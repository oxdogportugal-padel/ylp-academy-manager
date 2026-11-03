/* Phone tables: under 768px the waiting list and the Classes list render as
   one card per row, with every cell (edit/delete included) on screen.
   Above 768px they stay ordinary tables. */
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

/* Geometry of the visible table: header shown?, per-row card layout, and
   whether every action button sits fully inside the viewport. */
const measure=p=>p.evaluate(()=>{
  const tb=[...document.querySelectorAll('table.stack')].find(t=>t.offsetParent);
  if(!tb) return null;
  const vw=document.documentElement.clientWidth;
  const rows=[...tb.tBodies[0].rows];
  const btns=[...tb.querySelectorAll('td.acts .btn')].map(b=>b.getBoundingClientRect());
  return {
    rows:rows.length,
    theadShown:getComputedStyle(tb.tHead).display!=='none',
    rowDisplay:getComputedStyle(rows[0]).display,
    btns:btns.length,
    btnsOff:btns.filter(r=>r.left<0||r.right>vw+0.5).length,
    overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    labels:[...rows[0].cells].map(c=>c.dataset.label||null)
  };
});

(async()=>{
  await new Promise(r=>srv.listen(8931,r));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());
  const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.addInitScript({path:SCRATCH+'fakeapi.js'});
  await p.addInitScript(()=>{ window.__API.academy.name='The Hyve'; });
  await p.goto('http://localhost:8931/',{waitUntil:'load'}); await sleep(650);
  const t=s=>p.locator(s).first();

  await t('#bnav [data-id="manage"]').click(); await sleep(250);
  await t('[data-act="loadDemo"]').click(); await sleep(250);
  await t('[data-act="saveModal"]').click();
  await p.waitForFunction(()=>window.__API.db.classes.length>=9 && window.__API.db.requests.length>0,{timeout:20000}).catch(()=>{});
  await sleep(3300);

  // ── phone: waiting list
  await t('#bnav [data-id="waitlist"]').click(); await sleep(400);
  let m=await measure(p);
  ok('waiting list renders rows', m && m.rows>0, m);
  ok('waiting list: header row hidden on a phone', m && !m.theadShown, m);
  ok('waiting list: each row is a card, not a table row', m && m.rowDisplay==='block', m);
  ok('waiting list: every edit/delete button is on screen', m && m.btns===m.rows*2 && m.btnsOff===0, m);
  ok('waiting list: no sideways scroll', m && m.overflow<=0, m);
  ok('waiting list: data cells carry labels', m && m.labels.filter(Boolean).length===5, m);
  await p.screenshot({path:`${OUT}/tables-waitlist-phone.png`,fullPage:true});

  // ── phone: Manage → Classes
  await t('#bnav [data-id="manage"]').click(); await sleep(250);
  await t('[data-act="sub"][data-id="classes"]').click(); await sleep(400);
  m=await measure(p);
  ok('classes list renders rows', m && m.rows>=9, m);
  ok('classes: header row hidden on a phone', m && !m.theadShown, m);
  ok('classes: each row is a card', m && m.rowDisplay==='block', m);
  ok('classes: every players/edit/delete button is on screen', m && m.btns===m.rows*3 && m.btnsOff===0, m);
  ok('classes: no sideways scroll', m && m.overflow<=0, m);
  await p.screenshot({path:`${OUT}/tables-classes-phone.png`,fullPage:true});

  // edit still works from the card
  await t('table.stack [data-act="editClass"]').click(); await sleep(300);
  ok('edit from a card opens the class form', await p.locator('[data-act="saveModal"]').count()>0);

  // ── desktop: unchanged table
  /* resize, don't reload: a reload resets the fake API and empties the data */
  await p.keyboard.press('Escape'); await t('[data-act="closeModal"]').click().catch(()=>{}); await sleep(200);
  await p.setViewportSize({width:1280,height:900}); await sleep(400);
  await p.screenshot({path:`${OUT}/tables-classes-desktop.png`});
  m=await measure(p);
  ok('desktop: classes is still a table with its header', m && m.theadShown && m.rowDisplay==='table-row', m);

  ok('no page errors', errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail?1:0);
})();
