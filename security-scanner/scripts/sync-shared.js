#!/usr/bin/env node
'use strict';
// Catalyst deploys each function folder on its own, so code shared between functions is
// copied from shared/ into functions/<name>/lib/. Run after editing anything in shared/
// (npm test fails if a copy is out of date).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const shared = path.join(root, 'shared');
const functionsDir = path.join(root, 'functions');

for (const fn of fs.readdirSync(functionsDir)) {
  const lib = path.join(functionsDir, fn, 'lib');
  if (!fs.existsSync(path.join(functionsDir, fn, 'index.js'))) continue;
  fs.rmSync(lib, { recursive: true, force: true });
  fs.cpSync(shared, lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'README.md'), '# Generated\n\nCopied from `../../shared` by `npm run sync`. Do not edit here.\n');
  console.log(`synced shared/ -> functions/${fn}/lib`);
}
