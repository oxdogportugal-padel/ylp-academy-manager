'use strict';
// Runs one audit and maintains the per-site issue log (detected / resolved / reopened).
// Called from the audit_runner Job function (15-minute limit) — never from the
// 30-second API function.
const { runScan } = require('../scanner');

const now = () => new Date().toISOString();

/**
 * Executes a queued audit. Idempotent: an audit that is already completed or
 * failed is left alone, so a duplicate job submission is harmless.
 */
async function runAudit({ repo, auditId, scan = runScan, scannerOptions = {} }) {
  const audit = await repo.getAudit(auditId);
  if (!audit || !['queued', 'running'].includes(audit.status)) return audit;
  const target = await repo.getTarget(audit.targetId);
  if (!target) {
    return repo.updateAudit(auditId, { status: 'failed', error: 'Site was deleted', finishedAt: now() });
  }
  await repo.updateAudit(auditId, { status: 'running', startedAt: now() });
  let result;
  try {
    result = await scan(target.url, scannerOptions);
  } catch (err) {
    // A failed audit says nothing about whether issues are fixed: the issue log is left untouched.
    return repo.updateAudit(auditId, { status: 'failed', error: String(err.message || err).slice(0, 2000), finishedAt: now() });
  }
  await recordResult(repo, audit, result);
  return repo.getAudit(auditId);
}

async function recordResult(repo, audit, result) {
  const at = result.finishedAt || now();
  const auditId = audit.id;
  const targetId = audit.targetId;
  const existing = new Map((await repo.listIssues(targetId)).map((i) => [i.fingerprint, i]));
  const seen = new Set();
  const events = [];
  const findings = [];
  const event = (issueId, type) => events.push({ issueId, targetId, auditId, event: type, at });

  for (const f of result.findings) {
    if (seen.has(f.fingerprint)) continue;
    seen.add(f.fingerprint);
    const issue = existing.get(f.fingerprint);
    let issueId;
    if (!issue) {
      const created = await repo.insertIssue({
        targetId, fingerprint: f.fingerprint, checkId: f.checkId, key: f.key, severity: f.severity, title: f.title,
        status: 'open', firstDetectedAuditId: auditId, firstDetectedAt: at, lastSeenAuditId: auditId, lastSeenAt: at, timesReopened: 0,
      });
      issueId = created.id;
      event(issueId, 'detected');
    } else {
      issueId = issue.id;
      if (issue.status === 'resolved') {
        await repo.updateIssue(issueId, {
          status: 'open', resolvedAuditId: null, resolvedAt: null, timesReopened: (issue.timesReopened || 0) + 1,
          lastSeenAuditId: auditId, lastSeenAt: at, severity: f.severity, title: f.title,
        });
        event(issueId, 'reopened');
      } else {
        await repo.updateIssue(issueId, { lastSeenAuditId: auditId, lastSeenAt: at, severity: f.severity, title: f.title });
      }
    }
    findings.push({ auditId, targetId, issueId, checkId: f.checkId, key: f.key, severity: f.severity, evidence: f.evidence || {} });
  }

  for (const issue of existing.values()) {
    if (issue.status === 'open' && !seen.has(issue.fingerprint)) {
      await repo.updateIssue(issue.id, { status: 'resolved', resolvedAuditId: auditId, resolvedAt: at });
      event(issue.id, 'resolved');
    }
  }

  await repo.insertFindings(findings);
  await repo.insertEvents(events);
  await repo.updateAudit(auditId, {
    status: 'completed', finalUrl: result.finalUrl, score: result.score, grade: result.grade,
    counts: result.counts, meta: result.meta || {}, startedAt: result.startedAt || at, finishedAt: at,
  });
}

module.exports = { runAudit, recordResult };
