'use strict';
// A deliberately insecure website used by the tests. `state` can be mutated
// between scans to simulate the owner fixing (or re-introducing) issues.
const http = require('node:http');

function createFixtureSite() {
  const state = { exposeEnv: true, exposeGit: true, oldJquery: true, csp: false, insecureCookie: true };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'TRACE') {
      res.writeHead(200, { 'Content-Type': 'message/http' });
      return res.end(`TRACE ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}`);
    }
    if (url.pathname === '/.env' && state.exposeEnv) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('APP_KEY=base64:abcdef\nDB_PASSWORD=supersecret\n');
    }
    if (url.pathname === '/.git/HEAD' && state.exposeGit) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ref: refs/heads/main\n');
    }
    if (url.pathname === '/uploads/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><head><title>Index of /uploads</title></head><body><a href="a.pdf">a.pdf</a></body></html>');
    }
    if (url.pathname !== '/') { res.writeHead(404); return res.end('not found'); }
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      Server: 'Apache/2.4.29 (Ubuntu)',
      'X-Powered-By': 'PHP/7.2.1',
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
    };
    if (state.csp) headers['Content-Security-Policy'] = "default-src 'self'; frame-ancestors 'self'";
    if (state.insecureCookie) headers['Set-Cookie'] = ['PHPSESSID=abc123; path=/', 'theme=dark; Path=/; HttpOnly; SameSite=Lax'];
    res.writeHead(200, headers);
    res.end(`<!doctype html><html><head><meta name="generator" content="WordPress 5.2.1">
      ${state.oldJquery ? '<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>' : '<script src="/app.js"></script>'}
      </head><body><form action="/login" method="post"><input type="password" name="pw"></form></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, state, url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) });
  }));
}

module.exports = { createFixtureSite };
