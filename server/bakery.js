// Bakery API: the same endpoints, SQL, and transactions as the former Spring Boot service,
// running as a Node.js function on PostgreSQL (Neon in production, Docker Compose locally).
import { readFileSync } from 'node:fs';
import pg from 'pg';

const SHIFT_SIZE = 5;
const REFILL_PORTIONS = 6;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

// COUNT/SUM/BIGINT columns arrive as strings by default; return them as JSON numbers.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const sqlFile = name => readFileSync(new URL('../db/' + name, import.meta.url), 'utf8');

let pool;
let ready;

function database() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
      || 'postgresql://sugarberry:sugarberry@127.0.0.1:5432/sugarberry';
    pool = new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_SIZE || 3) });
  }
  // Create tables and seed the catalog once per instance. Both files are idempotent,
  // and the advisory lock keeps simultaneous cold starts from racing each other.
  ready ??= transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(724501)');
    await db.query(sqlFile('schema.sql'));
    await db.query(sqlFile('data.sql'));
  }, false).catch(error => { ready = undefined; throw error; });
  return ready.then(() => pool);
}

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}
const missing = () => new HttpError(404, 'Bakery profile not found.');
const conflict = detail => new HttpError(409, detail);
const badRequest = detail => new HttpError(400, detail);

async function transaction(work, init = true, begin = 'BEGIN') {
  const client = await (init ? database() : Promise.resolve(pool)).then(p => p.connect());
  try {
    await client.query(begin);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
const readOnly = work => transaction(work, true, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const rows = async (db, sql, params = []) => (await db.query(sql, params)).rows;

async function player(db, id, lock = false) {
  const [found] = await rows(db, `
    SELECT name, day, slot, served, coins, xp, oven, decor, revision, last_request
    FROM players WHERE id = $1` + (lock ? ' FOR UPDATE' : ''), [id]);
  if (!found) throw missing();
  return found;
}

async function menu(db, level) {
  const products = new Map();
  for (const row of await rows(db, `
    SELECT p.id, p.name, p.price, p.unlock_level, r.ingredient_id, r.portions
    FROM products p
    JOIN recipe_ingredients r ON r.product_id = p.id
    WHERE p.unlock_level <= $1
    ORDER BY p.menu_position, r.ingredient_id`, [level])) {
    if (!products.has(row.id)) {
      products.set(row.id, { id: row.id, name: row.name, price: row.price, level: row.unlock_level, recipe: {} });
    }
    products.get(row.id).recipe[row.ingredient_id] = row.portions;
  }
  return [...products.values()];
}

const customers = db => rows(db, 'SELECT id, name, species FROM customers ORDER BY rotation');

async function snapshot(db, id) {
  const p = await player(db, id);
  const stock = {};
  for (const row of await rows(db, `
    SELECT ingredient_id, quantity FROM inventory WHERE player_id = $1 ORDER BY ingredient_id`, [id])) {
    stock[row.ingredient_id] = row.quantity;
  }
  const history = await rows(db, `
    SELECT o.day, o.slot, c.name AS customer, p.name AS product,
           oi.quantity::bigint * oi.unit_price + o.bonus AS total
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN order_items oi ON oi.order_id = o.id
    JOIN products p ON p.id = oi.product_id
    WHERE o.player_id = $1
    ORDER BY o.day DESC, o.slot DESC, p.menu_position LIMIT 20`, [id]);
  return {
    name: p.name, day: p.day, slot: p.slot, served: p.served, coins: p.coins, xp: p.xp,
    oven: p.oven, decor: p.decor, revision: p.revision, stock, history,
  };
}

async function tables(db, id) {
  const result = {
    ingredients: await rows(db, 'SELECT id, name, refill_price, starting_stock FROM ingredients ORDER BY id'),
    products: await rows(db, 'SELECT id, name, price, unlock_level FROM products ORDER BY menu_position'),
    recipe_ingredients: await rows(db, `
      SELECT product_id, ingredient_id, portions
      FROM recipe_ingredients ORDER BY product_id, ingredient_id`),
    customers: await rows(db, 'SELECT id, name, species, rotation FROM customers ORDER BY rotation'),
  };
  if (!id) return result;
  result.players = await rows(db, 'SELECT id, name, coins, xp, day, slot FROM players WHERE id = $1', [id]);
  result.inventory = await rows(db, `
    SELECT player_id, ingredient_id, quantity FROM inventory
    WHERE player_id = $1 ORDER BY ingredient_id`, [id]);
  result.orders = await rows(db, `
    SELECT id, player_id, customer_id, day, slot, bonus FROM orders
    WHERE player_id = $1 ORDER BY day DESC, slot DESC LIMIT 20`, [id]);
  result.order_items = await rows(db, `
    SELECT i.order_id, i.product_id, i.quantity, i.unit_price
    FROM order_items i
    JOIN (SELECT id FROM orders WHERE player_id = $1
          ORDER BY day DESC, slot DESC LIMIT 20) o ON o.id = i.order_id
    ORDER BY i.order_id DESC, i.product_id`, [id]);
  return result;
}

function requireOpen(p) {
  if (p.slot >= SHIFT_SIZE) throw conflict('The shift is already over.');
}

async function serve(db, id, p, perfect) {
  requireOpen(p);
  const products = await menu(db, 1 + Math.trunc((p.xp - p.served) / 3));
  const guests = await customers(db);
  const product = products[((p.day - 1) * SHIFT_SIZE + p.slot) % products.length];
  const customer = guests[(p.slot + p.day - 1) % guests.length];

  for (const [ingredient, portions] of Object.entries(product.recipe)) {
    const { rowCount } = await db.query(`
      UPDATE inventory SET quantity = quantity - $1
      WHERE player_id = $2 AND ingredient_id = $3 AND quantity >= $1`, [portions, id, ingredient]);
    if (rowCount !== 1) throw conflict('You’re short on ingredients. Refill your pantry.');
  }

  const bonus = (perfect ? 4 : 0) + (p.decor ? 2 : 0);
  const [order] = await rows(db, `
    INSERT INTO orders (player_id, customer_id, day, slot, bonus)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`, [id, customer.id, p.day, p.slot, bonus]);
  await db.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, $3)',
    [order.id, product.id, product.price]);
  await db.query(`
    UPDATE players SET coins = coins + $1, xp = xp + 1, slot = slot + 1, served = served + 1
    WHERE id = $2`, [product.price + bonus, id]);
}

async function restock(db, id, p, item) {
  const [ingredient] = await rows(db, 'SELECT refill_price FROM ingredients WHERE id = $1', [item]);
  if (!ingredient) throw badRequest('Unknown ingredient.');
  if (p.coins < ingredient.refill_price) throw conflict('You need more coins.');
  await db.query('UPDATE players SET coins = coins - $1 WHERE id = $2', [ingredient.refill_price, id]);
  await db.query(`
    INSERT INTO inventory (player_id, ingredient_id, quantity) VALUES ($1, $2, $3)
    ON CONFLICT (player_id, ingredient_id)
    DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity`, [id, item, REFILL_PORTIONS]);
}

async function upgrade(db, id, p, item) {
  if (item === 'oven' && !p.oven && p.coins >= 40) {
    await db.query('UPDATE players SET coins = coins - 40, oven = TRUE WHERE id = $1', [id]);
  } else if (item === 'decor' && !p.decor && p.coins >= 28) {
    await db.query('UPDATE players SET coins = coins - 28, decor = TRUE WHERE id = $1', [id]);
  } else {
    throw conflict('This upgrade is unavailable.');
  }
}

async function act(id, a) {
  const integer = value => Number.isInteger(value);
  if (typeof a.action !== 'string' || typeof a.requestId !== 'string' || !UUID.test(a.requestId)
      || !integer(a.revision) || !integer(a.day) || !integer(a.slot)) {
    throw badRequest('Action, request ID, revision, day, and slot are required.');
  }
  return transaction(async db => {
    const p = await player(db, id, true);
    // A retried request that already succeeded returns the confirmed state.
    if (p.last_request && p.last_request.toLowerCase() === a.requestId.toLowerCase()) return snapshot(db, id);
    if (a.revision !== p.revision || a.day !== p.day || a.slot !== p.slot) {
      throw conflict('Your shift changed. Please use the latest ticket.');
    }
    switch (a.action) {
      case 'serve': await serve(db, id, p, a.perfect === true); break;
      case 'skip':
        requireOpen(p);
        await db.query('UPDATE players SET slot = slot + 1 WHERE id = $1', [id]);
        break;
      case 'next':
        if (p.slot !== SHIFT_SIZE) throw conflict('Finish the current shift first.');
        await db.query('UPDATE players SET day = day + 1, slot = 0, served = 0 WHERE id = $1', [id]);
        break;
      case 'restock': await restock(db, id, p, a.item); break;
      case 'upgrade': await upgrade(db, id, p, a.item); break;
      default: throw badRequest('Unknown bakery action.');
    }
    await db.query('UPDATE players SET revision = revision + 1, last_request = $1 WHERE id = $2', [a.requestId, id]);
    return snapshot(db, id);
  });
}

const api = {
  tables: () => readOnly(db => tables(db, null)),
  playerTables: id => readOnly(db => tables(db, id)),
  catalog: () => readOnly(async db => ({
    products: await menu(db, 2147483647),
    ingredients: (await rows(db, 'SELECT id, name, refill_price FROM ingredients ORDER BY id'))
      .map(row => ({ id: row.id, name: row.name, price: row.refill_price })),
    customers: await customers(db),
  })),
  create: id => transaction(async db => {
    const { rowCount } = await db.query('INSERT INTO players (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    if (rowCount === 1) {
      await db.query(`
        INSERT INTO inventory (player_id, ingredient_id, quantity)
        SELECT $1, id, starting_stock FROM ingredients`, [id]);
    }
    return snapshot(db, id);
  }),
  read: id => readOnly(db => snapshot(db, id)),
  rename: (id, name) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) {
      throw badRequest('Use a name of 1 to 40 characters.');
    }
    return transaction(async db => {
      const { rowCount } = await db.query(
        'UPDATE players SET name = $1, revision = revision + 1 WHERE id = $2', [name.trim(), id]);
      if (rowCount === 0) throw missing();
      return snapshot(db, id);
    });
  },
  remove: id => transaction(async db => {
    if ((await db.query('DELETE FROM players WHERE id = $1', [id])).rowCount === 0) throw missing();
  }),
  act,
  sales: id => readOnly(async db => {
    await player(db, id);
    return rows(db, `
      SELECT o.day, COUNT(*) AS orders, SUM(t.items_total + o.bonus) AS revenue
      FROM orders o
      JOIN (
          SELECT oi.order_id, SUM(oi.quantity::bigint * oi.unit_price) AS items_total
          FROM order_items oi JOIN orders own ON own.id = oi.order_id
          WHERE own.player_id = $1
          GROUP BY oi.order_id
      ) t ON t.order_id = o.id
      WHERE o.player_id = $1
      GROUP BY o.day ORDER BY o.day`, [id]);
  }),
};

