export function preferRedirect(ua='',{popupLikelyBlocked=false}={}){
 const ios=/iPhone|iPad|iPod/.test(ua);
 const safari=/Safari/.test(ua)&&!/Chrome|CriOS|Chromium|FxiOS|EdgiOS|Android/.test(ua);
 return ios||safari||popupLikelyBlocked;
}

export function persistenceUnavailableMessage(){
 return '這個瀏覽器目前無法長期記住登入（無痕、儲存空間關閉或限制）。關閉分頁後需要重新登入，無法宣稱「登入一次，之後自動備份」。';
}

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
  userAgent=()=>globalThis.navigator?.userAgent||'',
  locationOrigin=()=>globalThis.location?.origin||''
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

 function emit(){for(const fn of listeners)fn(snapshot());}
 function snapshot(){
  return {
   ready,resolving,user,persistence,loadError,configInfo,redirectPending,
   available:Boolean(modules&&firebase&&!loadError),
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
     if(redirected?.user)user=redirected.user;
    }catch(error){loadError=error;}
   }
   await new Promise(resolve=>{
    const unsub=modules.auth.onAuthStateChanged(firebase.auth,next=>{
     user=next||null;
     ready=true;resolving=false;redirectPending=false;
     emit();unsub();resolve();
    });
   });
   modules.auth.onAuthStateChanged(firebase.auth,next=>{
    user=next||null;
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
  const provider=new modules.auth.GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  const ua=userAgent();
  const useRedirect=preferRedirect(ua);
  if(useRedirect){
   const origin=locationOrigin();
   const authDomain=configInfo.config?.authDomain||'';
   if(!configInfo.emulator&&authDomain&&origin&&!origin.includes('localhost')&&!origin.includes(authDomain.replace(/^\w+:\/\//,''))){
    // redirect 仍可在授權網域上運作；這裡只在完全沒設定時提出缺口
   }
   redirectPending=true;emit();
   await modules.auth.signInWithRedirect(firebase.auth,provider);
   return {method:'redirect',pending:true};
  }
  try{
   const cred=await modules.auth.signInWithPopup(firebase.auth,provider);
   user=cred.user;emit();
   return {method:'popup',user};
  }catch(error){
   const text=String(error?.code||error?.message||error);
   if(/popup-blocked|cancelled-popup|operation-not-supported|web-storage-unsupported/i.test(text)){
    redirectPending=true;emit();
    await modules.auth.signInWithRedirect(firebase.auth,provider);
    return {method:'redirect',pending:true,fallback:true};
   }
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
