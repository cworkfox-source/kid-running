import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyAuthPersistence,persistenceUnavailableMessage,shouldFallbackToRedirect,describeAuthError,createAuthService,shouldCompleteBackupEnable,writeEnableIntent,readEnableIntent,clearEnableIntent,ENABLE_INTENT_KEY} from '../auth.js';
import {resolveFirebaseConfig,shouldUseEmulator,FIREBASE_SDK_VERSION} from '../firebase.js';
import {describeBackupStatus} from '../backup.js';

function memoryStore(init={}){
 const data=new Map(Object.entries(init));
 return {
  getItem:k=>data.has(k)?data.get(k):null,
  setItem:(k,v)=>data.set(String(k),String(v)),
  removeItem:k=>data.delete(String(k))
 };
}

function authHarness({
 popupError=null,
 redirectError=null,
 redirectUser=null,
 authState,
 session,
 ua='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
 authStateTimeoutMs=0
}={}){
 const store=session||memoryStore();
 let popupCalls=0;
 let redirectCalls=0;
 const signedIn=redirectUser||(authState===undefined?null:authState);
 const authMod={
  GoogleAuthProvider:class{setCustomParameters(){}},
  indexedDBLocalPersistence:{name:'idb'},
  browserLocalPersistence:{name:'local'},
  async setPersistence(){},
  async signInWithPopup(){
   popupCalls+=1;
   if(popupError)throw popupError;
   return {user:{uid:'u1',email:'a@b.c',displayName:'A'}};
  },
  async signInWithRedirect(){redirectCalls+=1;},
  async getRedirectResult(){
   if(redirectError)throw redirectError;
   if(redirectUser)return {user:redirectUser};
   return null;
  },
  onAuthStateChanged(_auth,cb){
   cb(authState===undefined?signedIn:authState);
   return ()=>{};
  },
  async signOut(){}
 };
 const service=createAuthService({
  loadModules:async()=>({auth:authMod}),
  resolveConfig:()=>({configured:true,emulator:false,config:{authDomain:'kid-running.firebaseapp.com',projectId:'kid-running'}}),
  initFirebase:async()=>({auth:{},firestore:{}}),
  sessionStore:store,
  authStateTimeoutMs
 });
 return {service,store,popupCalls:()=>popupCalls,redirectCalls:()=>redirectCalls};
}

test('A01 使用長期持久而非 session',async()=>{
 const calls=[];
 const authMod={
  indexedDBLocalPersistence:{name:'idb'},
  browserLocalPersistence:{name:'local'},
  browserSessionPersistence:{name:'session'},
  async setPersistence(auth,value){calls.push(value.name);if(value.name==='idb')return;}
 };
 const result=await applyAuthPersistence(authMod,{});
 assert.equal(result.ok,true);
 assert.equal(result.longLived,true);
 assert.equal(result.type,'indexedDB');
 assert.deepEqual(calls,['idb']);
 assert.ok(!calls.includes('session'));
});

test('A03 持久不可用時明確失敗，不改短暫登入',async()=>{
 const authMod={
  indexedDBLocalPersistence:{name:'idb'},
  browserLocalPersistence:{name:'local'},
  browserSessionPersistence:{name:'session'},
  async setPersistence(){throw Error('blocked');}
 };
 const result=await applyAuthPersistence(authMod,{});
 assert.equal(result.ok,false);
 assert.equal(result.longLived,false);
 assert.match(result.message||persistenceUnavailableMessage(),/無法長期記住登入/);
});

test('iPhone Safari 仍先嘗試 popup，被擋才 redirect',async()=>{
 const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
 const ok=authHarness({ua:iphone});
 await ok.service.start();
 const popped=await ok.service.signInWithGoogle();
 assert.equal(popped.method,'popup');
 assert.equal(ok.popupCalls(),1);
 assert.equal(ok.redirectCalls(),0);

 const blocked=authHarness({
  ua:iphone,
  popupError:Object.assign(Error('Popup blocked'),{code:'auth/popup-blocked'})
 });
 await blocked.service.start();
 const fallback=await blocked.service.signInWithGoogle();
 assert.equal(fallback.method,'redirect');
 assert.equal(fallback.fallback,true);
 assert.equal(blocked.popupCalls(),1);
 assert.equal(blocked.redirectCalls(),1);
 assert.equal(blocked.store.getItem('kid-running-auth-redirect'),'1');
});

