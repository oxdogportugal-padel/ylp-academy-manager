const express = require('express');
const { zcql, insertRow, updateRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, oneOf, asyncHandler } = require('../utils/validation');
const { scanForClassOpenings } = require('../services/waitlist');

const router = express.Router();

router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const { clubId, status } = req.query;
  const clauses = [];
  if (clubId) clauses.push(`ClubId = ${Number(clubId)}`);
  if (status) clauses.push(`Status = '${status}'`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await zcql(req, `SELECT * FROM ${TABLES.REQUESTS} ${where} ORDER BY CREATEDTIME DESC LIMIT 500`);
  res.json({ data: rows, error: null });
}));

router.post('/', asyncHandler(async (req, res) => {
  required(req.body, ['PlayerId', 'ClubId', 'Level', 'SessionsPerWeek']);
  inRange(req.body.Level, 0, 10, 'Level');
  oneOf(Number(req.body.SessionsPerWeek), [1, 2], 'SessionsPerWeek');

  const fulfilledSessions = Number(req.body.FulfilledSessions) || 0;
  const status = fulfilledSessions >= Number(req.body.SessionsPerWeek) ? 'FULFILLED' : fulfilledSessions > 0 ? 'PARTIAL' : 'PENDING';

  const toCsv = (v) => (Array.isArray(v) ? v.join(',') : v || '');

  const row = await insertRow(req, TABLES.REQUESTS, {
    PlayerId: Number(req.body.PlayerId),
    ClubId: Number(req.body.ClubId),
    Level: Number(req.body.Level),
    PreferredDurations: toCsv(req.body.PreferredDurations),
    PreferredDays: toCsv(req.body.PreferredDays),
    PreferredTimeStart: req.body.PreferredTimeStart || '',
    PreferredTimeEnd: req.body.PreferredTimeEnd || '',
    SessionsPerWeek: Number(req.body.SessionsPerWeek),
    FulfilledSessions: fulfilledSessions,
    Status: status,
  });

  const alerts = status === 'FULFILLED' ? [] : await scanForClassOpenings(req, row.ClubId);
  res.status(201).json({ data: { request: row, alerts }, error: null });
}));

router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const row = await updateRow(req, TABLES.REQUESTS, { ROWID: req.params.id, ...req.body });
  res.json({ data: row, error: null });
}));

module.exports = router;
