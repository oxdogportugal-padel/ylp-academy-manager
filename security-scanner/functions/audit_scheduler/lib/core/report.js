'use strict';
// Builds reports from stored audits. What a report contains depends on the plan:
// free = severity-ranked list; pro = + explanation, evidence, remediation, references.
const { CATALOG, SEVERITY_RANK } = require('../scanner/catalog');

const bySeverity = (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

async function buildReport(repo, auditId, { detailed }) {
  const audit = await repo.getAudit(auditId);
  if (!audit) return null;
  const target = await repo.getTarget(audit.targetId);
  const [findings, events, previous] = await Promise.all([
    repo.listFindingsForAudit(auditId),
    repo.listEventsForAudit(auditId),
    repo.previousCompletedAudit(audit.targetId, audit.createdAt),
  ]);
  const issues = new Map((await repo.listIssues(audit.targetId)).map((i) => [i.id, i]));

  const list = findings.map((f) => {
    const def = CATALOG[f.checkId] || {};
    const issue = issues.get(f.issueId) || {};
    const base = {
      checkId: f.checkId, key: f.key, severity: f.severity, category: def.category, title: issue.title || def.title,
      summary: def.summary, issueId: f.issueId, firstDetectedAt: issue.firstDetectedAt, timesReopened: issue.timesReopened || 0,
    };
    if (!detailed) return base;
    return {
      ...base, description: def.description, remediation: def.remediation, references: def.references || [],
      cwe: def.cwe, owasp: def.owasp, evidence: f.evidence || {},
    };
  }).sort((a, b) => bySeverity(a, b) || (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));

  const pick = (type) => events.filter((e) => e.event === type).map((e) => {
    const i = issues.get(e.issueId) || {};
    return { issueId: e.issueId, checkId: i.checkId, key: i.key, severity: i.severity, title: i.title, firstDetectedAt: i.firstDetectedAt };
  }).sort(bySeverity);

  return {
    detailed: Boolean(detailed),
    target: target ? { id: target.id, url: target.url } : null,
    audit: {
      id: audit.id, status: audit.status, trigger: audit.trigger, finalUrl: audit.finalUrl,
      score: audit.score, grade: audit.grade, counts: audit.counts,
      createdAt: audit.createdAt, startedAt: audit.startedAt, finishedAt: audit.finishedAt, error: audit.error,
      ...(detailed ? { meta: audit.meta } : {}),
    },
    previousAudit: previous ? { id: previous.id, createdAt: previous.createdAt, grade: previous.grade, score: previous.score } : null,
    // Relative to the previous audit of this site. On the very first audit everything is "new".
    changes: { new: pick('detected'), reopened: pick('reopened'), resolved: pick('resolved') },
    findings: list,
  };
}

async function issueLog(repo, targetId) {
  const [issues, events] = await Promise.all([repo.listIssues(targetId), repo.listEventsForTarget(targetId)]);
  const history = new Map();
  for (const e of events) {
    if (!history.has(e.issueId)) history.set(e.issueId, []);
    history.get(e.issueId).push({ event: e.event, at: e.at, auditId: e.auditId });
  }
  return issues.map((i) => ({
    id: i.id, checkId: i.checkId, key: i.key, severity: i.severity, title: i.title,
    category: CATALOG[i.checkId]?.category, status: i.status,
    firstDetectedAt: i.firstDetectedAt, firstDetectedAuditId: i.firstDetectedAuditId,
    lastSeenAt: i.lastSeenAt, lastSeenAuditId: i.lastSeenAuditId,
    resolvedAt: i.resolvedAt, resolvedAuditId: i.resolvedAuditId,
    timesReopened: i.timesReopened || 0,
    openForDays: Math.max(0, Math.round(((i.resolvedAt ? Date.parse(i.resolvedAt) : Date.now()) - Date.parse(i.firstDetectedAt)) / 864e5)),
    history: history.get(i.id) || [],
  })).sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)
    || bySeverity(a, b)
    || String(b.resolvedAt || '').localeCompare(String(a.resolvedAt || '')));
}

module.exports = { buildReport, issueLog };
