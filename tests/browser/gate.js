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
  let f=path.join(root,url==='/'?'index.html':url);
  if(url!=='/'&&url.endsWith('/')) f=path.join(f,'index.html');
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
  ok('a Portuguese browser gets Portuguese', /Uma única entrada/.test(await p.locator('.glead').innerText()));
  const fr=await p.evaluate(()=>{const f=document.querySelector('#login-container iframe'), c=document.querySelector('.glogin');
    const r=f.getBoundingClientRect(), cr=c.getBoundingClientRect();
    return {h:Math.round(r.height), w:Math.round(r.width), cw:Math.round(cr.width), bg:getComputedStyle(c).backgroundColor,
            titles:[...document.querySelectorAll('#gate h2')].filter(h=>h.getBoundingClientRect().width>1).length};});
  ok('the sign-in frame is tall enough for the whole form', fr.h>=480, fr);
  ok('and as wide as its card', fr.w===fr.cw, fr);
  ok('the card is white, like the form inside it', fr.bg==='rgb(255, 255, 255)', fr);
  ok('only Zoho\'s own heading is visible, not a second one', fr.titles===0, fr);
  ok('sign-in returns to the planner', (await p.evaluate(()=>window.__API.mode.signInCalls[0].redirect)).endsWith('/'));
  await p.screenshot({path:`${OUT}/gate-login.png`});
  await p.locator('.glangs [data-id="es"]').click(); await sleep(200);
  ok('the language can be switched before sign-in', /Un único acceso/.test(await p.locator('.glead').innerText()));
  ok('html lang follows', await p.evaluate(()=>document.documentElement.lang)==='es');
  await p.context().close();

  p=await page(()=>{ window.__API.mode.signedIn=false; },{locale:'fr-FR'});
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(600);
  ok('a French browser gets French', /Une seule connexion/.test(await p.locator('.glead').innerText()));
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

  console.log('\nafter sign-in Catalyst lands on /app/');
  p=await page(()=>{ window.__API.mode.signedIn=!!sessionStorage.getItem('fake.signedin');
    window.__API.mode.operator=true; window.__API.mode.noAcademy=false;
    window.__API.mode.admin=function(path,body,respond){ return respond(200,{academies:[],users:[]}); }; });
  await p.goto(BASE+'/?next=admin',{waitUntil:'load'}); await sleep(500);
  ok('signed out, the sign-in page shows', await shown(p,'#login-container'));
  await p.evaluate(()=>sessionStorage.setItem('fake.signedin','1'));   /* the user signs in… */
  await p.goto(BASE+'/app/',{waitUntil:'load'});                        /* …and Catalyst sends them here */
  await p.waitForURL(/admin\.html/,{timeout:8000}).catch(()=>{});
  ok('/app/ forwards to the planner, which sends the operator on to the console', /admin\.html$/.test(p.url()), p.url());
  await p.context().close();
  p=await page(()=>{ window.__API.academy.language='pt'; });
  await p.goto(BASE+'/app/',{waitUntil:'load'}); await sleep(900);
  ok('a coordinator landing on /app/ gets the planner', !/\/app\//.test(p.url()) && await shown(p,'header.top'), p.url());
  await p.context().close();

  console.log('\nsign out is always in reach');
  for (const [label,vp] of [['computer',{viewport:{width:1280,height:900}}],['phone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]) {
    p=await page(()=>{ window.__API.academy.language='pt'; }, vp);
    await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(800);
    const b=await p.evaluate(()=>{const e=document.querySelector('#signOutBtn'); const r=e.getBoundingClientRect();
      return {w:r.width,h:r.height,top:r.top,right:r.right,vw:innerWidth,label:e.getAttribute('aria-label'),
              inHeader:!!e.closest('header.top'),
              overlaps:[...document.querySelectorAll('.stat,.acadname > span:not(.grow)')].some(s=>{const q=s.getBoundingClientRect();
                return q.width>0&&!(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom);})};});
    ok(`${label}: a sign-out button is in the header`, b.inHeader && b.w>0 && b.top<120 && b.right<=b.vw, b);
    ok(`${label}: it is labelled in the academy's language`, b.label==='Sair', b);
    ok(`${label}: it is big enough to tap`, b.h>=34, b);
    ok(`${label}: it covers nothing else in the header`, !b.overlaps, b);
    await p.locator('#signOutBtn').click(); await sleep(150);
    ok(`${label}: it signs out back to the sign-in page`, (await p.evaluate(()=>window.__API.mode.signedOutTo||'')).endsWith('/'));
    if(label==='phone') await p.screenshot({path:`${OUT}/signout-phone.png`});
    await p.context().close();
  }

  console.log('\nan operator opens an academy from the console');
  p=await page(()=>{ window.__API.mode.operator=true; window.__API.mode.noAcademy=true;
    window.__API.academy.language='pt'; window.__API.academy.tutorialDone=false; });
  await p.goto(BASE+'/?academy=777',{waitUntil:'load'}); await sleep(900);
  ok('the planner opens instead of the console', !/admin/.test(p.url()) && await shown(p,'header.top'), p.url());
  ok('every request names the academy', await p.evaluate(()=>(window.__API.mode.asSeen||[]).includes('data')&&(window.__API.mode.asSeen||[]).includes('session')));
  ok('a strip says it is an operator view', await shown(p,'#opbar') && /operador/.test(await p.locator('#opbar').innerText()));
  ok('the tour stays out of the way', !(await shown(p,'.tcard')));
  await p.screenshot({path:`${OUT}/operator-view.png`});
  await p.reload({waitUntil:'load'}); await sleep(800);
  ok('a reload stays in that academy', await shown(p,'#opbar'));
  await p.locator('#opbar [data-act="backToConsole"]').click();
  await p.waitForURL(/admin\.html/,{timeout:8000}).catch(()=>{});
  ok('"Back to console" returns to the console', /admin\.html$/.test(p.url()), p.url());
  ok('and forgets the academy', await p.evaluate(()=>sessionStorage.getItem('bandeja.as'))===null);
  await p.context().close();

  p=await page(()=>{ window.__API.mode.operator=true; window.__API.mode.noAcademy=true;
    window.__API.mode.admin=function(path,body,respond){
      if(path==='admin/academies') return respond(200,{academies:[{id:'777',name:'Test Academy',plan:'TRIAL',maxClubs:1,maxUsers:3,clubsUsed:0,language:'pt',ownerEmail:'o@t.pt'}],
        users:[{id:'55',academyId:'777',email:'o@t.pt',name:'Owner',role:'owner',status:'invited'}]});
      if(path==='admin/user/resend'){ window.__resent=body.id; return respond(200,{ok:true,sent:'invite',email:'o@t.pt'}); }
      return respond(404,{error:'?'}); }; });
  await p.goto(BASE+'/admin.html',{waitUntil:'load'}); await sleep(900);
  ok('each academy card has "Open planner" for that academy', await p.$eval('a[href*="academy="]',a=>a.getAttribute('href'))==='./?academy=777');
  await p.locator('[data-act="users"]').click(); await sleep(200);
  await p.locator('[data-act="resendInvite"]').click(); await sleep(400);
  ok('Resend calls the API for that user', await p.evaluate(()=>window.__resent)==='55');
  ok('and says what was sent', /New invitation sent to o@t\.pt/.test(await p.locator('#toastEl').innerText()));
  await p.screenshot({path:`${OUT}/admin-resend.png`});
  ok('no page errors in the console', p.errs.length===0, p.errs);
  await p.context().close();

  console.log('\ncoaches and viewers get a read-only planner');
  p=await page(()=>{ window.__API.academy.language='pt'; window.__API.mode.role='viewer';
    const D=window.__API.db;
    D.venues.push({id:'1',name:'Riverside',courts:2}); D.coaches.push({id:'2',name:'Alex Reed',certLevel:3,venueIds:['1']});
    D.players.push({id:'3',name:'A. Silva',level:3});
    D.classes.push({id:'4',venueId:'1',coachId:'2',day:0,start:'18:00',duration:90,level:3,capacity:null,playerIds:['3']});
    D.requests.push({id:'5',name:'B. Costa',level:3,venueId:'1',sessions:1,windows:[{day:1,from:'18:00',to:'21:00'}],placed:[]}); });
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(900);
  ok('a viewer sees the week', await p.locator('.ev').count()===1);
  ok('marked "Só leitura" in the header', /Só leitura/.test(await p.locator('#roChip').innerText()));
  const WRITES=['newClass','editClass','delClass','moveClass','newVenue','editVenue','delVenue','newPlayer','editPlayer','delPlayer',
    'importPlayers','newRequest','editRequest','delRequest','ppBook','ppWait','loadDemo','wipe','editAcademy','addToClass','unenrol'];
  const visibleWrites=async()=>p.evaluate(W=>W.filter(a=>[...document.querySelectorAll(`[data-act="${a}"]`)].some(e=>e.getBoundingClientRect().width>0)),WRITES);
  const roSeen=new Set();
  for(const [v,sub] of [['calendar'],['place'],['waitlist'],['manage','academy'],['manage','venues'],['manage','coaches'],['manage','players'],['manage','classes']]){
    await p.locator(`#tabs [data-id="${v}"]`).click(); await sleep(120);
    if(sub){ await p.locator(`[data-act="sub"][data-id="${sub}"]`).click(); await sleep(120); }
    (await visibleWrites()).forEach(a=>roSeen.add(v+'/'+(sub||'')+':'+a));
  }
  await p.locator('#tabs [data-id="calendar"]').click(); await sleep(150);
  await p.locator('.ev').first().click(); await sleep(250);
  (await visibleWrites()).forEach(a=>roSeen.add('class detail:'+a));
  ok('no editing control is visible anywhere', roSeen.size===0, [...roSeen]);
  ok('the class still opens to show who is in it', /A\. Silva/.test(await p.locator('#modalBox').innerText()));
  await p.screenshot({path:`${OUT}/viewer-class.png`});
  await p.locator('[data-act="closeModal"]').first().click(); await sleep(100);
    const evBox=await p.locator('.ev').first().boundingBox();
  await p.mouse.move(evBox.x+evBox.width/2,evBox.y+8); await p.mouse.down(); await p.mouse.move(evBox.x+evBox.width/2,evBox.y+120,{steps:6}); await p.mouse.up(); await sleep(200);
  ok('classes cannot be dragged', await p.evaluate(()=>!window.__API.calls.includes('save')));
  await p.locator('#tabs [data-id="manage"]').click(); await sleep(120);
  await p.locator('[data-act="sub"][data-id="academy"]').click(); await sleep(120);
  ok('"Send feedback" and "Sair" are still there', await shown(p,'#signOutBtn') && await shown(p,'[data-act="feedback"]'));
  await p.screenshot({path:`${OUT}/viewer-manage.png`});
  ok('no page errors', p.errs.length===0, p.errs);
  await p.context().close();

  console.log('\nconsole: feedback inbox and activity');
  p=await page(()=>{ window.__API.mode.operator=true; window.__API.mode.noAcademy=true;
    window.__fb=[{id:'71',academyId:'777',email:'vera@hyve.pt',screen:'calendar',message:'Can coaches see only their classes?',context:'{"clubs":1,"classes":9}',status:'new',at:'2026-11-19 10:02:00'},
                 {id:'72',academyId:'777',email:'ana@hyve.pt',screen:'place',message:'Love the waiting list.',context:'',status:'done',at:'2026-11-18 09:00:00'}];
    window.__API.mode.admin=function(path,body,respond){
      if(path==='admin/academies') return respond(200,{academies:[{id:'777',name:'The Hyve',plan:'TRIAL',maxClubs:1,maxUsers:3,clubsUsed:1,language:'pt',ownerEmail:'ana@hyve.pt'}],users:[]});
      if(path==='admin/feedback') return respond(200,{feedback:window.__fb});
      if(path==='admin/feedback/status'){ window.__fbSet=[body.id,body.status]; return respond(200,{ok:true,status:body.status}); }
      if(path==='admin/audit'){ window.__auditFor=body.academyId; return respond(200,{entries:[
        {id:'1',academyId:'777',email:'info@youlovepadel.pt',role:'operator',action:'update',target:'classes',summary:'Mon 18:30 · 90 min · level 3',at:'2026-11-19 11:00:00'},
        {id:'2',academyId:'777',email:'ana@hyve.pt',role:'owner',action:'create',target:'players',summary:'A. Silva · level 3',at:'2026-11-19 10:00:00'}]}); }
      return respond(404,{error:'?'}); }; });
  await p.goto(BASE+'/admin.html',{waitUntil:'load'}); await sleep(900);
  ok('the Feedback tab shows how many are new', /Feedback\s*1 new/.test(await p.locator('[data-act="view"][data-id="feedback"]').innerText()));
  await p.locator('[data-act="view"][data-id="feedback"]').click(); await sleep(200);
  const fbText=await p.locator('main').innerText();
  ok('each message shows academy, sender, screen and message', /The Hyve/.test(fbText)&&/vera@hyve\.pt/.test(fbText)&&/on calendar/.test(fbText)&&/only their classes/.test(fbText), fbText.slice(0,300));
  ok('with the shape of their data', /1 clubs · 9 classes/.test(fbText));
  await p.screenshot({path:`${OUT}/admin-feedback.png`});
  await p.locator('[data-act="fbStatus"][data-id="71"][data-s="done"]').click(); await sleep(200);
  ok('"Done" is saved', JSON.stringify(await p.evaluate(()=>window.__fbSet))==='["71","done"]');
  ok('and the new count drops', !/new/.test(await p.locator('[data-act="view"][data-id="feedback"]').innerText()));
  await p.locator('[data-act="view"][data-id="academies"]').click(); await sleep(150);
  await p.locator('[data-act="activity"]').click(); await sleep(400);
  const act=await p.locator('#modalRoot').innerText();
  ok('Activity lists the academy\'s changes', await p.evaluate(()=>window.__auditFor)==='777' && /A\. Silva/.test(act) && /Mon 18:30/.test(act), act.slice(0,300));
  ok('operator changes are marked', await p.locator('#modalRoot .chip.warn',{hasText:'operator'}).count()===1);
  await p.screenshot({path:`${OUT}/admin-activity.png`});
  ok('no page errors in the console', p.errs.length===0, p.errs);
  await p.context().close();

  console.log('\nno endless splash');
  const LIM='window.__BANDEJA_LIMITS={auth:600,token:600,fetch:700,watchdog:4000};';
  for (const [label,setup,expect] of [
    ['the sign-in check never answers', 'window.__API.mode.hangAuth=true;', /verificar a sua sessão/],
    ['the token never comes',           'window.__API.mode.hangToken=true;', /obter um token/],
    ['the server never answers "session"', 'window.__API.mode.hangPath="session";', /perguntar quem é/],
    ['the server never answers "data"',    'window.__API.mode.hangPath="data";',    /carregar a sua academia/] ]) {
    p=await page(LIM+'window.__API.academy.language="pt";localStorage.setItem("bandeja.lang","pt");'+setup);
    await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(2500);
    const txt=await p.locator('#gate').innerText();
    ok(`${label}: a message replaces the dots`, !(await shown(p,'.gsplash')) && /demorar demasiado, txt.slice(0,200));
    ok(`${label}: and it names the step`, expect.test(txt), txt.slice(0,200));
    ok(`${label}: with a way to try again`, await shown(p,'#gate [data-act="reloadNow"]'));
    if(label.includes('data')) await p.screenshot({path:`${OUT}/stalled.png`});
    await p.context().close();
  }
  p=await page('window.__BANDEJA_LIMITS={auth:60000,token:60000,fetch:60000,watchdog:60000};window.__API.mode.hangAuth=true; setTimeout(function(){ throw new Error("boom in startup"); },1500);');
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(2500);
  ok('a script error during startup shows instead of the dots', /boom in startup/.test(await p.locator('#gate').innerText()));
  await p.context().close();
  p=await page(LIM+'window.__API.mode.operator=true; window.__API.mode.hangPath="admin/academies";');
  await p.goto(BASE+'/admin.html',{waitUntil:'load'}); await sleep(5500);
  const at=await p.locator('#gate').innerText();
  ok('the console does the same', /taking too long/.test(at) && /loading (academies|feedback)/.test(at) && await shown(p,'#gate [data-act="retry"]'), at.slice(0,200));
  await p.context().close();
  p=await page(LIM+'window.__API.academy.language="pt";');
  await p.goto(BASE+'/',{waitUntil:'load'}); await sleep(5000);
  ok('a normal start is never interrupted by the watchdog', await shown(p,'header.top') && !(await shown(p,'#gate')));
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
