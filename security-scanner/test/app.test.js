'use strict';
// End-to-end flow through the real API + audit lifecycle + scheduler, with the
// in-memory store standing in for the Catalyst Data Store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi } = require('../shared/core/api');
const { createRepo } = require('../shared/repo/repo');
const { createMemoryDriver } = require('../shared/repo/memory-driver');
const { runAudit } = require('../shared/core/lifecycle');
const { runDueSchedules, failStaleAudits, emailScheduledAudit, nextRun } = require('../shared/core/scheduler');
const { verifyStripeSignature, applyStripeEvent } = require('../shared/core/billing');
const { createFixtureSite } = require('./fixture-site');

const ONLY = ['transport', 'headers', 'cookies', 'cors', 'exposure', 'content', 'methods'];

async function setup() {
  const repo = createRepo(createMemoryDriver());
  const jobs = [];
  const sent = [];
  const mailer = { async send(m) { sent.push(m); } };
  const runJob = async (auditId) => {
    const a = await runAudit({ repo, auditId, scannerOptions: { allowPrivate: true, timeoutMs: 3000, only: ONLY } });
    if (a?.status === 'completed' && a.trigger === 'scheduled') await emailScheduledAudit({ repo, mailer, auditId, appUrl: 'https://app.test' });
  };
  const submitAuditJob = async (_req, auditId) => { jobs.push(runJob(auditId)); };
  const app = createApi({
    repoFor: () => repo,
    authenticate: async (req) => (req.headers['x-test-user'] ? { catalystUserId: req.headers['x-test-user'], email: `${req.headers['x-test-user']}@example.com` } : null),
    submitAuditJob,
    config: { appUrl: 'https://app.test', billing: { devMode: true } },
  });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const as = (user) => async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(user ? { 'X-Test-User': user } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const settle = async () => { while (jobs.length) await jobs.shift(); };
  return { repo, sent, as, settle, submitAuditJob, close: () => new Promise((r) => server.close(r)) };
}

test('full flow: ranked free report, issue log (detected -> fixed -> reopened), Pro gating, schedules and e-mail', async () => {
  const env = await setup();
  const site = await createFixtureSite();
  try {
    const alice = env.as('1001');
    assert.equal((await env.as(null)('GET', '/api/me')).status, 401);
    // Catalyst calls arrive under /server/<function>/...; the prefix is stripped.
    assert.equal((await alice('GET', '/server/siteguard_api/api/me')).data.user.plan, 'free');

    const scan = await alice('POST', '/api/scan', { url: site.url });
    assert.equal(scan.status, 202);
    const { targetId } = scan.data;
    assert.ok(['queued', 'running'].includes((await alice('GET', `/api/audits/${scan.data.auditId}`)).data.audit.status));
    await env.settle();
    const r1 = (await alice('GET', `/api/audits/${scan.data.auditId}`)).data;
    assert.equal(r1.audit.status, 'completed');
    assert.equal(r1.detailed, false);
    assert.equal(r1.findings[0].severity, 'critical');
    assert.equal(r1.findings[0].remediation, undefined);
    assert.equal(r1.findings[0].evidence, undefined);
    assert.equal(r1.changes.new.length, r1.findings.length);

    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'weekly' })).status, 402);
    assert.equal((await alice('GET', `/api/audits/${r1.audit.id}/export.json`)).status, 402);

    // the owner fixes .env and adds a CSP
    site.state.exposeEnv = false; site.state.csp = true;
    const a2 = await alice('POST', `/api/targets/${targetId}/audits`);
    await env.settle();
    const r2 = (await alice('GET', `/api/audits/${a2.data.auditId}`)).data;
    assert.deepEqual(r2.changes.resolved.map((i) => i.checkId).sort(), ['exposure.env', 'headers.clickjacking', 'headers.csp_missing']);
    assert.equal(r2.changes.new.length, 0);
    assert.equal(r2.previousAudit.id, r1.audit.id);

    // .env comes back
    site.state.exposeEnv = true;
    const a3 = await alice('POST', `/api/targets/${targetId}/audits`);
    await env.settle();
    const r3 = (await alice('GET', `/api/audits/${a3.data.auditId}`)).data;
    assert.deepEqual(r3.changes.reopened.map((i) => i.checkId), ['exposure.env']);

    const log = (await alice('GET', `/api/targets/${targetId}/issues`)).data;
    const envIssue = log.find((i) => i.checkId === 'exposure.env');
    assert.equal(envIssue.status, 'open');
    assert.equal(envIssue.timesReopened, 1);
    assert.deepEqual(envIssue.history.map((h) => [h.event, h.auditId]), [['detected', r1.audit.id], ['resolved', r2.audit.id], ['reopened', r3.audit.id]]);
    const csp = log.find((i) => i.checkId === 'headers.csp_missing');
    assert.equal(csp.status, 'resolved');
    assert.equal(csp.resolvedAuditId, r2.audit.id);
    assert.equal(log[0].status, 'open');

    // a failed audit must not mark issues as fixed
    const openBefore = await env.repo.countIssues(targetId, 'open');
    await new Promise((r) => site.server.close(r));
    const a4 = await alice('POST', `/api/targets/${targetId}/audits`);
    await env.settle();
    assert.equal((await alice('GET', `/api/audits/${a4.data.auditId}`)).data.audit.status, 'failed');
    assert.equal(await env.repo.countIssues(targetId, 'open'), openBefore);
    await new Promise((r) => site.server.listen(Number(new URL(site.url).port), '127.0.0.1', r));

    // Pro: details, export, schedule (first audit + e-mail right away)
    await alice('POST', '/api/billing/dev-set-plan', { plan: 'pro' });
    const detailed = (await alice('GET', `/api/audits/${r3.audit.id}`)).data;
    assert.ok(detailed.detailed && detailed.findings[0].remediation && detailed.findings[0].evidence);
    assert.equal((await alice('GET', `/api/audits/${r3.audit.id}/export.json`)).status, 200);
    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'hourly' })).status, 400);
    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'weekly', recipients: 'nope' })).status, 400);
    site.state.exposeGit = false;
    assert.equal((await alice('PUT', `/api/targets/${targetId}/schedule`, { frequency: 'weekly', recipients: 'alice@example.com, ops@example.com' })).status, 200);
    await env.settle();
    assert.equal(env.sent.length, 1);
    assert.deepEqual(env.sent[0].to, ['alice@example.com', 'ops@example.com']);
    assert.match(env.sent[0].subject, /grade F/);
    assert.match(env.sent[0].subject, /1 fixed/);
    assert.match(env.sent[0].html, /Fixed since last audit/);
    assert.match(env.sent[0].html, /How to fix/);
    const schedule = await env.repo.getSchedule(targetId);
    const days = (Date.parse(schedule.nextRunAt) - Date.now()) / 864e5;
    assert.ok(days > 6.9 && days <= 7.01, `next run in ~7 days, got ${days}`);

    // scheduler: nothing due tomorrow; due in 8 days -> one audit + one more e-mail
    const submit = (id) => env.submitAuditJob(null, id);
    assert.deepEqual(await runDueSchedules({ repo: env.repo, submitAuditJob: submit, at: new Date(Date.now() + 864e5) }), []);
    const queued = await runDueSchedules({ repo: env.repo, submitAuditJob: submit, at: new Date(Date.now() + 8 * 864e5) });
    assert.equal(queued.length, 1);
    await env.settle();
    assert.equal(env.sent.length, 2);

    // downgrade: schedule paused (slot skipped, no audit, no mail)
    await alice('POST', '/api/billing/dev-set-plan', { plan: 'free' });
    assert.deepEqual(await runDueSchedules({ repo: env.repo, submitAuditJob: submit, at: new Date(Date.now() + 30 * 864e5) }), []);
    assert.equal(env.sent.length, 2);

    // isolation between users
    const bob = env.as('2002');
    assert.equal((await bob('GET', `/api/targets/${targetId}`)).status, 404);
    assert.equal((await bob('GET', `/api/audits/${r1.audit.id}`)).status, 404);
    assert.equal((await bob('GET', `/api/targets/${targetId}/issues`)).status, 404);
    assert.equal((await bob('DELETE', `/api/targets/${targetId}`)).status, 404);
    assert.deepEqual((await bob('GET', '/api/targets')).data, []);

    // deleting a site removes its whole history
    assert.equal((await alice('DELETE', `/api/targets/${targetId}`)).status, 200);
    for (const t of ['audits', 'issues', 'issueEvents', 'findings', 'schedules', 'targets']) assert.equal(env.repo.driver.data[t].length, 0, t);
  } finally {
    await site.close().catch(() => {});
    await env.close();
  }
});

