'use strict';
// SSRF protection: the scanner fetches arbitrary user-supplied URLs, so every
// connection is resolved through this guard, which refuses private, loopback,
// link-local, CGNAT, multicast and reserved ranges (unless explicitly allowed).
const dns = require('node:dns');
const net = require('node:net');

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96],
]) blocked.addSubnet(addr, prefix, 'ipv6');

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}

class BlockedTargetError extends Error {
  constructor(message) { super(message); this.code = 'EBLOCKED'; }
}

function assertHostAllowed(hostname, allowPrivate) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (allowPrivate) return;
  if (/^localhost$/i.test(host) || /\.localhost$/i.test(host) || /\.(internal|local)$/i.test(host)) {
    throw new BlockedTargetError(`Refusing to scan internal host "${host}"`);
  }
  if (net.isIP(host) && isPrivateAddress(host)) {
    throw new BlockedTargetError(`Refusing to scan private address ${host}`);
  }
}

function guardedLookup(allowPrivate) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, { all: true, family: options.family || 0 }, (err, addresses) => {
      if (err) return callback(err);
      if (!allowPrivate) {
        const bad = addresses.find((a) => isPrivateAddress(a.address));
        if (bad) return callback(new BlockedTargetError(`${hostname} resolves to private address ${bad.address}`));
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

module.exports = { isPrivateAddress, assertHostAllowed, guardedLookup, BlockedTargetError };
