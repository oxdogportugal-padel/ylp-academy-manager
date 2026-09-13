const express = require('express');
const { table, zcql, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, asyncHandler } = require('../utils/validation');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await table(req, TABLES.CLUBS).getPagedRows({ maxRows: 200 });
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await table(req, TABLES.CLUBS).getRow(req.params.id);
  res.json({ data: row, error: null });
}));

router.get('/:id/coaches', asyncHandler(async (req, res) => {
  const rows = await zcql(
    req,
    `SELECT Coaches.ROWID, Coaches.Name, Coaches.Level, Coaches.Email, Coaches.Phone
     FROM Coaches
     JOIN ${TABLES.CLUB_COACHES} ON Coaches.ROWID = ${TABLES.CLUB_COACHES}.CoachId
     WHERE ${TABLES.CLUB_COACHES}.ClubId = ${Number(req.params.id)}`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['Name', 'NumberOfFields']);
  inRange(req.body.NumberOfFields, 1, 50, 'NumberOfFields');
  const row = await table(req, TABLES.CLUBS).insertRow({
    Name: req.body.Name,
    NumberOfFields: Number(req.body.NumberOfFields),
    Address: req.body.Address || '',
    Phone: req.body.Phone || '',
  });
  res.status(201).json({ data: row, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (req.body.NumberOfFields !== undefined) inRange(req.body.NumberOfFields, 1, 50, 'NumberOfFields');
  const row = await table(req, TABLES.CLUBS).updateRow({ ROWID: req.params.id, ...req.body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await table(req, TABLES.CLUBS).deleteRow(req.params.id);
  res.status(204).end();
}));

router.post('/:clubId/coaches/:coachId', requireAdmin, asyncHandler(async (req, res) => {
  const row = await table(req, TABLES.CLUB_COACHES).insertRow({
    ClubId: Number(req.params.clubId),
    CoachId: Number(req.params.coachId),
  });
  res.status(201).json({ data: row, error: null });
}));

router.delete('/:clubId/coaches/:coachId', requireAdmin, asyncHandler(async (req, res) => {
  const rows = await zcql(
    req,
    `SELECT ROWID FROM ${TABLES.CLUB_COACHES} WHERE ClubId = ${Number(req.params.clubId)} AND CoachId = ${Number(req.params.coachId)}`
  );
  await Promise.all(rows.map((r) => table(req, TABLES.CLUB_COACHES).deleteRow(r.ROWID)));
  res.status(204).end();
}));

module.exports = router;
