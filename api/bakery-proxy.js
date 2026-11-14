const playerRoute = /^players\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}(?:\/(actions|sales|tables))?$/i;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  const { route } = request.query;
  const player = typeof route === 'string' && playerRoute.exec(route);
  const catalogRoute = route === 'catalog' || route === 'tables';
  if (!catalogRoute && !player) {
    return response.status(404).json({ detail: 'Unknown bakery API route.' });
  }

  const methods = catalogRoute || player[1] === 'sales' || player[1] === 'tables' ? ['GET']
    : player[1] === 'actions' ? ['POST'] : ['GET', 'PUT', 'PATCH', 'DELETE'];
  if (!methods.includes(request.method)) {
    response.setHeader('Allow', methods.join(', '));
    return response.status(405).json({ detail: 'Method not allowed.' });
  }

  const configuredOrigin = process.env.BAKERY_API_ORIGIN || '';
  const origin = URL.canParse(configuredOrigin) ? new URL(configuredOrigin) : null;
  if (!origin || origin.protocol !== 'https:' || origin.username || origin.password) {
    return response.status(503).json({
      detail: 'The hosted bakery API is not configured. Set BAKERY_API_ORIGIN in Vercel and redeploy.',
    });
  }

  try {
    const upstream = await fetch(new URL('/api/' + route, origin), {
      method: request.method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: ['POST', 'PATCH'].includes(request.method) && request.body !== undefined
        ? typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
        : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (upstream.status === 204) return response.status(204).end();

    const contentType = upstream.headers.get('content-type') || '';
    if (!/^application\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
      return response.status(502).json({ detail: 'The hosted bakery API did not return JSON. Check its deployment URL.' });
    }
    const body = await upstream.text();
    response.setHeader('Content-Type', contentType);
    return response.status(upstream.status).send(body);
  } catch {
    return response.status(502).json({ detail: 'The hosted bakery API could not be reached. Check that it is running.' });
  }
}
