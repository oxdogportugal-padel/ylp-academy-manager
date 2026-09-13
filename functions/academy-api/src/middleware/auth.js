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

/**
 * Multi-tenant boundary: resolves which Academy this request operates on
 * and rejects anything the caller isn't a member of. Every tenant-owned
 * route sits behind this — there is no "list everything" mode in the API.
 *
 * A user's Catalyst login (ZUID) can belong to several academies (AppUsers
 * is keyed by ZUID+AcademyId), so the caller must say which one via the
 * `X-Academy-Id` header — unless they only belong to one, in which case
 * that's the default.
 */
async function resolveAcademy(req, res, next) {
  try {
    if (req.user.zuid === 'local-dev') {
      // Local dev bypass: act as an admin of a single fixed academy so
      // `catalyst serve` works without a real login or seeded AppUsers rows.
      req.academyId = Number(req.headers['x-academy-id']) || 1;
      req.role = 'ADMIN';
      req.coachId = null;
      return next();
    }

    const memberships = await zcql(req, `SELECT * FROM ${TABLES.APP_USERS} WHERE ZUID = '${req.user.zuid}'`);
    if (!memberships.length) {
      return res.status(403).json({
        data: null,
        error: { code: 'NO_ACADEMY', message: 'This account is not a member of any academy yet. Create one via POST /academies.' },
      });
    }

    const requestedId = req.headers['x-academy-id'];
    const membership = requestedId
      ? memberships.find((m) => String(m.AcademyId) === String(requestedId))
      : memberships.length === 1
        ? memberships[0]
        : null;

    if (!membership) {
      return res.status(403).json({
        data: null,
        error: { code: 'ACADEMY_REQUIRED', message: 'This account belongs to multiple academies — send an X-Academy-Id header.' },
      });
    }

    req.academyId = Number(membership.AcademyId);
    req.role = membership.Role;
    req.coachId = membership.CoachId || null;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (req.role === 'ADMIN') return next();
  return res.status(403).json({ data: null, error: { message: 'Administrator access required' } });
}

module.exports = { requireAuth, resolveAcademy, requireAdmin, currentUser };
