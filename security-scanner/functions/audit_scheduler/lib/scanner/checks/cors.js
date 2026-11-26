'use strict';
// Sends a request with a foreign Origin and inspects the CORS response.

const PROBE_ORIGIN = 'https://cors-probe.siteguard.invalid';

module.exports = async function corsCheck(ctx) {
  const host = 'site'; // stable fingerprint key for site-wide findings
  const res = await ctx.request(ctx.finalUrl.href, { headers: { Origin: PROBE_ORIGIN }, maxBytes: 64 * 1024 });
  const acao = res.headers['access-control-allow-origin'];
  const acac = String(res.headers['access-control-allow-credentials'] || '').toLowerCase() === 'true';
  if (!acao) return;
  const evidence = { sentOrigin: PROBE_ORIGIN, accessControlAllowOrigin: acao, allowCredentials: acac };
  if (acao === PROBE_ORIGIN || acao === 'null') {
    ctx.add(acac ? 'cors.reflect_origin_credentials' : 'cors.reflect_origin', host, evidence);
  } else if (acao === '*') {
    ctx.add('cors.wildcard', host, evidence);
  }
};
