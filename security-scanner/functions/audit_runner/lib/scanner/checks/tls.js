'use strict';
const tls = require('node:tls');
const { guardedLookup } = require('../net-guard');

const DAY = 24 * 60 * 60 * 1000;

/** Pure evaluation of a peer certificate, separated for testability. */
function evaluateCertificate({ cert, authorizationError, hostname, now = Date.now() }) {
  const out = [];
  if (!cert || !cert.valid_to) return out;
  const validTo = new Date(cert.valid_to).getTime();
  const daysLeft = Math.floor((validTo - now) / DAY);
  const evidence = {
    subject: cert.subject?.CN, issuer: cert.issuer?.O || cert.issuer?.CN,
    validFrom: new Date(cert.valid_from).toISOString(), validTo: new Date(validTo).toISOString(), daysLeft,
  };
  if (validTo < now) {
    out.push(['tls.cert_expired', evidence]);
    return out;
  }
  let error = authorizationError ? String(authorizationError) : null;
  if (!error) {
    const idErr = tls.checkServerIdentity(hostname, cert);
    if (idErr) error = idErr.message;
  }
  if (error && !/CERT_HAS_EXPIRED/.test(error)) out.push(['tls.cert_invalid', { ...evidence, error }]);
  if (daysLeft <= 14) out.push(['tls.cert_expiring_soon', evidence]);
  return out;
}

function handshake(ctx, { hostname, port, minVersion, maxVersion, ciphers }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: hostname, port, servername: hostname, rejectUnauthorized: false,
      minVersion, maxVersion, ciphers, lookup: guardedLookup(ctx.opts.allowPrivate), timeout: ctx.opts.timeoutMs,
    }, () => {
      const result = {
        cert: socket.getPeerCertificate(false),
        authorizationError: socket.authorizationError,
        protocol: socket.getProtocol(),
      };
      socket.end();
      resolve(result);
    });
    socket.on('timeout', () => socket.destroy(new Error('TLS handshake timeout')));
    socket.on('error', reject);
  });
}

async function tlsCheck(ctx) {
  if (!ctx.isHttps) return;
  const { hostname } = ctx.finalUrl;
  const port = Number(ctx.finalUrl.port) || 443;
  const main = await handshake(ctx, { hostname, port });
  ctx.meta.tls = { protocol: main.protocol, issuer: main.cert?.issuer?.O, validTo: main.cert?.valid_to };
  for (const [id, evidence] of evaluateCertificate({ ...main, hostname })) ctx.add(id, 'site', evidence);

  for (const version of ['TLSv1', 'TLSv1.1']) {
    try {
      const legacy = await handshake(ctx, {
        hostname, port, minVersion: version, maxVersion: version, ciphers: 'DEFAULT@SECLEVEL=0',
      });
      if (legacy.protocol === version) {
        ctx.add('tls.legacy_protocol', 'site', { acceptedProtocol: version });
        break;
      }
    } catch { /* refused: good */ }
  }
}

module.exports = tlsCheck;
module.exports.evaluateCertificate = evaluateCertificate;
