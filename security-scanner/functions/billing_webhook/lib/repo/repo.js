'use strict';
// Domain-level data access, written once against the driver interface
// (catalyst-driver.js in production, memory-driver.js in tests/dev).

const now = () => new Date().toISOString();

function createRepo(driver) {
  return {
    driver,

    // ---------------------------------------------------------------- users
    async upsertUser({ catalystUserId, email }) {
      const [existing] = await driver.find('users', { catalystUserId: String(catalystUserId) }, { limit: 1 });
      if (existing) {
        if (email && existing.email !== email) return driver.update('users', existing.id, { email });
        return existing;
      }
      return driver.insert('users', { catalystUserId: String(catalystUserId), email, plan: 'free', createdAt: now() });
    },
    getUser: (id) => driver.get('users', id),
    async findUserByStripeCustomer(customerId) {
      return (await driver.find('users', { stripeCustomerId: customerId }, { limit: 1 }))[0] || null;
    },
    updateUser: (id, fields) => driver.update('users', id, fields),

    // -------------------------------------------------------------- targets
    listTargets: (ownerId) => driver.find('targets', { ownerId }, { orderBy: [['createdAt', 'DESC']] }),
    getTarget: (id) => driver.get('targets', id),
    async findTarget(ownerId, url) { return (await driver.find('targets', { ownerId, url }, { limit: 1 }))[0] || null; },
    countTargets: (ownerId) => driver.count('targets', { ownerId }),
    insertTarget: (ownerId, url) => driver.insert('targets', { ownerId, url, createdAt: now() }),
    async deleteTargetCascade(targetId) {
      // Data Store has no cascading deletes through plain bigint references: clean up explicitly.
      for (const t of ['findings', 'issueEvents', 'issues', 'audits', 'schedules']) await driver.remove(t, { targetId });
      await driver.remove('targets', { id: targetId });
    },

    // --------------------------------------------------------------- audits
    insertAudit: ({ targetId, ownerId, trigger }) => driver.insert('audits', { targetId, ownerId, trigger, status: 'queued', createdAt: now() }),
    getAudit: (id) => driver.get('audits', id),
    updateAudit: (id, fields) => driver.update('audits', id, fields),
    listAudits: (targetId, limit = 100) => driver.find('audits', { targetId }, { orderBy: [['createdAt', 'DESC']], limit }),
    async latestAudit(targetId) { return (await driver.find('audits', { targetId }, { orderBy: [['createdAt', 'DESC']], limit: 1 }))[0] || null; },
    async findActiveAudit(targetId) {
      return (await driver.find('audits', { targetId, status: { in: ['queued', 'running'] } }, { limit: 1 }))[0] || null;
    },
    countManualAuditsSince: (ownerId, sinceIso) => driver.count('audits', { ownerId, trigger: 'manual', createdAt: { gte: sinceIso } }),
    async previousCompletedAudit(targetId, beforeIso) {
      return (await driver.find('audits', { targetId, status: 'completed', createdAt: { lt: beforeIso } }, { orderBy: [['createdAt', 'DESC']], limit: 1 }))[0] || null;
    },
    staleAudits: (beforeIso) => driver.find('audits', { status: { in: ['queued', 'running'] }, createdAt: { lt: beforeIso } }, { limit: 300 }),

    // --------------------------------------------------------------- issues
    listIssues: (targetId) => driver.find('issues', { targetId }),
    insertIssue: (issue) => driver.insert('issues', issue),
    updateIssue: (id, fields) => driver.update('issues', id, fields),
    countIssues: (targetId, status) => driver.count('issues', { targetId, status }),

    insertEvents: (events) => (events.length ? driver.insertMany('issueEvents', events) : []),
    listEventsForAudit: (auditId) => driver.find('issueEvents', { auditId }),
    listEventsForTarget: (targetId) => driver.find('issueEvents', { targetId }, { orderBy: [['at', 'ASC'], ['id', 'ASC']] }),

    insertFindings: (findings) => (findings.length ? driver.insertMany('findings', findings) : []),
    listFindingsForAudit: (auditId) => driver.find('findings', { auditId }),

    // ------------------------------------------------------------ schedules
    async getSchedule(targetId) { return (await driver.find('schedules', { targetId }, { limit: 1 }))[0] || null; },
    async upsertSchedule(targetId, ownerId, fields) {
      const existing = await this.getSchedule(targetId);
      if (existing) return driver.update('schedules', existing.id, fields);
      return driver.insert('schedules', { targetId, ownerId, createdAt: now(), ...fields });
    },
    deleteSchedule: (targetId) => driver.remove('schedules', { targetId }),
    updateSchedule: (id, fields) => driver.update('schedules', id, fields),
    listDueSchedules: (nowIso) => driver.find('schedules', { enabled: true, nextRunAt: { lte: nowIso } }, { orderBy: [['nextRunAt', 'ASC']], limit: 300 }),

    logEmail: (entry) => driver.insert('emailLog', { sentAt: now(), ...entry }),
  };
}

module.exports = { createRepo };
