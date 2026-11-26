#!/usr/bin/env node
'use strict';
// Usage: npm run scan -- https://example.com [--json]
const { runScan } = require('./scanner');
const { CATALOG } = require('./scanner/catalog');

(async () => {
  const url = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!url) { console.error('Usage: npm run scan -- <url> [--json]'); process.exit(2); }
  const result = await runScan(url, { allowPrivate: process.env.SCANNER_ALLOW_PRIVATE === 'true' });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`\n${result.finalUrl}  —  grade ${result.grade} (${result.score}/100)\n`);
  for (const f of result.findings) {
    console.log(`[${f.severity.toUpperCase().padEnd(8)}] ${f.title}  (${f.key})`);
    console.log(`           ${CATALOG[f.checkId].summary}`);
  }
  if (Object.keys(result.meta.checkErrors).length) console.log('\nCheck errors:', result.meta.checkErrors);
})().catch((e) => { console.error(e.message); process.exit(1); });
