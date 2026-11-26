'use strict';
const config = require('./config');
const { openDatabase } = require('./db');
const { createAuditService } = require('./audits');
const { createScheduler } = require('./scheduler');
const { createMailer } = require('./mailer');
const { createApp } = require('./app');

const db = openDatabase(config.databasePath);
const audits = createAuditService({ db, scannerOptions: config.scanner, concurrency: config.auditConcurrency });
const mailer = createMailer(config.mail);
const scheduler = createScheduler({ db, audits, mailer, appUrl: config.appUrl, intervalMs: config.schedulerIntervalMs });
const app = createApp({ db, config, audits });

app.listen(config.port, () => {
  console.log(`SiteGuard listening on ${config.appUrl} (port ${config.port})`);
  console.log(`  e-mail: ${mailer.mode === 'smtp' ? `SMTP ${config.mail.host}` : `writing to ${config.mail.outboxDir}`}`);
  console.log(`  billing: ${config.billing.stripeSecretKey ? 'Stripe' : config.billing.devMode ? 'DEV MODE (free plan switching)' : 'disabled'}`);
  if (config.scanner.allowPrivate) console.warn('  WARNING: SCANNER_ALLOW_PRIVATE is on — the scanner can reach internal addresses');
  scheduler.start();
});
