'use strict';
// Loads each Catalyst function entry point (from functions/*/index.js, i.e. the deployed
// code incl. its lib/ copy) with a fake zcatalyst-sdk-node, and checks the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const sdkCalls = [];
let currentUser = null;
const fakeSdk = {
  initialize: (_ctx, opts) => ({
    userManagement: () => ({ getCurrentUser: async () => { if (!currentUser) throw new Error('no user'); return currentUser; } }),
    zcql: () => ({ executeZCQLQuery: async (q) => { sdkCalls.push(['zcql', q, opts]); return []; } }),
    datastore: () => ({ table: (name) => ({
      insertRow: async (row) => { sdkCalls.push(['insert', name, row]); return { ROWID: '555', ...row }; },
      updateRow: async (row) => { sdkCalls.push(['update', name, row]); return row; },
    }) }),
    jobScheduling: () => ({ job: () => ({ submitJob: async (job) => { sdkCalls.push(['job', job]); } }) }),
    email: () => ({ sendMail: async (m) => { sdkCalls.push(['mail', m]); } }),
  }),
};
const origLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'zcatalyst-sdk-node') return fakeSdk;
  if (request === 'express') return origLoad.call(this, path.join(root, 'node_modules', 'express'), ...rest);
  return origLoad.call(this, request, ...rest);
};
const fn = (name) => require(path.join(root, 'functions', name, 'index.js'));

function jobContext() {
  const ctx = { result: null, closeWithSuccess() { ctx.result = 'success'; }, closeWithFailure() { ctx.result = 'failure'; }, getMaxExecutionTimeMs: () => '900000' };
  return ctx;
}

test('every function folder has the files Catalyst needs', () => {
  const targets = JSON.parse(fs.readFileSync(path.join(root, 'catalyst.json'), 'utf8')).functions.targets;
  for (const name of targets) {
    const dir = path.join(root, 'functions', name);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'catalyst-config.json'), 'utf8'));
    assert.equal(cfg.deployment.name, name);
    assert.equal(cfg.execution.main, 'index.js');
    assert.ok(['advancedio', 'job'].includes(cfg.deployment.type));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies['zcatalyst-sdk-node']);
  }
});

test('siteguard_api: rejects anonymous calls; a logged-in user is created on first request', async () => {
  const app = fn('siteguard_api');
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/server/siteguard_api`;
  try {
    currentUser = null;
    assert.equal((await fetch(`${base}/api/me`)).status, 401);
    currentUser = { user_id: '9001', email_id: 'zoe@example.com' };
    sdkCalls.length = 0;
    const res = await fetch(`${base}/api/me`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.email, 'zoe@example.com');
    assert.deepEqual(sdkCalls[0].slice(0, 2), ['zcql', "SELECT * FROM AppUsers WHERE CatalystUserId = '9001' LIMIT 0, 1"]);
    assert.deepEqual(sdkCalls[0][2], { scope: 'admin' });
    assert.equal(sdkCalls[1][0], 'insert');
    assert.equal(sdkCalls[1][1], 'AppUsers');
  } finally { server.close(); }
});

test('audit_runner: invalid job params fail the job; missing audit closes successfully', async () => {
  const runner = fn('audit_runner');
  let ctx = jobContext();
  await runner({ getAllJobParams: () => ({ auditId: 'x' }) }, ctx);
  assert.equal(ctx.result, 'failure');
  ctx = jobContext();
  await runner({ getAllJobParams: () => ({ auditId: '123' }) }, ctx);
  assert.equal(ctx.result, 'success');
});

test('audit_scheduler: queries due schedules and closes successfully', async () => {
  sdkCalls.length = 0;
  const ctx = jobContext();
  await fn('audit_scheduler')({}, ctx);
  assert.equal(ctx.result, 'success');
  assert.ok(sdkCalls.some(([k, q]) => k === 'zcql' && /FROM Schedules WHERE Enabled = true AND NextRunAt <= '/.test(q)));
});

test('billing_webhook: rejects unsigned requests', async () => {
  const http = require('node:http');
  const server = http.createServer(fn('billing_webhook'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 400);
  } finally { server.close(); }
});

test('functions/*/lib is an up-to-date copy of shared/ (run npm run sync)', () => {
  const list = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
  const shared = path.join(root, 'shared');
  for (const name of fs.readdirSync(path.join(root, 'functions'))) {
    const lib = path.join(root, 'functions', name, 'lib');
    assert.deepEqual(list(lib).filter((f) => f !== 'README.md'), list(shared), `${name}: file list differs`);
    for (const f of list(shared)) assert.equal(fs.readFileSync(path.join(lib, f), 'utf8'), fs.readFileSync(path.join(shared, f), 'utf8'), `${name}/lib/${f} is stale`);
  }
});
