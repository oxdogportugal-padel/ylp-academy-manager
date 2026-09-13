const express = require('express');
const { table, zcql, insertRow, updateRow, deleteRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, oneOf, asyncHandler, ValidationError } = require('../utils/validation');
const { enrollmentCount } = require('../services/matching');
const { attemptFulfillFromClass, scanForClassOpenings } = require('../services/waitlist');
const { createClass } = require('../services/classCreation');

const router = express.Router();
const DURATIONS = [60, 90, 120];

router.get('/', asyncHandler(async (req, res) => {
  const { clubId, coachId, level, durationMinutes } = req.query;
  if (!clubId) throw new ValidationError('clubId query parameter is required');

  const clauses = [`ClubId = ${Number(clubId)}`, "Status != 'CANCELLED'"];
  if (coachId) clauses.push(`CoachId = ${Number(coachId)}`);
  if (level) clauses.push(`Level = ${Number(level)}`);
  if (durationMinutes) clauses.push(`DurationMinutes = ${Number(durationMinutes)}`);

  const classes = await zcql(
    req,
    `SELECT * FROM ${TABLES.CLASSES} WHERE ${clauses.join(' AND ')} ORDER BY DayOfWeek ASC, StartTime ASC LIMIT 500`
  );

  const withCapacity = await Promise.all(
    classes.map(async (cls) => {
      const enrolled = await enrollmentCount(req, cls.ROWID);
      return { ...cls, enrolledCount: enrolled, spotsLeft: Number(cls.Capacity) - enrolled };
    })
  );

  res.json({ data: withCapacity, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await table(req, TABLES.CLASSES).getRow(req.params.id);
  const enrolled = await zcql(
    req,
    `SELECT Players.ROWID, Players.Name, Players.Level FROM Players
     JOIN ${TABLES.ENROLLMENTS} ON Players.ROWID = ${TABLES.ENROLLMENTS}.PlayerId
     WHERE ${TABLES.ENROLLMENTS}.ClassId = ${Number(req.params.id)} AND ${TABLES.ENROLLMENTS}.Status = 'CONFIRMED'`
  );
  res.json({ data: { ...row, players: enrolled }, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const result = await createClass(req, req.body);
  res.status(201).json({ data: result, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (req.body.DayOfWeek !== undefined) inRange(req.body.DayOfWeek, 0, 6, 'DayOfWeek');
  if (req.body.Level !== undefined) inRange(req.body.Level, 0, 10, 'Level');
  if (req.body.DurationMinutes !== undefined) oneOf(Number(req.body.DurationMinutes), DURATIONS, 'DurationMinutes');
  const row = await updateRow(req, TABLES.CLASSES, { ROWID: req.params.id, ...req.body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await updateRow(req, TABLES.CLASSES, { ROWID: req.params.id, Status: 'CANCELLED' });
  res.status(204).end();
}));

router.post('/:id/enroll', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['playerId']);
  const cls = await table(req, TABLES.CLASSES).getRow(req.params.id);
  const enrolled = await enrollmentCount(req, cls.ROWID);
  if (enrolled >= Number(cls.Capacity)) {
    throw new ValidationError('This class is already at capacity');
  }
  const row = await insertRow(req, TABLES.ENROLLMENTS, {
    ClassId: Number(req.params.id),
    PlayerId: Number(req.body.playerId),
    Status: 'CONFIRMED',
  });
  if (enrolled + 1 >= Number(cls.Capacity)) {
    await updateRow(req, TABLES.CLASSES, { ROWID: cls.ROWID, Status: 'FULL' });
  }
  res.status(201).json({ data: row, error: null });
}));

router.delete('/:id/enroll/:playerId', requireAdmin, asyncHandler(async (req, res) => {
  const rows = await zcql(
    req,
    `SELECT ROWID FROM ${TABLES.ENROLLMENTS} WHERE ClassId = ${Number(req.params.id)} AND PlayerId = ${Number(req.params.playerId)} AND Status = 'CONFIRMED'`
  );
  await Promise.all(rows.map((r) => deleteRow(req, TABLES.ENROLLMENTS, r.ROWID)));

  const cls = await table(req, TABLES.CLASSES).getRow(req.params.id);
  if (cls.Status === 'FULL') {
    await updateRow(req, TABLES.CLASSES, { ROWID: cls.ROWID, Status: 'OPEN' });
  }

  // A spot just freed up — see if a waiting player (e.g. a partial 2x/week
  // request) fits it now.
  await attemptFulfillFromClass(req, cls);
  await scanForClassOpenings(req, cls.ClubId);

  res.status(204).end();
}));

module.exports = router;
