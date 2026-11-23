import {LOCAL_OWNER} from './core.js';

let database=null;
let opening=null;

function request(req){
 return new Promise((resolve,reject)=>{
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}

export async function openDB(){
 if(database)return database;
 if(opening)return opening;
 opening=new Promise((resolve,reject)=>{
  const req=indexedDB.open('kid-running',2);
  req.onupgradeneeded=event=>{
   const db=req.result;
   const tx=req.transaction;
   if(event.oldVersion<1){
    for(const name of ['records','children','settings']){
     if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});
    }
   }
   if(event.oldVersion<2){
    for(const name of ['meta','backupQueue','backupLocks','restoreSnapshots']){
     if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});
    }
    if(event.oldVersion>=1){
     for(const name of ['records','children']){
      const store=tx.objectStore(name);
      store.openCursor().onsuccess=ev=>{
       const cursor=ev.target.result;
       if(!cursor)return;
       const value=cursor.value;
       if(!value.ownerUid){
        value.ownerUid=LOCAL_OWNER;
        cursor.update(value);
       }
       cursor.continue();
      };
     }
    }
   }
  };
  req.onsuccess=()=>{
   const db=req.result;
   // 瀏覽器可能在背景、切換到 Google 登入頁或其他分頁升級時關閉連線；關閉後清掉快取，下次操作自動重開
   db.onversionchange=()=>{if(database===db)database=null;db.close();};
   db.onclose=()=>{if(database===db)database=null;};
   database=db;
   resolve(db);
  };
  req.onerror=()=>reject(req.error);
  req.onblocked=()=>reject(Error('請關閉其他分頁後重試'));
 }).finally(()=>{opening=null;});
 return opening;
}

function isClosedConnectionError(error){
 // Chrome／Android：InvalidStateError "The database connection is closing"
 // iOS Safari：UnknownError "Connection to Indexed Database server lost"
 return error?.name==='InvalidStateError'||/connection is clos|database.*clos|indexed ?database server lost/i.test(String(error?.message||''));
}

// 建立交易；若既有連線已關閉或正在關閉，丟棄舊連線並重開一次再試
async function transaction(stores,mode='readonly'){
 for(let attempt=0;;attempt++){
  const db=await openDB();
  try{return db.transaction(stores,mode);}
  catch(error){
   if(attempt>0||!isClosedConnectionError(error))throw error;
   if(database===db)database=null;
   try{db.close();}catch{}
  }
 }
}

export async function all(store){
 const tx=await transaction(store);
 return new Promise((resolve,reject)=>{
  const req=tx.objectStore(store).getAll();
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}

export async function get(store,id){
 const tx=await transaction(store);
 return new Promise((resolve,reject)=>{
  const req=tx.objectStore(store).get(id);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
}

function applyChange(store,change){
 if(change.clear)store.clear();
 else if(change.delete)store.delete(change.delete);
 else store.put(change.value);
}

export async function write(changes,options={}){
 const stores=new Set(changes.map(c=>c.store));
 if(options.bumpRevision||options.meta)stores.add('meta');
 const tx=await transaction([...stores],'readwrite');
 return new Promise((resolve,reject)=>{
  tx.oncomplete=resolve;
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||Error('儲存取消'));
  for(const change of changes)applyChange(tx.objectStore(change.store),change);
  if(options.bumpRevision){
   const ownerUid=options.ownerUid||LOCAL_OWNER;
   const metaStore=tx.objectStore('meta');
   const accId=`account:${ownerUid}`;
   const getReq=metaStore.get(accId);
   getReq.onsuccess=()=>{
    const acc=getReq.result||{id:accId,ownerUid,localRevision:0,pendingBackup:false,backupEnabled:false,backupPaused:false};
    acc.localRevision=(acc.localRevision||0)+1;
    acc.pendingBackup=options.pendingBackup!==false;
    acc.ownerUid=ownerUid;
    if(options.accountPatch)Object.assign(acc,options.accountPatch);
    metaStore.put(acc);
   };
  }else if(options.meta){
   const metaStore=tx.objectStore('meta');
   for(const item of options.meta)metaStore.put(item);
  }
 });
}

export async function ensureAppMeta(){
 let app=await get('meta','app');
 if(!app){
  app={id:'app',deviceId:crypto.randomUUID(),schemaVersion:2,enablePromptDismissed:false,createdAt:new Date().toISOString()};
  await write([{store:'meta',value:app}]);
 }
 return app;
}

export async function getAccount(ownerUid){
 const id=`account:${ownerUid}`;
 return await get('meta',id)||{id,ownerUid,localRevision:0,pendingBackup:false,backupEnabled:false,backupPaused:false,waitingFirstRecord:false,lastSuccess:null,lastError:null};
}

export async function putAccount(account){
 await write([{store:'meta',value:{...account,id:`account:${account.ownerUid}`}}]);
}

export async function acquireLock(tabId,ttl=25000,now=Date.now()){
 const tx=await transaction(['backupLocks'],'readwrite');
 return new Promise((resolve,reject)=>{
  let ok=false;
  const store=tx.objectStore('backupLocks');
  const getReq=store.get('backup');
  getReq.onsuccess=()=>{
   const current=getReq.result;
   if(current&&current.owner!==tabId&&current.expiresAt>now)return;
   ok=true;
   store.put({id:'backup',owner:tabId,expiresAt:now+ttl,heartbeatAt:now});
  };
  tx.oncomplete=()=>resolve(ok);
  tx.onerror=()=>reject(tx.error);
  tx.onabort=()=>reject(tx.error||Error('鎖失敗'));
 });
}

export async function heartbeatLock(tabId,ttl=25000,now=Date.now()){
 const tx=await transaction(['backupLocks'],'readwrite');
 return new Promise((resolve,reject)=>{
  let ok=false;
  const store=tx.objectStore('backupLocks');
  const getReq=store.get('backup');
  getReq.onsuccess=()=>{
   const current=getReq.result;
   if(!current||current.owner!==tabId)return;
   ok=true;
   store.put({...current,expiresAt:now+ttl,heartbeatAt:now});
  };
  tx.oncomplete=()=>resolve(ok);
  tx.onerror=()=>reject(tx.error);
 });
}

export async function releaseLock(tabId){
 const tx=await transaction(['backupLocks'],'readwrite');
 return new Promise((resolve,reject)=>{
  const store=tx.objectStore('backupLocks');
  const getReq=store.get('backup');
  getReq.onsuccess=()=>{
   const current=getReq.result;
   if(current&&current.owner===tabId)store.delete('backup');
  };
  tx.oncomplete=resolve;
  tx.onerror=()=>reject(tx.error);
 });
}

export async function saveRestoreSnapshot(snapshot){
 await write([{store:'restoreSnapshots',value:{id:'pre-restore',...snapshot,savedAt:new Date().toISOString()}}]);
}

export {request};
