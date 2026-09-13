const express = require('express');
const { zcql, TABLES } = require('../db');
const { asyncHandler } = require('../utils/validation');
const { scanForClassOpenings } = require('../services/waitlist');

const router = express.Router();

/**
 * This endpoint sweeps every tenant, so it deliberately sits outside the
 * per-request resolveAcademy gate (mounted before it in index.js) — it's
 * for the internal waitlist-sweeper cron job, not for tenant admins.
 * Server-to-server function invocations carry no real Catalyst user
 * session, so requireAuth's `currentUser()` lookup fails and req.user falls
 * back to the 'local-dev' identity; that's how we tell "the cron job" apart
 * from "a browser session", and reject the latter.
 */
function requireServiceCall(req, res, next) {
  if (req.user.zuid === 'local-dev') return next();
  return res.status(403).json({ data: null, error: { message: 'This endpoint is for internal system jobs only.' } });
}

// Safety-net re-scan of every academy's every club's waitlist, meant to be
// triggered by the waitlist-sweeper cron function in case a
// client-triggered scan was missed.
router.post('/sweep', requireServiceCall, asyncHandler(async (req, res) => {
  const academies = await zcql(req, `SELECT ROWID FROM ${TABLES.ACADEMIES}`);
  const results = {};

  for (const academy of academies) {
    const academyId = Number(academy.ROWID);
    req.academyId = academyId; // scopes the shared helpers below to this tenant
    // eslint-disable-next-line no-await-in-loop
    const clubs = await zcql(req, `SELECT ROWID FROM ${TABLES.CLUBS} WHERE AcademyId = ${academyId}`);
    results[academyId] = {};
    for (const club of clubs) {
      // eslint-disable-next-line no-await-in-loop
      results[academyId][club.ROWID] = await scanForClassOpenings(req, club.ROWID);
    }
  }

  res.json({ data: results, error: null });
}));

module.exports = router;
