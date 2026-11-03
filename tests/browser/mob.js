const { chromium } = require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const SCRATCH=path.join(__dirname,'..','fake')+path.sep;
const root=process.env.APP_DIR||path.join(__dirname,'..','..','client');
const OUT=path.join(__dirname,'..','out');
fs.mkdirSync(OUT,{recursive:true});

const srv=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];
  if(url==='/__catalyst/sdk/init.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end('/*stub*/');}
  const f=path.join(root,url==='/'?'index.html':url);
  if(!fs.existsSync(f)){res.writeHead(404);return res.end('nope');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(fs.readFileSync(f));
});

(async()=>{
  await new Promise(r=>srv.listen(8901,r));
  const browser=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
  await page.addInitScript({path:SCRATCH+'fakeapi.js'});
  await page.addInitScript(()=>{ window.__API.academy.name='Riverside Padel Academy'; });
  await page.goto('http://localhost:8901/',{waitUntil:'load'});
  await page.waitForTimeout(600);
  const t=s=>page.locator(s).first();

  await t('#bnav [data-id="manage"]').click(); await page.waitForTimeout(200);
  await t('[data-act="loadDemo"]').click(); await page.waitForTimeout(200);
  await t('[data-act="saveModal"]').click();
  await page.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(3300);

  // header height + whether all four tabs are inside the viewport
  const geo=await page.evaluate(()=>{
    const h=document.querySelector('header.top').getBoundingClientRect();
    const bs=[...document.querySelectorAll('#bnav button')].map(b=>{
      const r=b.getBoundingClientRect();
      return {label:b.textContent.trim(),x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right)};
    });
    return {headerH:Math.round(h.height), vw:innerWidth, vh:innerHeight, tabs:bs,
            navTop:Math.round(document.querySelector('#bnav').getBoundingClientRect().top)};
  });
  console.log(JSON.stringify(geo,null,1));
  console.log('all tabs within viewport:', geo.tabs.every(b=>b.x>=0 && b.right<=geo.vw));
  console.log('tap target >=44px tall:', geo.tabs.every(b=>b.h>=44));

  for (const id of ['calendar','place','waitlist','manage']){
    await t(`#bnav [data-id="${id}"]`).click(); await page.waitForTimeout(450);
    await page.screenshot({path:`${OUT}/${id}.png`});
    // nothing should scroll sideways
    const ox=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    console.log(id,'horizontal overflow px:',ox);
  }
  // content must not hide behind the bar
  await t('#bnav [data-id="calendar"]').click(); await page.waitForTimeout(300);
  await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.screenshot({path:`${OUT}/calendar-bottom.png`});

  console.log('page errors:',errs.length?errs:'none');
  await browser.close(); srv.close();
})();
