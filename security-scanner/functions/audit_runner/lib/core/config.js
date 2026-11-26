'use strict';
// Settings come from each function's environment variables
// (catalyst-config.json -> deployment.env_variables, or Console -> Functions -> Configuration).
const bool = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));

module.exports = function loadConfig(env = process.env) {
  return {
    appUrl: String(env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    jobPoolName: env.JOB_POOL_NAME || 'siteguard_audits',
    auditRunnerFunction: env.AUDIT_RUNNER_FUNCTION || 'audit_runner',
    fromEmail: env.FROM_EMAIL || '',
    scanner: { timeoutMs: Number(env.SCANNER_TIMEOUT_MS) || 10000, allowPrivate: false },
    billing: {
      stripeSecretKey: env.STRIPE_SECRET_KEY || '',
      stripePriceId: env.STRIPE_PRICE_ID || '',
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      devMode: bool(env.BILLING_DEV_MODE),
    },
  };
};