test('popup 失敗屬 popup-blocked 家族才 fallback redirect',()=>{
 assert.equal(shouldFallbackToRedirect({code:'auth/popup-blocked'}),true);
 assert.equal(shouldFallbackToRedirect({code:'auth/cancelled-popup-request'}),true);
 assert.equal(shouldFallbackToRedirect({code:'auth/operation-not-supported-in-this-environment'}),true);
 assert.equal(shouldFallbackToRedirect({code:'auth/web-storage-unsupported'}),true);
 assert.equal(shouldFallbackToRedirect({code:'auth/popup-closed-by-user'}),false);
 assert.match(describeAuthError({code:'auth/popup-closed-by-user',message:'closed'}),/Google 登入未完成/);
});

test('getRedirectResult 失敗會寫入 loadError，UI 可看見',async()=>{
 const {service}=authHarness({
  redirectError:Object.assign(Error('The redirect operation failed'),{code:'auth/internal-error'}),
  authState:null
 });
 const snap=await service.start();
 assert.equal(snap.available,true);
 assert.ok(snap.loadError);
 assert.match(String(snap.loadError.message),/Google 登入未完成/);
 assert.match(String(snap.loadError.message),/auth\/internal-error|redirect operation failed/);
});

test('預期 redirect 但結果為空時不可默默略過',async()=>{
 const {service}=authHarness({
  session:memoryStore({'kid-running-auth-redirect':'1'}),
  authState:null
 });
 const snap=await service.start();
 assert.equal(snap.available,true);
 assert.ok(snap.loadError);
 assert.match(String(snap.loadError.message),/重新導向沒有帶回登入結果/);
});

test('getRedirectResult 成功時即使第一次 auth 狀態是 null 也要留下 user',async()=>{
 const redirectUser={uid:'u-redirect',email:'a@b.c',displayName:'A'};
 const {service}=authHarness({redirectUser,authState:null,authStateTimeoutMs:0});
 const snap=await service.start();
 assert.equal(snap.fromRedirect,true);
 assert.equal(snap.user?.uid,'u-redirect');
 assert.equal(snap.loadError,null);
});

test('已拿到 user 且尚未 backupEnabled 時必須走啟用流程',()=>{
 assert.equal(shouldCompleteBackupEnable({user:null,backupEnabled:false,enableIntent:true}),false);
 assert.equal(shouldCompleteBackupEnable({user:{uid:'u1'},backupEnabled:false,enableIntent:false}),true);
 assert.equal(shouldCompleteBackupEnable({user:{uid:'u1'},backupEnabled:true,enableIntent:false}),false);
 assert.equal(shouldCompleteBackupEnable({user:{uid:'u1'},backupEnabled:true,enableIntent:true}),true);
 const store=memoryStore();
 writeEnableIntent(store,1);
 assert.equal(readEnableIntent(store,1),true);
 clearEnableIntent(store);
 assert.equal(store.getItem(ENABLE_INTENT_KEY),null);
});

test('A02 啟動先解析 auth 設定，已設定仍不誤報雲端成功',()=>{
 const resolved=resolveFirebaseConfig({search:'',hostname:'localhost'});
 assert.equal(resolved.configured,true);
 assert.equal(resolved.config.projectId,'kid-running');
 assert.equal(resolved.emulator,false);
 const empty=resolveFirebaseConfig({search:'',hostname:'localhost',envConfig:{apiKey:'',projectId:'',appId:''}});
 assert.equal(empty.configured,false);
 assert.equal(shouldUseEmulator('?emulator=1','localhost'),true);
 const status=describeBackupStatus({configured:false,sdkFailed:false,resolving:false,user:null,enabled:false,recordCount:0});
 assert.equal(status.code,'unconfigured');
 assert.ok(!status.text.includes('已備份'));
 const idle=describeBackupStatus({configured:true,resolving:false,user:null,enabled:false,recordCount:0});
 assert.equal(idle.code,'not-enabled');
 assert.ok(!idle.text.includes('已備份'));
 const checking=describeBackupStatus({configured:true,resolving:true,user:null,enabled:false,recordCount:0});
 assert.equal(checking.code,'checking');
 assert.equal(FIREBASE_SDK_VERSION,'11.1.0');
});
