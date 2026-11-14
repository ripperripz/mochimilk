import { PGliteWorker } from '@electric-sql/pglite/worker';

const database = PGliteWorker.create(
  new Worker(new URL('./demo-db-worker.js', import.meta.url), { type: 'module' }),
  { dataDir: 'idb://sugarberry-demo' },
);

async function rows(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}

async function readPlayer(db, id) {
  const [player] = await rows(db, 'SELECT name, coins, day, slot, revision FROM players WHERE id = $1', [id]);
  if (!player) throw Object.assign(Error('Demo profile not found.'), { status: 404 });
  const stock = await rows(db, 'SELECT ingredient_id, quantity FROM inventory WHERE player_id = $1', [id]);
  return { ...player, stock: Object.fromEntries(stock.map(row => [row.ingredient_id, row.quantity])) };
}

export async function read(id) {
  return readPlayer(await database, id);
}

export async function create(id) {
  return (await database).transaction(async tx => {
    const result = await tx.query('INSERT INTO players (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    if (result.affectedRows === 1) {
      await tx.query('INSERT INTO inventory SELECT $1, id, starting_stock FROM ingredients', [id]);
    }
    return readPlayer(tx, id);
  });
}

export async function rename(id, name) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 40) throw Error('Use a name of 1 to 40 characters.');
  return (await database).transaction(async tx => {
    await tx.query('UPDATE players SET name = $2, revision = revision + 1 WHERE id = $1', [id, trimmed]);
    return readPlayer(tx, id);
  });
}

export async function remove(id) {
  await (await database).query('DELETE FROM players WHERE id = $1', [id]);
}

export async function serve(id, expected) {
  return (await database).transaction(async tx => {
    const [player] = await rows(tx, 'SELECT * FROM players WHERE id = $1 FOR UPDATE', [id]);
    if (!player || player.revision !== expected.revision || player.slot >= 5) {
      throw Error('The shift changed. Refresh the records and try again.');
    }
    const menu = await rows(tx, 'SELECT id, price FROM products WHERE unlock_level <= $1 ORDER BY menu_position',
      [1 + Math.floor((player.xp - player.served) / 3)]);
    const product = menu[((player.day - 1) * 5 + player.slot) % menu.length];
    const guests = await rows(tx, 'SELECT id FROM customers ORDER BY rotation');
    const customer = guests[(player.day - 1 + player.slot) % guests.length];
    const recipe = await rows(tx, 'SELECT ingredient_id, portions FROM recipe_ingredients WHERE product_id = $1 ORDER BY ingredient_id', [product.id]);
    for (const { ingredient_id, portions } of recipe) {
      const update = await tx.query(
        'UPDATE inventory SET quantity = quantity - $3 WHERE player_id = $1 AND ingredient_id = $2 AND quantity >= $3',
        [id, ingredient_id, portions],
      );
      if (update.affectedRows !== 1) throw Error('Insufficient ingredients. The sale was rolled back.');
    }
    const bonus = 4 + (player.decor ? 2 : 0);
    const [order] = await rows(tx, `
      INSERT INTO orders (player_id, customer_id, day, slot, bonus)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [id, customer.id, player.day, player.slot, bonus]);
    await tx.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, $3)',
      [order.id, product.id, product.price]);
    await tx.query(`
      UPDATE players SET coins = coins + $2, xp = xp + 1, served = served + 1,
        slot = slot + 1, revision = revision + 1 WHERE id = $1
    `, [id, product.price + bonus]);
    return readPlayer(tx, id);
  });
}

export async function tables(id) {
  return (await database).transaction(async tx => {
    const catalog = {
      ingredients: await rows(tx, 'SELECT * FROM ingredients ORDER BY id'),
      products: await rows(tx, 'SELECT * FROM products ORDER BY menu_position'),
      recipe_ingredients: await rows(tx, 'SELECT * FROM recipe_ingredients ORDER BY product_id, ingredient_id'),
      customers: await rows(tx, 'SELECT * FROM customers ORDER BY rotation'),
    };
    if (!id) return catalog;
    return {
      ...catalog,
      players: await rows(tx, 'SELECT id, name, coins, xp, day, slot FROM players WHERE id = $1', [id]),
      inventory: await rows(tx, 'SELECT * FROM inventory WHERE player_id = $1 ORDER BY ingredient_id', [id]),
      orders: await rows(tx, 'SELECT * FROM orders WHERE player_id = $1 ORDER BY day DESC, slot DESC LIMIT 20', [id]),
      order_items: await rows(tx, `
        SELECT i.* FROM order_items i
        JOIN (SELECT id FROM orders WHERE player_id = $1 ORDER BY day DESC, slot DESC LIMIT 20) o
          ON i.order_id = o.id
        ORDER BY i.order_id DESC, i.product_id
      `, [id]),
    };
  });
}

export async function sales(id) {
  return rows(await database, `
    SELECT day, COUNT(*) AS orders, SUM(total) AS revenue
    FROM (
      SELECT o.day, SUM(i.quantity::bigint * i.unit_price) + o.bonus AS total
      FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.player_id = $1
      GROUP BY o.id
    ) order_totals
    GROUP BY day ORDER BY day
  `, [id]);
}
