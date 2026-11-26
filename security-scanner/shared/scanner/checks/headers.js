'use strict';
// Response security headers and banner disclosure on the main page.

function parseCsp(value) {
  const directives = {};
  for (const part of value.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) directives[name.toLowerCase()] = vals;
  }
  return directives;
}

module.exports = function headersCheck(ctx) {
  const res = ctx.main.final;
  const h = res.headers;
  const host = 'site'; // stable fingerprint key for site-wide findings
  const isHtml = /html/i.test(h['content-type'] || '') || /<html/i.test(res.text.slice(0, 2000));

  const csp = h['content-security-policy'];
  const cspDirectives = csp ? parseCsp(String(csp)) : null;

  if (isHtml) {
    if (!csp) {
      ctx.add('headers.csp_missing', host, { reportOnly: Boolean(h['content-security-policy-report-only']) });
    } else {
      const scriptSrc = cspDirectives['script-src'] || cspDirectives['default-src'] || [];
      const hasNonceOrHash = scriptSrc.some((v) => /^'(nonce-|sha(256|384|512)-)/.test(v)) || scriptSrc.includes("'strict-dynamic'");
      const problems = [];
      if (scriptSrc.includes("'unsafe-inline'") && !hasNonceOrHash) problems.push("'unsafe-inline'");
      if (scriptSrc.includes("'unsafe-eval'")) problems.push("'unsafe-eval'");
      if (problems.length) ctx.add('headers.csp_unsafe', host, { policy: String(csp).slice(0, 500), problems });
    }

    const xfo = h['x-frame-options'];
    const frameAncestors = cspDirectives && cspDirectives['frame-ancestors'];
    if (!xfo && !frameAncestors) ctx.add('headers.clickjacking', host, { xFrameOptions: null, frameAncestors: null });

    if (!h['referrer-policy']) ctx.add('headers.referrer_policy_missing', host, {});
    if (!h['permissions-policy']) ctx.add('headers.permissions_policy_missing', host, {});
  }

  if (!h['x-content-type-options'] || !/nosniff/i.test(h['x-content-type-options'])) {
    ctx.add('headers.xcto_missing', host, { value: h['x-content-type-options'] || null });
  }

  if (ctx.isHttps) {
    const hsts = h['strict-transport-security'];
    if (!hsts) ctx.add('headers.hsts_missing', host, {});
    else {
      const maxAge = Number((String(hsts).match(/max-age\s*=\s*"?(\d+)/i) || [])[1] || 0);
      if (maxAge < 15552000) ctx.add('headers.hsts_weak', host, { value: hsts, maxAge });
    }
  }

  const server = h.server;
  if (server && /\d/.test(server)) ctx.add('disclosure.server_version', host, { server });
  const poweredBy = h['x-powered-by'];
  if (poweredBy) ctx.add('disclosure.powered_by', host, { xPoweredBy: poweredBy });
};

module.exports.parseCsp = parseCsp;
