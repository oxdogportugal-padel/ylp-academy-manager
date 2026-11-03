/* Every string the planner puts on screen goes through t(), keyed by its
   English text. This fails if any key lacks a Portuguese, Spanish or French
   entry, or if a translation drops or invents a {placeholder} — the two ways a
   translation goes wrong silently. No browser needed. */
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };

const src = html.match(/var I18N=(\{[\s\S]*?\n\});/);
ok('the page carries a translation table', !!src);
const I18N = Function('return ' + src[1])();

const keys = new Set();
const re = /\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
let m;
while ((m = re.exec(html))) keys.add(JSON.parse('"' + (m[1] !== undefined ? m[1] : m[2].replace(/"/g, '\\"')) + '"'));
/* keys that reach t() through a variable rather than a literal */
['Calendar', 'Place a player', 'Place', 'Waiting list', 'Waiting', 'Manage',
 'Academy', 'Clubs', 'Coaches', 'Players', 'Classes',
 'Player', 'Level', 'Club', 'Wants', 'Booked', 'Availability', 'Day', 'Time', 'Seats', 'Coach',
 'save', 'delete'].forEach((k) => keys.add(k));
ok('found the strings', keys.size > 250, keys.size);

const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
for (const lang of ['pt', 'es', 'fr']) {
  const d = I18N[lang] || {};
  const missing = [...keys].filter((k) => !d[k]);
  ok(`${lang}: every string translated`, missing.length === 0, missing.slice(0, 8));
  const bad = [...keys].filter((k) => d[k] && ph(d[k]) !== ph(k));
  ok(`${lang}: placeholders intact`, bad.length === 0, bad.slice(0, 5));
  const stale = Object.keys(d).filter((k) => !keys.has(k));
  ok(`${lang}: no leftover entries`, stale.length === 0, stale.slice(0, 5));
}

/* The plural rule drops "(s)" for one and keeps it otherwise. A Portuguese
   ending like "será(ão)" would come out as "seráão", so ban it at the source. */
const odd = [];
for (const lang of ['pt', 'es', 'fr']) Object.values(I18N[lang]).forEach((v) => {
  if (/[aeiouáéíóúãõâêôà]\([aeiouáéíóúãõâêô]/i.test(v)) odd.push(v);
});
ok('no vowel-on-vowel plural ending', odd.length === 0, odd);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
