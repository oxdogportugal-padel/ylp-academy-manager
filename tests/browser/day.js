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
(async()=>{
  await new Promise(r=>srv.listen(8902,r));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());
  for (const w of [320,390,430]){
    const page=await b.newPage({viewport:{width:w,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await page.addInitScript({path:SCRATCH+'fakeapi.js'});
    await page.goto('http://localhost:8902/',{waitUntil:'load'}); await page.waitForTimeout(500);
    const t=s=>page.locator(s).first();
    await t('#bnav [data-id="manage"]').click(); await page.waitForTimeout(200);
    await t('[data-act="loadDemo"]').click(); await page.waitForTimeout(200);
    await t('[data-act="saveModal"]').click();
    await page.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
    await page.waitForTimeout(600);
    const tiles=await page.evaluate(()=>{const g=document.querySelector('.gset');return g?getComputedStyle(g).gridTemplateColumns:'none';});
    await t('#bnav [data-id="calendar"]').click(); await page.waitForTimeout(500);
    const ds=await page.evaluate(()=>{const e=document.querySelector('.daystrip');return e?{sw:e.scrollWidth,cw:e.clientWidth}:null;});
    console.log(w+'px  daystrip', JSON.stringify(ds), ds.sw<=ds.cw?'FITS':'CLIPPED', ' settings cols:', tiles);
    if(w===390) await page.screenshot({path:path.join(__dirname,'..','out','cal2.png')});
    await page.close();
  }
  await b.close(); srv.close();
})();
