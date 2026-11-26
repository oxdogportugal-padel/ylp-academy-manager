'use strict';
// Recurring audits. The audit_scheduler Job function (run every 15 minutes by a
// Catalyst Job Scheduling cron) calls runDueSchedules(); each audit then runs in its
// own audit_runner job, which e-mails the report when it finishes.
const { buildReport } = require('./report');
const { renderAuditEmail } = require('./email-report');
const { planFor } = require('./plans');

const STALE_AFTER_MS = 30 * 60 * 1000; // jobs time out at 15 min; anything older is dead

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
  } else throw new Error(`Unknown frequency ${frequency}`);
  return d.toISOString();
}

/** Starts every due schedule. Returns the audit ids that were queued. */
async function runDueSchedules({ repo, submitAuditJob, at = new Date() }) {
  const nowIso = at.toISOString();
  const queued = [];
  for (const s of await repo.listDueSchedules(nowIso)) {
    // Advance first so a slow or crashed run never fires the same slot twice.
    let next = nextRun(s.nextRunAt, s.frequency);
    while (next <= nowIso) next = nextRun(next, s.frequency);
    await repo.updateSchedule(s.id, { nextRunAt: next, lastRunAt: nowIso });
    const owner = await repo.getUser(s.ownerId);
    if (!planFor(owner).schedules) continue; // subscription lapsed: schedule kept but paused
    if (await repo.findActiveAudit(s.targetId)) continue;
    const audit = await repo.insertAudit({ targetId: s.targetId, ownerId: s.ownerId, trigger: 'scheduled' });
    await submitAuditJob(audit.id);
    queued.push(audit.id);
  }
  return queued;
}

/** Audits whose job died (crash, timeout) are marked failed so the site isn't stuck "running". */
async function failStaleAudits({ repo, at = new Date() }) {
  const stale = await repo.staleAudits(new Date(at.getTime() - STALE_AFTER_MS).toISOString());
  for (const a of stale) await repo.updateAudit(a.id, { status: 'failed', error: 'Audit did not finish in time', finishedAt: at.toISOString() });
  return stale.length;
}

/** E-mails a finished scheduled audit to the schedule's recipients. */
async function emailScheduledAudit({ repo, mailer, auditId, appUrl }) {
  const audit = await repo.getAudit(auditId);
  if (!audit || audit.trigger !== 'scheduled') return null;
  const schedule = await repo.getSchedule(audit.targetId);
  if (!schedule || !schedule.recipients) return null;
  const owner = await repo.getUser(audit.ownerId);
  const report = await buildReport(repo, auditId, { detailed: planFor(owner).detailedReport });
  const msg = renderAuditEmail(report, appUrl);
  const to = schedule.recipients.split(/\s*,\s*/).filter(Boolean);
  try {
    await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text });
    await repo.logEmail({ auditId, recipients: to.join(', '), subject: msg.subject.slice(0, 255), status: 'sent' });
    return { to, subject: msg.subject };
  } catch (err) {
    await repo.logEmail({ auditId, recipients: to.join(', '), subject: msg.subject.slice(0, 255), status: 'failed', error: String(err.message || err) });
    throw err;
  }
}

module.exports = { nextRun, runDueSchedules, failStaleAudits, emailScheduledAudit };
