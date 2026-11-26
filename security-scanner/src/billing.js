'use strict';
// Pro subscriptions through Stripe Checkout (REST API, no SDK needed).
// In BILLING_DEV_MODE the plan can be toggled without payment for local testing.
const crypto = require('node:crypto');
const express = require('express');

function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((kv) => kv.split('=')).filter((kv) => kv.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  if (!parts.t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

function createBillingRouter({ db, billing, appUrl, requireUser }) {
  const router = express.Router();
  const stripeEnabled = Boolean(billing.stripeSecretKey && billing.stripePriceId);

  async function stripe(path, params) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${billing.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message || `Stripe error ${res.status}`);
    return body;
  }

  router.get('/config', (_req, res) => res.json({ stripeEnabled, devMode: billing.devMode }));

  router.post('/checkout', express.json(), requireUser, async (req, res) => {
    if (!stripeEnabled) return res.status(400).json({ error: 'Online payments are not configured on this server' });
    try {
      const params = {
        mode: 'subscription',
        'line_items[0][price]': billing.stripePriceId,
        'line_items[0][quantity]': '1',
        success_url: `${appUrl}/#/billing?status=success`,
        cancel_url: `${appUrl}/#/billing?status=cancelled`,
        client_reference_id: String(req.user.id),
      };
      if (req.user.stripe_customer_id) params.customer = req.user.stripe_customer_id;
      else params.customer_email = req.user.email;
      const session = await stripe('checkout/sessions', params);
      res.json({ url: session.url });
    } catch (err) { res.status(502).json({ error: err.message }); }
  });

  router.post('/portal', express.json(), requireUser, async (req, res) => {
    if (!stripeEnabled || !req.user.stripe_customer_id) return res.status(400).json({ error: 'No subscription to manage' });
    try {
      const session = await stripe('billing_portal/sessions', { customer: req.user.stripe_customer_id, return_url: `${appUrl}/#/billing` });
      res.json({ url: session.url });
    } catch (err) { res.status(502).json({ error: err.message }); }
  });

  router.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
    const raw = req.body.toString('utf8');
    if (!billing.stripeWebhookSecret || !verifyStripeSignature(raw, req.headers['stripe-signature'], billing.stripeWebhookSecret)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = JSON.parse(raw);
    const obj = event.data?.object || {};
    if (event.type === 'checkout.session.completed' && obj.client_reference_id) {
      db.run(`UPDATE users SET plan='pro', stripe_customer_id=?, stripe_subscription_id=? WHERE id=?`, obj.customer, obj.subscription, Number(obj.client_reference_id));
    } else if (event.type === 'customer.subscription.updated') {
      const plan = ['active', 'trialing', 'past_due'].includes(obj.status) ? 'pro' : 'free';
      db.run('UPDATE users SET plan=?, stripe_subscription_id=? WHERE stripe_customer_id=?', plan, obj.id, obj.customer);
    } else if (event.type === 'customer.subscription.deleted') {
      db.run(`UPDATE users SET plan='free' WHERE stripe_customer_id=?`, obj.customer);
    }
    res.json({ received: true });
  });

  router.post('/dev-set-plan', express.json(), requireUser, (req, res) => {
    if (!billing.devMode) return res.status(404).json({ error: 'Not found' });
    const plan = req.body?.plan === 'pro' ? 'pro' : 'free';
    db.run('UPDATE users SET plan=? WHERE id=?', plan, req.user.id);
    res.json({ plan });
  });

  return router;
}

module.exports = { createBillingRouter, verifyStripeSignature };
