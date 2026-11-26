'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runScan, normalizeTargetUrl, scoreFindings } = require('../shared/scanner');
const { isPrivateAddress } = require('../shared/scanner/net-guard');
const { evaluateCertificate } = require('../shared/scanner/checks/tls');
const { detectLibrary, vulnerableRule } = require('../shared/scanner/checks/content');
const { SEVERITY_RANK } = require('../shared/scanner/catalog');
const { createFixtureSite } = require('./fixture-site');

test('scans an insecure site and ranks findings from most to least severe', async () => {
  const site = await createFixtureSite();
  try {
    const r = await runScan(site.url, { allowPrivate: true, timeoutMs: 3000, only: ['transport', 'headers', 'cookies', 'cors', 'exposure', 'content', 'methods'] });
    const ids = r.findings.map((f) => f.checkId);
    for (const id of ['exposure.env', 'exposure.git', 'cors.reflect_origin_credentials', 'content.password_over_http',
      'transport.no_https', 'headers.csp_missing', 'headers.clickjacking', 'content.vulnerable_library', 'exposure.directory_listing',
      'cookies.no_httponly', 'disclosure.server_version', 'disclosure.powered_by', 'methods.trace', 'content.sri_missing']) {
      assert.ok(ids.includes(id), `expected ${id}`);
    }
    const ranks = r.findings.map((f) => SEVERITY_RANK[f.severity]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'findings sorted by severity');
    assert.equal(r.findings[0].severity, 'critical');
    assert.equal(r.grade, 'F');
    // secrets from the exposed .env are masked in stored evidence
    const env = r.findings.find((f) => f.checkId === 'exposure.env');
    assert.ok(!JSON.stringify(env.evidence).includes('supersecret'));
    // session-like cookie gets elevated severity, theme cookie is fine
    const cookie = r.findings.find((f) => f.checkId === 'cookies.no_httponly');
    assert.equal(cookie.key, 'PHPSESSID');
    assert.equal(cookie.severity, 'medium');
    assert.ok(!r.findings.some((f) => f.key === 'theme'));
  } finally { await site.close(); }
});

test('soft-404 sites that return 200 for everything do not produce exposure false positives', async () => {
  const http = require('node:http');
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>Welcome</body></html>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await runScan(`http://127.0.0.1:${server.address().port}/`, { allowPrivate: true, timeoutMs: 3000, only: ['exposure'] });
    assert.deepEqual(r.findings.map((f) => f.checkId), ['exposure.security_txt_missing']);
  } finally { server.close(); }
});

test('refuses private and internal targets (SSRF protection)', async () => {
  for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://10.1.2.3/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://metadata.internal/']) {
    await assert.rejects(runScan(u, { timeoutMs: 1000 }), /Refusing|private|internal/i, u);
  }
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.equal(isPrivateAddress('2606:4700::1111'), false);
});

test('normalizes user input into a canonical URL', () => {
  assert.equal(normalizeTargetUrl('Example.COM').url, 'https://example.com/');
  assert.equal(normalizeTargetUrl('http://example.com/a#x').url, 'http://example.com/a');
  assert.throws(() => normalizeTargetUrl('ftp://example.com'), /Only http/);
  assert.throws(() => normalizeTargetUrl('https://user:pw@example.com'), /credentials/);
  assert.throws(() => normalizeTargetUrl('intranet'), /public domain/);
});

test('certificate evaluation: expired, untrusted, expiring soon', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const cert = (validTo) => ({ subject: { CN: 'example.com' }, subjectaltname: 'DNS:example.com', issuer: { O: 'CA' }, valid_from: 'Jan 1 00:00:00 2026 GMT', valid_to: validTo });
  assert.deepEqual(evaluateCertificate({ cert: cert('May 1 00:00:00 2026 GMT'), hostname: 'example.com', now }).map((x) => x[0]), ['tls.cert_expired']);
  assert.deepEqual(evaluateCertificate({ cert: cert('Jun 10 00:00:00 2026 GMT'), hostname: 'example.com', now }).map((x) => x[0]), ['tls.cert_expiring_soon']);
  assert.deepEqual(evaluateCertificate({ cert: cert('Dec 1 00:00:00 2026 GMT'), hostname: 'example.com', now }), []);
  assert.deepEqual(evaluateCertificate({ cert: cert('Dec 1 00:00:00 2026 GMT'), hostname: 'other.org', now }).map((x) => x[0]), ['tls.cert_invalid']);
  assert.deepEqual(evaluateCertificate({ cert: cert('Dec 1 00:00:00 2026 GMT'), authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT', hostname: 'example.com', now }).map((x) => x[0]), ['tls.cert_invalid']);
});

test('detects vulnerable front-end library versions', () => {
  const v = (src) => { const d = detectLibrary(src); return d && vulnerableRule(d.lib, d.version) ? `${d.lib.name}@${d.version}` : null; };
  assert.equal(v('https://code.jquery.com/jquery-1.12.4.min.js'), 'jquery@1.12.4');
  assert.equal(v('https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js'), null);
  assert.equal(v('https://cdnjs.cloudflare.com/ajax/libs/jquery/3.4.1/jquery.min.js'), 'jquery@3.4.1');
  assert.equal(v('https://code.jquery.com/ui/1.12.1/jquery-ui.min.js'), null); // version only in folder name "ui/" — not attributable
  assert.equal(v('/js/jquery-ui-1.12.1.min.js'), 'jquery-ui@1.12.1');
  assert.equal(v('https://stackpath.bootstrapcdn.com/bootstrap/4.1.3/js/bootstrap.min.js'), 'bootstrap@4.1.3');
  assert.equal(v('https://stackpath.bootstrapcdn.com/bootstrap/4.6.2/js/bootstrap.min.js'), null);
  assert.equal(v('https://cdn.jsdelivr.net/npm/lodash@4.17.15/lodash.min.js'), 'lodash@4.17.15');
  assert.equal(v('https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular.min.js'), 'angularjs@1.8.2');
});

test('scoring: any critical finding means grade F', () => {
  assert.equal(scoreFindings([]).grade, 'A');
  assert.equal(scoreFindings([{ severity: 'low' }]).grade, 'A');
  assert.equal(scoreFindings([{ severity: 'critical' }]).grade, 'F');
  assert.equal(scoreFindings([{ severity: 'high' }]).grade, 'C');
});
