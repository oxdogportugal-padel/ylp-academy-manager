'use strict';

module.exports = async function methodsCheck(ctx) {
  const res = await ctx.request(ctx.finalUrl.href, {
    method: 'TRACE', headers: { 'X-SiteGuard-Trace': 'probe' }, maxBytes: 16 * 1024,
  });
  if (res.status === 200 && /x-siteguard-trace:\s*probe/i.test(res.text)) {
    ctx.add('methods.trace', 'site', { status: res.status });
  }
};
