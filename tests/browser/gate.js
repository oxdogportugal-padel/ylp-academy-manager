/* Sign-in gate, shared login with the operator console, per-academy language
   and the first-login tour. */
const { chromium } = require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const SCRATCH=path.join(__dirname,'..','fake')+path.sep;
const root=process.env.APP_DIR||path.join(__dirname,'..','..','client');
const OUT=path.join(__dirname,'..','out'); fs.mkdirSync(OUT,{recursive:true});
const PORT=8941, BASE=`http://localhost:${PORT}`;
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

/* English keys whose translation differs, to catch strings that escaped t(). */
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const I18N=Function('return '+html.match(/var I18N=(\{[\s\S]*?\n\});/)[1])();

let browser;
/* A fresh page whose fake API is set up by `setup` before the app boots. */
async function page(setup, opts={}){
  const ctx=await browser.newContext(Object.assign({viewport:{width:1280,height:900}},opts));
  const p=await ctx.newPage();
  p.errs=[]; p.on('pageerror',e=>p.errs.push(String(e)));
  await p.addInitScript({path:SCRATCH+'fakeapi.js'});
  if(setup) await p.addInitScript(setup);
  return p;
}
const shown=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s); return !!e && getComputedStyle(e).display!=='none' && e.getBoundingClientRect().height>0;},sel);

