'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createAuditService } = require('../src/audits');
const { createScheduler } = require('../src/scheduler');
const { createMailer } = require('../src/mailer');
const { createApp } = require('../src/app');
const { verifyStripeSignature } = require('../src/billing');
const { createFixtureSite } = require('./fixture-site');

const ONLY = ['transport', 'headers', 'cookies', 'cors', 'exposure', 'content', 'methods'];

async function setup() {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-outbox-'));
  const db = openDatabase(':memory:');
  const config = {
    appUrl: 'http://app.test', production: false,
    billing: { devMode: true, stripeSecretKey: '', stripePriceId: '', stripeWebhookSecret: 'whsec_test' },
  };
  const audits = createAuditService({ db, scannerOptions: { allowPrivate: true, timeoutMs: 3000, only: ONLY }, concurrency: 2 });
  const mailer = createMailer({ host: '', from: 'SiteGuard <r@example.com>', outboxDir });
  const scheduler = createScheduler({ db, audits, mailer, appUrl: config.appUrl, log: { error() {} } });
  const app = createApp({ db, config, audits });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    return async function call(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };
  }

  async function waitForAudit(call, id) {
    for (let i = 0; i < 100; i += 1) {
      const r = await call('GET', `/api/audits/${id}`);
      if (['completed', 'failed'].includes(r.data.audit.status)) return r.data;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('audit did not finish');
  }

  return { db, server, mailer, scheduler, client, waitForAudit, outboxDir, close: () => new Promise((r) => server.close(r)) };
}

test('full flow: free report, issue log across audits (detected -> fixed -> reopened), Pro gating, schedules and e-mail', async () => {
  const env = await setup();
  const site = await createFixtureSite();
  try {
    const alice = env.client();
    assert.equal((await alice('POST', '/api/auth/signup', { email: 'alice@example.com', password: 'correct horse' })).status, 201);
    assert.equal((await alice('GET', '/api/me')).data.user.plan, 'free');

    // --- first audit (free plan): ranked list, no details
    const scan = await alice('POST', '/api/scan', { url: site.url });
    assert.equal(scan.status, 202);
    const { targetId } = scan.data;
    const r1 = await env.waitForAudit(alice, scan.data.auditId);
    assert.equal(r1.audit.status, 'completed');
    assert.equal(r1.detailed, false);
    assert.equal(r1.findings[0].severity, 'critical');
    assert.equal(r1.findings[0].remediation, undefined, 'free plan gets no remediation');
    assert.equal(r1.findings[0].evidence, undefined, 'free plan gets no evidence');
    assert.ok(r1.changes.new.length === r1.findings.length, 'first audit: all findings are new');

    // Pro-only endpoints are refused
    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'weekly' })).status, 402);
    assert.equal((await alice('GET', `/api/audits/${r1.audit.id}/export.json`)).status, 402);

    // --- site owner fixes the .env exposure and adds a CSP
    site.state.exposeEnv = false;
    site.state.csp = true;
    const a2 = await alice('POST', `/api/targets/${targetId}/audits`);
    const r2 = await env.waitForAudit(alice, a2.data.auditId);
    const fixed = r2.changes.resolved.map((i) => i.checkId).sort();
    assert.deepEqual(fixed, ['exposure.env', 'headers.clickjacking', 'headers.csp_missing']);
    assert.equal(r2.changes.new.length, 0);
    assert.equal(r2.previousAudit.id, r1.audit.id);

    // --- the .env file comes back
    site.state.exposeEnv = true;
    const a3 = await alice('POST', `/api/targets/${targetId}/audits`);
    const r3 = await env.waitForAudit(alice, a3.data.auditId);
    assert.deepEqual(r3.changes.reopened.map((i) => i.checkId), ['exposure.env']);

    // --- issue log shows when each issue was detected and fixed
    const log = (await alice('GET', `/api/targets/${targetId}/issues`)).data;
    const envIssue = log.find((i) => i.checkId === 'exposure.env');
    assert.equal(envIssue.status, 'open');
    assert.equal(envIssue.timesReopened, 1);
    assert.deepEqual(envIssue.history.map((h) => [h.event, h.auditId]), [['detected', r1.audit.id], ['resolved', r2.audit.id], ['reopened', r3.audit.id]]);
    const csp = log.find((i) => i.checkId === 'headers.csp_missing');
    assert.equal(csp.status, 'resolved');
    assert.equal(csp.firstDetectedAuditId, r1.audit.id);
    assert.equal(csp.resolvedAuditId, r2.audit.id);
    assert.ok(csp.resolvedAt);
    assert.equal(log[0].status, 'open', 'open issues listed first');

    // --- a failed audit must not mark issues as fixed
    const before = env.db.get(`SELECT COUNT(*) c FROM issues WHERE status='open'`).c;
    await new Promise((r) => site.server.close(r));
    const a4 = await alice('POST', `/api/targets/${targetId}/audits`);
    const r4 = await env.waitForAudit(alice, a4.data.auditId);
    assert.equal(r4.audit.status, 'failed');
    assert.equal(env.db.get(`SELECT COUNT(*) c FROM issues WHERE status='open'`).c, before);
    await new Promise((r) => site.server.listen(Number(new URL(site.url).port), '127.0.0.1', r));

    // --- upgrade to Pro: detailed report, export, schedule
    await alice('POST', '/api/billing/dev-set-plan', { plan: 'pro' });
    const detailed = (await alice('GET', `/api/audits/${r3.audit.id}`)).data;
    assert.equal(detailed.detailed, true);
    assert.ok(detailed.findings[0].remediation && detailed.findings[0].description && detailed.findings[0].evidence);
    assert.equal((await alice('GET', `/api/audits/${r3.audit.id}/export.json`)).status, 200);

    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'hourly' })).status, 400);
    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'weekly', recipients: 'not-an-email' })).status, 400);
    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'weekly', recipients: 'alice@example.com, ops@example.com' })).status, 200);

    // scheduler: new schedule is due immediately, runs an audit and e-mails the report
    site.state.exposeGit = false;
    const ran = await env.scheduler.tick(new Date(Date.now() + 1000));
    assert.equal(ran, 1);
    const scheduled = env.db.get(`SELECT * FROM audits WHERE trigger='scheduled'`);
    assert.equal(scheduled.status, 'completed');
    const sched = env.db.get('SELECT * FROM schedules WHERE target_id = ?', targetId);
    const days = (Date.parse(sched.next_run_at) - Date.now()) / 864e5;
    assert.ok(days > 6 && days <= 7.01, `next run in ~7 days, got ${days}`);
    assert.equal(env.mailer.sent.length, 1);
    assert.equal(env.mailer.sent[0].to, 'alice@example.com, ops@example.com');
    assert.match(env.mailer.sent[0].subject, /grade F/);
    assert.match(env.mailer.sent[0].subject, /1 fixed/);
    const eml = fs.readFileSync(path.join(env.outboxDir, fs.readdirSync(env.outboxDir)[0]), 'utf8').replace(/=\r?\n/g, ''); // undo quoted-printable soft breaks
    assert.match(eml, /Fixed since last audit/);
    assert.match(eml, /How to fix/);
    assert.equal(env.db.get('SELECT status FROM email_log').status, 'sent');

    // not due again until next week
    assert.equal(await env.scheduler.tick(new Date(Date.now() + 864e5)), 0);

    // downgrade: schedules are paused (slot skipped, no audit, no mail)
    await alice('POST', '/api/billing/dev-set-plan', { plan: 'free' });
    await env.scheduler.tick(new Date(Date.now() + 8 * 864e5));
    assert.equal(env.db.get(`SELECT COUNT(*) c FROM audits WHERE trigger='scheduled'`).c, 1);
    assert.equal(env.mailer.sent.length, 1);

    // --- tenant isolation: another user cannot see alice's data
    const bob = env.client();
    await bob('POST', '/api/auth/signup', { email: 'bob@example.com', password: 'hunter2hunter2' });
    assert.equal((await bob('GET', `/api/targets/${targetId}`)).status, 404);
    assert.equal((await bob('GET', `/api/audits/${r1.audit.id}`)).status, 404);
    assert.equal((await bob('GET', `/api/targets/${targetId}/issues`)).status, 404);
    assert.deepEqual((await bob('GET', '/api/targets')).data, []);
  } finally {
    await site.close().catch(() => {});
    await env.close();
  }
});

