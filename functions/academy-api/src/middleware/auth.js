const catalyst = require('zcatalyst-sdk-node');
const { zcql, TABLES } = require('../db');

/**
 * Reads the Catalyst-authenticated end user for this request. Requires the
 * "academy-api" Advanced I/O function's access level to be set to
 * "Authenticated" in the Catalyst console — Catalyst then rejects
 * unauthenticated requests before they even reach this code.
 *
 * Falls back to an anonymous "local-dev" user when no Catalyst auth context
 * is present (e.g. running via `catalyst serve` without logging in), so the
 * API stays usable for local development.
 */
async function currentUser(req) {
  try {
    const app = catalyst.initialize(req);
    const user = await app.userManagement().getCurrentUser();
    return { zuid: String(user.user_id || user.zuid), email: user.email_id, name: user.first_name };
  } catch (err) {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await currentUser(req);
  req.user = user || { zuid: 'local-dev', email: 'local-dev@example.com', name: 'Local Dev' };
  next();
}

async function requireAdmin(req, res, next) {
  if (req.user.zuid === 'local-dev') return next(); // local dev bypass
  try {
    const rows = await zcql(req, `SELECT * FROM ${TABLES.APP_USERS} WHERE ZUID = '${req.user.zuid}'`);
    const appUser = rows[0];
    if (appUser && appUser.Role === 'ADMIN') return next();
    return res.status(403).json({ data: null, error: { message: 'Administrator access required' } });
  } catch (err) {
    return res.status(403).json({ data: null, error: { message: 'Administrator access required' } });
  }
}

module.exports = { requireAuth, requireAdmin, currentUser };
