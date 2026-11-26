'use strict';
const path = require('node:path');

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const config = {
  port: int(process.env.PORT, 3000),
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'siteguard.db'),
  production: process.env.NODE_ENV === 'production',
  scanner: {
    allowPrivate: bool(process.env.SCANNER_ALLOW_PRIVATE),
    timeoutMs: int(process.env.SCANNER_TIMEOUT_MS, 10000),
  },
  auditConcurrency: int(process.env.AUDIT_CONCURRENCY, 3),
  schedulerIntervalMs: int(process.env.SCHEDULER_INTERVAL_MS, 60000),
  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'SiteGuard <reports@example.com>',
    outboxDir: process.env.MAIL_OUTBOX_DIR || path.join(__dirname, '..', 'data', 'outbox'),
  },
  billing: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripePriceId: process.env.STRIPE_PRICE_ID || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    devMode: bool(process.env.BILLING_DEV_MODE),
  },
};

module.exports = config;
