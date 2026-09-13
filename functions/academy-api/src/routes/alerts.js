const express = require('express');
const { zcql, updateRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, asyncHandler } = require('../utils/validation');
const { createClass } = require('../services/classCreation');

const router = express.Router();

router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const { clubId, status } = req.query;
  const clauses = [];
  if (clubId) clauses.push(`ClubId = ${Number(clubId)}`);
  if (status) clauses.push(`Status = '${status}'`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : "WHERE Status = 'OPEN'";
  const rows = await zcql(req, `SELECT * FROM ${TABLES.ALERTS} ${where} ORDER BY CREATEDTIME DESC LIMIT 200`);
  res.json({ data: rows, error: null });
}));

// Admin picks a coach + field for the suggested slot; opens the class and
// auto-enrolls every Request that alerted it.
router.post('/:id/convert', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['CoachId', 'FieldNumber']);
  const alert = await zcql(req, `SELECT * FROM ${TABLES.ALERTS} WHERE ROWID = ${Number(req.params.id)}`);
  const a = alert[0];

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
  const row = await updateRow(req, TABLES.ALERTS, { ROWID: req.params.id, ...req.body });
  res.json({ data: row, error: null });
}));

module.exports = router;
