const express = require('express');
const { table, zcql, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, asyncHandler } = require('../utils/validation');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await table(req, TABLES.COACHES).getPagedRows({ maxRows: 500 });
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await table(req, TABLES.COACHES).getRow(req.params.id);
  res.json({ data: row, error: null });
}));

router.get('/:id/clubs', asyncHandler(async (req, res) => {
  const rows = await zcql(
    req,
    `SELECT Clubs.ROWID, Clubs.Name, Clubs.NumberOfFields
     FROM Clubs
     JOIN ${TABLES.CLUB_COACHES} ON Clubs.ROWID = ${TABLES.CLUB_COACHES}.ClubId
     WHERE ${TABLES.CLUB_COACHES}.CoachId = ${Number(req.params.id)}`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['Name', 'Level']);
  inRange(req.body.Level, 1, 3, 'Level');
  const row = await table(req, TABLES.COACHES).insertRow({
    Name: req.body.Name,
    Level: Number(req.body.Level),
    Email: req.body.Email || '',
    Phone: req.body.Phone || '',
  });
  res.status(201).json({ data: row, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (req.body.Level !== undefined) inRange(req.body.Level, 1, 3, 'Level');
  const row = await table(req, TABLES.COACHES).updateRow({ ROWID: req.params.id, ...req.body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await table(req, TABLES.COACHES).deleteRow(req.params.id);
  res.status(204).end();
}));

module.exports = router;
