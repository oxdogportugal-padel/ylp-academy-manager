const express = require('express');
const { table, TABLES } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/validation');
const { scanForClassOpenings } = require('../services/waitlist');

const router = express.Router();

// Safety-net re-scan of every club's waitlist, meant to be triggered by the
// waitlist-sweeper cron function in case a client-triggered scan was missed.
router.post('/sweep', requireAdmin, asyncHandler(async (req, res) => {
  const clubs = await table(req, TABLES.CLUBS).getPagedRows({ maxRows: 200 });
  const results = {};
  for (const club of clubs) {
    // eslint-disable-next-line no-await-in-loop
    results[club.ROWID] = await scanForClassOpenings(req, club.ROWID);
  }
  res.json({ data: results, error: null });
}));

module.exports = router;
