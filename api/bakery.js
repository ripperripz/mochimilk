import { handle } from '../server/bakery.js';

// Vercel Node.js function. vercel.json rewrites /api/<route> to /api/bakery?route=<route>.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let body;
  try {
    // Vercel parses JSON lazily and throws on a malformed body.
    body = typeof request.body === 'string' ? JSON.parse(request.body || 'null') : request.body;
  } catch {
    return response.status(400).json({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Send a JSON request body.' });
  }
  const route = request.query?.route
    ?? new URL(request.url, 'http://localhost').pathname.replace(/^\/api\/?/, '');
  const result = await handle(request.method, Array.isArray(route) ? route.join('/') : route, body);
  if (result.allow) response.setHeader('Allow', result.allow);
  if (result.status === 204) return response.status(204).end();
  return response.status(result.status).json(result.body);
}
