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
  await new Promise(r=>srv.listen(8922,r));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());
  const p=await b.newPage({viewport:{width:1400,height:1000},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.addInitScript({path:SCRATCH+'fakeapi.js'});
  await p.addInitScript(()=>{ window.__API.academy.name='The Hyve'; });
  await p.goto('http://localhost:8922/',{waitUntil:'load'}); await sleep(650);

  await p.locator('[data-act="loadDemo"]').first().click(); await sleep(250);
  await p.locator('[data-act="saveModal"]').first().click();
  await p.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
  await sleep(3400);
  await p.locator('[data-act="tab"][data-id="calendar"]').first().click(); await sleep(600);

  const idOf = async (day,start)=>p.evaluate(([d,s])=>{
    const c=window.__API.db.classes.find(c=>c.day===d&&c.start===s); return c?String(c.id):null;
  },[day,start]);
  const stateOf = async id=>p.evaluate(i=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(i)); return c?{day:c.day,start:c.start}:null;
  },id);

  // ── 1. a plain click still opens the class, it is not swallowed by the drag code
  const monId = await idOf(0,'10:00');
  await p.locator(`.ev[data-id="${monId}"]`).click(); await sleep(400);
  ok('a click on a block still opens it', await p.locator('.mhead h3').count()===1);
  await p.locator('[data-act="closeModal"]').first().click(); await sleep(300);

  // ── 2. drag it down two rows (one hour) on the same day
  const blk = p.locator(`.ev[data-id="${monId}"]`);
  let box = await blk.boundingBox();
  await p.mouse.move(box.x+box.width/2, box.y+8);
  await p.mouse.down();
  await p.mouse.move(box.x+box.width/2, box.y+8+44, {steps:8});
  await sleep(120);
  ok('a drag tip shows the target slot', await p.locator('#dragTip').count()===1,
     await p.locator('#dragTip').textContent().catch(()=>null));
  ok('the block is marked as dragging', await p.locator('.ev.dragging').count()===1);
  await p.screenshot({path:OUT+'/dragging.png', clip:{x:0,y:0,width:1400,height:700}});
  await p.mouse.up();
  await p.waitForFunction(i=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(i)); return c && c.start==='11:00';
  }, monId, {timeout:10000});
  ok('dropping one hour later rewrites the start', (await stateOf(monId)).start==='11:00', await stateOf(monId));
  ok('the drag tip is cleared on drop', await p.locator('#dragTip').count()===0);
  ok('dropping does not also open the class', await p.locator('.mhead h3').count()===0);

  // ── 3. undo returns it
  ok('a drop offers Undo', await p.locator('.toast .tundo').count()===1);
  await p.locator('.toast .tundo').click();
  await p.waitForFunction(i=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(i)); return c && c.start==='10:00';
  }, monId, {timeout:10000});
  ok('Undo restores the original time', (await stateOf(monId)).start==='10:00');
  await sleep(400);

  // ── 4. drag across to another day
  box = await (p.locator(`.ev[data-id="${monId}"]`)).boundingBox();
  const cols = await p.evaluate(()=>[...document.querySelectorAll('.calbody .daycol')]
    .map(c=>{const r=c.getBoundingClientRect();return {left:r.left,width:r.width};}));
  await p.mouse.move(box.x+box.width/2, box.y+8);
  await p.mouse.down();
  await p.mouse.move(cols[2].left+cols[2].width/2, box.y+8, {steps:10});
  await sleep(120);
  await p.mouse.up();
  await p.waitForFunction(i=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(i)); return c && c.day===2;
  }, monId, {timeout:10000});
  const moved = await stateOf(monId);
  ok('dragging sideways changes the day and keeps the time', moved.day===2 && moved.start==='10:00', moved);
  await p.screenshot({path:OUT+'/dropped.png', clip:{x:0,y:0,width:1400,height:700}});

  // ── 5. an impossible drop is refused and reverted
  const nina = await idOf(0,'18:30');          // Nina Hart, Monday 18:30
  const clashTarget = await p.evaluate(i=>{
    const c=window.__API.db.classes.find(c=>String(c.id)===String(i));
    const other=window.__API.db.classes.find(x=>x.coachId===c.coachId&&x.id!==c.id&&x.day===2);
    return other?{day:other.day,start:other.start}:null;
  }, nina);
  if(clashTarget){
    const nb = await (p.locator(`.ev[data-id="${nina}"]`)).boundingBox();
    const slot=(( (+clashTarget.start.split(':')[0])*60 + (+clashTarget.start.split(':')[1]) ) - 8*60)/30;
    const gridTop = await p.evaluate(()=>document.querySelector('.calbody .daycol').getBoundingClientRect().top);
    await p.mouse.move(nb.x+nb.width/2, nb.y+8);
    await p.mouse.down();
    await p.mouse.move(cols[clashTarget.day].left+cols[clashTarget.day].width/2, gridTop+slot*22+8, {steps:10});
    await sleep(120);
    await p.mouse.up(); await sleep(500);
    const after = await stateOf(nina);
    ok('a drop onto the same coach is refused', after.day===0 && after.start==='18:30', {after, clashTarget});
    const msg = await p.locator('.toast').textContent().catch(()=>'');
    ok('and says why', /teaches|courts|booked/i.test(msg), msg);
  } else { ok('clash case set up', false, 'no same-coach class on Wed'); }

  ok('no page errors', errs.length===0, errs);
  console.log(`${pass} passed, ${fail} failed`);
  await b.close(); srv.close(); process.exit(fail?1:0);
})();
