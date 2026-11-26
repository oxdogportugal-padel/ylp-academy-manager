'use strict';
// HTTPS availability and HTTP -> HTTPS redirect.

module.exports = async function transportCheck(ctx) {
  const host = 'site'; // stable fingerprint key for site-wide findings
  if (!ctx.isHttps) {
    // The site ended up on plain HTTP. Is HTTPS available at all?
    const httpsUrl = `https://${ctx.finalUrl.hostname}${ctx.finalUrl.pathname}`;
    try {
      const res = await ctx.fetch(httpsUrl, { method: 'GET', maxBytes: 64 * 1024 });
      if (res.final.status < 500) {
        ctx.add('transport.no_https_redirect', host, { tested: ctx.finalUrl.href, httpsAvailableAt: httpsUrl });
        return;
      }
    } catch { /* not reachable over HTTPS */ }
    ctx.add('transport.no_https', host, { tested: ctx.finalUrl.href, httpsAttempt: httpsUrl });
    return;
  }

  // Site is on HTTPS: does the HTTP version redirect?
  const httpUrl = `http://${ctx.finalUrl.hostname}${ctx.finalUrl.pathname}`;
  try {
    const res = await ctx.fetch(httpUrl, { maxRedirects: 5, maxBytes: 64 * 1024 });
    const landed = new URL(res.final.url);
    if (landed.protocol === 'http:' && res.final.status < 400) {
      ctx.add('transport.no_https_redirect', host, { tested: httpUrl, status: res.final.status });
    }
  } catch { /* port 80 closed: fine, nothing served insecurely */ }
};
