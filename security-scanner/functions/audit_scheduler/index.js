'use strict';
// Job function, run every 15 minutes by a Job Scheduling cron. Queues an audit for
// every due Pro schedule and marks audits whose job died as failed.
const catalyst = require('zcatalyst-sdk-node');
const { runDueSchedules, failStaleAudits } = require('./lib/core/scheduler');
const { catalystRepo, submitAuditJob } = require('./lib/core/catalyst-services');
const loadConfig = require('./lib/core/config');

module.exports = async (_jobRequest, context) => {
  const config = loadConfig();
  try {
    const app = catalyst.initialize(context, { scope: 'admin' });
    const repo = catalystRepo(app);
    const stale = await failStaleAudits({ repo });
    const queued = await runDueSchedules({ repo, submitAuditJob: (auditId) => submitAuditJob(app, config, auditId) });
    console.log(`audit_scheduler: queued ${queued.length} audit(s), cleaned ${stale} stale`);
    context.closeWithSuccess();
  } catch (err) {
    console.error('audit_scheduler failed', err);
    context.closeWithFailure();
  }
};
