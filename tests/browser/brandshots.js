const { chromium } = require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const SCRATCH=path.join(__dirname,'..','fake')+path.sep;
const root=process.env.APP_DIR||path.join(__dirname,'..','..','client');
const OUT=path.join(__dirname,'..','out'); fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const srv=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];
  if(url==='/__catalyst/sdk/init.js'){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end('/*stub*/');}
  const f=path.join(root,url==='/'?'index.html':url);
  if(!fs.existsSync(f)){res.writeHead(404);return res.end('nope');}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(f));
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errs=[];

(async()=>{
  await new Promise(r=>srv.listen(8911,r));
  const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());

  const phone=async(initFns)=>{
    const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
    p.on('pageerror',e=>errs.push(String(e)));
    await p.addInitScript({path:SCRATCH+'fakeapi.js'});
    for(const fn of (initFns||[])) await p.addInitScript(fn);
    await p.goto('http://localhost:8911/',{waitUntil:'load'}); await sleep(650);
    return p;
  };

  // 1 — the sign-in screen: make the fake SDK report "not authenticated"
  let p=await phone([()=>{
    window.__API.academy.name='The Hyve';
    const iv=setInterval(()=>{
      if(window.catalyst&&window.catalyst.auth){
        clearInterval(iv);
        window.catalyst.auth.isUserAuthenticated=()=>Promise.reject({status:401});
        window.catalyst.auth.signIn=(id)=>{
          const el=document.getElementById(id); if(!el) return;
          el.innerHTML='<label style="display:block;font-size:12px;color:var(--ink2);margin-bottom:4px">Email</label>'+
            '<input class="inp" value="treinador@thehyve.pt" style="margin-bottom:12px">'+
            '<label style="display:block;font-size:12px;color:var(--ink2);margin-bottom:4px">Password</label>'+
            '<input class="inp" type="password" value="123456789" style="margin-bottom:16px">'+
            '<button class="btn honey" style="width:100%;justify-content:center">Sign in</button>';
        };
      }
    },20);
  }]);
  await sleep(1400);
  await p.screenshot({path:OUT+'/1-signin.png'});
  await p.close();

  // seeded academy for the in-app screens
  p=await phone([()=>{ window.__API.academy.name='The Hyve'; }]);
  const t=s=>p.locator(s).first();
  await t('#bnav [data-id="manage"]').click(); await sleep(250);
  await t('[data-act="loadDemo"]').click(); await sleep(250);
  await t('[data-act="saveModal"]').click();
  await p.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
  await sleep(3400);

  await t('#bnav [data-id="calendar"]').click(); await sleep(500);
  await p.screenshot({path:OUT+'/2-calendar.png'});

  await t('#bnav [data-id="manage"]').click(); await sleep(500);
  await p.evaluate(()=>scrollTo(0,document.body.scrollHeight));
  await sleep(350);
  await p.screenshot({path:OUT+'/3-manage.png'});

  const geo=await p.evaluate(()=>{
    const h=document.querySelector('header.top').getBoundingClientRect();
    const m=document.querySelector('.hmark');
    return { headerH:Math.round(h.height), markVisible: !!(m && m.getBoundingClientRect().width>0),
             markRight: m?Math.round(m.getBoundingClientRect().right):null, vw:innerWidth };
  });
  console.log('phone header height:',geo.headerH,'| quiet mark visible:',geo.markVisible,'| flush right:',geo.markRight,'of',geo.vw);
  await p.close();

  // 4 — desktop header, where the full wordmark shows
  const d=await b.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});
  d.on('pageerror',e=>errs.push(String(e)));
  await d.addInitScript({path:SCRATCH+'fakeapi.js'});
  await d.addInitScript(()=>{ window.__API.academy.name='The Hyve'; });
  await d.goto('http://localhost:8911/',{waitUntil:'load'}); await sleep(650);
  await d.locator('[data-act="loadDemo"]').first().click(); await sleep(250);
  await d.locator('[data-act="saveModal"]').first().click();
  await d.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
  await sleep(3400);
  await d.locator('[data-act="tab"][data-id="calendar"]').first().click(); await sleep(500);
  await d.screenshot({path:OUT+'/4-desktop.png', clip:{x:0,y:0,width:1280,height:620}});
  const dm=await d.evaluate(()=>{
    const e=document.querySelector('.brand');
    return e? {shown:getComputedStyle(e).display, text:e.innerText.replace(/\s+/g,' ').trim()} : null;
  });
  console.log('desktop lockup:', JSON.stringify(dm));
  await d.close();

  console.log('page errors:', errs.length?errs:'none');
  await b.close(); srv.close();
})();
