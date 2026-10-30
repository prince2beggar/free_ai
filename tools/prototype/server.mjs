import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function readConfig(env) {
  const host = env.PROTOTYPE_HOST ?? '127.0.0.1';
  const mode = env.PROTOTYPE_MODE ?? 'synthetic';
  const rawPort = env.PROTOTYPE_PORT ?? '4173';
  if (
    host !== '127.0.0.1' ||
    mode !== 'synthetic' ||
    !/^[1-9]\d{0,4}$/.test(rawPort) ||
    Number(rawPort) > 65535
  )
    throw new Error('Prototype requires loopback, synthetic mode and a valid port.');
  return { host, port: Number(rawPort), mode };
}

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/main.js', ['main.js', 'text/javascript; charset=utf-8']],
  ['/mock.js', ['mock.js', 'text/javascript; charset=utf-8']],
  ['/demo.json', ['demo.json', 'application/json; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
export function createPreviewServer() {
  const server = http.createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const deny = (code, text) => {
      response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(text);
    };
    const address = server.address();
    const authority = `127.0.0.1:${address.port}`;
    if (request.headers.host !== authority) return deny(421, 'Local preview only.');
    if (request.headers.origin !== undefined && request.headers.origin !== `http://${authority}`)
      return deny(403, 'Origin refused.');
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return deny(405, 'Read-only preview.');
    const asset = assets.get(request.url);
    if (!asset) return deny(404, 'Not found.');
    try {
      const content = await readFile(new URL(`../../apps/web/dist/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      deny(503, 'Build the local preview before starting.');
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const config = readConfig({
      PROTOTYPE_HOST: process.env.PROTOTYPE_HOST,
      PROTOTYPE_PORT: process.env.PROTOTYPE_PORT,
      PROTOTYPE_MODE: process.env.PROTOTYPE_MODE,
    });
    const server = createPreviewServer();
    server.on('error', () => {
      console.error('Local preview could not start. Check the configured port.');
      process.exitCode = 1;
    });
    server.listen(config.port, config.host, () =>
      console.log(`Synthetic local preview: http://${config.host}:${config.port}`),
    );
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
  } catch {
    console.error('Invalid prototype environment. Use loopback, synthetic mode and a valid port.');
    process.exitCode = 1;
  }
}
