const express = require('express');
const { insertRow, zcql, TABLES } = require('../db');
const { required, asyncHandler } = require('../utils/validation');

const router = express.Router();

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function uniqueSlug(req, name) {
  const base = slugify(name) || 'academy';
  let slug = base;
  let suffix = 1;
  for (;;) {
    const existing = await zcql(req, `SELECT ROWID FROM ${TABLES.ACADEMIES} WHERE Slug = '${slug}'`);
    if (!existing.length) return slug;
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
}

// Which academies is the current login a member of? Drives onboarding on
// the client: zero -> "create your academy", one -> auto-select, many ->
// show a switcher.
router.get('/mine', asyncHandler(async (req, res) => {
  if (req.user.zuid === 'local-dev') {
    return res.json({ data: [{ ROWID: 1, Name: 'Local Dev Academy', Slug: 'local-dev', role: 'ADMIN' }], error: null });
  }

  const memberships = await zcql(req, `SELECT * FROM ${TABLES.APP_USERS} WHERE ZUID = '${req.user.zuid}'`);
  const academies = await Promise.all(
    memberships.map(async (m) => {
      const rows = await zcql(req, `SELECT * FROM ${TABLES.ACADEMIES} WHERE ROWID = ${Number(m.AcademyId)}`);
      return { ...rows[0], role: m.Role };
    })
  );
  res.json({ data: academies, error: null });
}));

// Self-serve tenant creation: "open a new padel academy". The creating
// login becomes its first ADMIN.
router.post('/', asyncHandler(async (req, res) => {
  required(req.body, ['Name']);
  const slug = await uniqueSlug(req, req.body.Name);

  const academy = await insertRow(req, TABLES.ACADEMIES, {
    Name: req.body.Name,
    Slug: slug,
    CreatedByZUID: req.user.zuid,
    PlanStatus: 'TRIAL',
  });

  await insertRow(req, TABLES.APP_USERS, {
    ZUID: req.user.zuid,
    AcademyId: Number(academy.ROWID),
    Name: req.user.name || req.user.email || 'Admin',
    Role: 'ADMIN',
  });

  res.status(201).json({ data: { ...academy, role: 'ADMIN' }, error: null });
}));

module.exports = router;
