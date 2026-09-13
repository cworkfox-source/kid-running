import {LOCAL_OWNER} from '../core.js';

export function createMemoryDB(){
 const stores={
  records:new Map(),
  children:new Map(),
  settings:new Map(),
  meta:new Map(),
  backupQueue:new Map(),
  backupLocks:new Map(),
  restoreSnapshots:new Map()
 };
 stores.meta.set('app',{id:'app',deviceId:'device-test-1',schemaVersion:2,enablePromptDismissed:false});
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 return {
  stores,
  async all(name){return [...stores[name].values()].map(clone);},
  async get(name,id){return clone(stores[name].get(id));},
  async write(changes,options={}){
   for(const change of changes){
    if(change.clear)stores[change.store].clear();
    else if(change.delete)stores[change.store].delete(change.delete);
    else stores[change.store].set(change.value.id,{...change.value});
   }
   if(options.bumpRevision){
    const ownerUid=options.ownerUid||LOCAL_OWNER;
    const id=`account:${ownerUid}`;
    const acc=stores.meta.get(id)||{id,ownerUid,localRevision:0,pendingBackup:false,backupEnabled:false,backupPaused:false};
    acc.localRevision=(acc.localRevision||0)+1;
    acc.pendingBackup=options.pendingBackup!==false;
    acc.ownerUid=ownerUid;
    stores.meta.set(id,{...acc});
   }
  },
  async getAccount(ownerUid){
   const id=`account:${ownerUid}`;
   return clone(stores.meta.get(id)||{id,ownerUid,localRevision:0,pendingBackup:false,backupEnabled:false,backupPaused:false,waitingFirstRecord:false,lastSuccess:null,lastError:null});
  },
  async putAccount(account){
   stores.meta.set(`account:${account.ownerUid}`,{...account,id:`account:${account.ownerUid}`});
  },
  async acquireLock(tabId,ttl=25000,now=Date.now()){
   const current=stores.backupLocks.get('backup');
   if(current&&current.owner!==tabId&&current.expiresAt>now)return false;
   stores.backupLocks.set('backup',{id:'backup',owner:tabId,expiresAt:now+ttl,heartbeatAt:now});
   return true;
  },
  async heartbeatLock(tabId,ttl=25000,now=Date.now()){
   const current=stores.backupLocks.get('backup');
   if(!current||current.owner!==tabId)return false;
   stores.backupLocks.set('backup',{...current,expiresAt:now+ttl,heartbeatAt:now});
   return true;
  },
  async releaseLock(tabId){
   const current=stores.backupLocks.get('backup');
   if(current&&current.owner===tabId)stores.backupLocks.delete('backup');
  },
  async saveRestoreSnapshot(snapshot){
   stores.restoreSnapshots.set('pre-restore',{id:'pre-restore',...snapshot});
  }
 };
}

export function createClock(){
 let now=0;
 const timers=[];
 let seq=0;
 return {
  now:()=>now,
  setTimeout(fn,ms){
   const id={id:++seq,at:now+ms,fn};
   timers.push(id);
   return id;
  },
  clearTimeout(id){
   const i=timers.indexOf(id);
   if(i>=0)timers.splice(i,1);
  },
  advance(ms){
   now+=ms;
   const due=timers.filter(timer=>timer.at<=now).sort((a,b)=>a.at-b.at);
   const results=[];
   for(const timer of due){
    const i=timers.indexOf(timer);
    if(i>=0)timers.splice(i,1);
    results.push(timer.fn());
   }
   return results;
  }
 };
}

export const sampleChild=(uid='user-a',id='child_01')=>({id,name:'小孩',birthday:null,ownerUid:uid});
export const sampleRecord=(uid='user-a',over={})=>({id:over.id||'rec-1',childId:over.childId||'child_01',date:over.date||'2026-09-13',distance:over.distance||30,seconds:over.seconds||7.42,note:over.note||'',startType:'',surface:'',timingMethod:'',createdAt:over.createdAt||'2026-09-13T12:00:00.000Z',updatedAt:over.updatedAt||'2026-09-13T12:00:00.000Z',ownerUid:uid});

export async function seedUser(db,{uid='user-a',records=[],children,enabled=true,paused=false,waitingFirst=false}={}){
 const kids=children||[sampleChild(uid)];
 await db.write([
  ...kids.map(value=>({store:'children',value})),
  ...records.map(value=>({store:'records',value}))
 ]);
 await db.putAccount({id:`account:${uid}`,ownerUid:uid,localRevision:records.length,pendingBackup:Boolean(records.length),backupEnabled:enabled,backupPaused:paused,waitingFirstRecord:waitingFirst,lastSuccess:null,lastError:null});
}
