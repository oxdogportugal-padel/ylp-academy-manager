'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map((r) => r.join('')); } catch { return null; }
}

module.exports = async function dnsCheck(ctx) {
  const host = ctx.finalUrl.hostname;
  if (net.isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.')) return;
  // Approximation of the registrable domain: strip a leading "www.".
  const domain = host.replace(/^www\./i, '');
  const [root, dmarc] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)]);
  if (root === null && dmarc === null) return; // DNS unavailable: don't guess
  if (!(root || []).some((r) => /^v=spf1/i.test(r))) ctx.add('dns.spf_missing', domain, { domain });
  if (!(dmarc || []).some((r) => /^v=DMARC1/i.test(r))) ctx.add('dns.dmarc_missing', domain, { domain });
};
