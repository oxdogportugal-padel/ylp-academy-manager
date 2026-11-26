'use strict';
// Cookie attribute flags on every Set-Cookie seen while loading the page.

const SESSION_LIKE = /(sess|sid|auth|token|jwt|login|remember|csrf|xsrf|connect\.sid|phpsessid|jsessionid|asp\.net)/i;

function parseSetCookie(header) {
  const [pair, ...attrs] = header.split(';');
  const name = pair.split('=')[0].trim();
  const flags = {};
  for (const a of attrs) {
    const [k, ...v] = a.trim().split('=');
    flags[k.trim().toLowerCase()] = v.join('=').trim() || true;
  }
  return { name, flags };
}

module.exports = function cookiesCheck(ctx) {
  const seen = new Map();
  for (const res of ctx.main.chain) {
    for (const raw of [].concat(res.headers['set-cookie'] || [])) {
      const c = parseSetCookie(raw);
      if (c.name && !seen.has(c.name)) seen.set(c.name, c);
    }
  }
  ctx.meta.cookies = seen.size;
  for (const { name, flags } of seen.values()) {
    // Cookies being deleted (expired / max-age=0) are not a risk.
    if (flags['max-age'] === '0' || (flags.expires && new Date(flags.expires).getTime() < Date.now())) continue;
    const sessionLike = SESSION_LIKE.test(name);
    const evidence = { cookie: name, attributes: Object.keys(flags) };
    if (ctx.isHttps && !flags.secure) ctx.add('cookies.no_secure', name, evidence, sessionLike ? 'medium' : 'low');
    if (!flags.httponly) ctx.add('cookies.no_httponly', name, evidence, sessionLike ? 'medium' : 'low');
    if (!flags.samesite) ctx.add('cookies.no_samesite', name, evidence);
  }
};

module.exports.parseSetCookie = parseSetCookie;
