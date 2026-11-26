'use strict';
// Advanced I/O function (raw http): Stripe webhook receiver.
// Security Rules: authentication "optional" — Stripe cannot log in; requests are
// authenticated by verifying the Stripe-Signature header instead.
const catalyst = require('zcatalyst-sdk-node');
const { verifyStripeSignature, applyStripeEvent } = require('./lib/core/billing');
const { catalystRepo } = require('./lib/core/catalyst-services');
const loadConfig = require('./lib/core/config');

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const config = loadConfig();
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    const body = await rawBody(req);
    if (!verifyStripeSignature(body, req.headers['stripe-signature'], config.billing.stripeWebhookSecret)) {
      return send(res, 400, { error: 'Invalid signature' });
    }
    const repo = catalystRepo(catalyst.initialize(req, { scope: 'admin' }));
    const plan = await applyStripeEvent(repo, JSON.parse(body));
    return send(res, 200, { received: true, plan });
  } catch (err) {
    console.error('billing_webhook failed', err);
    return send(res, 500, { error: 'Webhook processing failed' });
  }
};
