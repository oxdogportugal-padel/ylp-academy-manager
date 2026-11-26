'use strict';
// Advanced I/O function (Express): the SiteGuard REST API.
// Security Rules: authentication "required" — Catalyst rejects anonymous calls before they get here.
const catalyst = require('zcatalyst-sdk-node');
const { createApi } = require('./lib/core/api');
const { catalystRepo, submitAuditJob } = require('./lib/core/catalyst-services');
const loadConfig = require('./lib/core/config');

const config = loadConfig();

async function authenticate(req) {
  try {
    // User scope resolves the caller from the Catalyst session / auth token.
    const user = await catalyst.initialize(req).userManagement().getCurrentUser();
    if (!user || !user.user_id) return null;
    return { catalystUserId: String(user.user_id), email: user.email_id };
  } catch {
    return null;
  }
}

module.exports = createApi({
  config,
  authenticate,
  repoFor: (req) => catalystRepo(catalyst.initialize(req, { scope: 'admin' })),
  submitAuditJob: (req, auditId) => submitAuditJob(catalyst.initialize(req, { scope: 'admin' }), config, auditId),
});
