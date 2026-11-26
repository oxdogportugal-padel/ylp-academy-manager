'use strict';
// Thin adapters from the Catalyst SDK to the interfaces the core code expects.
const { createRepo } = require('../repo/repo');
const { createCatalystDriver } = require('../repo/catalyst-driver');

/** Data access with admin scope: ownership is enforced in our own code (OwnerId checks). */
function catalystRepo(catalystApp) {
  return createRepo(createCatalystDriver(catalystApp));
}

/** Queues an audit in the audit_runner Job function (15-minute limit instead of 30 s). */
async function submitAuditJob(catalystApp, config, auditId) {
  await catalystApp.jobScheduling().job().submitJob({
    job_name: `audit_${auditId}`,            // alphanumeric + underscores only
    jobpool_name: config.jobPoolName,
    target_type: 'Function',
    target_name: config.auditRunnerFunction,
    params: { auditId: String(auditId) },
    job_config: { number_of_retries: 0 },     // a failed scan is recorded, not retried
  });
}

/** Catalyst Mail. FROM_EMAIL must be a verified sender (Console -> Mail -> Sender Email). */
function catalystMailer(catalystApp, config) {
  return {
    async send({ to, subject, html }) {
      if (!config.fromEmail) throw new Error('FROM_EMAIL is not configured');
      await catalystApp.email().sendMail({
        from_email: config.fromEmail,
        to_email: to,
        subject,
        content: html,
        html_mode: true,
      });
    },
  };
}

module.exports = { catalystRepo, submitAuditJob, catalystMailer };
