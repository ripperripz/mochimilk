// Calls api/bakery.js the way Vercel does, with a request/response pair and no database.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL = '1';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
const { default: handler } = await import('../api/bakery.js');
const { call: mock } = await import('./mock.js');

const call = (...args) => mock(handler, ...args);

test('without DATABASE_URL on Vercel the API answers 503 JSON instead of trying localhost', async () => {
  const response = await call('GET', '/api/bakery?route=catalog');
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body.detail, /DATABASE_URL/);
});

test('routing errors are JSON and never touch the database', async () => {
  assert.equal((await call('GET', '/api/bakery?route=nope')).statusCode, 404);
  const wrongMethod = await call('DELETE', '/api/bakery?route=catalog');
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, 'GET');
  const badId = await call('GET', '/api/bakery?route=players/not-a-uuid');
  assert.equal(badId.statusCode, 404);
  assert.equal(badId.body.title, 'Not Found');
});

test('a malformed JSON body is a 400', async () => {
  const response = await call('POST', '/api/bakery?route=players/' + crypto.randomUUID() + '/actions', '{oops');
  assert.equal(response.statusCode, 400);
});

test('the route falls back to the request path when there is no ?route=', async () => {
  const response = await call('GET', '/api/catalog');
  assert.equal(response.statusCode, 503);
});
