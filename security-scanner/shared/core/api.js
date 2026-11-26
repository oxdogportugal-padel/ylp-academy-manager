'use strict';
// REST API (Express). Deployed as the siteguard_api Advanced I/O function; the same
// factory runs the local dev server and the tests with an in-memory store.
//
//   repoFor(req)                -> data repository (Catalyst Data Store in production)
//   authenticate(req)           -> { catalystUserId, email } | null   (Catalyst Authentication)
//   submitAuditJob(req, auditId)                                        (Catalyst Job Scheduling)
const express = require('express');
const { PLANS, planFor } = require('./plans');
const { buildReport, issueLog } = require('./report');
const { nextRun } = require('./scheduler');
const { stripeRequest } = require('./billing');
const { normalizeTargetUrl, ScanError } = require('../scanner');

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const ID_RE = /^\d+$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApi({ repoFor, authenticate, submitAuditJob, config }) {
  const app = express();
  app.disable('x-powered-by');

  // Catalyst routes /server/<function>/... to the function: strip that prefix.
  app.use((req, _res, next) => {
    req.url = req.url.replace(/^\/server\/[^/]+(\/execute)?(?=\/|$|\?)/, '') || '/';
    next();
  });

  // CORS only for localhost development. In production the Slate domain is added to
  // Catalyst Authorized Domains, and the gateway injects CORS headers itself.
  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User',
      });
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    return next();
  });

  app.use(express.json({ limit: '50kb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Every API route needs a logged-in Catalyst user; we keep our own AppUsers row (plan, Stripe ids).
  app.use('/api', wrap(async (req, _res, next) => {
    const identity = await authenticate(req);
    if (!identity) throw new HttpError(401, 'Please log in');
    req.repo = repoFor(req);
    req.user = await req.repo.upsertUser(identity);
    next();
  }));

  const own = async (req, kind, id) => {
    const { repo, user } = req;
    if (!ID_RE.test(String(id))) throw new HttpError(404, 'Not found');
    const row = kind === 'target' ? await repo.getTarget(id) : await repo.getAudit(id);
    if (!row || String(row.ownerId) !== String(user.id)) throw new HttpError(404, kind === 'target' ? 'Site not found' : 'Audit not found');
    return row;
  };

  async function createTarget(req, rawUrl) {
    const { repo, user } = req;
    let url;
    try { ({ url } = normalizeTargetUrl(rawUrl)); } catch (e) { throw new HttpError(400, e.message); }
    if (url.length > 255) throw new HttpError(400, 'URL is too long (max 255 characters)');
    const existing = await repo.findTarget(user.id, url);
    if (existing) return existing;
    const plan = planFor(user);
    if (await repo.countTargets(user.id) >= plan.maxTargets) {
      throw new HttpError(402, `Your ${plan.name} plan allows ${plan.maxTargets} sites. Upgrade to monitor more.`);
    }
    return repo.insertTarget(user.id, url);
  }

  async function startAudit(req, target, trigger = 'manual') {
    const { repo, user } = req;
    const active = await repo.findActiveAudit(target.id);
    if (active) return active.id;
    if (trigger === 'manual') {
      const plan = planFor(user);
      const used = await repo.countManualAuditsSince(user.id, new Date(Date.now() - 864e5).toISOString());
      if (used >= plan.manualAuditsPerDay) throw new HttpError(429, `Daily limit of ${plan.manualAuditsPerDay} audits reached on the ${plan.name} plan.`);
    }
    const audit = await repo.insertAudit({ targetId: target.id, ownerId: user.id, trigger });
    try {
      await submitAuditJob(req, audit.id);
    } catch (err) {
      await repo.updateAudit(audit.id, { status: 'failed', error: `Could not start audit: ${err.message}`, finishedAt: new Date().toISOString() });
      throw err;
    }
    return audit.id;
  }

  // ------------------------------------------------------------------- me
  app.get('/api/me', (req, res) => {
    const plan = planFor(req.user);
    res.json({ user: { id: req.user.id, email: req.user.email, plan: plan.id }, features: plan, plans: PLANS });
  });

  // -------------------------------------------------------------- targets
  app.get('/api/targets', wrap(async (req, res) => {
    const targets = await req.repo.listTargets(req.user.id);
    res.json(await Promise.all(targets.map(async (t) => {
      const [last, open, resolved, schedule] = await Promise.all([
        req.repo.latestAudit(t.id), req.repo.countIssues(t.id, 'open'), req.repo.countIssues(t.id, 'resolved'), req.repo.getSchedule(t.id),
      ]);
      return {
        id: t.id, url: t.url, createdAt: t.createdAt,
        lastAudit: last ? { id: last.id, status: last.status, grade: last.grade, score: last.score, counts: last.counts, createdAt: last.createdAt } : null,
        openIssues: open, resolvedIssues: resolved,
        schedule: schedule ? { frequency: schedule.frequency, enabled: schedule.enabled, nextRunAt: schedule.nextRunAt } : null,
      };
    })));
  }));

  app.post('/api/targets', wrap(async (req, res) => res.status(201).json(await createTarget(req, req.body?.url))));

  // One step: add (or reuse) the site and start an audit.
  app.post('/api/scan', wrap(async (req, res) => {
    const target = await createTarget(req, req.body?.url);
    res.status(202).json({ targetId: target.id, auditId: await startAudit(req, target) });
  }));

  app.get('/api/targets/:id', wrap(async (req, res) => {
    const t = await own(req, 'target', req.params.id);
    const [schedule, audits] = await Promise.all([req.repo.getSchedule(t.id), req.repo.listAudits(t.id, 200)]);
    res.json({
      target: { id: t.id, url: t.url, createdAt: t.createdAt },
      schedule: schedule ? { frequency: schedule.frequency, recipients: schedule.recipients, enabled: schedule.enabled, nextRunAt: schedule.nextRunAt, lastRunAt: schedule.lastRunAt } : null,
      audits: audits.map((a) => ({ id: a.id, trigger: a.trigger, status: a.status, grade: a.grade, score: a.score, counts: a.counts, error: a.error, createdAt: a.createdAt, finishedAt: a.finishedAt })),
    });
  }));

  app.delete('/api/targets/:id', wrap(async (req, res) => {
    const t = await own(req, 'target', req.params.id);
    await req.repo.deleteTargetCascade(t.id);
    res.json({ ok: true });
  }));

  app.post('/api/targets/:id/audits', wrap(async (req, res) => {
    const t = await own(req, 'target', req.params.id);
    res.status(202).json({ auditId: await startAudit(req, t) });
  }));

  // Issue log: every issue ever seen on this site with its detected / resolved / reopened history.
  app.get('/api/targets/:id/issues', wrap(async (req, res) => {
    const t = await own(req, 'target', req.params.id);
    res.json(await issueLog(req.repo, t.id));
  }));

  // ------------------------------------------------------------ schedules
  app.put('/api/targets/:id/schedule', wrap(async (req, res) => {
    const t = await own(req, 'target', req.params.id);
    if (!planFor(req.user).schedules) throw new HttpError(402, 'Scheduled audits are a Pro feature');
    const frequency = String(req.body?.frequency || '');
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) throw new HttpError(400, 'Frequency must be daily, weekly or monthly');
    const recipients = String(req.body?.recipients || req.user.email).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!recipients.length || recipients.length > 10 || !recipients.every((r) => EMAIL_RE.test(r))) {
      throw new HttpError(400, 'Enter up to 10 valid e-mail addresses');
    }
    const existing = await req.repo.getSchedule(t.id);
    const nowIso = new Date().toISOString();
    const keepCadence = existing && existing.frequency === frequency;
    await req.repo.upsertSchedule(t.id, req.user.id, {
      frequency, recipients: recipients.join(', '), enabled: req.body?.enabled !== false,
      nextRunAt: keepCadence ? existing.nextRunAt : nextRun(nowIso, frequency),
    });
    // A brand-new schedule runs its first audit (and sends its first e-mail) right away.
    if (!existing && req.body?.runNow !== false) await startAudit(req, t, 'scheduled');
    res.json({ ok: true });
  }));

  app.delete('/api/targets/:id/schedule', wrap(async (req, res) => {
    const t = await own(req, 'target', req.params.id);
    await req.repo.deleteSchedule(t.id);
    res.json({ ok: true });
  }));

  // --------------------------------------------------------------- audits
  app.get('/api/audits/:id', wrap(async (req, res) => {
    const a = await own(req, 'audit', req.params.id);
    res.json(await buildReport(req.repo, a.id, { detailed: planFor(req.user).detailedReport }));
  }));

  app.get('/api/audits/:id/export.json', wrap(async (req, res) => {
    const a = await own(req, 'audit', req.params.id);
    if (!planFor(req.user).exportJson) throw new HttpError(402, 'Export is a Pro feature');
    res.set('Content-Disposition', `attachment; filename="siteguard-audit-${a.id}.json"`);
    res.json(await buildReport(req.repo, a.id, { detailed: true }));
  }));

  // -------------------------------------------------------------- billing
  const billing = config.billing || {};
  const stripeEnabled = Boolean(billing.stripeSecretKey && billing.stripePriceId);

  app.get('/api/billing/config', (_req, res) => res.json({ stripeEnabled, devMode: Boolean(billing.devMode) }));

  app.post('/api/billing/checkout', wrap(async (req, res) => {
    if (!stripeEnabled) throw new HttpError(400, 'Online payments are not configured yet');
    const params = {
      mode: 'subscription',
      'line_items[0][price]': billing.stripePriceId,
      'line_items[0][quantity]': '1',
      success_url: `${config.appUrl}/#/billing?status=success`,
      cancel_url: `${config.appUrl}/#/billing?status=cancelled`,
      client_reference_id: String(req.user.id),
    };
    if (req.user.stripeCustomerId) params.customer = req.user.stripeCustomerId;
    else params.customer_email = req.user.email;
    const session = await stripeRequest(billing.stripeSecretKey, 'checkout/sessions', params);
    res.json({ url: session.url });
  }));

  app.post('/api/billing/portal', wrap(async (req, res) => {
    if (!stripeEnabled || !req.user.stripeCustomerId) throw new HttpError(400, 'No subscription to manage');
    const session = await stripeRequest(billing.stripeSecretKey, 'billing_portal/sessions', { customer: req.user.stripeCustomerId, return_url: `${config.appUrl}/#/billing` });
    res.json({ url: session.url });
  }));

  app.post('/api/billing/dev-set-plan', wrap(async (req, res) => {
    if (!billing.devMode) throw new HttpError(404, 'Not found');
    const plan = req.body?.plan === 'pro' ? 'pro' : 'free';
    await req.repo.updateUser(req.user.id, { plan });
    res.json({ plan });
  }));

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError || err instanceof ScanError) return res.status(err.status || 400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApi, HttpError };
