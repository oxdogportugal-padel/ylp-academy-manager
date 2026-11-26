'use strict';
// The Catalyst Data Store driver against a fake SDK: checks the ZCQL it generates,
// result unwrapping, pagination, batching and type conversion.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalystDriver, whereClause } = require('../shared/repo/catalyst-driver');

function fakeApp({ pages = [] } = {}) {
  const queries = [];
  const inserts = [];
  const updates = [];
  let n = 100;
  return {
    queries, inserts, updates,
    zcql: () => ({ executeZCQLQuery: async (q) => { queries.push(q); return pages.shift() || []; } }),
    datastore: () => ({
      table: (name) => ({
        insertRow: async (row) => { inserts.push([name, row]); n += 1; return { ROWID: String(n), ...row }; },
        insertRows: async (rows) => { inserts.push([name, rows]); return rows.map((r) => { n += 1; return { ROWID: String(n), ...r }; }); },
        updateRow: async (row) => { updates.push([name, row]); return row; },
      }),
    }),
  };
}

test('builds ZCQL with column names, quoting and operators', () => {
  assert.equal(whereClause('audits', { targetId: '123', status: { in: ['queued', 'running'] }, createdAt: { lt: "2026-01-01T00:00:00.000Z" } }),
    " WHERE TargetId = 123 AND Status IN ('queued', 'running') AND CreatedAt < '2026-01-01T00:00:00.000Z'");
  assert.equal(whereClause('targets', { url: "https://x.com/it's" }), " WHERE Url = 'https://x.com/it''s'");
  assert.equal(whereClause('schedules', { enabled: true }), ' WHERE Enabled = true');
  assert.equal(whereClause('issues', { resolvedAt: null }), ' WHERE ResolvedAt IS NULL');
  assert.throws(() => whereClause('audits', { targetId: '1 OR 1=1' }), /Invalid numeric/);
  assert.throws(() => whereClause('targets', { url: 'a\\b' }), /Unsupported character/);
  assert.throws(() => whereClause('audits', { nope: 1 }), /Unknown field/);
});

test('find unwraps rows, converts types and paginates in pages of 300', async () => {
  const row = (i) => ({ Audits: { ROWID: String(i), TargetId: '9', Score: '87', Counts: '{"high":1}', Status: 'completed', ErrorMessage: '' } });
  const app = fakeApp({ pages: [Array.from({ length: 300 }, (_, i) => row(i + 1)), [row(301)]] });
  const d = createCatalystDriver(app);
  const rows = await d.find('audits', { targetId: '9' }, { orderBy: [['createdAt', 'DESC']] });
  assert.equal(rows.length, 301);
  assert.deepEqual(app.queries, [
    'SELECT * FROM Audits WHERE TargetId = 9 ORDER BY CreatedAt DESC LIMIT 0, 300',
    'SELECT * FROM Audits WHERE TargetId = 9 ORDER BY CreatedAt DESC LIMIT 300, 300',
  ]);
  assert.deepEqual(rows[0].counts, { high: 1 });
  assert.equal(rows[0].score, 87);
  assert.equal(rows[0].id, '1');
  assert.equal(rows[0].error, null);
});

test('limit, get, count and remove', async () => {
  const app = fakeApp({ pages: [[{ Schedules: { ROWID: '5', Enabled: 'false' } }], [{ Issues: { 'COUNT(ROWID)': '7' } }]] });
  const d = createCatalystDriver(app);
  const s = await d.get('schedules', '5');
  assert.equal(s.enabled, false, 'boolean strings converted');
  assert.equal(await d.count('issues', { targetId: '1', status: 'open' }), 7);
  await d.remove('findings', { targetId: '1' });
  assert.equal(await d.get('schedules', 'x'), null);
  await assert.rejects(d.remove('findings', {}), /WHERE/);
  assert.deepEqual(app.queries, [
    'SELECT * FROM Schedules WHERE ROWID = 5 LIMIT 0, 1',
    "SELECT COUNT(ROWID) FROM Issues WHERE TargetId = 1 AND Status = 'open'",
    'DELETE FROM Findings WHERE TargetId = 1',
  ]);
});

test('inserts map fields to columns and batch by 200; updates carry ROWID', async () => {
  const app = fakeApp();
  const d = createCatalystDriver(app);
  const ins = await d.insert('schedules', { targetId: '1', enabled: true, recipients: 'a@b.co' });
  assert.deepEqual(app.inserts[0], ['Schedules', { TargetId: '1', Enabled: 'true', Recipients: 'a@b.co' }]);
  assert.equal(ins.enabled, true);
  const many = await d.insertMany('findings', Array.from({ length: 450 }, (_, i) => ({ auditId: '1', evidence: { i } })));
  assert.equal(many.length, 450);
  assert.deepEqual(app.inserts.slice(1).map(([, rows]) => rows.length), [200, 200, 50]);
  assert.equal(app.inserts[1][1][0].Evidence, '{"i":0}');
  await d.update('issues', '77', { status: 'resolved', resolvedAt: '2026-01-01T00:00:00.000Z', resolvedAuditId: null });
  assert.deepEqual(app.updates[0], ['Issues', { ROWID: '77', Status: 'resolved', ResolvedAt: '2026-01-01T00:00:00.000Z', ResolvedAuditId: null }]);
});
