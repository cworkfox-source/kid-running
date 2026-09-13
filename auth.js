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

export const ENABLE_INTENT_KEY='kid-running-enable-backup';
export const REDIRECT_FLAG='kid-running-auth-redirect';
const ENABLE_INTENT_TTL_MS=30*60*1000;

export function writeEnableIntent(storage,now=Date.now()){
 try{storage?.setItem?.(ENABLE_INTENT_KEY,String(now));}catch{/* 無 storage 時仍可嘗試登入 */}
}

export function clearEnableIntent(storage){
 try{storage?.removeItem?.(ENABLE_INTENT_KEY);}catch{/* ignore */}
}

export function readEnableIntent(storage,now=Date.now(),ttl=ENABLE_INTENT_TTL_MS){
 try{
  const raw=storage?.getItem?.(ENABLE_INTENT_KEY);
  if(!raw)return false;
  if(raw==='1')return true;
  const ts=Number(raw);
  if(!Number.isFinite(ts))return true;
  if(now-ts>ttl){
   storage.removeItem?.(ENABLE_INTENT_KEY);
   return false;
  }
  return true;
 }catch{return false;}
}

export function shouldCompleteBackupEnable({user,backupEnabled=false,enableIntent=false}={}){
 if(!user)return false;
 if(backupEnabled===true)return Boolean(enableIntent);
 return true;
}

async function applyPersistence(authMod,auth){
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

export const applyAuthPersistence=applyPersistence;

export function createAuthService(deps){
 const {
  loadModules,
  resolveConfig,
  initFirebase,
  now=()=>Date.now(),
  sessionStore=()=>globalThis.sessionStorage,
  delay=(fn,ms)=>setTimeout(fn,ms),
  authStateTimeoutMs=2500
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
 let fromRedirect=false;
 const listeners=new Set();

 function asStore(value){
  try{return typeof value==='function'?value():value;}
  catch{return null;}
 }
 function store(){return asStore(sessionStore);}
 function markRedirectIntent(){
  try{store()?.setItem?.(REDIRECT_FLAG,'1');}catch{/* ignore */}
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
 function withResolver(method,args){
  const resolver=modules.auth.browserPopupRedirectResolver;
  return resolver?method(...args,resolver):method(...args);
 }

 function emit(){for(const fn of listeners)fn(snapshot());}
 function snapshot(){
  return {
   ready,resolving,user,persistence,loadError,configInfo,redirectPending,fromRedirect,
   available:Boolean(modules&&firebase),
   configured:configInfo.configured,
   uid:user?.uid||null,
   email:user?.email||null,
   displayName:user?.displayName||null
  };
 }

 async function waitForAuthUser(existingUser){
  await new Promise(resolve=>{
   let unsub=()=>{};
   let done=false;
   const finish=()=>{
    if(done)return;
    done=true;
    try{unsub();}catch{/* ignore */}
    resolve();
   };
   unsub=modules.auth.onAuthStateChanged(firebase.auth,next=>{
    if(next){
     user=next;
     loadError=null;
     finish();
     return;
    }
    if(!existingUser){
     user=null;
     finish();
    }
   });
   if(existingUser)delay(finish,authStateTimeoutMs);
  });
 }

 async function start(){
  resolving=true;fromRedirect=false;emit();
  try{
   configInfo=resolveConfig();
   if(!configInfo.configured){
    ready=true;resolving=false;emit();return snapshot();
   }
   modules=await loadModules();
   firebase=await initFirebase({modules,config:configInfo.config,emulator:configInfo.emulator});
   persistence=await applyPersistence(modules.auth,firebase.auth);
   let redirectUser=null;
   if(modules.auth.getRedirectResult){
    try{
     const redirected=await withResolver(modules.auth.getRedirectResult,[firebase.auth]);
     if(redirected?.user){
      redirectUser=redirected.user;
      user=redirectUser;
      fromRedirect=true;
      consumeRedirectIntent();
     }else if(consumeRedirectIntent()){
      rememberAuthError(null,{missingRedirect:true});
     }
    }catch(error){
     consumeRedirectIntent();
     rememberAuthError(error);
    }
   }
   await waitForAuthUser(redirectUser||user);
   if(user){
    loadError=null;
    if(redirectUser)fromRedirect=true;
   }
   ready=true;resolving=false;redirectPending=false;
   emit();
   let ignoreInitialNull=Boolean(user);
   modules.auth.onAuthStateChanged(firebase.auth,next=>{
    if(next){
     user=next;
     loadError=null;
     ignoreInitialNull=false;
    }else if(ignoreInitialNull){
     ignoreInitialNull=false;
    }else{
     user=null;
     fromRedirect=false;
    }
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
  fromRedirect=false;
  const provider=new modules.auth.GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  markRedirectIntent();
  try{
   const cred=await withResolver(modules.auth.signInWithPopup,[firebase.auth,provider]);
   consumeRedirectIntent();
   user=cred.user;redirectPending=false;fromRedirect=false;emit();
   return {method:'popup',user};
  }catch(error){
   if(shouldFallbackToRedirect(error)){
    redirectPending=true;markRedirectIntent();emit();
    await withResolver(modules.auth.signInWithRedirect,[firebase.auth,provider]);
    return {method:'redirect',pending:true,fallback:true};
   }
   consumeRedirectIntent();
   rememberAuthError(error);emit();
   throw error;
  }
 }

 async function signOut(){
  if(firebase?.auth&&modules?.auth?.signOut)await modules.auth.signOut(firebase.auth);
  user=null;fromRedirect=false;emit();
 }

 return {
  start,signInWithGoogle,signOut,snapshot,
  subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  getFirebase:()=>firebase,
  getModules:()=>modules,
  now
 };
}
