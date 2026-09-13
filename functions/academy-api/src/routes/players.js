const express = require('express');
const { zcql, insertRow, updateRow, deleteRow, getRow, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, asyncHandler } = require('../utils/validation');
const { withAcademy, assertOwned } = require('../utils/tenant');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await zcql(req, `SELECT * FROM ${TABLES.PLAYERS} WHERE AcademyId = ${req.academyId} ORDER BY Name ASC LIMIT 1000`);
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await getRow(req, TABLES.PLAYERS, req.params.id);
  assertOwned(row, req, 'Player');
  res.json({ data: row, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['Name', 'Level', 'PreferredClubId']);
  inRange(req.body.Level, 0, 10, 'Level');
  assertOwned(await getRow(req, TABLES.CLUBS, req.body.PreferredClubId), req, 'Club');

  const row = await insertRow(req, TABLES.PLAYERS, withAcademy({
    Name: req.body.Name,
    Level: Number(req.body.Level),
    Email: req.body.Email || '',
    Phone: req.body.Phone || '',
    PreferredClubId: Number(req.body.PreferredClubId),
    Status: 'ACTIVE',
  }, req));
  res.status(201).json({ data: row, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.PLAYERS, req.params.id), req, 'Player');
  if (req.body.Level !== undefined) inRange(req.body.Level, 0, 10, 'Level');
  if (req.body.PreferredClubId !== undefined) {
    assertOwned(await getRow(req, TABLES.CLUBS, req.body.PreferredClubId), req, 'Club');
  }
  const { AcademyId, ...body } = req.body; // eslint-disable-line no-unused-vars
  const row = await updateRow(req, TABLES.PLAYERS, { ROWID: req.params.id, ...body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  assertOwned(await getRow(req, TABLES.PLAYERS, req.params.id), req, 'Player');
  await deleteRow(req, TABLES.PLAYERS, req.params.id);
  res.status(204).end();
}));

module.exports = router;
