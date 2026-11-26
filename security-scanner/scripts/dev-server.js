#!/usr/bin/env node
'use strict';
// Local development without a Catalyst account: serves client/ and the real API with an
// in-memory store, "dev mode" login (any e-mail), in-process audit jobs and e-mails
// printed to the console. For the real platform locally, use `catalyst serve`.
const path = require('node:path');
const express = require('express');
const { createApi } = require('../shared/core/api');
const { createRepo } = require('../shared/repo/repo');
const { createMemoryDriver } = require('../shared/repo/memory-driver');
const { runAudit } = require('../shared/core/lifecycle');
const { runDueSchedules, emailScheduledAudit } = require('../shared/core/scheduler');

const port = Number(process.env.PORT) || 3000;
const allowPrivate = process.env.SCANNER_ALLOW_PRIVATE === 'true';
const repo = createRepo(createMemoryDriver());
const appUrl = `http://localhost:${port}`;
const sent = [];
const mailer = { async send(msg) { sent.push(msg); console.log(`[mail] to ${msg.to.join(', ')}: ${msg.subject}`); } };

async function runJob(auditId) {
  const audit = await runAudit({ repo, auditId, scannerOptions: { allowPrivate, timeoutMs: 10000 } });
  if (audit?.status === 'completed' && audit.trigger === 'scheduled') await emailScheduledAudit({ repo, mailer, auditId, appUrl });
}
const submitAuditJob = async (_req, auditId) => { setImmediate(() => runJob(auditId).catch(console.error)); };

const app = express();
app.get('/config.js', (_req, res) => res.type('js').send("window.SITEGUARD_CONFIG = { apiBase: '', devAuth: true };"));
app.get('/__catalyst/sdk/init.js', (_req, res) => res.type('js').send('/* dev server: no Catalyst SDK */'));
app.get('/__dev/outbox', (_req, res) => res.json(sent));
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(createApi({
  repoFor: () => repo,
  authenticate: async (req) => {
    const email = String(req.headers['x-dev-user'] || '').trim().toLowerCase();
    return email ? { catalystUserId: `dev-${email}`, email } : null;
  },
  submitAuditJob,
  config: { appUrl, billing: { devMode: true } },
}));

const interval = Number(process.env.SCHEDULER_INTERVAL_MS) || 60000;
setInterval(() => runDueSchedules({ repo, submitAuditJob: (id) => submitAuditJob(null, id) }).catch(console.error), interval).unref();

app.listen(port, () => {
  console.log(`SiteGuard dev server on ${appUrl} (in-memory data, dev login)`);
  if (allowPrivate) console.warn('SCANNER_ALLOW_PRIVATE=true: the scanner can reach local addresses');
});
