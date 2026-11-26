'use strict';
// Runs audits, stores them, and maintains the per-target issue log
// (first detected / resolved / reopened) by diffing against open issues.
const { runScan } = require('./scanner');

const now = () => new Date().toISOString();

function createAuditService({ db, scannerOptions = {}, concurrency = 3, scan = runScan }) {
  const queue = [];
  let active = 0;
  const waiters = new Map(); // auditId -> [resolve]

  // Anything left half-done by a crash/restart is marked failed.
  db.run(`UPDATE audits SET status='failed', error='Interrupted by server restart', finished_at=? WHERE status IN ('queued','running')`, now());

  function enqueue(targetId, trigger = 'manual') {
    const { lastInsertRowid } = db.run(`INSERT INTO audits (target_id, trigger, status) VALUES (?, ?, 'queued')`, targetId, trigger);
    const auditId = Number(lastInsertRowid);
    const done = new Promise((resolve) => waiters.set(auditId, [resolve]));
    queue.push(auditId);
    pump();
    return { auditId, done };
  }

  function pump() {
    while (active < concurrency && queue.length) {
      const auditId = queue.shift();
      active += 1;
      execute(auditId).finally(() => {
        active -= 1;
        for (const resolve of waiters.get(auditId) || []) resolve(getAudit(auditId));
        waiters.delete(auditId);
        pump();
      });
    }
  }

  async function execute(auditId) {
    const audit = db.get('SELECT a.*, t.url FROM audits a JOIN targets t ON t.id = a.target_id WHERE a.id = ?', auditId);
    if (!audit) return;
    db.run(`UPDATE audits SET status='running', started_at=? WHERE id=?`, now(), auditId);
    try {
      const result = await scan(audit.url, scannerOptions);
      recordResult(auditId, audit.target_id, result);
    } catch (err) {
      // A failed audit says nothing about whether issues are fixed: the issue log is left untouched.
      db.run(`UPDATE audits SET status='failed', error=?, finished_at=? WHERE id=?`, String(err.message || err), now(), auditId);
    }
  }

  function recordResult(auditId, targetId, result) {
    const at = result.finishedAt || now();
    db.tx(() => {
      const existing = new Map(db.all('SELECT * FROM issues WHERE target_id = ?', targetId).map((i) => [i.fingerprint, i]));
      const seen = new Set();
      const event = (issueId, ev) => db.run('INSERT INTO issue_events (issue_id, audit_id, event, at) VALUES (?,?,?,?)', issueId, auditId, ev, at);

      for (const f of result.findings) {
        seen.add(f.fingerprint);
        let issue = existing.get(f.fingerprint);
        let issueId;
        if (!issue) {
          issueId = Number(db.run(`INSERT INTO issues (target_id, fingerprint, check_id, key, severity, title, status,
              first_detected_audit_id, first_detected_at, last_seen_audit_id, last_seen_at)
            VALUES (?,?,?,?,?,?,'open',?,?,?,?)`, targetId, f.fingerprint, f.checkId, f.key, f.severity, f.title, auditId, at, auditId, at).lastInsertRowid);
          event(issueId, 'detected');
        } else {
          issueId = issue.id;
          if (issue.status === 'resolved') {
            db.run(`UPDATE issues SET status='open', resolved_audit_id=NULL, resolved_at=NULL, times_reopened=times_reopened+1,
                last_seen_audit_id=?, last_seen_at=?, severity=?, title=? WHERE id=?`, auditId, at, f.severity, f.title, issueId);
            event(issueId, 'reopened');
          } else {
            db.run('UPDATE issues SET last_seen_audit_id=?, last_seen_at=?, severity=?, title=? WHERE id=?', auditId, at, f.severity, f.title, issueId);
          }
        }
        db.run('INSERT INTO findings (audit_id, issue_id, check_id, key, severity, evidence) VALUES (?,?,?,?,?,?)',
          auditId, issueId, f.checkId, f.key, f.severity, JSON.stringify(f.evidence || {}));
      }

      for (const issue of existing.values()) {
        if (issue.status === 'open' && !seen.has(issue.fingerprint)) {
          db.run(`UPDATE issues SET status='resolved', resolved_audit_id=?, resolved_at=? WHERE id=?`, auditId, at, issue.id);
          event(issue.id, 'resolved');
        }
      }

      db.run(`UPDATE audits SET status='completed', final_url=?, score=?, grade=?, counts=?, meta=?, started_at=?, finished_at=? WHERE id=?`,
        result.finalUrl, result.score, result.grade, JSON.stringify(result.counts), JSON.stringify(result.meta || {}),
        result.startedAt || at, at, auditId);
    });
  }

  function getAudit(auditId) {
    const a = db.get('SELECT * FROM audits WHERE id = ?', auditId);
    if (!a) return null;
    return { ...a, counts: a.counts ? JSON.parse(a.counts) : null, meta: a.meta ? JSON.parse(a.meta) : null };
  }

  return { enqueue, getAudit, recordResult, get pending() { return queue.length + active; } };
}

module.exports = { createAuditService };