const problem = (status, detail) => ({
  status, body: { type: 'about:blank', title: { 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict' }[status] || 'Internal Server Error', status, detail },
});

/** Route one request. `route` is the path after /api/, e.g. "players/<uuid>/actions". */
export async function handle(method, route, body) {
  const parts = String(route || '').replace(/^\/+|\/+$/g, '').split('/');
  let routes;
  if (parts.length === 1 && parts[0] === 'catalog') routes = { GET: api.catalog };
  else if (parts.length === 1 && parts[0] === 'tables') routes = { GET: api.tables };
  else if (parts[0] === 'players' && UUID.test(parts[1] || '') && parts.length <= 3) {
    const id = parts[1].toLowerCase();
    const sub = parts[2];
    if (sub === undefined) {
      routes = {
        PUT: () => api.create(id), GET: () => api.read(id),
        PATCH: () => api.rename(id, body?.name), DELETE: () => api.remove(id),
      };
    } else if (sub === 'actions') routes = { POST: () => api.act(id, body || {}) };
    else if (sub === 'sales') routes = { GET: () => api.sales(id) };
    else if (sub === 'tables') routes = { GET: () => api.playerTables(id) };
  }
  if (!routes) return problem(404, 'Unknown bakery API route.');
  if (!routes[method]) return { ...problem(405, 'Method not allowed.'), allow: Object.keys(routes).join(', ') };
  try {
    const result = await routes[method]();
    return result === undefined ? { status: 204 } : { status: 200, body: result };
  } catch (error) {
    if (error instanceof HttpError) return problem(error.status, error.message);
    // A concurrent duplicate ticket hits UNIQUE (player_id, day, slot); a CHECK catches bad state.
    if (error.code === '23505' || error.code === '23514') return problem(409, 'Your shift changed. Please use the latest ticket.');
    console.error(error);
    return problem(500, 'The bakery database is unavailable.');
  }
}
