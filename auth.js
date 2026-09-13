export function persistenceUnavailableMessage(){
 return '這個瀏覽器目前無法長期記住登入（無痕、儲存空間關閉或限制）。關閉分頁後需要重新登入，無法宣稱「登入一次，之後自動備份」。';
}

export function shouldFallbackToRedirect(error){
 const text=String(error?.code||error?.message||error);
 return /popup-blocked|cancelled-popup|operation-not-supported|web-storage-unsupported/i.test(text);
}

export function describeAuthError(error){
 const code=String(error?.code||'').trim();
 const message=String(error?.message||error||'未知錯誤').trim();
 const detail=code&&!message.includes(code)?`${code} ${message}`:message||code||'未知錯誤';
 return `Google 登入未完成：${detail}`;
}

const REDIRECT_FLAG='kid-running-auth-redirect';

export async function applyAuthPersistence(authMod,auth){
 const attempts=[
  ['indexedDB',authMod.indexedDBLocalPersistence],
  ['local',authMod.browserLocalPersistence]
 ].filter(([,value])=>value);
 let lastError=null;
 for(const [type,persistence] of attempts){
  try{
   await authMod.setPersistence(auth,persistence);
   return {ok:true,type,longLived:true};
  }catch(error){lastError=error;}
 }
 return {ok:false,type:'none',longLived:false,error:lastError,message:persistenceUnavailableMessage()};
}

export function createAuthService(deps){
 const {
  loadModules,
  resolveConfig,
  initFirebase,
  now=()=>Date.now(),
  sessionStore=()=>globalThis.sessionStorage
 }=deps;

 let ready=false;
 let resolving=true;
 let modules=null;
 let firebase=null;
 let user=null;
 let persistence={ok:false,type:'none',longLived:false};
 let loadError=null;
 let configInfo={configured:false,emulator:false,config:null};
 let redirectPending=false;
 const listeners=new Set();

 function store(){
  try{return typeof sessionStore==='function'?sessionStore():sessionStore;}
  catch{return null;}
 }
 function markRedirectIntent(){
  try{store()?.setItem?.(REDIRECT_FLAG,'1');}catch{/* 無 sessionStorage 時仍可嘗試 redirect */}
 }
 function consumeRedirectIntent(){
  try{
   const api=store();
   const flagged=Boolean(api?.getItem?.(REDIRECT_FLAG));
   api?.removeItem?.(REDIRECT_FLAG);
   return flagged;
  }catch{return false;}
 }
 function rememberAuthError(error,{missingRedirect=false}={}){
  const wrapped=missingRedirect
   ?Object.assign(Error('Google 登入未完成：重新導向沒有帶回登入結果。請再試一次，並允許彈出視窗。'),{code:'auth/redirect-result-missing'})
   :Object.assign(Error(describeAuthError(error)),{code:error?.code,cause:error});
  loadError=wrapped;
  return wrapped;
 }

 function emit(){for(const fn of listeners)fn(snapshot());}
 function snapshot(){
  return {
   ready,resolving,user,persistence,loadError,configInfo,redirectPending,
   available:Boolean(modules&&firebase),
   configured:configInfo.configured,
   uid:user?.uid||null,
   email:user?.email||null,
   displayName:user?.displayName||null
  };
 }

 async function start(){
  resolving=true;emit();
  try{
   configInfo=resolveConfig();
   if(!configInfo.configured){
    ready=true;resolving=false;emit();return snapshot();
   }
   modules=await loadModules();
   firebase=await initFirebase({modules,config:configInfo.config,emulator:configInfo.emulator});
   persistence=await applyAuthPersistence(modules.auth,firebase.auth);
   if(modules.auth.getRedirectResult){
    try{
     const redirected=await modules.auth.getRedirectResult(firebase.auth);
     if(redirected?.user){
      user=redirected.user;
      consumeRedirectIntent();
     }else if(consumeRedirectIntent()){
      rememberAuthError(null,{missingRedirect:true});
     }
    }catch(error){
     consumeRedirectIntent();
     rememberAuthError(error);
    }
   }
   await new Promise(resolve=>{
    let unsub=null;
    let pending=false;
    const finish=()=>{
     if(unsub){const stop=unsub;unsub=null;stop();}
     resolve();
    };
    unsub=modules.auth.onAuthStateChanged(firebase.auth,next=>{
     user=next||null;
     if(user)loadError=null;
     ready=true;resolving=false;redirectPending=false;
     emit();
     if(unsub)finish();
     else pending=true;
    });
    if(pending)finish();
   });
   modules.auth.onAuthStateChanged(firebase.auth,next=>{
    user=next||null;
    if(user)loadError=null;
    emit();
   });
  }catch(error){
   loadError=error;
   modules=null;firebase=null;
   ready=true;resolving=false;
   emit();
  }
  return snapshot();
 }

 async function signInWithGoogle(){
  if(!firebase||!modules)throw Error(loadError?.message||'雲端備份元件尚未就緒，本機仍可記錄');
  if(!persistence.ok)throw Error(persistence.message||persistenceUnavailableMessage());
  loadError=null;
  const provider=new modules.auth.GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  try{
   const cred=await modules.auth.signInWithPopup(firebase.auth,provider);
   user=cred.user;redirectPending=false;emit();
   return {method:'popup',user};
  }catch(error){
   if(shouldFallbackToRedirect(error)){
    redirectPending=true;markRedirectIntent();emit();
    await modules.auth.signInWithRedirect(firebase.auth,provider);
    return {method:'redirect',pending:true,fallback:true};
   }
   rememberAuthError(error);emit();
   throw error;
  }
 }

 async function signOut(){
  if(firebase?.auth&&modules?.auth?.signOut)await modules.auth.signOut(firebase.auth);
  user=null;emit();
 }

 return {
  start,signInWithGoogle,signOut,snapshot,
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  getFirebase:()=>firebase,
  getModules:()=>modules,
  now
 };
}
