import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
});

export async function startServer({ root }) {
  let fixturePath = null;
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let filePath = null;
    if (pathname === '/__graph_eval_fixture__.json') filePath = fixturePath;
    else {
      const relative = pathname.replace(/^\/+/, '') || 'index.html';
      const resolved = path.resolve(root, relative);
      if (resolved !== path.resolve(root) && !resolved.startsWith(rootPrefix)) return response.writeHead(403).end();
      filePath = resolved;
    }
    if (!filePath) return response.writeHead(404).end();
    const extension = path.extname(filePath);
    response.writeHead(200, {
      'content-type': MIME[extension] || 'application/octet-stream',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { if (!response.headersSent) response.writeHead(404); response.end(); });
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    setFixture(nextFixturePath) { fixturePath = nextFixturePath; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
