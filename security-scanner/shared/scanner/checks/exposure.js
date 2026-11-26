'use strict';
// Probes a short list of well-known sensitive paths. Every probe requires a
// content signature, and soft-404 pages (200 for everything) are filtered out
// using a baseline request, so a match means the file really is there.
const crypto = require('node:crypto');

const PROBES = [
  { id: 'exposure.git', key: 'git', path: '/.git/HEAD', match: (t) => /^ref:\s*refs\/|^[0-9a-f]{40}\s*$/.test(t.trim()) },
  { id: 'exposure.git', key: 'git', path: '/.git/config', match: (t) => /\[core\]/.test(t) && !/<html/i.test(t) },
  { id: 'exposure.env', key: '.env', path: '/.env', match: (t) => /^\s*[A-Z][A-Z0-9_]*\s*=/m.test(t) && !/<(html|body|head)/i.test(t) },
  { id: 'exposure.svn', key: 'svn', path: '/.svn/wc.db', match: (t) => t.startsWith('SQLite format 3') },
  ...['/wp-config.php.bak', '/wp-config.php~', '/wp-config.php.save', '/wp-config.old', '/config.php.bak', '/configuration.php.bak']
    .map((path) => ({ id: 'exposure.backup_file', key: path, path, match: (t) => /<\?php|DB_PASSWORD|DB_NAME/.test(t) })),
  ...['/backup.sql', '/dump.sql', '/database.sql', '/db.sql']
    .map((path) => ({ id: 'exposure.sql_dump', key: path, path, match: (t) => /(CREATE TABLE|INSERT INTO|-- MySQL dump|PostgreSQL database dump)/i.test(t) && !/<html/i.test(t) })),
  { id: 'exposure.ds_store', key: '.DS_Store', path: '/.DS_Store', match: (t, b) => b.length > 8 && b.subarray(4, 8).toString('latin1') === 'Bud1' },
  { id: 'exposure.server_status', key: 'server-status', path: '/server-status', match: (t) => /Apache Server Status/i.test(t) },
  ...['/phpinfo.php', '/info.php']
    .map((path) => ({ id: 'exposure.phpinfo', key: path, path, match: (t) => /<title>phpinfo\(\)<\/title>|PHP Version \d+\.\d+/i.test(t) })),
  ...['/uploads/', '/images/', '/backup/', '/files/']
    .map((path) => ({ id: 'exposure.directory_listing', key: path, path, match: (t) => LISTING.test(t) })),
];
const LISTING = /<title>\s*(Index of \/|Directory listing for \/)/i;

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

const hash = (b) => crypto.createHash('sha1').update(b).digest('hex');

module.exports = async function exposureCheck(ctx) {
  const origin = ctx.finalUrl.origin;
  const get = (path) => ctx.request(origin + path, { maxBytes: 256 * 1024 }).catch(() => null);

  const baseline = await get(`/siteguard-${crypto.randomBytes(6).toString('hex')}.txt`);
  const baselineHash = baseline && baseline.status === 200 ? hash(baseline.body) : null;

  // Directory listing on the page itself
  if (LISTING.test(ctx.main.final.text)) ctx.add('exposure.directory_listing', ctx.finalUrl.pathname, { url: ctx.finalUrl.href });

  const reported = new Set();
  await pool(PROBES, 5, async (probe) => {
    const res = await get(probe.path);
    if (!res || res.status !== 200 || !res.body.length) return;
    if (baselineHash && hash(res.body) === baselineHash) return;
    if (!probe.match(res.text, res.body)) return;
    const fp = `${probe.id}|${probe.key}`;
    if (reported.has(fp)) return;
    reported.add(fp);
    ctx.add(probe.id, probe.key, { url: origin + probe.path, status: res.status, bytes: res.body.length, preview: redact(res.text) });
  });

  const sec = await get('/.well-known/security.txt');
  if (!sec || sec.status !== 200 || !/^contact:/im.test(sec.text)) {
    ctx.add('exposure.security_txt_missing', 'site', { url: `${origin}/.well-known/security.txt` });
  }
};

// Never store secrets in our own database: keep only a masked preview.
function redact(text) {
  return text.slice(0, 160)
    .replace(/(=|:)\s*([^\s'"]{3})[^\s'"]*/g, '$1 $2***')
    .replace(/[^\x20-\x7e\n]/g, '.');
}
module.exports.PROBES = PROBES;
