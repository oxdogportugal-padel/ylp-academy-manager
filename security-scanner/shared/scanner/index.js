'use strict';
const { request, fetchFollow } = require('./http-client');
const { CATALOG, SEVERITY_RANK, definitionFor } = require('./catalog');

const CHECKS = {
  transport: require('./checks/transport'),
  tls: require('./checks/tls'),
  headers: require('./checks/headers'),
  cookies: require('./checks/cookies'),
  cors: require('./checks/cors'),
  exposure: require('./checks/exposure'),
  content: require('./checks/content'),
  methods: require('./checks/methods'),
  dns: require('./checks/dns'),
};

const WEIGHTS = { critical: 30, high: 15, medium: 6, low: 2, info: 0 };

class ScanError extends Error {}

/** Accepts "example.com", "https://example.com/path" etc. Returns a canonical URL string. */
function normalizeTargetUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new ScanError('Please enter a URL');
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (!hadScheme) raw = `https://${raw}`;
  let u;
  try { u = new URL(raw); } catch { throw new ScanError('That does not look like a valid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new ScanError('Only http:// and https:// URLs can be scanned');
  if (u.username || u.password) throw new ScanError('URLs with credentials are not allowed');
  if (!u.hostname.includes('.') && !/^\[.*\]$/.test(u.hostname) && u.hostname !== 'localhost') {
    throw new ScanError('Please enter a public domain name, e.g. example.com');
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  return { url: u.toString(), hadScheme };
}

function scoreFindings(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let penalty = 0;
  for (const f of findings) { counts[f.severity] += 1; penalty += WEIGHTS[f.severity]; }
  const score = Math.max(0, 100 - penalty);
  let grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  if (counts.critical > 0) grade = 'F';
  else if (counts.high > 0 && grade < 'C') grade = 'C';
  return { score, grade, counts };
}

function sortFindings(findings) {
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.category.localeCompare(b.category) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

/**
 * Runs every passive check against a URL.
 * @returns {{ requestedUrl, finalUrl, startedAt, finishedAt, findings, score, grade, counts, meta }}
 */
async function runScan(input, options = {}) {
  const opts = { timeoutMs: 10000, allowPrivate: false, only: null, ...options };
  const { url, hadScheme } = normalizeTargetUrl(input);
  const startedAt = new Date();
  const reqOpts = { timeoutMs: opts.timeoutMs, allowPrivate: opts.allowPrivate };

  let main;
  try {
    main = await fetchFollow(url, reqOpts);
  } catch (err) {
    if (err.code === 'EBLOCKED') throw new ScanError(err.message);
    if (!hadScheme) {
      try { main = await fetchFollow(url.replace(/^https:/, 'http:'), reqOpts); } catch { /* report original error */ }
    }
    if (!main) throw new ScanError(`Could not reach ${url}: ${err.message}`);
  }

  const findings = new Map();
  const ctx = {
    opts: reqOpts,
    main,
    finalUrl: new URL(main.final.url),
    get isHttps() { return this.finalUrl.protocol === 'https:'; },
    meta: { status: main.final.status, redirects: main.chain.length - 1, checkErrors: {} },
    request: (u, o = {}) => request(u, { ...reqOpts, ...o }),
    fetch: (u, o = {}) => fetchFollow(u, { ...reqOpts, ...o }),
    add(checkId, key, evidence = {}, severity) {
      const def = definitionFor(checkId);
      const fingerprint = `${checkId}|${String(key).toLowerCase()}`;
      if (findings.has(fingerprint)) return;
      findings.set(fingerprint, {
        checkId, key: String(key), fingerprint,
        severity: severity || def.severity,
        category: def.category, title: def.title,
        evidence,
      });
    },
  };

  const selected = Object.entries(CHECKS).filter(([name]) => !opts.only || opts.only.includes(name));
  await Promise.all(selected.map(async ([name, check]) => {
    try { await check(ctx); } catch (err) { ctx.meta.checkErrors[name] = err.message; }
  }));

  const list = sortFindings([...findings.values()]);
  return {
    requestedUrl: url,
    finalUrl: ctx.finalUrl.toString(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    findings: list,
    ...scoreFindings(list),
    meta: ctx.meta,
  };
}

module.exports = { runScan, normalizeTargetUrl, scoreFindings, sortFindings, ScanError, CATALOG };
