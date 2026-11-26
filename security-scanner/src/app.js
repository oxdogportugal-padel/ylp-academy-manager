'use strict';
const path = require('node:path');
const express = require('express');
const { createAuth, hashPassword, verifyPassword } = require('./auth');
const { PLANS, planFor } = require('./plans');
const { buildReport, issueLog } = require('./report');
const { createBillingRouter } = require('./billing');
const { normalizeTargetUrl, ScanError } = require('./scanner');
const { nextRun } = require('./scheduler');

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const parseJson = (s) => (s ? JSON.parse(s) : null);

function createApp({ db, config, audits }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // We practise what we preach.
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Frame-Options': 'DENY',
      ...(config.production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    });
    next();
  });

  const auth = createAuth({ db, secureCookies: config.production });
  app.use(auth.loadUser);
  const { requireUser } = auth;

  // Billing (mounted before express.json so the webhook gets the raw body)
  app.use('/api/billing', createBillingRouter({ db, billing: config.billing, appUrl: config.appUrl, requireUser }));
  app.use('/api', express.json({ limit: '50kb' }));

  // CSRF: state-changing API calls must be JSON (cross-site forms cannot send that without a CORS preflight).
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.path.startsWith('/billing/webhook')
      && req.headers['content-length'] !== '0' && req.headers['content-length'] && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' });
    }
    return next();
  });

  // ------------------------------------------------------------------ auth
  app.post('/api/auth/signup', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid e-mail address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'An account with this e-mail already exists' });
    const { lastInsertRowid } = db.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', email, hashPassword(password));
    auth.startSession(res, Number(lastInsertRowid));
    return res.status(201).json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Wrong e-mail or password' });
    }
    auth.startSession(res, user.id);
    return res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });

  app.get('/api/me', (req, res) => {
    if (!req.user) return res.json({ user: null, plans: PLANS });
    const plan = planFor(req.user);
    return res.json({ user: { id: req.user.id, email: req.user.email, plan: plan.id }, features: plan, plans: PLANS });
  });

  // --------------------------------------------------------------- targets
  const ownTarget = (req, res) => {
    const t = db.get('SELECT * FROM targets WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!t) res.status(404).json({ error: 'Site not found' });
    return t;
  };

  function createTarget(user, rawUrl) {
    const { url } = normalizeTargetUrl(rawUrl);
    const existing = db.get('SELECT * FROM targets WHERE user_id = ? AND url = ?', user.id, url);
    if (existing) return existing;
    const { count } = db.get('SELECT COUNT(*) AS count FROM targets WHERE user_id = ?', user.id);
    const plan = planFor(user);
    if (count >= plan.maxTargets) {
      const e = new ScanError(`Your ${plan.name} plan allows ${plan.maxTargets} sites. Upgrade to monitor more.`);
      e.status = 402;
      throw e;
    }
    const { lastInsertRowid } = db.run('INSERT INTO targets (user_id, url) VALUES (?, ?)', user.id, url);
    return db.get('SELECT * FROM targets WHERE id = ?', Number(lastInsertRowid));
  }

  function startManualAudit(user, targetId) {
    const plan = planFor(user);
    const { count } = db.get(`SELECT COUNT(*) AS count FROM audits a JOIN targets t ON t.id = a.target_id
      WHERE t.user_id = ? AND a.trigger = 'manual' AND a.created_at > ?`, user.id, new Date(Date.now() - 864e5).toISOString());
    if (count >= plan.manualAuditsPerDay) {
      const e = new ScanError(`Daily limit of ${plan.manualAuditsPerDay} audits reached on the ${plan.name} plan.`);
      e.status = 429;
      throw e;
    }
    const running = db.get(`SELECT id FROM audits WHERE target_id = ? AND status IN ('queued','running')`, targetId);
    if (running) return running.id;
    return audits.enqueue(targetId, 'manual').auditId;
  }

  const handle = (fn) => (req, res) => {
    try { return fn(req, res); } catch (err) {
      if (err instanceof ScanError) return res.status(err.status || 400).json({ error: err.message });
      throw err;
    }
  };

  app.get('/api/targets', requireUser, (req, res) => {
    const rows = db.all(`SELECT t.*,
        (SELECT json_object('id', a.id, 'status', a.status, 'grade', a.grade, 'score', a.score, 'counts', a.counts, 'createdAt', a.created_at)
           FROM audits a WHERE a.target_id = t.id ORDER BY a.id DESC LIMIT 1) AS last_audit,
        (SELECT COUNT(*) FROM audits a WHERE a.target_id = t.id) AS audit_count,
        (SELECT COUNT(*) FROM issues i WHERE i.target_id = t.id AND i.status = 'open') AS open_issues,
        (SELECT COUNT(*) FROM issues i WHERE i.target_id = t.id AND i.status = 'resolved') AS resolved_issues,
        s.frequency, s.enabled AS schedule_enabled, s.next_run_at
      FROM targets t LEFT JOIN schedules s ON s.target_id = t.id WHERE t.user_id = ? ORDER BY t.created_at DESC`, req.user.id);
    res.json(rows.map((r) => {
      const last = parseJson(r.last_audit);
      if (last) last.counts = parseJson(last.counts);
      return {
        id: r.id, url: r.url, createdAt: r.created_at, lastAudit: last, auditCount: r.audit_count,
        openIssues: r.open_issues, resolvedIssues: r.resolved_issues,
        schedule: r.frequency ? { frequency: r.frequency, enabled: Boolean(r.schedule_enabled), nextRunAt: r.next_run_at } : null,
      };
    }));
  });

  app.post('/api/targets', requireUser, handle((req, res) => res.status(201).json(createTarget(req.user, req.body?.url))));

  // One-step "scan this URL": creates/reuses the site and starts an audit.
  app.post('/api/scan', requireUser, handle((req, res) => {
    const target = createTarget(req.user, req.body?.url);
    const auditId = startManualAudit(req.user, target.id);
    res.status(202).json({ targetId: target.id, auditId });
  }));

  app.get('/api/targets/:id', requireUser, (req, res) => {
    const t = ownTarget(req, res);
    if (!t) return undefined;
    const schedule = db.get('SELECT frequency, recipients, enabled, next_run_at, last_run_at FROM schedules WHERE target_id = ?', t.id);
    const audits = db.all(`SELECT id, trigger, status, grade, score, counts, error, created_at, finished_at FROM audits
      WHERE target_id = ? ORDER BY id DESC LIMIT 200`, t.id).map((a) => ({ ...a, counts: parseJson(a.counts) }));
    return res.json({
      target: { id: t.id, url: t.url, createdAt: t.created_at },
      schedule: schedule ? { frequency: schedule.frequency, recipients: schedule.recipients, enabled: Boolean(schedule.enabled), nextRunAt: schedule.next_run_at, lastRunAt: schedule.last_run_at } : null,
      audits,
    });
  });

  app.delete('/api/targets/:id', requireUser, (req, res) => {
    const t = ownTarget(req, res);
    if (!t) return undefined;
    db.run('DELETE FROM targets WHERE id = ?', t.id);
    return res.json({ ok: true });
  });

  app.post('/api/targets/:id/audits', requireUser, handle((req, res) => {
    const t = ownTarget(req, res);
    if (!t) return undefined;
    return res.status(202).json({ auditId: startManualAudit(req.user, t.id) });
  }));

  // Issue log: every issue ever seen on this site, with detected / resolved / reopened history.
  app.get('/api/targets/:id/issues', requireUser, (req, res) => {
    const t = ownTarget(req, res);
    if (!t) return undefined;
    return res.json(issueLog(db, t.id));
  });

  // --------------------------------------------------------------- schedules
  app.put('/api/targets/:id/schedule', requireUser, (req, res) => {
    const t = ownTarget(req, res);
    if (!t) return undefined;
    if (!planFor(req.user).schedules) return res.status(402).json({ error: 'Scheduled audits are a Pro feature' });
    const frequency = String(req.body?.frequency || '');
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) return res.status(400).json({ error: 'Frequency must be daily, weekly or monthly' });
    const recipients = String(req.body?.recipients || req.user.email).split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!recipients.length || recipients.length > 10 || !recipients.every((r) => EMAIL_RE.test(r))) {
      return res.status(400).json({ error: 'Enter up to 10 valid e-mail addresses' });
    }
    const enabled = req.body?.enabled === false ? 0 : 1;
    const existing = db.get('SELECT * FROM schedules WHERE target_id = ?', t.id);
    // First run: now-ish for a new schedule; keep the cadence when only recipients change.
    const nextRunAt = existing && existing.frequency === frequency ? existing.next_run_at : nextRun(new Date().toISOString(), frequency);
    const runFirstAuditNow = !existing && req.body?.runNow !== false;
    db.run(`INSERT INTO schedules (target_id, frequency, recipients, enabled, next_run_at) VALUES (?,?,?,?,?)
      ON CONFLICT(target_id) DO UPDATE SET frequency=excluded.frequency, recipients=excluded.recipients, enabled=excluded.enabled, next_run_at=excluded.next_run_at`,
    t.id, frequency, recipients.join(', '), enabled, runFirstAuditNow ? new Date().toISOString() : nextRunAt);
    return res.json({ ok: true });
  });

  app.delete('/api/targets/:id/schedule', requireUser, (req, res) => {
    const t = ownTarget(req, res);
    if (!t) return undefined;
    db.run('DELETE FROM schedules WHERE target_id = ?', t.id);
    return res.json({ ok: true });
  });

  // ----------------------------------------------------------------- audits
  const ownAudit = (req, res) => {
    const a = db.get(`SELECT a.* FROM audits a JOIN targets t ON t.id = a.target_id WHERE a.id = ? AND t.user_id = ?`, Number(req.params.id), req.user.id);
    if (!a) res.status(404).json({ error: 'Audit not found' });
    return a;
  };

  app.get('/api/audits/:id', requireUser, (req, res) => {
    const a = ownAudit(req, res);
    if (!a) return undefined;
    return res.json(buildReport(db, a.id, { detailed: planFor(req.user).detailedReport }));
  });

  app.get('/api/audits/:id/export.json', requireUser, (req, res) => {
    const a = ownAudit(req, res);
    if (!a) return undefined;
    if (!planFor(req.user).exportJson) return res.status(402).json({ error: 'Export is a Pro feature' });
    res.set('Content-Disposition', `attachment; filename="siteguard-audit-${a.id}.json"`);
    return res.json(buildReport(db, a.id, { detailed: true }));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