test('validation, free-plan limits and stale audit cleanup', async () => {
  const env = await setup();
  try {
    const c = env.as('3003');
    assert.equal((await c('POST', '/api/targets', { url: 'ftp://example.com' })).status, 400);
    assert.equal((await c('POST', '/api/targets', { url: `https://example.com/${'a'.repeat(300)}` })).status, 400);
    for (const u of ['one.example', 'two.example', 'three.example']) assert.equal((await c('POST', '/api/targets', { url: u })).status, 201);
    assert.equal((await c('POST', '/api/targets', { url: 'one.example' })).status, 201);
    assert.equal((await c('POST', '/api/targets', { url: 'four.example' })).status, 402);
    assert.equal((await c('GET', '/api/targets/abc')).status, 404);

    const [t] = await env.repo.listTargets((await env.repo.upsertUser({ catalystUserId: '3003' })).id);
    const stuck = await env.repo.insertAudit({ targetId: t.id, ownerId: t.ownerId, trigger: 'manual' });
    assert.equal(await failStaleAudits({ repo: env.repo, at: new Date(Date.now() + 60 * 60 * 1000) }), 1);
    assert.equal((await env.repo.getAudit(stuck.id)).status, 'failed');
  } finally { await env.close(); }
});

test('Stripe webhook: signature verification and plan changes', async () => {
  const crypto = require('node:crypto');
  const body = '{"type":"x"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_test'), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, 'whsec_test'), false);
  assert.equal(verifyStripeSignature(body, `t=${t - 1000},v1=${sig}`, 'whsec_test'), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, ''), false);

  const repo = createRepo(createMemoryDriver());
  const u = await repo.upsertUser({ catalystUserId: '42', email: 'x@example.com' });
  await applyStripeEvent(repo, { type: 'checkout.session.completed', data: { object: { client_reference_id: u.id, customer: 'cus_1', subscription: 'sub_1' } } });
  assert.equal((await repo.getUser(u.id)).plan, 'pro');
  await applyStripeEvent(repo, { type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1' } } });
  assert.equal((await repo.getUser(u.id)).plan, 'free');
});

test('monthly schedules clamp to the end of short months', () => {
  assert.equal(nextRun('2026-01-31T09:00:00.000Z', 'monthly'), '2026-02-28T09:00:00.000Z');
  assert.equal(nextRun('2026-03-15T09:00:00.000Z', 'monthly'), '2026-04-15T09:00:00.000Z');
  assert.equal(nextRun('2026-03-15T09:00:00.000Z', 'weekly'), '2026-03-22T09:00:00.000Z');
});
