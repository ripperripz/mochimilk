import test from 'node:test';
import assert from 'node:assert/strict';
import { ticket, canBake, levelOf, shiftSize } from '../src/model.js';

const fresh = () => ({ day: 1, slot: 0, served: 0, xp: 0, stock: { flour: 20, milk: 14, berry: 12, sugar: 12 } });

test('day one alternates the two starter treats and guests rotate', () => {
  const state = fresh();
  assert.deepEqual([0, 1, 2, 3, 4].map(offset => ticket(state, offset).product.id),
    ['shortcake', 'cookie', 'shortcake', 'cookie', 'shortcake']);
  assert.equal(ticket(state).customer.name, 'Miso');
  assert.equal(ticket(state, shiftSize), null);
});

test('levels unlock new treats only from the next shift', () => {
  assert.equal(levelOf(2), 1);
  assert.equal(levelOf(3), 2);
  // Five sales mid-shift: the menu still uses the level the shift started with.
  assert.equal(ticket({ ...fresh(), slot: 4, served: 4, xp: 4 }).product.id, 'shortcake');
  assert.equal(ticket({ ...fresh(), day: 2, xp: 5 }).product.id, 'mochi');
});

test('canBake checks every recipe portion against stock', () => {
  const state = fresh();
  assert.equal(canBake(state, ticket(state).product), true);
  state.stock.berry = 1;
  assert.equal(canBake(state, ticket(state).product), false);
});
