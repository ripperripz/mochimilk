import assert from 'node:assert/strict';

const base = process.env.BAKERY_API || 'http://127.0.0.1:8080';
const id = crypto.randomUUID();
const path = '/players/' + id;
async function api(url, method = 'GET', body, expected = 200) {
  const response = await fetch(base + '/api' + url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  assert.equal(response.status, expected, text);
  return text ? JSON.parse(text) : null;
}
const action = (state, data) => ({
  day: state.day, slot: state.slot, revision: state.revision, requestId: crypto.randomUUID(), ...data,
});
const catalog = await api('/catalog');
assert.equal(catalog.products[0].recipe.flour, 2);
let player = await api(path, 'PUT');
try {
  assert.equal(player.coins, 24);
  assert.equal(player.stock.flour, 20);
  player = await api(path, 'PATCH', { name: 'Viva Bakery' });
  assert.equal(player.name, 'Viva Bakery');
  assert.equal((await api(path)).name, 'Viva Bakery');

  const sale = action(player, { action: 'serve', perfect: true });
  const results = await Promise.all([
    api(path + '/actions', 'POST', sale),
    api(path + '/actions', 'POST', sale),
  ]);
  player = results[0];
  assert.deepEqual(results[0], results[1]);
  assert.equal(player.coins, 44);
  assert.equal(player.stock.berry, 10);
  assert.equal(player.history.length, 1);
  assert.equal(player.history[0].product, 'Berry Shortcake');
  await api(path + '/actions', 'POST', { ...sale, requestId: crypto.randomUUID() }, 409);
  assert.deepEqual(await api(path + '/sales'), [{ day: 1, orders: 1, revenue: 20 }]);
  const tables = await api(path + '/tables');
  assert.equal(tables.orders.length, 1);
  assert.equal(tables.order_items[0].order_id, tables.orders[0].id);
  assert.equal(tables.inventory.find(row => row.ingredient_id === 'berry').quantity, 10);

  player = await api(path + '/actions', 'POST', action(player, { action: 'upgrade', item: 'oven' }));
  assert.equal(player.oven, true);
  player = await api(path + '/actions', 'POST', action(player, { action: 'restock', item: 'flour' }));
  assert.equal(player.stock.flour, 24);
  assert.equal(player.coins, 0);
  await api(path + '/actions', 'POST', action(player, { action: 'restock', item: 'flour' }), 409);
  assert.deepEqual(await api(path), player);
  console.log('PostgreSQL smoke passed against ' + base + ': CRUD, recipe join, concurrent retry, sales aggregation, table view, upgrade, refill, rejected purchase.');
} finally {
  await api(path, 'DELETE', undefined, 204);
}
await api(path, 'GET', undefined, 404);
