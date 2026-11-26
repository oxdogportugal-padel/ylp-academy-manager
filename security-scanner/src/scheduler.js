'use strict';
// Runs due scheduled audits (Pro only) and e-mails the report to the recipients.
const { buildReport } = require('./report');
const { renderAuditEmail } = require('./email-report');

function nextRun(fromIso, frequency) {
  const d = new Date(fromIso);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'monthly') {
    // Same day next month, clamped (Jan 31 -> Feb 28/29) instead of overflowing into March.
    const dom = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dom, daysInMonth));
  }
  else throw new Error(`Unknown frequency ${frequency}`);
  return d.toISOString();
}

function createScheduler({ db, audits, mailer, appUrl, intervalMs = 60000, log = console }) {
  let timer = null;

  async function emailAudit(auditId, recipients, { detailed }) {
    const report = buildReport(db, auditId, { detailed });
    const msg = renderAuditEmail(report, appUrl);
    try {
      await mailer.send({ to: recipients, ...msg });
      db.run('INSERT INTO email_log (audit_id, recipients, subject, status) VALUES (?,?,?,?)', auditId, recipients, msg.subject, 'sent');
    } catch (err) {
      db.run('INSERT INTO email_log (audit_id, recipients, subject, status, error) VALUES (?,?,?,?,?)', auditId, recipients, msg.subject, 'failed', err.message);
      log.error(`[scheduler] e-mail for audit ${auditId} failed: ${err.message}`);
    }
  }

  /** Starts every due schedule; resolves once their audits ran and e-mails went out. */
  async function tick(at = new Date()) {
    const nowIso = at.toISOString();
    const due = db.all(`SELECT s.*, u.plan FROM schedules s JOIN targets t ON t.id = s.target_id JOIN users u ON u.id = t.user_id
      WHERE s.enabled = 1 AND s.next_run_at <= ?`, nowIso);
    const jobs = [];
    for (const s of due) {
      // Advance first so a slow audit or a crash never runs the same slot twice.
      let next = nextRun(s.next_run_at, s.frequency);
      while (next <= nowIso) next = nextRun(next, s.frequency);
      db.run('UPDATE schedules SET next_run_at = ?, last_run_at = ? WHERE id = ?', next, nowIso, s.id);
      if (s.plan !== 'pro') continue; // subscription lapsed: schedule is kept but paused
      const { done } = audits.enqueue(s.target_id, 'scheduled');
      jobs.push(done.then((audit) => emailAudit(audit.id, s.recipients, { detailed: true })));
    }
    await Promise.all(jobs);
    return due.length;
  }

  function start() {
    if (timer) return;
    const run = () => tick().catch((e) => log.error('[scheduler]', e));
    timer = setInterval(run, intervalMs);
    timer.unref?.();
    run();
  }
  function stop() { clearInterval(timer); timer = null; }

  return { tick, start, stop, emailAudit };
}

module.exports = { createScheduler, nextRun };
