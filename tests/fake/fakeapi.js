/* Stands in for the Catalyst SDK plus the deployed API function, implementing
   the same request/response contract the real function serves. */
(function(){
  var SEQ=900000;
  /* language "en" and the tour already done keep the older suites, which read
     English text and never expected an overlay, working unchanged; the suites
     about language and the tour set these themselves. */
  var A={ id:"777", name:"The Hyve", rules:{levelTolerance:1,classCapacity:4},
          plan:"ACTIVE", maxClubs:3, maxUsers:5, language:"en", tutorialDone:true };
  var DB={ venues:[], coaches:[], players:[], classes:[], requests:[] };
  var CALLS=[];
  var MODE={ failSave:false, status:null, code:null, signedIn:true, operator:false, noAcademy:false, admin:null };

  function nid(){ return String(++SEQ); }

  window.catalyst={
    auth:{
      isUserAuthenticated:function(){
        return MODE.signedIn ? Promise.resolve({content:{email_id:"ana@hyve.pt"}}) : Promise.reject(new Error("not signed in"));
      },
      generateAuthToken:function(){ return Promise.resolve({access_token:"tok_abc"}); },
      signIn:function(id,opts){
        MODE.signInCalls=(MODE.signInCalls||[]).concat([{id:id,redirect:opts&&opts.login_redirect}]);
        var el=document.getElementById(id); if(el) el.innerHTML='<div class="fake-login">[Catalyst sign-in form]</div>';
      },
      signOut:function(to){ MODE.signedOutTo=to; }
    }
  };

  var realFetch=window.fetch;
  window.fetch=function(url,opts){
    opts=opts||{};
    if(String(url).indexOf("/server/api/execute")<0) return realFetch(url,opts);
    if(!opts.headers||!opts.headers.Authorization) return respond(401,{error:"Not signed in"});

    var path, body={};
    if(opts.method==="POST"){ body=JSON.parse(opts.body||"{}"); path=body.path; }
    else { path=new URL(url,location.origin).searchParams.get("path"); }
    CALLS.push(path);

    if(MODE.status) return respond(MODE.status,{error:MODE.code||"blocked",message:"forced"});

    if(path==="session"){
      return respond(200,{email:"ana@hyve.pt",name:"Ana",isOperator:!!MODE.operator,role:"owner",
        academy:MODE.noAcademy?null:JSON.parse(JSON.stringify(A))});
    }
    if(path==="tutorial"){ A.tutorialDone=body.done!==false; return respond(200,{ok:true,tutorialDone:A.tutorialDone}); }
    if(MODE.admin&&path.indexOf("admin/")===0) return MODE.admin(path,body,respond);
    if(path==="data"){
      return respond(200,Object.assign({academy:JSON.parse(JSON.stringify(A)),role:"owner"},
        JSON.parse(JSON.stringify(DB))));
    }
    if(path==="save"){
      if(MODE.failSave) return respond(500,{error:"Save refused by test"});
      var c=body.collection, rec=JSON.parse(JSON.stringify(body.record||{}));
      var isNew=!rec.id||!/^\d+$/.test(String(rec.id));
      if(isNew && c==="venues" && DB.venues.length>=A.maxClubs)
        return respond(409,{error:"This academy's plan includes "+A.maxClubs+" club(s)."});
      if(isNew){ rec.id=nid(); DB[c].push(rec); }
      else {
        var i=DB[c].findIndex(function(x){return String(x.id)===String(rec.id);});
        if(i<0) return respond(404,{error:"Not found in this academy"});
        DB[c][i]=rec;
      }
      return respond(200,{id:rec.id});
    }
    if(path==="delete"){
      DB[body.collection]=DB[body.collection].filter(function(x){return String(x.id)!==String(body.id);});
      return respond(200,{ok:true});
    }
    if(path==="academy"){ A.name=body.name; A.rules=body.rules; return respond(200,{ok:true}); }
    if(path==="feedback"){ if(!body.message||!String(body.message).trim()) return respond(400,{error:"Message is required"});
      (DB.feedback=DB.feedback||[]).push({message:body.message,screen:body.screen,context:body.context}); return respond(200,{ok:true}); }
    return respond(404,{error:"Unknown path: "+path});
  };

  function respond(status,obj){
    return Promise.resolve({ ok:status<400, status:status,
      text:function(){ return Promise.resolve(JSON.stringify(obj)); } });
  }

  window.__API={ db:DB, academy:A, calls:CALLS, mode:MODE };
})();
