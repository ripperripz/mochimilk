// Minimal stand-in for Vercel's Node.js request/response helpers.
export function call(handler, method, url, body) {
  const query = Object.fromEntries(new URL(url, 'http://x').searchParams);
  const request = { method, url, query, body };
  return new Promise(resolve => {
    const response = {
      statusCode: 200, headers: {},
      setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; resolve(this); return this; },
      end() { resolve(this); return this; },
    };
    handler(request, response);
  });
}
