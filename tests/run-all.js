#!/usr/bin/env node
/* Runs every suite and sums the results.
 *   node tests/run-all.js            all of them
 *   node tests/run-all.js unit       just the fast ones, no browser needed
 * Set CHROMIUM to a browser binary if Playwright cannot find one. */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');

const only = process.argv[2];
const suites = [];
const add = (dir, kind) => fs.readdirSync(path.join(__dirname, dir))
  .filter(f => f.endsWith('.js') && !f.startsWith('_') && f !== 'run-all.js')
  .sort()
  .forEach(f => suites.push({ kind, file: path.join(__dirname, dir, f), name: `${kind}/${f}` }));

add('unit', 'unit');
if (only !== 'unit') add('browser', 'browser');

let total = 0, failed = 0, broke = 0;
for (const s of suites) {
  let out = '';
  try {
    /* stderr is piped, not inherited: the function logs refused writes on
       purpose during the negative tests, and those traces are not failures. */
    out = execFileSync(process.execPath, [s.file],
      { cwd: path.dirname(s.file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    if (!/\d+ passed/.test(out)) {
      broke++;
      console.log(`  ✗ ${s.name}  did not run\n${out.trim().split('\n').slice(-4).map(l => '      ' + l).join('\n')}`);
      continue;
    }
  }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (!m) {                       // suites that only print observations
    console.log(`  · ${s.name}  ran, no assertions reported`);
    continue;
  }
  total += +m[1]; failed += +m[2];
  console.log(`  ${+m[2] ? '✗' : '✓'} ${s.name.padEnd(26)} ${m[1]} passed${+m[2] ? `, ${m[2]} FAILED` : ''}`);
  if (+m[2]) out.split('\n').filter(l => /FAIL/.test(l)).forEach(l => console.log('      ' + l.trim()));
}

console.log(`\n${total} passed, ${failed} failed${broke ? `, ${broke} suite(s) did not run` : ''}`);
process.exit(failed || broke ? 1 : 0);
