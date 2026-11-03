'use strict';
/**
 * Padel Academy Planner — API
 *
 * Advanced I/O function. This is the ONLY path to the data: the browser no
 * longer touches Data Store, and App User table permissions are revoked, so a
 * coordinator with devtools open has nothing to reach.
 *
 * Tenancy comes from identity, never from the request. The caller's email is
 * read from the Catalyst session, looked up in AcademyUsers, and that decides
 * which academy they see. The client cannot name an academy; there is no slug
 * and no academy id in any request a coordinator can make.
 */

const catalyst = require('zcatalyst-sdk-node');

/* The Development ZAID. It differs in Production — registerUser silently
   fails against the wrong one, which is the usual post-promotion surprise. */
const ZAID = '30047977891';

const TABLES = {
  venues:   'Clubs',
  coaches:  'Coaches',
  players:  'Players',
  classes:  'Classes',
  requests: 'Requests'
};

/* ─────────── plumbing ─────────── */

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (req.body && typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
    }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
    req.on('error', reject);
  });
}

const sid = (v) => (v === null || v === undefined ? null : String(v));
const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };

/* ZCQL nests each row under its table name; a join yields one key per table. */
function unwrap(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    if (!r || typeof r !== 'object') return r;
    const keys = Object.keys(r);
    if (keys.length === 1 && r[keys[0]] && typeof r[keys[0]] === 'object') return r[keys[0]];
    const merged = {}; let wrapped = false;
    keys.forEach((k) => {
      if (r[k] && typeof r[k] === 'object' && !Array.isArray(r[k])) { wrapped = true; Object.assign(merged, r[k]); }
    });
    return wrapped ? merged : r;
  });
}

