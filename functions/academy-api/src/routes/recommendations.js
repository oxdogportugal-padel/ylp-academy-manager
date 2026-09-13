const express = require('express');
const { required, inRange, asyncHandler } = require('../utils/validation');
const { recommendClasses } = require('../services/matching');

const router = express.Router();

/**
 * Intake helper: "a new player wants to buy padel classes" — given their
 * level, preferred club (which must belong to the caller's academy) and
 * schedule, return the best-fit open classes ranked by level match, time
 * overlap, and remaining capacity.
 *
 * This is read-only (no Player/Request/Enrollment is created here) so staff
 * can browse fit with a prospective player before committing. The intake
 * wizard then calls POST /classes/:id/enroll for a chosen class, or
 * POST /requests to join the waitlist when nothing fits well enough.
 */
router.post('/', asyncHandler(async (req, res) => {
  required(req.body, ['clubId', 'level']);
  inRange(req.body.level, 0, 10, 'level');

  const preferences = {
    level: Number(req.body.level),
    days: req.body.days,
    durations: req.body.durations,
    timeStart: req.body.timeStart,
    timeEnd: req.body.timeEnd,
  };

  const classes = await recommendClasses(req, req.body.clubId, preferences);
  const sessionsPerWeek = Number(req.body.sessionsPerWeek) || 1;

  res.json({
    data: {
      classes,
      sessionsPerWeek,
      fullyFits: classes.length >= sessionsPerWeek,
      partiallyFits: classes.length > 0 && classes.length < sessionsPerWeek,
    },
    error: null,
  });
}));

module.exports = router;
