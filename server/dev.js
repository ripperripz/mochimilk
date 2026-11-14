// Local API server for `npm run dev` (Vite proxies /api here). Uses DATABASE_URL or the Compose database.
import { createServer } from 'node:http';
import { handle } from './bakery.js';

const port = Number(process.env.PORT || 8080);
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const send = (status, body, headers = {}) => {
    response.writeHead(status, { 'Cache-Control': 'no-store', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers });
    response.end(body === undefined ? undefined : JSON.stringify(body));
  };
  if (!url.pathname.startsWith('/api/')) return send(404, { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Not found.' });
  let text = '';
  for await (const chunk of request) text += chunk;
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { return send(400, { type: 'about:blank', title: 'Bad Request', status: 400, detail: 'Send a JSON request body.' }); }
  const result = await handle(request.method, url.pathname.slice(5), body);
  send(result.status, result.body, result.allow ? { Allow: result.allow } : {});
}).listen(port, '127.0.0.1', () => console.log(`Bakery API on http://127.0.0.1:${port}`));
