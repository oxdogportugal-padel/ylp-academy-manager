#!/usr/bin/env node
'use strict';
// Writes data-model/tables.json and data-model/schema.md from shared/repo/schema.js.
const fs = require('node:fs');
const path = require('node:path');
const { TABLES } = require('../shared/repo/schema');

const out = path.join(__dirname, '..', 'data-model');
fs.mkdirSync(out, { recursive: true });
const tables = Object.values(TABLES).map((t) => ({
  table_name: t.name,
  columns: Object.values(t.columns).map(([column_name, data_type, max_length]) => ({
    column_name, data_type, ...(max_length ? { max_length } : {}), is_mandatory: false,
  })),
}));
fs.writeFileSync(path.join(out, 'tables.json'), `${JSON.stringify(tables, null, 2)}\n`);

let md = '# SiteGuard Data Store schema\n\nGenerated from `shared/repo/schema.js` by `npm run gen-schema` — edit that file, not this one.\n\n'
  + 'Every table also has the system columns `ROWID`, `CREATORID`, `CREATEDTIME`, `MODIFIEDTIME` (do not create them).\n'
  + 'Timestamps are ISO-8601 UTC strings. `bigint` id columns hold the `ROWID` of the referenced row.\n';
for (const t of Object.values(TABLES)) {
  md += `\n## ${t.name}\n\n| Column | Type | Max length |\n|---|---|---|\n`;
  for (const [col, type, max] of Object.values(t.columns)) md += `| ${col} | ${type} | ${max || ''} |\n`;
}
fs.writeFileSync(path.join(out, 'schema.md'), md);
console.log(`wrote ${tables.length} tables to data-model/`);
