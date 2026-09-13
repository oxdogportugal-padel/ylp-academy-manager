const express = require('express');
const { zcql, updateRow, getRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, asyncHandler } = require('../utils/validation');
const { assertOwned } = require('../utils/tenant');
const { createClass } = require('../services/classCreation');

const router = express.Router();

router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const { clubId, status } = req.query;
  const clauses = [`AcademyId = ${req.academyId}`];
  clauses.push(status ? `Status = '${status}'` : "Status = 'OPEN'");
  if (clubId) clauses.push(`ClubId = ${Number(clubId)}`);
  const rows = await zcql(req, `SELECT * FROM ${TABLES.ALERTS} WHERE ${clauses.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT 200`);
  res.json({ data: rows, error: null });
}));

// Admin picks a coach + field for the suggested slot; opens the class and
// auto-enrolls every Request that alerted it.
router.post('/:id/convert', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['CoachId', 'FieldNumber']);
  const a = assertOwned(await getRow(req, TABLES.ALERTS, req.params.id), req, 'Alert');

  const result = await createClass(req, {
    ClubId: a.ClubId,
    CoachId: req.body.CoachId,
    FieldNumber: req.body.FieldNumber,
    DayOfWeek: a.SuggestedDayOfWeek,
    StartTime: a.SuggestedTimeStart,
    DurationMinutes: a.SuggestedDurationMinutes,
    Level: a.Level,
    Capacity: req.body.Capacity,
  });

  await updateRow(req, TABLES.ALERTS, { ROWID: a.ROWID, Status: 'RESOLVED' });
  res.status(201).json({ data: result, error: null });
}));

router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.ALERTS, req.params.id), req, 'Alert');
  const { AcademyId, ...body } = req.body; // eslint-disable-line no-unused-vars
  const row = await updateRow(req, TABLES.ALERTS, { ROWID: req.params.id, ...body });
  res.json({ data: row, error: null });
}));

module.exports = router;
