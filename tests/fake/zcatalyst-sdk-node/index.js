/* In-memory stand-in for zcatalyst-sdk-node, reproducing the behaviours that
   matter: ZCQL wraps rows under the table name, ids come back as strings, and
   registerUser sends an invite. */
const DB = {
  Academies: [], Clubs: [], Coaches: [], ClubCoaches: [], Players: [], Classes: [],
  ClassEnrollments: [], Requests: [], RequestWindows: [], AcademyUsers: [], PlatformAdmins: [], Feedback: []
};
let SEQ = 5361000000900000;
const USERS = [];
const INVITES = [];
let CURRENT = null;                       // the signed-in user for this request

const ID_COLS = /(^ROWID$|Id$)/;
function wire(row) {
  const o = {};
  Object.keys(row).forEach((k) => {
    const v = row[k];
    o[k] = (v !== null && v !== undefined && ID_COLS.test(k)) ? String(v) : v;
  });
  return o;
}

function parse(sql) {
  const m = sql.replace(/\s+/g, ' ').trim()
    .match(/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))? LIMIT (\d+), (\d+)$/i);
  if (!m) throw new Error('fake sdk cannot parse: ' + sql);
  return { cols: m[1].split(',').map((c) => c.trim().split('.').pop()),
           table: m[2], where: m[3] || null, offset: +m[4], limit: +m[5] };
}
function matches(row, where) {
  if (!where) return true;
  return where.split(/ AND /i).every((cond) => {
    const p = cond.trim().match(/^(?:\w+\.)?(\w+)\s*=\s*(.+)$/);
    if (!p) throw new Error('fake sdk cannot parse condition: ' + cond);
    const val = p[2].trim().replace(/^'|'$/g, '').replace(/''/g, "'");
    return String(row[p[1]]) === String(val);
  });
}

function table(name) {
  if (!DB[name]) throw new Error('fake sdk: unknown table ' + name);
  return {
    insertRow: async (row) => { const r = { ...row, ROWID: String(++SEQ) }; DB[name].push(r); return wire(r); },
    updateRow: async (row) => {
      const hit = DB[name].find((r) => String(r.ROWID) === String(row.ROWID));
      if (!hit) throw new Error('no such row ' + row.ROWID);
      Object.assign(hit, row); return wire(hit);
    },
    deleteRow: async (id) => { DB[name] = DB[name].filter((r) => String(r.ROWID) !== String(id)); },
    deleteRows: async (ids) => {
      const set = ids.map(String);
      DB[name] = DB[name].filter((r) => !set.includes(String(r.ROWID)));
    }
  };
}

const adminApp = {
  zcql: () => ({
    executeZCQLQuery: async (sql) => {
      const qy = parse(sql);
      return DB[qy.table].filter((r) => matches(r, qy.where))
        .slice(qy.offset, qy.offset + qy.limit)
        .map((r) => { const picked = {}; qy.cols.forEach((c) => { picked[c] = r[c]; });
                      return { [qy.table]: wire(picked) }; });
    }
  }),
  datastore: () => ({ table }),
  userManagement: () => ({
    getAllUsers: async () => USERS.slice(),
    registerUser: async (cfg, user) => {
      if (!cfg || cfg.zaid !== '30047977891') throw new Error('wrong or missing ZAID');
      USERS.push({ email_id: user.email_id });
      INVITES.push({ email: user.email_id, first: user.first_name, last: user.last_name });
      return { email_id: user.email_id };
    }
  })
};
const userApp = { userManagement: () => ({ getCurrentUser: async () => CURRENT }) };

module.exports = {
  initialize: (_req, opts) => (opts && opts.scope === 'admin' ? adminApp : userApp),
  __test: { DB, USERS, INVITES, setUser: (u) => { CURRENT = u; },
            reset: () => { Object.keys(DB).forEach((k) => { DB[k].length = 0; });
                           USERS.length = 0; INVITES.length = 0; CURRENT = null; } }
};
