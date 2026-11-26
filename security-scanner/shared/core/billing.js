'use strict';
// Pro subscriptions via Stripe Checkout (REST API, no SDK).
const crypto = require('node:crypto');

function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  const items = String(header || '').split(',').map((p) => p.trim());
  const t = (items.find((p) => p.startsWith('t=')) || '').slice(2);
  const sigs = items.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !sigs.length || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/** Applies a verified Stripe webhook event to the user's plan. */
async function applyStripeEvent(repo, event) {
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed' && obj.client_reference_id) {
    await repo.updateUser(obj.client_reference_id, { plan: 'pro', stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription });
    return 'pro';
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const user = await repo.findUserByStripeCustomer(obj.customer);
    if (!user) return null;
    const plan = event.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(obj.status) ? 'pro' : 'free';
    await repo.updateUser(user.id, { plan, stripeSubscriptionId: obj.id });
    return plan;
  }
  return null;
}

async function stripeRequest(secretKey, path, params) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Stripe error ${res.status}`);
  return body;
}

module.exports = { verifyStripeSignature, applyStripeEvent, stripeRequest };
