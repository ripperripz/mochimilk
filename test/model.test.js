import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, ticket, updateLocal, canBake } from '../src/model.js';

test('a perfect sale spends portions, awards coins, and advances one ticket', () => {
  const before = newGame();
  const after = updateLocal(before, { action: 'serve', perfect: true });
  assert.deepEqual(after.stock, { flour: 18, milk: 13, berry: 10, sugar: 12 });
  assert.equal(after.coins, 44);
  assert.equal(after.history[0].customer, 'Miso');
  assert.equal(after.slot, 1);
  assert.equal(after.xp, 1);
  assert.equal(before.stock.flour, 20);
});

test('a completed shift introduces unlocked treats on the next day', () => {
  let state = newGame();
  assert.throws(() => updateLocal(state, { action: 'next' }));
  for (let i = 0; i < 5; i++) {
    assert.notEqual(ticket(state).product.id, 'mochi');
    state = updateLocal(state, { action: 'serve' });
  }
  assert.equal(ticket(state), null);
  state = updateLocal(state, { action: 'next' });
  assert.equal(state.day, 2);
  assert.equal(state.served, 0);
  assert.equal(ticket(state).product.id, 'mochi');
});

test('refills rescue a blocked ticket and decoration increases the sale', () => {
  let state = newGame();
  state.coins = 40;
  state.stock.flour = 0;
  assert.equal(canBake(state, ticket(state).product), false);
  assert.throws(() => updateLocal(state, { action: 'serve' }));
  state = updateLocal(state, { action: 'restock', item: 'flour' });
  assert.equal(state.stock.flour, 6);
  state = updateLocal(state, { action: 'upgrade', item: 'decor' });
  assert.throws(() => updateLocal(state, { action: 'upgrade', item: 'decor' }));
  state = updateLocal(state, { action: 'serve' });
  assert.equal(state.history[0].total, 18);
  assert.equal(state.coins, 26);
});

test('passing on a guest consumes a ticket but makes no sale', () => {
  const state = updateLocal(newGame(), { action: 'skip' });
  assert.equal(state.slot, 1);
  assert.equal(state.xp, 0);
  assert.equal(state.coins, 24);
  assert.deepEqual(state.history, []);
});
