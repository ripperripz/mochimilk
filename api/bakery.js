import { handle } from '../server/bakery.js';

// Vercel Node.js function. vercel.json rewrites /api/* here with ?route=<path after /api/>.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  let body;
  try {
    body = typeof request.body === 'string' ? JSON.parse(request.body || 'null') : request.body;
  } catch {
    return response.status(400).json({ status: 400, title: 'Bad Request', detail: 'Send a JSON request body.' });
  }
  const result = await handle(request.method, request.query.route, body);
  if (result.allow) response.setHeader('Allow', result.allow);
  if (result.status === 204) return response.status(204).end();
  return response.status(result.status).json(result.body);
}
