'use strict';
// Job function: runs one audit (params.auditId), updates the issue log and, for
// scheduled audits, e-mails the report. Submitted by siteguard_api and audit_scheduler.
const catalyst = require('zcatalyst-sdk-node');
const { runAudit } = require('./lib/core/lifecycle');
const { emailScheduledAudit } = require('./lib/core/scheduler');
const { catalystRepo, catalystMailer } = require('./lib/core/catalyst-services');
const loadConfig = require('./lib/core/config');

module.exports = async (jobRequest, context) => {
  const config = loadConfig();
  try {
    const app = catalyst.initialize(context, { scope: 'admin' });
    const repo = catalystRepo(app);
    const { auditId } = jobRequest.getAllJobParams() || {};
    if (!/^\d+$/.test(String(auditId || ''))) throw new Error(`Invalid auditId ${auditId}`);

    const audit = await runAudit({ repo, auditId: String(auditId), scannerOptions: config.scanner });
    console.log(`audit ${auditId}: ${audit?.status} ${audit?.grade || ''}`);

    if (audit?.status === 'completed' && audit.trigger === 'scheduled') {
      try {
        await emailScheduledAudit({ repo, mailer: catalystMailer(app, config), auditId: String(auditId), appUrl: config.appUrl });
      } catch (err) {
        console.error(`audit ${auditId}: e-mail failed: ${err.message}`); // logged in EmailLog too
      }
    }
    context.closeWithSuccess();
  } catch (err) {
    console.error('audit_runner failed', err);
    context.closeWithFailure();
  }
};
