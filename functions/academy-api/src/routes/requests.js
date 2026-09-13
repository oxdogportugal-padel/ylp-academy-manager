const express = require('express');
const { zcql, insertRow, updateRow, getRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, oneOf, asyncHandler } = require('../utils/validation');
const { withAcademy, assertOwned } = require('../utils/tenant');
const { scanForClassOpenings } = require('../services/waitlist');

const router = express.Router();

router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const { clubId, status } = req.query;
  const clauses = [`AcademyId = ${req.academyId}`];
  if (clubId) clauses.push(`ClubId = ${Number(clubId)}`);
  if (status) clauses.push(`Status = '${status}'`);
  const rows = await zcql(req, `SELECT * FROM ${TABLES.REQUESTS} WHERE ${clauses.join(' AND ')} ORDER BY CREATEDTIME DESC LIMIT 500`);
  res.json({ data: rows, error: null });
}));

router.post('/', asyncHandler(async (req, res) => {
  required(req.body, ['PlayerId', 'ClubId', 'Level', 'SessionsPerWeek']);
  inRange(req.body.Level, 0, 10, 'Level');
  oneOf(Number(req.body.SessionsPerWeek), [1, 2], 'SessionsPerWeek');
  assertOwned(await getRow(req, TABLES.PLAYERS, req.body.PlayerId), req, 'Player');
  assertOwned(await getRow(req, TABLES.CLUBS, req.body.ClubId), req, 'Club');

  const fulfilledSessions = Number(req.body.FulfilledSessions) || 0;
  const status = fulfilledSessions >= Number(req.body.SessionsPerWeek) ? 'FULFILLED' : fulfilledSessions > 0 ? 'PARTIAL' : 'PENDING';

  const toCsv = (v) => (Array.isArray(v) ? v.join(',') : v || '');

  const row = await insertRow(req, TABLES.REQUESTS, withAcademy({
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
  }, req));

  const alerts = status === 'FULFILLED' ? [] : await scanForClassOpenings(req, row.ClubId);
  res.status(201).json({ data: { request: row, alerts }, error: null });
}));

router.patch('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.REQUESTS, req.params.id), req, 'Request');
  const { AcademyId, ...body } = req.body; // eslint-disable-line no-unused-vars
  const row = await updateRow(req, TABLES.REQUESTS, { ROWID: req.params.id, ...body });
  res.json({ data: row, error: null });
}));

module.exports = router;
