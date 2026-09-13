const express = require('express');
const { zcql, insertRow, updateRow, deleteRow, getRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, asyncHandler } = require('../utils/validation');
const { withAcademy, assertOwned } = require('../utils/tenant');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await zcql(req, `SELECT * FROM ${TABLES.CLUBS} WHERE AcademyId = ${req.academyId} ORDER BY Name ASC LIMIT 200`);
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await getRow(req, TABLES.CLUBS, req.params.id);
  assertOwned(row, req, 'Club');
  res.json({ data: row, error: null });
}));

router.get('/:id/coaches', asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.CLUBS, req.params.id), req, 'Club');
  const rows = await zcql(
    req,
    `SELECT Coaches.ROWID, Coaches.Name, Coaches.Level, Coaches.Email, Coaches.Phone
     FROM Coaches
     JOIN ${TABLES.CLUB_COACHES} ON Coaches.ROWID = ${TABLES.CLUB_COACHES}.CoachId
     WHERE ${TABLES.CLUB_COACHES}.ClubId = ${Number(req.params.id)} AND ${TABLES.CLUB_COACHES}.AcademyId = ${req.academyId}`
  );
  res.json({ data: rows, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['Name', 'NumberOfFields']);
  inRange(req.body.NumberOfFields, 1, 50, 'NumberOfFields');
  const row = await insertRow(req, TABLES.CLUBS, withAcademy({
    Name: req.body.Name,
    NumberOfFields: Number(req.body.NumberOfFields),
    Address: req.body.Address || '',
    Phone: req.body.Phone || '',
  }, req));
  res.status(201).json({ data: row, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.CLUBS, req.params.id), req, 'Club');
  if (req.body.NumberOfFields !== undefined) inRange(req.body.NumberOfFields, 1, 50, 'NumberOfFields');
  const { AcademyId, ...body } = req.body; // eslint-disable-line no-unused-vars
  const row = await updateRow(req, TABLES.CLUBS, { ROWID: req.params.id, ...body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.CLUBS, req.params.id), req, 'Club');
  await deleteRow(req, TABLES.CLUBS, req.params.id);
  res.status(204).end();
}));

router.post('/:clubId/coaches/:coachId', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.CLUBS, req.params.clubId), req, 'Club');
  assertOwned(await getRow(req, TABLES.COACHES, req.params.coachId), req, 'Coach');
  const row = await insertRow(req, TABLES.CLUB_COACHES, withAcademy({
    ClubId: Number(req.params.clubId),
    CoachId: Number(req.params.coachId),
  }, req));
  res.status(201).json({ data: row, error: null });
}));

router.delete('/:clubId/coaches/:coachId', requireAdmin, asyncHandler(async (req, res) => {
  const rows = await zcql(
    req,
    `SELECT ROWID FROM ${TABLES.CLUB_COACHES} WHERE ClubId = ${Number(req.params.clubId)} AND CoachId = ${Number(req.params.coachId)} AND AcademyId = ${req.academyId}`
  );
  await Promise.all(rows.map((r) => deleteRow(req, TABLES.CLUB_COACHES, r.ROWID)));
  res.status(204).end();
}));

module.exports = router;
