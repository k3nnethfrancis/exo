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

export async function startServer({ root, graphbenchRoot }) {
  let fixturePath = null;
  const graphwaguRoot = path.join(graphbenchRoot, '.cache', 'graphwagu', 'dist');
  const vendor = new Map([
    ['/graphbench/vendor/graphology.umd.min.js', path.join(graphbenchRoot, 'node_modules/graphology/dist/graphology.umd.min.js')],
    ['/graphbench/vendor/sigma.min.js', path.join(graphbenchRoot, 'node_modules/sigma/dist/sigma.min.js')],
  ]);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let filePath = null;
    if (pathname === '/__graphbench_fixture__.json') filePath = fixturePath;
    else if (vendor.has(pathname)) filePath = vendor.get(pathname);
    else if (pathname === '/GraphWaGu' || pathname === '/GraphWaGu/') filePath = path.join(graphwaguRoot, 'index.html');
    else if (pathname.startsWith('/GraphWaGu/')) {
      const relative = pathname.slice('/GraphWaGu/'.length);
      const resolved = path.resolve(graphwaguRoot, relative);
      const prefix = `${path.resolve(graphwaguRoot)}${path.sep}`;
      if (resolved !== path.resolve(graphwaguRoot) && !resolved.startsWith(prefix)) return response.writeHead(403).end();
      filePath = resolved;
    }
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
