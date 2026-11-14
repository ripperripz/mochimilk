// End-to-end against a real PostgreSQL through the Vercel handler. Skips when no database is reachable.
// Uses DATABASE_URL, or the Compose database on 127.0.0.1:5432.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import handler from '../api/bakery.js';
import { close, connectionString } from '../server/bakery.js';
import { products } from '../src/model.js';
import { call } from './mock.js';

delete process.env.VERCEL;
const probe = new pg.Client({ connectionString: connectionString(), connectionTimeoutMillis: 2000 });
const reachable = await probe.connect().then(() => probe.end().then(() => true), () => false);
const skip = reachable ? false : 'PostgreSQL is not reachable';

const api = async (method, route, body, expected = 200) => {
  const response = await call(handler, method, '/api/bakery?route=' + route, body);
  assert.equal(response.statusCode, expected, JSON.stringify(response.body));
  return response.body;
};
const act = (id, state, action, extra = {}) => api('POST', `players/${id}/actions`, {
  action, day: state.day, slot: state.slot, revision: state.revision, requestId: crypto.randomUUID(), ...extra,
});

test.after(() => close());

test('the client catalog matches the seeded database', { skip }, async () => {
  const catalog = await api('GET', 'catalog');
  assert.deepEqual(catalog.products.map(({ id, price, level, recipe }) => ({ id, price, level, recipe })),
    products.map(({ id, price, level, recipe }) => ({ id, price, level, recipe })));
});

test('a full shift persists: five serves, next day, restock, upgrade, then a fresh pool', { skip }, async () => {
  const id = crypto.randomUUID();
  let state = await api('PUT', 'players/' + id);
  try {
    assert.deepEqual(await api('PUT', 'players/' + id), state, 'PUT reopens instead of resetting');
    for (let i = 0; i < 5; i++) state = await act(id, state, 'serve', { perfect: i % 2 === 0 });
    assert.equal(state.slot, 5);
    assert.equal(state.served, 5);
    // Shortcake 16, cookie 12 alternating, +4 on perfect bakes (slots 0, 2, 4).
    assert.equal(state.coins, 24 + 16 * 3 + 12 * 2 + 4 * 3);
    assert.deepEqual(state.stock, { flour: 10, milk: 9, berry: 6, sugar: 10 });
    await api('POST', `players/${id}/actions`, { action: 'serve', day: 1, slot: 5, revision: state.revision, requestId: crypto.randomUUID() }, 409);

    state = await act(id, state, 'next');
    assert.deepEqual([state.day, state.slot, state.served], [2, 0, 0]);
    state = await act(id, state, 'restock', { item: 'berry' });
    assert.equal(state.stock.berry, 12);
    state = await act(id, state, 'upgrade', { item: 'oven' });
    assert.equal(state.oven, true);
    await api('POST', `players/${id}/actions`, { action: 'upgrade', item: 'oven', day: 2, slot: 0, revision: state.revision, requestId: crypto.randomUUID() }, 409);
    await api('POST', `players/${id}/actions`, { action: 'upgrade', item: 'coins', day: 2, slot: 0, revision: state.revision, requestId: crypto.randomUUID() }, 400);
    // Level 2 from yesterday's five sales puts Garden Mochi on day 2.
    state = await act(id, state, 'serve', { perfect: false });
    assert.equal(state.history[0].product, 'Garden Mochi');

    // A stale revision (another device moved on) is rejected without changing anything.
    await api('POST', `players/${id}/actions`, { action: 'skip', day: 2, slot: 1, revision: state.revision - 1, requestId: crypto.randomUUID() }, 409);

    const tables = await api('GET', `players/${id}/tables`);
    assert.equal(tables.orders.length, 6);
    assert.equal(tables.order_items.length, 6);
    assert.equal(tables.players[0].coins, state.coins);

    // Simulate a restart (new instance, new pool): everything comes back from PostgreSQL.
    await close();
    assert.deepEqual(await api('GET', 'players/' + id), state);
    assert.deepEqual(await api('GET', `players/${id}/sales`), [
      { day: 1, orders: 5, revenue: 16 * 3 + 12 * 2 + 4 * 3 },
      { day: 2, orders: 1, revenue: 22 },
    ]);
  } finally {
    await api('DELETE', 'players/' + id, undefined, 204);
  }
  await api('GET', 'players/' + id, undefined, 404);
  const gone = await api('GET', `players/${id}/tables`);
  assert.equal(gone.orders.length, 0, 'ON DELETE CASCADE removed the orders');
});

test('a short pantry rolls back the whole sale', { skip }, async () => {
  const id = crypto.randomUUID();
  let state = await api('PUT', 'players/' + id);
  try {
    const db = new pg.Client({ connectionString: connectionString() });
    await db.connect();
    await db.query("UPDATE inventory SET quantity = 1 WHERE player_id = $1 AND ingredient_id = 'berry'", [id]);
    await db.end();
    state = await api('GET', 'players/' + id);
    await api('POST', `players/${id}/actions`, { action: 'serve', day: 1, slot: 0, revision: state.revision, requestId: crypto.randomUUID() }, 409);
    const after = await api('GET', 'players/' + id);
    assert.deepEqual(after, state, 'flour and milk were not deducted');
  } finally {
    await api('DELETE', 'players/' + id, undefined, 204);
  }
});
