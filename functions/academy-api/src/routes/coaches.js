const express = require('express');
const { zcql, insertRow, updateRow, deleteRow, getRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, asyncHandler } = require('../utils/validation');
const { withAcademy, assertOwned } = require('../utils/tenant');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await zcql(req, `SELECT * FROM ${TABLES.COACHES} WHERE AcademyId = ${req.academyId} ORDER BY Name ASC LIMIT 500`);
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await getRow(req, TABLES.COACHES, req.params.id);
  assertOwned(row, req, 'Coach');
  res.json({ data: row, error: null });
}));

router.get('/:id/clubs', asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.COACHES, req.params.id), req, 'Coach');
  const rows = await zcql(
    req,
    `SELECT Clubs.ROWID, Clubs.Name, Clubs.NumberOfFields
     FROM Clubs
     JOIN ${TABLES.CLUB_COACHES} ON Clubs.ROWID = ${TABLES.CLUB_COACHES}.ClubId
     WHERE ${TABLES.CLUB_COACHES}.CoachId = ${Number(req.params.id)} AND ${TABLES.CLUB_COACHES}.AcademyId = ${req.academyId}`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['Name', 'Level']);
  inRange(req.body.Level, 1, 3, 'Level');
  const row = await insertRow(req, TABLES.COACHES, withAcademy({
    Name: req.body.Name,
    Level: Number(req.body.Level),
    Email: req.body.Email || '',
    Phone: req.body.Phone || '',
  }, req));
  res.status(201).json({ data: row, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.COACHES, req.params.id), req, 'Coach');
  if (req.body.Level !== undefined) inRange(req.body.Level, 1, 3, 'Level');
  const { AcademyId, ...body } = req.body; // eslint-disable-line no-unused-vars
  const row = await updateRow(req, TABLES.COACHES, { ROWID: req.params.id, ...body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.COACHES, req.params.id), req, 'Coach');
  await deleteRow(req, TABLES.COACHES, req.params.id);
  res.status(204).end();
}));

module.exports = router;
