'use strict';
const http = require('node:http');
const https = require('node:https');
const { assertHostAllowed, guardedLookup } = require('./net-guard');

const USER_AGENT = 'SiteGuard-SecurityScanner/1.0 (+passive audit)';

/**
 * Single HTTP(S) request with SSRF guard, timeout and response size cap.
 * Never throws on HTTP status; throws on network errors.
 */
function request(url, opts = {}) {
  const {
    method = 'GET', headers = {}, maxBytes = 2 * 1024 * 1024, timeoutMs = 10000, allowPrivate = false,
  } = opts;
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error(`Invalid URL: ${url}`)); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error(`Unsupported protocol ${u.protocol}`));
    try { assertHostAllowed(u.hostname, allowPrivate); } catch (e) { return reject(e); }

    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
      lookup: guardedLookup(allowPrivate),
      rejectUnauthorized: false, // certificate problems are reported by the TLS check, not fatal here
      agent: false,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c) => {
        if (truncated) return;
        size += c.length;
        if (size > maxBytes) { truncated = true; chunks.push(c.subarray(0, c.length - (size - maxBytes))); res.destroy(); return; }
        chunks.push(c);
      });
      const done = () => {
        const body = Buffer.concat(chunks);
        resolve({
          url: u.toString(),
          status: res.statusCode,
          headers: res.headers,
          rawHeaders: res.rawHeaders,
          body,
          text: body.toString('utf8'),
          truncated,
        });
      };
      res.on('end', done);
      res.on('close', () => { if (truncated) done(); });
      res.on('error', (e) => (truncated ? done() : reject(e)));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`Timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/** Follows redirects manually (each hop goes through the SSRF guard). */
async function fetchFollow(url, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? 5;
  const chain = [];
  let current = url;
  for (let i = 0; i <= maxRedirects; i += 1) {
    const res = await request(current, opts);
    chain.push(res);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current).toString();
      continue;
    }
    return { final: res, chain };
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}

module.exports = { request, fetchFollow, USER_AGENT };