(async()=>{
  await new Promise(r=>srv.listen(PORT,r));
  browser=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}).catch(()=>chromium.launch());

  console.log('\nsigned out: the sign-in screen and nothing else');
  let p=await page(()=>{ window.__API.mode.signedIn=false; },{locale:'pt-PT'});
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(700);
  ok('sign-in box is shown', await shown(p,'#login-container'));
  ok('the planner header is not', !(await shown(p,'header.top')));
  ok('the planner body is not', !(await shown(p,'main')));
  ok('the tab bar is not', !(await shown(p,'#bnav')));
  ok('no academy data was requested', !(await p.evaluate(()=>window.__API.calls.includes('data'))));
  ok('a Portuguese browser gets Portuguese', /Entrar/.test(await p.locator('#gate h2').innerText()));
  ok('sign-in returns to the planner', (await p.evaluate(()=>window.__API.mode.signInCalls[0].redirect)).endsWith('/'));
  await p.screenshot({path:`${OUT}/gate-login.png`});
  await p.locator('.glangs [data-id="es"]').click(); await sleep(200);
  ok('the language can be switched before sign-in', /Iniciar sesión/.test(await p.locator('#gate h2').innerText()));
  ok('html lang follows', await p.evaluate(()=>document.documentElement.lang)==='es');
  await p.context().close();

  p=await page(()=>{ window.__API.mode.signedIn=false; },{locale:'fr-FR'});
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(600);
  ok('a French browser gets French', /Se connecter/.test(await p.locator('#gate h2').innerText()));
  await p.context().close();

  console.log('\nthe operator console has no sign-in of its own');
  p=await page(()=>{ window.__API.mode.signedIn=false; });
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await p.waitForURL(/\?next=admin/,{timeout:8000}).catch(()=>{});
  ok('signed out, /admin goes to the shared sign-in', /\/\?next=admin$/.test(p.url()), p.url());
  await sleep(500);
  ok('that sign-in brings them back to the console',
    (await p.evaluate(()=>window.__API.mode.signInCalls[0].redirect)).endsWith('/?next=admin'));
  await p.context().close();

  p=await page(()=>{ window.__API.mode.operator=false; });
  await p.goto(BASE+'/admin.html',{waitUntil:'load'});
  await p.waitForURL(u=>!/admin/.test(String(u)),{timeout:8000}).catch(()=>{});
  ok('a signed-in non-operator is sent to the planner', !/admin/.test(p.url()), p.url());
  await p.context().close();

  p=await page(()=>{ window.__API.mode.operator=true; window.__API.mode.noAcademy=true;
    window.__API.mode.admin=function(path,body,respond){
      if(path==='admin/academies') return respond(200,{academies:(window.__saved||[]),users:[]});
      if(path==='admin/academy'){ window.__lastAcademy=body.academy;
        (window.__saved=window.__saved||[]).push(Object.assign({id:'9',clubsUsed:0,ownerEmail:body.academy.ownerEmail},body.academy));
        return respond(200,{id:'9',invited:true,owner:body.academy.ownerEmail}); }
      return respond(404,{error:'?'}); }; });
  await p.goto(BASE+'/?next=admin',{waitUntil:'load'});
  await p.waitForURL(/admin\.html/,{timeout:8000}).catch(()=>{});
  ok('an operator signing in with next=admin lands on the console', /admin\.html$/.test(p.url()), p.url());
  await sleep(700);
  ok('the console shows once the operator is confirmed', await shown(p,'header.top'));
  await p.locator('[data-act="newAcademy"]').click(); await sleep(200);
  const langs=await p.$$eval('#aLang option',o=>o.map(x=>x.value));
  ok('creating an academy offers the four languages', JSON.stringify(langs)==='["pt","es","fr","en"]', langs);
  ok('Portuguese is preselected', await p.$eval('#aLang',e=>e.value)==='pt');
  await p.fill('#aName','Padel Sevilla'); await p.fill('#aOwner','owner@sevilla.es');
  await p.selectOption('#aLang','es');
  await p.screenshot({path:`${OUT}/admin-new-academy.png`});
  await p.locator('[data-act="saveModal"]').click(); await sleep(500);
  ok('the chosen language is sent', await p.evaluate(()=>window.__lastAcademy&&window.__lastAcademy.language)==='es');
  ok('the academy card shows it', /ES/.test(await p.locator('.langchip').first().innerText()));
  ok('no page errors in the console', p.errs.length===0, p.errs);
  await p.context().close();

  console.log('\nsigned in: the academy language rules');
  for (const [lang,word,day] of [['pt','Calendário','Seg'],['es','Calendario','Lun'],['fr','Calendrier','Lun'],['en','Calendar','Mon']]) {
    p=await page(`window.__API.academy.language=${JSON.stringify(lang)};`);
    await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(700);
    const tabs=await p.locator('#tabs').innerText();
    ok(`${lang}: tabs in ${lang}`, tabs.includes(word), tabs);
    ok(`${lang}: <html lang>`, await p.evaluate(()=>document.documentElement.lang)===lang);
    if(lang==='pt'){
      ok('the planner is open once signed in', await shown(p,'header.top') && !(await shown(p,'#gate')));
      await p.locator('#tabs [data-id="manage"]').click(); await sleep(150);
      await p.locator('[data-act="loadDemo"]').first().click(); await sleep(150);
      await p.locator('[data-act="saveModal"]').click();
      await p.waitForFunction(()=>window.__API.db.classes.length>=9,{timeout:20000}).catch(()=>{});
      await sleep(3300);
      /* walk every screen and look for English that should have been translated */
      const leaks=new Set();
      const screens=[['calendar'],['place'],['waitlist'],['manage','academy'],['manage','venues'],['manage','coaches'],['manage','players'],['manage','classes']];
      for(const [v,sub] of screens){
        await p.locator(`#tabs [data-id="${v}"]`).click(); await sleep(150);
        if(sub){ await p.locator(`[data-act="sub"][data-id="${sub}"]`).click(); await sleep(150); }
        const texts=await p.evaluate(()=>{const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
          let n; while((n=w.nextNode())){ const s=n.textContent.replace(/\s+/g,' ').trim(); if(s&&n.parentElement.offsetParent!==null) out.push(s);} 
          document.querySelectorAll('[placeholder],[title],[aria-label],[data-label]').forEach(e=>['placeholder','title','aria-label','data-label'].forEach(a=>{const v=e.getAttribute(a); if(v) out.push(v.trim());}));
          return out;});
        texts.forEach(s=>{ if(I18N.pt[s] && I18N.pt[s]!==s) leaks.add(s); });
      }
      await p.locator('#tabs [data-id="calendar"]').click(); await sleep(150);
      await p.locator('.ev').first().click(); await sleep(250);
      (await p.locator('#modalBox').innerText()).split('\n').map(s=>s.trim()).forEach(s=>{ if(I18N.pt[s]&&I18N.pt[s]!==s) leaks.add(s); });
      await p.screenshot({path:`${OUT}/pt-class.png`});
      ok('no English left on any Portuguese screen', leaks.size===0, [...leaks]);
      ok('day names are Portuguese', /Seg/.test(await p.locator('.calhead').innerText()));
      ok('no page errors', p.errs.length===0, p.errs);
    }
    await p.context().close();
  }

  console.log('\nfirst-login tour');
  p=await page(()=>{ window.__API.academy.language='pt'; window.__API.academy.tutorialDone=false; });
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(800);
  ok('the tour opens on first sign-in', await shown(p,'.tcard'));
  ok('it starts with a welcome', /Bem-vindo/.test(await p.locator('.tcard').innerText()));
  await p.screenshot({path:`${OUT}/tour-1.png`});
  const seen=[];
  for(let i=0;i<5;i++){
    await p.locator('#tourNext').click(); await sleep(200);
    seen.push(await p.evaluate(()=>({view:(document.querySelector('#tabs .on')||{}).dataset.id,
      hi:(document.querySelector('#tabs .tourhi')||{dataset:{}}).dataset.id,
      title:document.querySelector('#tourTitle').textContent})));
    if(i===0) await p.screenshot({path:`${OUT}/tour-2.png`});
  }
  ok('each step brings up its own screen', seen.slice(0,4).map(x=>x.view).join()==='calendar,place,waitlist,manage', seen);
  ok('and marks its tab', seen.slice(0,4).every(x=>x.hi===x.view), seen);
  ok('the last step says how to begin', /Pronto/.test(seen[4].title), seen[4]);
  await p.locator('#tourNext').click(); await sleep(300);
  ok('finishing closes it', !(await shown(p,'.tcard')));
  ok('finishing is recorded on the server', await p.evaluate(()=>window.__API.calls.includes('tutorial')&&window.__API.academy.tutorialDone===true));
  ok('it ends on Manage, where the checklist is', await p.evaluate(()=>document.querySelector('#tabs .on').dataset.id)==='manage');
  await p.locator('[data-act="tourStart"]').click(); await sleep(250);
  ok('it can be replayed from Manage', await shown(p,'.tcard'));
  await p.keyboard.press('Escape'); await sleep(200);
  ok('Escape skips it', !(await shown(p,'.tcard')));
  await p.reload({waitUntil:'load'}); await sleep(800);
  ok('it does not come back once done', !(await shown(p,'.tcard')));
  ok('no page errors', p.errs.length===0, p.errs);
  await p.context().close();

  p=await page(()=>{ window.__API.academy.language='pt'; window.__API.academy.tutorialDone=false; },{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(800);
  await p.locator('#tourNext').click(); await sleep(200);
  const geo=await p.evaluate(()=>{const c=document.querySelector('.tcard').getBoundingClientRect(), n=document.querySelector('#bnav').getBoundingClientRect();
    return {cardBottom:c.bottom,navTop:n.top,left:c.left,right:c.right,vw:innerWidth,hi:(document.querySelector('#bnav .tourhi')||{dataset:{}}).dataset.id};});
  ok('on a phone the card sits above the tab bar', geo.cardBottom<=geo.navTop, geo);
  ok('and inside the screen', geo.left>=0&&geo.right<=geo.vw, geo);
  ok('the bottom tab is marked', geo.hi==='calendar', geo);
  await p.screenshot({path:`${OUT}/tour-phone.png`});
  await p.context().close();

  console.log('\nrefusals stay behind the gate');
  p=await page(()=>{ window.__API.mode.noAcademy=true; window.__API.academy.language='pt'; });
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(700);
  ok('an account with no academy gets a sentence, not a planner', await shown(p,'#gate') && !(await shown(p,'header.top')));
  await p.context().close();
  p=await page(()=>{ window.__API.mode.status=403; window.__API.mode.code='suspended'; });
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(700);
  ok('a suspended academy likewise', await shown(p,'#gate') && !(await shown(p,'header.top')));
  await p.context().close();

  console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); srv.close(); process.exit(fail?1:0);
})();
