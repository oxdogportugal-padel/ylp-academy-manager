#!/usr/bin/env node
/* Regenerates every screenshot the guide uses, from the real client against
 * the fake API, so the manual always shows the app as it is.
 *   node manual/shots.js            English (default)
 *   LANG_UI=pt node manual/shots.js Portuguese interface
 * Writes manual/shots/*.png, then run: python3 manual/build.py
 * Invented names only — never point this at real player data. */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'client');
const FAKE = path.join(__dirname, '..', 'tests', 'fake', 'fakeapi.js');
const OUT = path.join(__dirname, 'shots');
const LANG = process.env.LANG_UI || 'en';
const PORT = 8961, BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const srv = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/__catalyst/sdk/init.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('/*stub*/'); }
  const f = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The real Catalyst widget cannot load offline; this stands in for it so the
   sign-in shot shows fields rather than a placeholder. */
function mockSignIn() {
  window.__API.mode.signedIn = false;
  window.__mockLogin = true;
  const iv = setInterval(() => {
    if (!window.catalyst) return;
    clearInterval(iv);
    window.catalyst.auth.signIn = (id) => {
      const el = document.getElementById(id); if (!el) return;
      el.style.minHeight = '0';
      el.innerHTML =
        '<label class="f"><span>Email</span><input class="inp" value="coordinator@academy.pt"></label>' +
        '<label class="f"><span>Password</span><input class="inp" type="password" value="0123456789"></label>' +
        '<button class="btn honey" style="width:100%;justify-content:center;margin-top:6px">→</button>';
    };
  }, 10);
}

(async () => {
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}).catch(() => chromium.launch());
  const mk = async (opts, setup) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: 'light' }, opts || {}));
    const p = await ctx.newPage();
    await p.addInitScript({ path: FAKE });
    await p.addInitScript(`window.__API.academy.name='Riverside Padel Academy';window.__API.academy.language=${JSON.stringify(LANG)};localStorage.setItem('bandeja.lang',${JSON.stringify(LANG)});`);
    if (setup) await p.addInitScript(setup);
    await p.goto(BASE + '/', { waitUntil: 'load' }); await sleep(700);
    return p;
  };
  const shot = async (p, name, el) => {
    const file = path.join(OUT, name + '.png');
    if (el) await p.locator(el).first().screenshot({ path: file });
    else await p.screenshot({ path: file });
    console.log('  ' + name);
  };
  const seed = async (p, phone) => {
    const nav = phone ? '#bnav' : '#tabs';
    await p.locator(`${nav} [data-id="manage"]`).click(); await sleep(200);
    await p.locator('[data-act="loadDemo"]').first().click(); await sleep(200);
    await p.locator('[data-act="saveModal"]').click();
    await p.waitForFunction(() => window.__API.db.classes.length >= 9 && window.__API.db.requests.length >= 3, { timeout: 20000 });
    await sleep(3300);
    return nav;
  };

  // sign-in
  let p = await mk({ viewport: { width: 1100, height: 760 } }, mockSignIn);
  await sleep(500); await shot(p, 'signin'); await p.context().close();

  // first-login tour
  p = await mk(null, () => { window.__API.academy.tutorialDone = false; });
  await sleep(300); await shot(p, 'tour-welcome');
  await p.locator('#tourNext').click(); await sleep(250); await shot(p, 'tour-step');
  await p.keyboard.press('Escape'); await sleep(200);

  // empty academy: the checklist
  await p.locator('#tabs [data-id="manage"]').click(); await sleep(200);
  await shot(p, 'checklist', 'main .card');

  // seeded week
  const nav = await seed(p);
  await p.locator(`${nav} [data-id="calendar"]`).click(); await sleep(400);
  await p.screenshot({ path: path.join(OUT, 'calendar.png'), fullPage: true }); console.log('  calendar');
  await p.locator('.ev', { hasText: '18:30' }).first().click(); await sleep(300);
  await shot(p, 'class-detail', '#modalBox');
  await p.locator('[data-act="moveClass"]').click(); await sleep(300);
  await shot(p, 'move', '#modalBox');
  await p.locator('[data-act="closeModal"]').first().click(); await sleep(200);

  await p.locator('[data-act="toggleFilters"]').click(); await sleep(200);
  await p.locator('[data-act="toggleFree"]').click(); await sleep(300);
  await p.screenshot({ path: path.join(OUT, 'filters.png'), clip: { x: 0, y: 0, width: 1280, height: 560 } }); console.log('  filters');
  await p.locator('[data-act="toggleFree"]').click(); await sleep(150);
  await p.locator('[data-act="toggleFilters"]').click(); await sleep(150);

  await p.locator('[data-act="newClass"]').first().click(); await sleep(250);
  const alex = await p.$$eval('#kCoach option', (o) => (o.find((x) => /Alex/.test(x.textContent)) || {}).value);
  if (alex) await p.selectOption('#kCoach', alex);
  await p.selectOption('#kDay', '0'); await p.fill('#kStart', '19:00');
  await p.locator('[data-act="saveModal"]').click(); await sleep(250);
  await shot(p, 'new-class', '#modalBox');
  await p.locator('[data-act="closeModal"]').first().click(); await sleep(150);

  await p.locator(`${nav} [data-id="place"]`).click(); await sleep(250);
  await p.fill('#ppName', 'Mariana');
  await p.$eval('#ppLevel', (e) => { e.value = '3'; e.dispatchEvent(new Event('input')); });
  await p.locator('[data-multi="ppDays"][data-val="1"]').click();
  await p.locator('[data-multi="ppDays"][data-val="0"]').click();
  await p.locator('[data-multi="ppDays"][data-val="2"]').click();
  await shot(p, 'place-form', 'main .card');
  await p.locator('[data-act="ppSearch"]').click(); await sleep(350);
  const box = await p.locator('main .wrap').boundingBox();
  const form = await p.locator('main .card').first().boundingBox();
  await p.screenshot({ path: path.join(OUT, 'place-results.png'), fullPage: true,
    clip: { x: box.x, y: form.y + form.height + 4, width: box.width, height: Math.min(620, box.height - form.height) } });
  console.log('  place-results');

  await p.locator(`${nav} [data-id="waitlist"]`).click(); await sleep(300);
  await shot(p, 'waitlist', 'main .wrap');

  await p.locator(`${nav} [data-id="manage"]`).click(); await sleep(200);
  await shot(p, 'settings', 'main .card');
  await p.locator('[data-act="sub"][data-id="players"]').click(); await sleep(200);
  await shot(p, 'manage-players', 'main .wrap');
  await p.locator('[data-act="editAcademy"]').first().click(); await sleep(250);
  await shot(p, 'rules', '#modalBox');
  await p.context().close();

  // phone
  p = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pn = await seed(p, true);
  await p.locator(`${pn} [data-id="calendar"]`).click(); await sleep(300);
  await shot(p, 'mobile');
  await p.locator(`${pn} [data-id="waitlist"]`).click(); await sleep(300);
  await shot(p, 'mobile-waitlist');
  await p.context().close();

  await browser.close(); srv.close();
  console.log('shots written to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
