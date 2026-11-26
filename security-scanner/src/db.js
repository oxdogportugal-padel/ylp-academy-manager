'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- A website/URL a user monitors. All audits and issues hang off it.
CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, url)
);

-- One row per scan run (the audit log).
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','scheduled')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  final_url TEXT,
  score INTEGER,
  grade TEXT,
  counts TEXT,           -- JSON {critical,high,medium,low,info}
  meta TEXT,             -- JSON scan metadata
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS audits_target ON audits(target_id, created_at);

-- A security issue tracked across audits of one target (identified by fingerprint).
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  check_id TEXT NOT NULL,
  key TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  first_detected_audit_id INTEGER NOT NULL REFERENCES audits(id),
  first_detected_at TEXT NOT NULL,
  last_seen_audit_id INTEGER NOT NULL REFERENCES audits(id),
  last_seen_at TEXT NOT NULL,
  resolved_audit_id INTEGER REFERENCES audits(id),
  resolved_at TEXT,
  times_reopened INTEGER NOT NULL DEFAULT 0,
  UNIQUE (target_id, fingerprint)
);

-- Full lifecycle history of each issue: detected -> resolved -> reopened -> ...
CREATE TABLE IF NOT EXISTS issue_events (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('detected','resolved','reopened')),
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issue_events_audit ON issue_events(audit_id);

-- What a given audit actually found (snapshot, with evidence).
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  key TEXT NOT NULL,
  severity TEXT NOT NULL,
  evidence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_audit ON findings(audit_id);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL UNIQUE REFERENCES targets(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  recipients TEXT NOT NULL,   -- comma-separated e-mails
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id) ON DELETE SET NULL,
  recipients TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  db.tx = (fn) => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  db.get = (sql, ...p) => db.prepare(sql).get(...p);
  db.all = (sql, ...p) => db.prepare(sql).all(...p);
  db.run = (sql, ...p) => db.prepare(sql).run(...p);
  return db;
}

module.exports = { openDatabase };
