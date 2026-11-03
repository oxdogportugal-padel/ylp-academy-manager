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
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x!==undefined?'  → '+JSON.stringify(x):''));} };

(async()=>{
  await new Promise(r=>srv.listen(8921,r));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.addInitScript({path:SCRATCH+'fakeapi.js'});
  await p.addInitScript(()=>{ window.__API.academy.name='The Hyve'; });
  await p.goto('http://localhost:8921/',{waitUntil:'load'}); await sleep(650);
  const t=s=>p.locator(s).first();

  await t('#bnav [data-id="manage"]').click(); await sleep(250);
  await t('[data-act="loadDemo"]').click(); await sleep(250);
  await t('[data-act="saveModal"]').click();
  await p.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
  await sleep(3400);

  // Monday 18:30 Level 3 with Nina Hart
  await t('#bnav [data-id="calendar"]').click(); await sleep(450);
  const before = await p.evaluate(()=>{
    const c=window.__API.db.classes.find(c=>c.day===0&&c.start==='18:30');
    return {id:c.id, day:c.day, start:c.start, coachId:c.coachId};
  });
  await p.locator('.daycard', { hasText:'18:30' }).first().click(); await sleep(400);
  ok('class detail offers Move to…', await p.locator('[data-act="moveClass"]').count()===1);

  await t('[data-act="moveClass"]').click(); await sleep(450);
  await p.screenshot({path:OUT+'/picker.png'});

  const vis = await p.evaluate(()=>{
    const box=document.getElementById('modalBox');
    const foot=box.querySelector('.mfoot');
    const chips=[...document.querySelectorAll('[data-act="moveTo"]')];
    if(!chips.length) return {n:0};
    const fr=foot.getBoundingClientRect();
    return {n:chips.length, hidden: chips.filter(c=>c.getBoundingClientRect().bottom>fr.top+1).length};
  });
  ok('time chips are fully visible, not under the footer', vis.n>0 && vis.hidden===0, vis);
  ok('the day offers a handful of house times, not every half hour', vis.n>0 && vis.n<=8, vis);

  const days = await p.evaluate(()=>[...document.querySelectorAll('[data-act="moveDay"]')]
    .map(b=>({d:b.dataset.id, n:+b.querySelector('b').textContent, off:b.disabled})));
  ok('a day chip per weekday', days.length===7, days.length);
  ok('each chip carries a free-slot count', days.every(d=>Number.isFinite(d.n)), days);
  ok('days with no room are disabled', days.every(d=>d.off === (d.n===0)), days);

  // every offered slot must actually be legal
  const verdicts = await p.evaluate(()=>{
    const slots=[...document.querySelectorAll('[data-act="moveTo"]')].map(b=>b.dataset.t);
    return slots.map(t=>({t, problems: window.__probe ? window.__probe(t) : null}));
  });
  ok('the current day offers slots', verdicts.length>0, verdicts.length);
  ok('its own current time is not offered', !verdicts.some(v=>v.t===before.start), verdicts.map(v=>v.t));

  // a slot that collides with Nina's other Monday class must be absent
  const clash = await p.evaluate(()=>{
    const c=window.__API.db.classes.find(c=>c.day===0&&c.start==='18:30');
    const other=window.__API.db.classes.filter(x=>x.day===0&&x.coachId===c.coachId&&x.id!==c.id);
    return other.map(o=>o.start);
  });
  const offered = verdicts.map(v=>v.t);
  ok('slots clashing with the same coach are withheld',
     clash.every(s=>offered.indexOf(s)<0), {clash, offered});

  // move it to another day
  await t('[data-act="moveDay"][data-id="4"]').click(); await sleep(400);
  const friSlots = await p.evaluate(()=>[...document.querySelectorAll('[data-act="moveTo"]')].map(b=>b.dataset.t));
  ok('switching day reloads that day\'s slots', friSlots.length>0, friSlots.length);

  const target=friSlots[Math.floor(friSlots.length/2)];
  await p.locator(`[data-act="moveTo"][data-t="${target}"]`).first().click();
  await p.waitForFunction(id=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(id)); return c && c.day===4;
  }, before.id, {timeout:10000});
  const after = await p.evaluate(id=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(id)); return {day:c.day,start:c.start};
  }, before.id);
  ok('the class is written to the new slot', after.day===4 && after.start===target, after);
  ok('the calendar follows it to that day', await p.evaluate(()=>{
    const on=document.querySelector('.daystrip button.on'); return on && on.textContent.indexOf('Fri')>=0;
  }));
  await sleep(300);
  await p.screenshot({path:OUT+'/moved.png'});

  // undo
  ok('the toast offers Undo', await p.locator('.toast .tundo').count()===1);
  await p.locator('.toast .tundo').click();
  await p.waitForFunction(id=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(id)); return c && c.day===0;
  }, before.id, {timeout:10000});
  const undone = await p.evaluate(id=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(id)); return {day:c.day,start:c.start};
  }, before.id);
  ok('Undo puts it back exactly', undone.day===before.day && undone.start===before.start, {before,undone});

  ok('no page errors', errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail?1:0);
})();