/* ZCQL SELECT is capped at 300 rows, so page explicitly. */
async function query(zcql, sql) {
  const out = [];
  const page = 300;
  for (let offset = 0; ; offset += page) {
    const rows = unwrap(await zcql.executeZCQLQuery(`${sql} LIMIT ${offset}, ${page}`));
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/* Single quotes are the only injection vector in these strings; every value
   that reaches a WHERE clause goes through here or through Number(). */
const q = (s) => `'${String(s === null || s === undefined ? '' : s).replace(/'/g, "''")}'`;

/* ─────────── identity ─────────── */

async function resolveCaller(req) {
  const userApp = catalyst.initialize(req);
  let me = null;
  try { me = await userApp.userManagement().getCurrentUser(); } catch (e) { me = null; }
  if (!me || !me.email_id) return null;

  const adminApp = catalyst.initialize(req, { scope: 'admin' });
  const zcql = adminApp.zcql();
  const email = String(me.email_id).toLowerCase();

  const admins = await query(zcql,
    `SELECT PlatformAdmins.ROWID, PlatformAdmins.Email, PlatformAdmins.Status
     FROM PlatformAdmins WHERE PlatformAdmins.Email = ${q(email)}`);
  const isOperator = admins.some((a) => (a.Status || 'active') === 'active');

  const memberships = await query(zcql,
    `SELECT AcademyUsers.ROWID, AcademyUsers.AcademyId, AcademyUsers.Role, AcademyUsers.Status
     FROM AcademyUsers WHERE AcademyUsers.Email = ${q(email)}`);
  const live = memberships.filter((m) => (m.Status || 'invited') !== 'removed');

  return {
    email,
    name: [me.first_name, me.last_name].filter(Boolean).join(' '),
    isOperator,
    academyId: live.length ? sid(live[0].AcademyId) : null,
    role: live.length ? (live[0].Role || 'coordinator') : null,
    app: adminApp,
    zcql
  };
}

async function loadAcademy(zcql, academyId) {
  const rows = await query(zcql,
    `SELECT Academies.ROWID, Academies.Name, Academies.Settings, Academies.PlanStatus,
            Academies.MaxClubs, Academies.MaxUsers, Academies.OwnerEmail
     FROM Academies WHERE Academies.ROWID = ${num(academyId)}`);
  if (!rows.length) return null;
  const a = rows[0];
  let rules = {};
  try { rules = a.Settings ? JSON.parse(a.Settings) : {}; } catch (e) { rules = {}; }
  return {
    id: sid(a.ROWID), name: a.Name, rules,
    plan: a.PlanStatus || 'TRIAL',
    maxClubs: num(a.MaxClubs) || 1,
    maxUsers: num(a.MaxUsers) || 1,
    ownerEmail: a.OwnerEmail || ''
  };
}

/* ─────────── reading one academy ─────────── */

async function readAll(zcql, academyId) {
  const where = `AcademyId = ${num(academyId)}`;
  const [clubs, coaches, clubCoaches, players, classes, enrols, reqs, wins] = await Promise.all([
    query(zcql, `SELECT Clubs.ROWID, Clubs.Name, Clubs.Courts, Clubs.Status FROM Clubs WHERE Clubs.${where}`),
    query(zcql, `SELECT Coaches.ROWID, Coaches.Name, Coaches.CertLevel, Coaches.Status FROM Coaches WHERE Coaches.${where}`),
    query(zcql, `SELECT ClubCoaches.ROWID, ClubCoaches.ClubId, ClubCoaches.CoachId FROM ClubCoaches WHERE ClubCoaches.${where}`),
    query(zcql, `SELECT Players.ROWID, Players.Name, Players.Level, Players.Contact, Players.Notes, Players.Status FROM Players WHERE Players.${where}`),
    query(zcql, `SELECT Classes.ROWID, Classes.ClubId, Classes.CoachId, Classes.FieldNumber, Classes.DayOfWeek,
                        Classes.StartTime, Classes.DurationMinutes, Classes.Level, Classes.Capacity, Classes.Status
                 FROM Classes WHERE Classes.${where}`),
    query(zcql, `SELECT ClassEnrollments.ROWID, ClassEnrollments.ClassId, ClassEnrollments.PlayerId, ClassEnrollments.Status
                 FROM ClassEnrollments WHERE ClassEnrollments.${where}`),
    query(zcql, `SELECT Requests.ROWID, Requests.PlayerName, Requests.Level, Requests.ClubId,
                        Requests.SessionsPerWeek, Requests.PlacedCount, Requests.Status
                 FROM Requests WHERE Requests.${where}`),
    query(zcql, `SELECT RequestWindows.ROWID, RequestWindows.RequestId, RequestWindows.DayOfWeek,
                        RequestWindows.FromTime, RequestWindows.ToTime
                 FROM RequestWindows WHERE RequestWindows.${where}`)
  ]);

  const alive = (r) => !r.Status || r.Status === 'active';

  const venuesByCoach = {};
  clubCoaches.forEach((x) => {
    const k = sid(x.CoachId);
    (venuesByCoach[k] = venuesByCoach[k] || []).push(sid(x.ClubId));
  });

  const rosterByClass = {};
  enrols.filter(alive).forEach((e) => {
    const k = sid(e.ClassId);
    (rosterByClass[k] = rosterByClass[k] || []).push(sid(e.PlayerId));
  });

  const winsByReq = {};
  wins.forEach((w) => {
    const k = sid(w.RequestId);
    (winsByReq[k] = winsByReq[k] || []).push({
      day: num(w.DayOfWeek), from: String(w.FromTime).slice(0, 5), to: String(w.ToTime).slice(0, 5)
    });
  });

  return {
    venues: clubs.filter(alive).map((c) => ({ id: sid(c.ROWID), name: c.Name, courts: num(c.Courts) })),
    coaches: coaches.filter(alive).map((c) => ({
      id: sid(c.ROWID), name: c.Name, certLevel: num(c.CertLevel), venueIds: venuesByCoach[sid(c.ROWID)] || []
    })),
    players: players.filter(alive).map((p) => ({
      id: sid(p.ROWID), name: p.Name, level: num(p.Level), contact: p.Contact || '', notes: p.Notes || ''
    })),
    classes: classes.filter(alive).map((k) => ({
      id: sid(k.ROWID), venueId: sid(k.ClubId), coachId: sid(k.CoachId),
      field: k.FieldNumber === null || k.FieldNumber === undefined ? null : num(k.FieldNumber),
      day: num(k.DayOfWeek), start: String(k.StartTime).slice(0, 5),
      duration: num(k.DurationMinutes), level: num(k.Level),
      capacity: k.Capacity === null || k.Capacity === undefined ? null : num(k.Capacity),
      playerIds: rosterByClass[sid(k.ROWID)] || []
    })),
    requests: reqs.filter((r) => (r.Status || 'waiting') !== 'cancelled').map((r) => {
      const placed = num(r.PlacedCount);
      return {
        id: sid(r.ROWID), name: r.PlayerName, level: num(r.Level), venueId: sid(r.ClubId),
        sessions: num(r.SessionsPerWeek),
        placed: Array.from({ length: placed }, () => 'placed'),
        windows: winsByReq[sid(r.ROWID)] || []
      };
    })
  };
}

/* ─────────── writing one academy ─────────── */

/* AcademyId is stamped from the session on every write. A client that sends
   its own academy id is ignored rather than trusted. */
function toRow(collection, o, academyId) {
  switch (collection) {
    case 'venues':
      return { AcademyId: academyId, Name: o.name, Courts: num(o.courts), Status: 'active' };
    case 'coaches':
      return { AcademyId: academyId, Name: o.name, CertLevel: num(o.certLevel), Status: 'active' };
    case 'players':
      return { AcademyId: academyId, Name: o.name, Level: num(o.level),
               Contact: o.contact || '', Notes: o.notes || '', Status: 'active' };
    case 'classes':
      return { AcademyId: academyId, ClubId: o.venueId, CoachId: o.coachId,
               FieldNumber: o.field === null || o.field === undefined ? null : num(o.field),
               DayOfWeek: num(o.day), StartTime: o.start, DurationMinutes: num(o.duration),
               Level: num(o.level),
               Capacity: o.capacity === null || o.capacity === undefined ? null : num(o.capacity),
               Status: 'active' };
    case 'requests': {
      const placed = (o.placed || []).length;
      return { AcademyId: academyId, PlayerName: o.name, Level: num(o.level), ClubId: o.venueId,
               SessionsPerWeek: num(o.sessions), PlacedCount: placed,
               Status: placed >= num(o.sessions) ? 'placed' : 'waiting' };
    }
    default:
      throw new Error(`Unknown collection: ${collection}`);
  }
}

/* A row is only ever touched after proving it belongs to the caller's academy.
   Without this, a guessed ROWID would be enough to edit another tenant. */
async function assertOwned(zcql, table, rowId, academyId) {
  const rows = await query(zcql,
    `SELECT ${table}.ROWID FROM ${table} WHERE ${table}.ROWID = ${num(rowId)} AND ${table}.AcademyId = ${num(academyId)}`);
  if (!rows.length) throw new Error('Not found in this academy');
}

async function saveRecord(app, zcql, academyId, academy, collection, record) {
  const table = TABLES[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);
  const ds = app.datastore().table(table);
  const isNew = !record.id || !/^\d+$/.test(String(record.id));

  if (isNew && collection === 'venues') {
    const existing = await query(zcql,
      `SELECT Clubs.ROWID FROM Clubs WHERE Clubs.AcademyId = ${num(academyId)} AND Clubs.Status = 'active'`);
    if (existing.length >= academy.maxClubs) {
      const err = new Error(`This academy's plan includes ${academy.maxClubs} club(s).`);
      err.code = 'LIMIT';
      throw err;
    }
  }

  const row = toRow(collection, record, academyId);
  let id;
  if (isNew) {
    const created = await ds.insertRow(row);
    id = sid(created && (created.ROWID || created.rowid));
  } else {
    await assertOwned(zcql, table, record.id, academyId);
    await ds.updateRow(Object.assign({ ROWID: record.id }, row));
    id = sid(record.id);
  }

  if (collection === 'classes') await syncEnrollments(app, zcql, academyId, id, record.playerIds || []);
  if (collection === 'coaches') await syncClubCoaches(app, zcql, academyId, id, record.venueIds || []);
  if (collection === 'requests') await syncWindows(app, zcql, academyId, id, record.windows || []);
  return id;
}

async function syncEnrollments(app, zcql, academyId, classId, want) {
  const ds = app.datastore().table('ClassEnrollments');
  const rows = await query(zcql,
    `SELECT ClassEnrollments.ROWID, ClassEnrollments.PlayerId, ClassEnrollments.Status
     FROM ClassEnrollments WHERE ClassEnrollments.ClassId = ${num(classId)}
       AND ClassEnrollments.AcademyId = ${num(academyId)}`);
  const liveRows = rows.filter((r) => !r.Status || r.Status === 'active');
  const have = liveRows.map((r) => sid(r.PlayerId));
  const wanted = want.map(sid);

  const remove = liveRows.filter((r) => !wanted.includes(sid(r.PlayerId))).map((r) => sid(r.ROWID));
  if (remove.length) await ds.deleteRows(remove);

  for (const pid of wanted.filter((p) => !have.includes(p))) {
    await ds.insertRow({ AcademyId: academyId, ClassId: classId, PlayerId: pid, Status: 'active' });
  }
}

async function syncClubCoaches(app, zcql, academyId, coachId, want) {
  const ds = app.datastore().table('ClubCoaches');
  const rows = await query(zcql,
    `SELECT ClubCoaches.ROWID, ClubCoaches.ClubId FROM ClubCoaches
     WHERE ClubCoaches.CoachId = ${num(coachId)} AND ClubCoaches.AcademyId = ${num(academyId)}`);
  const have = rows.map((r) => sid(r.ClubId));
  const wanted = want.map(sid);

  const remove = rows.filter((r) => !wanted.includes(sid(r.ClubId))).map((r) => sid(r.ROWID));
  if (remove.length) await ds.deleteRows(remove);

  for (const vid of wanted.filter((v) => !have.includes(v))) {
    await ds.insertRow({ AcademyId: academyId, ClubId: vid, CoachId: coachId });
  }
}

async function syncWindows(app, zcql, academyId, requestId, windows) {
  const ds = app.datastore().table('RequestWindows');
  const rows = await query(zcql,
    `SELECT RequestWindows.ROWID FROM RequestWindows
     WHERE RequestWindows.RequestId = ${num(requestId)} AND RequestWindows.AcademyId = ${num(academyId)}`);
  if (rows.length) await ds.deleteRows(rows.map((r) => sid(r.ROWID)));
  for (const w of windows) {
    await ds.insertRow({ AcademyId: academyId, RequestId: requestId,
      DayOfWeek: num(w.day), FromTime: w.from, ToTime: w.to });
  }
}

async function deleteRecord(app, zcql, academyId, collection, id) {
  const table = TABLES[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);
  await assertOwned(zcql, table, id, academyId);

  const children = { classes: ['ClassEnrollments', 'ClassId'],
                     coaches: ['ClubCoaches', 'CoachId'],
                     requests: ['RequestWindows', 'RequestId'] }[collection];
  if (children) {
    const [childTable, fk] = children;
    const rows = await query(zcql,
      `SELECT ${childTable}.ROWID FROM ${childTable}
       WHERE ${childTable}.${fk} = ${num(id)} AND ${childTable}.AcademyId = ${num(academyId)}`);
    if (rows.length) await app.datastore().table(childTable).deleteRows(rows.map((r) => sid(r.ROWID)));
  }
  if (collection === 'players') {
    const rows = await query(zcql,
      `SELECT ClassEnrollments.ROWID FROM ClassEnrollments
       WHERE ClassEnrollments.PlayerId = ${num(id)} AND ClassEnrollments.AcademyId = ${num(academyId)}`);
    if (rows.length) await app.datastore().table('ClassEnrollments').deleteRows(rows.map((r) => sid(r.ROWID)));
  }
  await app.datastore().table(table).deleteRow(String(id));
}

/* ─────────── operator surface ─────────── */

async function listAcademies(zcql) {
  const [academies, users, clubs] = await Promise.all([
    query(zcql, `SELECT Academies.ROWID, Academies.Name, Academies.PlanStatus, Academies.MaxClubs,
                        Academies.MaxUsers, Academies.ContactEmail, Academies.OwnerEmail, Academies.Notes
                 FROM Academies`),
    query(zcql, `SELECT AcademyUsers.ROWID, AcademyUsers.AcademyId, AcademyUsers.Email,
                        AcademyUsers.Name, AcademyUsers.Role, AcademyUsers.Status FROM AcademyUsers`),
    query(zcql, `SELECT Clubs.ROWID, Clubs.AcademyId, Clubs.Status FROM Clubs`)
  ]);

  const clubCount = {};
  clubs.filter((c) => !c.Status || c.Status === 'active').forEach((c) => {
    const k = sid(c.AcademyId); clubCount[k] = (clubCount[k] || 0) + 1;
  });

  const mapped = academies.map((a) => ({
    id: sid(a.ROWID), name: a.Name, plan: a.PlanStatus || 'TRIAL',
    maxClubs: num(a.MaxClubs), maxUsers: num(a.MaxUsers),
    contact: a.ContactEmail || '', ownerEmail: a.OwnerEmail || '', notes: a.Notes || '',
    clubsUsed: clubCount[sid(a.ROWID)] || 0
  })).sort((x, y) => String(x.name).localeCompare(String(y.name)));

  return {
    academies: mapped,
    users: users.filter((u) => (u.Status || 'invited') !== 'removed').map((u) => ({
      id: sid(u.ROWID), academyId: sid(u.AcademyId), email: u.Email,
      name: u.Name || '', role: u.Role || 'coordinator', status: u.Status || 'invited'
    }))
  };
}

/* Creates the Catalyst login and sends the password email. This is the only
   place an account can be created — public signup is off by design. */
async function invite(app, email, name) {
  const existing = await app.userManagement().getAllUsers().catch(() => []);
  const already = (existing || []).some(
    (u) => String(u.email_id || '').toLowerCase() === String(email).toLowerCase());
  if (already) return { invited: false, reason: 'already a user' };

  const parts = String(name || '').trim().split(/\s+/);
  await app.userManagement().registerUser(
    { platform_type: 'web', zaid: ZAID },
    { email_id: email,
      first_name: parts[0] || email.split('@')[0],
      last_name: parts.slice(1).join(' ') || '-' }
  );
  return { invited: true };
}

async function seatsUsed(zcql, academyId) {
  const rows = await query(zcql,
    `SELECT AcademyUsers.ROWID, AcademyUsers.Status FROM AcademyUsers
     WHERE AcademyUsers.AcademyId = ${num(academyId)}`);
  return rows.filter((r) => (r.Status || 'invited') !== 'removed').length;
}

/* ─────────── routing ─────────── */

async function handler(req, res) {
  let path = '';
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const body = req.method === 'GET' ? {} : await getBody(req);
    path = body.path || url.searchParams.get('path') || 'session';

    const me = await resolveCaller(req);
    if (!me) return sendJson(res, 401, { error: 'Not signed in' });

    const { zcql, app } = me;

    /* ---- who am I, and what can I see ---- */
    if (path === 'session') {
      const academy = me.academyId ? await loadAcademy(zcql, me.academyId) : null;
      return sendJson(res, 200, {
        email: me.email, name: me.name, isOperator: me.isOperator,
        role: me.role, academy
      });
    }

    /* ---- operator endpoints ---- */
    if (path.startsWith('admin/')) {
      if (!me.isOperator) return sendJson(res, 403, { error: 'Not an operator' });

      if (path === 'admin/academies') {
        return sendJson(res, 200, await listAcademies(zcql));
      }

      if (path === 'admin/academy') {
        const a = body.academy || {};
        if (!a.name) return sendJson(res, 400, { error: 'The academy needs a name.' });
        const ds = app.datastore().table('Academies');
        const row = {
          Name: a.name, PlanStatus: a.plan || 'TRIAL',
          MaxClubs: Math.max(1, num(a.maxClubs)), MaxUsers: Math.max(1, num(a.maxUsers)),
          ContactEmail: a.contact || '', Notes: a.notes || ''
        };

        if (a.id) {
          await ds.updateRow(Object.assign({ ROWID: a.id }, row));
          return sendJson(res, 200, { id: sid(a.id), invited: false });
        }

        const owner = String(a.ownerEmail || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) {
          return sendJson(res, 400, { error: 'A valid owner email is required — that is who gets the invitation.' });
        }
        /* Slug is kept for continuity with existing rows; nothing routes by it. */
        const slug = String(a.name).toLowerCase().normalize('NFD')
          .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '').slice(0, 90) + '-' + Date.now().toString(36).slice(-4);

        const created = await ds.insertRow(Object.assign({
          Slug: slug, Settings: '{}', Timezone: 'Europe/Lisbon', OwnerEmail: owner
        }, row));
        const academyId = sid(created && (created.ROWID || created.rowid));

        await app.datastore().table('AcademyUsers').insertRow({
          AcademyId: academyId, Email: owner, Name: a.ownerName || '',
          Role: 'owner', Status: 'invited'
        });
        const result = await invite(app, owner, a.ownerName);
        return sendJson(res, 200, { id: academyId, owner, invited: result.invited, reason: result.reason });
      }

      if (path === 'admin/academy/delete') {
        const id = body.id;
        const clubs = await query(zcql,
          `SELECT Clubs.ROWID FROM Clubs WHERE Clubs.AcademyId = ${num(id)}`);
        if (clubs.length) {
          return sendJson(res, 409, { error: `Still has ${clubs.length} club(s). Suspend it instead, or clear its clubs first.` });
        }
        const users = await query(zcql,
          `SELECT AcademyUsers.ROWID FROM AcademyUsers WHERE AcademyUsers.AcademyId = ${num(id)}`);
        if (users.length) await app.datastore().table('AcademyUsers').deleteRows(users.map((u) => sid(u.ROWID)));
        await app.datastore().table('Academies').deleteRow(String(id));
        return sendJson(res, 200, { ok: true });
      }

      if (path === 'admin/user') {
        const u = body.user || {};
        const email = String(u.email || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return sendJson(res, 400, { error: 'That does not look like an email address.' });
        }
        const academy = await loadAcademy(zcql, u.academyId);
        if (!academy) return sendJson(res, 404, { error: 'Academy not found' });

        const ds = app.datastore().table('AcademyUsers');
        if (u.id) {
          await ds.updateRow({ ROWID: u.id, AcademyId: u.academyId, Email: email,
            Name: u.name || '', Role: u.role || 'coordinator', Status: u.status || 'invited' });
          return sendJson(res, 200, { id: sid(u.id), invited: false });
        }

        if (await seatsUsed(zcql, u.academyId) >= academy.maxUsers) {
          return sendJson(res, 409, { error: `Seat limit reached — this plan includes ${academy.maxUsers} user(s).` });
        }
        const dupes = await query(zcql,
          `SELECT AcademyUsers.ROWID FROM AcademyUsers
           WHERE AcademyUsers.AcademyId = ${num(u.academyId)} AND AcademyUsers.Email = ${q(email)}`);
        if (dupes.length) return sendJson(res, 409, { error: 'That email is already on this academy.' });

        const created = await ds.insertRow({ AcademyId: u.academyId, Email: email,
          Name: u.name || '', Role: u.role || 'coordinator', Status: 'invited' });
        const result = await invite(app, email, u.name);
        return sendJson(res, 200, { id: sid(created && created.ROWID), invited: result.invited, reason: result.reason });
      }

      if (path === 'admin/user/delete') {
        await app.datastore().table('AcademyUsers').deleteRow(String(body.id));
        return sendJson(res, 200, { ok: true });
      }

      /* Read what testers have sent, newest first. */
      if (path === 'admin/feedback') {
        const rows = await query(zcql,
          `SELECT Feedback.ROWID, Feedback.AcademyId, Feedback.Email, Feedback.Screen,
                  Feedback.Message, Feedback.Status, Feedback.CREATEDTIME FROM Feedback`);
        return sendJson(res, 200, {
          feedback: rows.map((r) => ({
            id: sid(r.ROWID), academyId: sid(r.AcademyId), email: r.Email,
            screen: r.Screen || '', message: r.Message || '',
            status: r.Status || 'new', at: r.CREATEDTIME
          })).sort((a, b) => String(b.at).localeCompare(String(a.at)))
        });
      }

      return sendJson(res, 404, { error: `Unknown admin path: ${path}` });
    }

    /* Feedback is deliberately outside the academy gate below: someone whose
       account is not attached to an academy yet is exactly the person most
       likely to have something to tell us. */
    if (path === 'feedback') {
      const message = String(body.message || '').trim();
      if (!message) return sendJson(res, 400, { error: 'Nothing to send.' });
      await app.datastore().table('Feedback').insertRow({
        AcademyId: me.academyId || null,
        Email: me.email,
        Screen: String(body.screen || '').slice(0, 40),
        Message: message.slice(0, 9000),
        Context: String(body.context || '').slice(0, 9000),
        Status: 'new'
      });
      return sendJson(res, 200, { ok: true });
    }

    /* ---- academy endpoints ---- */
    if (!me.academyId) {
      return sendJson(res, 403, {
        error: 'no-academy',
        message: 'This account is not attached to any academy yet.'
      });
    }
    const academy = await loadAcademy(zcql, me.academyId);
    if (!academy) return sendJson(res, 404, { error: 'Academy not found' });
    if (academy.plan === 'SUSPENDED') {
      return sendJson(res, 403, { error: 'suspended', message: 'This academy is suspended.' });
    }

    if (path === 'data') {
      const data = await readAll(zcql, me.academyId);
      return sendJson(res, 200, Object.assign({ academy, role: me.role }, data));
    }

    if (path === 'save') {
      const id = await saveRecord(app, zcql, me.academyId, academy, body.collection, body.record || {});
      return sendJson(res, 200, { id });
    }

    if (path === 'delete') {
      await deleteRecord(app, zcql, me.academyId, body.collection, body.id);
      return sendJson(res, 200, { ok: true });
    }

    if (path === 'academy') {
      if (me.role !== 'owner' && me.role !== 'coordinator') {
        return sendJson(res, 403, { error: 'Only an owner or coordinator can change academy settings.' });
      }
      await app.datastore().table('Academies').updateRow({
        ROWID: me.academyId,
        Name: body.name || academy.name,
        Settings: JSON.stringify(body.rules || academy.rules || {})
      });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: `Unknown path: ${path}` });
  } catch (error) {
    console.error('api error on path', path, '-', error && error.message, error && error.stack);
    const status = error && error.code === 'LIMIT' ? 409 : 500;
    sendJson(res, status, { error: (error && error.message) || 'Unexpected error' });
  }
}

/* The Advanced I/O template that ships the Catalyst SDK scaffolds an EXPRESS
   app, and Express answers unknown paths itself — "Cannot GET /execute" —
   before any handler runs. Mounting on a catch-all fixes that, and it stays
   correct whichever template the function was created from: an Express app is
   itself a (req, res) function, so a raw-http runtime can call it directly.
   If express is not present, the bare handler is exported instead. */
let exported = handler;
try {
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.all('*', handler);
  exported = app;
} catch (e) {
  /* raw-http template — no express in the bundle, use the handler as-is */
}

module.exports = exported;