test('auth, validation and free-plan limits', async () => {
  const env = await setup();
  try {
    const c = env.client();
    assert.equal((await c('GET', '/api/targets')).status, 401);
    assert.equal((await c('POST', '/api/auth/signup', { email: 'bad', password: 'longenough' })).status, 400);
    assert.equal((await c('POST', '/api/auth/signup', { email: 'a@b.co', password: 'short' })).status, 400);
    assert.equal((await c('POST', '/api/auth/signup', { email: 'a@b.co', password: 'longenough' })).status, 201);
    assert.equal((await c('POST', '/api/auth/signup', { email: 'A@B.co', password: 'longenough' })).status, 409);
    await c('POST', '/api/auth/logout');
    assert.equal((await c('POST', '/api/auth/login', { email: 'a@b.co', password: 'wrong-password' })).status, 401);
    assert.equal((await c('POST', '/api/auth/login', { email: 'a@b.co', password: 'longenough' })).status, 200);

    assert.equal((await c('POST', '/api/targets', { url: 'ftp://example.com' })).status, 400);
    for (const u of ['one.example', 'two.example', 'three.example']) assert.equal((await c('POST', '/api/targets', { url: u })).status, 201);
    assert.equal((await c('POST', '/api/targets', { url: 'one.example' })).status, 201, 're-adding returns the existing site');
    assert.equal((await c('POST', '/api/targets', { url: 'four.example' })).status, 402, 'free plan site limit');

    // CSRF guard: form-encoded POSTs are refused
    const res = await fetch(`http://127.0.0.1:${env.server.address().port}/api/targets`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'url=x.com' });
    assert.equal(res.status, 415);
  } finally { await env.close(); }
});

test('Stripe webhook signature verification', () => {
  const crypto = require('node:crypto');
  const body = '{"type":"x"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test'), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, 'whsec_test'), false);
  assert.equal(verifyStripeSignature(body, `t=${t - 1000},v1=${sig}`, 'whsec_test'), false);
});

test('monthly schedules clamp to the end of short months', () => {
  const { nextRun } = require('../src/scheduler');
  assert.equal(nextRun('2026-01-31T09:00:00.000Z', 'monthly'), '2026-02-28T09:00:00.000Z');
  assert.equal(nextRun('2026-03-15T09:00:00.000Z', 'monthly'), '2026-04-15T09:00:00.000Z');
  assert.equal(nextRun('2026-03-15T09:00:00.000Z', 'weekly'), '2026-03-22T09:00:00.000Z');
});
