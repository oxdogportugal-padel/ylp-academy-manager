const { sdk, api } = require('./_boot.js');
const {DB,setUser,reset}=sdk.__test;
function call(method,payload,user){
  setUser(user||null);
  return new Promise(r=>{
    const req={method,url:method==='GET'?`/execute?path=${payload.path}`:'/execute',
               headers:{host:'x.eu'}, body:method==='GET'?undefined:payload};
    const res={writeHead(){},end(b){r(JSON.parse(b));}};
    Promise.resolve(api(req,res)).catch(e=>r({error:'THREW: '+e.message}));
  });
}
const OP={email_id:'info@youlovepadel.pt',first_name:'L',last_name:'C'};
const OWNER={email_id:'ana@hyve.pt',first_name:'Ana',last_name:'S'};
const STRANGER={email_id:'nobody@nowhere.pt',first_name:'No',last_name:'Body'};
let pass=0,fail=0;
const ck=(l,c,d)=>{ if(c){pass++;console.log('  ok   '+l);} else {fail++;console.log('  FAIL '+l+(d!==undefined?' -> '+JSON.stringify(d):''));} };
(async()=>{
  reset();
  DB.PlatformAdmins.push({ROWID:'1',Email:'info@youlovepadel.pt',Status:'active'});
  const a=await call('POST',{path:'admin/academy',academy:{name:'The Hyve',ownerEmail:'ana@hyve.pt',maxClubs:2,maxUsers:3,plan:'ACTIVE'}},OP);

  console.log('\nfeedback');
  ck('anonymous refused',(await call('POST',{path:'feedback',message:'hi'},null)).error==='Not signed in');
  ck('empty message refused',/Nothing to send/.test((await call('POST',{path:'feedback',message:'   '},OWNER)).error||''));
  const r1=await call('POST',{path:'feedback',message:'The calendar is hard to read on my phone',screen:'calendar'},OWNER);
  ck('academy member can send',r1.ok===true,r1);
  const r2=await call('POST',{path:'feedback',message:'I cannot get in at all',screen:'none'},STRANGER);
  ck('user with NO academy can still send',r2.ok===true,r2);
  ck('stored with email and screen',DB.Feedback.length===2 && DB.Feedback[0].Email==='ana@hyve.pt' && DB.Feedback[0].Screen==='calendar',DB.Feedback);
  ck('academy stamped from session, not client',String(DB.Feedback[0].AcademyId)===String(a.id),DB.Feedback[0].AcademyId);
  ck('unattached feedback has no academy',DB.Feedback[1].AcademyId==null,DB.Feedback[1].AcademyId);

  console.log('\nreading it back');
  ck('non-operator cannot read',(await call('GET',{path:'admin/feedback'},OWNER)).error==='Not an operator');
  const list=await call('GET',{path:'admin/feedback'},OP);
  ck('operator reads both',list.feedback&&list.feedback.length===2,list);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
