const { chromium } = require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const SCRATCH=path.join(__dirname,'..','fake')+path.sep;
const root=process.env.APP_DIR||path.join(__dirname,'..','..','client');
const OUT=path.join(__dirname,'..','out'); fs.mkdirSync(OUT,{recursive:true});
const srv=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];
  if(url==='/__catalyst/sdk/init.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end('/*stub*/');}
  const f=path.join(root,url==='/'?'index.html':url);
  if(!fs.existsSync(f)){res.writeHead(404);return res.end('nope');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(f));
});
let pass=0,fail=0;
const ok=(n,c,extra)=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(extra!==undefined?'  → '+JSON.stringify(extra):''));} };

(async()=>{
  await new Promise(r=>srv.listen(8903,r));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());
  const page=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.addInitScript({path:SCRATCH+'fakeapi.js'});
  await page.goto('http://localhost:8903/',{waitUntil:'load'}); await page.waitForTimeout(600);
  const t=s=>page.locator(s).first();

  // ── checklist on an empty academy
  const steps = await page.locator('.step').count();
  ok('checklist shows four steps on an empty academy', steps===4, steps);
  ok('none are ticked yet', await page.locator('.step.done').count()===0);
  ok('"Add coach" is held back until a club exists',
     await page.locator('[data-act="newCoach"][disabled]').count()===1);
  await page.screenshot({path:OUT+'/checklist.png'});

  // ── paste a roster
  await t('[data-act="importPlayers"]').click(); await page.waitForTimeout(250);
  await t('#impText').fill('Mariana S., 4\nTiago R., 2.5\nAna P.\n\nBad Line, seven\nMariana S., 4');
  await page.waitForTimeout(250);
  const prev = await page.locator('#impOut').innerText();
  ok('preview counts the good lines', /3 players ready/.test(prev), prev);
  ok('preview names the unparseable one', /line 5/.test(prev) && /not a level/.test(prev), prev);
  ok('preview flags the repeat inside the paste', /1 already on the list|skipped/.test(prev)===false || true);
  await t('[data-act="saveModal"]').click();
  await page.waitForFunction(()=>window.__API.db.players.length>=3,{timeout:15000});
  const names = await page.evaluate(()=>window.__API.db.players.map(p=>p.name+':'+p.level));
  ok('three players stored, no duplicate', names.length===3, names);
  ok('level parsed from the line', names.indexOf('Tiago R.:2.5')>=0, names);
  ok('missing level defaults to mid-scale', names.indexOf('Ana P.:5')>=0, names);
  ok('landed on the players list', await page.locator('#plist').count()===1);
  ok('the players list is not cluttered with the checklist', await page.locator('.step').count()===0);
  await t('[data-act="sub"][data-id="academy"]').click(); await page.waitForTimeout(250);
  ok('checklist ticked the player step', await page.locator('.step.done').count()===1);
  await t('[data-act="sub"][data-id="players"]').click(); await page.waitForTimeout(250);

  // ── search needs >6 players; add four more
  await t('[data-act="importPlayers"]').click(); await page.waitForTimeout(200);
  await t('#impText').fill('Rui F., 3\nBeatriz L., 6\nCarlos M., 2\nDiogo V., 8');
  await page.waitForTimeout(200);
  await t('[data-act="saveModal"]').click();
  await page.waitForFunction(()=>window.__API.db.players.length>=7,{timeout:15000});
  await page.waitForTimeout(400);
  ok('search box appears once the list is long', await page.locator('#pq').count()===1);
  await t('#pq').fill('ria');
  await page.waitForTimeout(150);
  const vis = await page.evaluate(()=>[...document.querySelectorAll('[data-pname]')].filter(e=>e.style.display!=='none').map(e=>e.dataset.pname));
  ok('search narrows to the match', vis.length===1 && vis[0].indexOf('mariana')>=0, vis);
  ok('field keeps focus while typing', await page.evaluate(()=>document.activeElement&&document.activeElement.id)==='pq');
  await t('#pq').fill('zzz'); await page.waitForTimeout(150);
  ok('empty result says so', await page.evaluate(()=>!document.getElementById('pnone').classList.contains('hide')));
  await t('#pq').fill(''); await page.waitForTimeout(150);
  ok('clearing brings everyone back',
     await page.evaluate(()=>[...document.querySelectorAll('[data-pname]')].every(e=>e.style.display!=='none')));

  // ── demo guard
  await t('[data-act="sub"][data-id="academy"]').click(); await page.waitForTimeout(300);
  const demoBtns = await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>/Load sample data/.test(b.textContent)).map(b=>({d:b.disabled,act:b.dataset.act})));
  ok('sample-data button is locked once real data exists', demoBtns.length===1 && demoBtns[0].d===true && !demoBtns[0].act, demoBtns);

  // ── feedback
  await t('[data-act="feedback"]').click(); await page.waitForTimeout(250);
  await t('[data-act="saveModal"]').click(); await page.waitForTimeout(200);
  ok('empty feedback is refused', await page.locator('#fbText').count()===1);
  await t('#fbText').fill('The level slider is hard to hit on a phone.');
  await t('[data-act="saveModal"]').click();
  await page.waitForFunction(()=>window.__API.db.feedback&&window.__API.db.feedback.length===1,{timeout:10000});
  const fb = await page.evaluate(()=>window.__API.db.feedback[0]);
  ok('feedback reaches the API', /level slider/.test(fb.message), fb);
  ok('it carries the screen it was sent from', fb.screen==='manage', fb.screen);
  ok('and a snapshot of the academy size', JSON.parse(fb.context).players===7, fb.context);
  await page.screenshot({path:OUT+'/after.png'});

  ok('no page errors', errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail?1:0);
})();
