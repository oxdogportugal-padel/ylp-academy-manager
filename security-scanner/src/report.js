'use strict';
// Builds reports from stored audits. What a report contains depends on the plan:
// free = severity-ranked list; pro = + explanation, evidence, remediation, references.
const { CATALOG, SEVERITY_RANK } = require('./scanner/catalog');

const parse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function buildReport(db, auditId, { detailed }) {
  const audit = db.get('SELECT * FROM audits WHERE id = ?', auditId);
  if (!audit) return null;
  const target = db.get('SELECT id, url, label FROM targets WHERE id = ?', audit.target_id);

  const rows = db.all(`SELECT f.*, i.id AS issue_id, i.first_detected_at, i.times_reopened, i.title
    FROM findings f JOIN issues i ON i.id = f.issue_id WHERE f.audit_id = ?`, auditId);

  const findings = rows.map((r) => {
    const def = CATALOG[r.check_id] || {};
    const base = {
      checkId: r.check_id, key: r.key, severity: r.severity, category: def.category, title: r.title,
      summary: def.summary, issueId: r.issue_id, firstDetectedAt: r.first_detected_at, timesReopened: r.times_reopened,
    };
    if (!detailed) return base;
    return {
      ...base, description: def.description, remediation: def.remediation, references: def.references || [],
      cwe: def.cwe, owasp: def.owasp, evidence: parse(r.evidence, {}),
    };
  }).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));

  const events = db.all(`SELECT e.event, i.id AS issue_id, i.check_id, i.key, i.severity, i.title, i.first_detected_at
    FROM issue_events e JOIN issues i ON i.id = e.issue_id WHERE e.audit_id = ?`, auditId);
  const pick = (ev) => events.filter((e) => e.event === ev)
    .map((e) => ({ issueId: e.issue_id, checkId: e.check_id, key: e.key, severity: e.severity, title: e.title, firstDetectedAt: e.first_detected_at }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const previous = db.get(`SELECT id, created_at, grade, score FROM audits
    WHERE target_id = ? AND status = 'completed' AND id < ? ORDER BY id DESC LIMIT 1`, audit.target_id, auditId);

  return {
    detailed: Boolean(detailed),
    target,
    audit: {
      id: audit.id, status: audit.status, trigger: audit.trigger, finalUrl: audit.final_url,
      score: audit.score, grade: audit.grade, counts: parse(audit.counts),
      createdAt: audit.created_at, startedAt: audit.started_at, finishedAt: audit.finished_at, error: audit.error,
      ...(detailed ? { meta: parse(audit.meta) } : {}),
    },
    previousAudit: previous ? { id: previous.id, createdAt: previous.created_at, grade: previous.grade, score: previous.score } : null,
    changes: {
      // Relative to the previous audit of this target. On the very first audit everything is "new".
      new: pick('detected'),
      reopened: pick('reopened'),
      resolved: pick('resolved'),
    },
    findings,
  };
}

function issueLog(db, targetId) {
  const issues = db.all('SELECT * FROM issues WHERE target_id = ?', targetId);
  const events = db.all(`SELECT e.issue_id, e.event, e.at, e.audit_id FROM issue_events e
    JOIN issues i ON i.id = e.issue_id WHERE i.target_id = ? ORDER BY e.id`, targetId);
  const byIssue = new Map();
  for (const e of events) {
    if (!byIssue.has(e.issue_id)) byIssue.set(e.issue_id, []);
    byIssue.get(e.issue_id).push({ event: e.event, at: e.at, auditId: e.audit_id });
  }
  return issues.map((i) => ({
    id: i.id, checkId: i.check_id, key: i.key, severity: i.severity, title: i.title,
    category: CATALOG[i.check_id]?.category, status: i.status,
    firstDetectedAt: i.first_detected_at, firstDetectedAuditId: i.first_detected_audit_id,
    lastSeenAt: i.last_seen_at, lastSeenAuditId: i.last_seen_audit_id,
    resolvedAt: i.resolved_at, resolvedAuditId: i.resolved_audit_id,
    timesReopened: i.times_reopened,
    openForDays: Math.max(0, Math.round(((i.resolved_at ? Date.parse(i.resolved_at) : Date.now()) - Date.parse(i.first_detected_at)) / 864e5)),
    history: byIssue.get(i.id) || [],
  })).sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1)
    || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || String(b.resolvedAt || '').localeCompare(String(a.resolvedAt || '')));
}

module.exports = { buildReport, issueLog };
