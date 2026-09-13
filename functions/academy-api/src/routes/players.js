const express = require('express');
const { table, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { required, inRange, asyncHandler } = require('../utils/validation');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await table(req, TABLES.PLAYERS).getPagedRows({ maxRows: 1000 });
  res.json({ data: rows, error: null });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = await table(req, TABLES.PLAYERS).getRow(req.params.id);
  res.json({ data: row, error: null });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  required(req.body, ['Name', 'Level', 'PreferredClubId']);
  inRange(req.body.Level, 0, 10, 'Level');
  const row = await table(req, TABLES.PLAYERS).insertRow({
    Name: req.body.Name,
    Level: Number(req.body.Level),
    Email: req.body.Email || '',
    Phone: req.body.Phone || '',
    PreferredClubId: Number(req.body.PreferredClubId),
    Status: 'ACTIVE',
  });
  res.status(201).json({ data: row, error: null });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (req.body.Level !== undefined) inRange(req.body.Level, 0, 10, 'Level');
  const row = await table(req, TABLES.PLAYERS).updateRow({ ROWID: req.params.id, ...req.body });
  res.json({ data: row, error: null });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  await table(req, TABLES.PLAYERS).deleteRow(req.params.id);
  res.status(204).end();
}));

module.exports = router;
