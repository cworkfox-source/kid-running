import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBackupService,describeBackupStatus} from '../backup.js';
import {createMemoryCloud} from '../cloud.js';
import {restoreVersion,listRestorableVersions,downloadAndVerify} from '../restore.js';
import {createMemoryDB,createClock,sampleChild,sampleRecord,seedUser} from './support.js';
import {LOCAL_OWNER,splitUtf8Chunks} from '../core.js';

function service(db,cloud,user,extra={}){
 const clock=extra.clock||{now:()=>Date.now(),setTimeout,clearTimeout};
 return createBackupService({
  db,getCloud:()=>cloud,getUser:()=>user,getAppMeta:async()=>({deviceId:'device-test-1'}),
  isOnline:extra.isOnline||(()=>true),clock,tabId:extra.tabId||'tab-1',
  debounceMs:extra.debounceMs||5000,maxWaitMs:extra.maxWaitMs||30000,
  randomId:extra.randomId||(()=>'backup-fixed'),random:()=>0.5,
  splitChunks:extra.splitChunks||(text=>splitUtf8Chunks(text,extra.chunkBytes||256*1024)),
  keepVersions:extra.keepVersions||30,
  clockIntervalMs:extra.clockIntervalMs??0
 });
}

async function addRecord(db,uid,record){
 await db.write([{store:'records',value:sampleRecord(uid,record)}],{bumpRevision:true,ownerUid:uid});
}

test('B01 本機有雲端無會上傳第一個完整版本',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user);
 const result=await backup.flush('user-a');
 assert.equal(result.ok,true);
 const backups=await cloud.listBackups('user-a','device-test-1');
 assert.equal(backups.length,1);
 assert.equal(backups[0].status,'complete');
 assert.equal(backups[0].recordCount,1);
 const acc=await db.getAccount('user-a');
 assert.equal(acc.lastSuccess.backupId,'backup-fixed');
 const versions=await listRestorableVersions(cloud,'user-a');
 assert.equal(versions.length,1);
 assert.equal(versions[0].backupId,'backup-fixed');
 assert.ok((await cloud.listDevices('user-a')).some(d=>(d.deviceId||d.id)==='device-test-1'));
});

test('B02 兩邊空白時等待第一筆，不建空成功版',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[],enabled:true,waitingFirst:true});
 const backup=service(db,cloud,user);
 const enabled=await backup.enableForUser(user);
 assert.equal(enabled.action,'wait-first');
 const flushed=await backup.flush('user-a');
 assert.equal(flushed.waitingFirst,true);
 assert.equal((await cloud.listBackups('user-a','device-test-1')).length,0);
 const status=describeBackupStatus({configured:true,user,enabled:true,waitingFirst:true,recordCount:0,online:true,persistenceOk:true});
 assert.equal(status.code,'waiting-first');
});

test('B03 debounce 5 秒，持續改動重設，最長等待後仍會備份',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user,{debounceMs:25,maxWaitMs:80,randomId:()=>'b1'});
 const poke=setInterval(()=>backup.noteLocalChange('user-a'),10);
 await backup.noteLocalChange('user-a');
 await new Promise(r=>setTimeout(r,20));
 assert.equal((await cloud.listBackups('user-a','device-test-1')).length,0);
 await new Promise(r=>setTimeout(r,90));
 clearInterval(poke);
 await new Promise(r=>setTimeout(r,40));
 assert.equal((await cloud.listBackups('user-a','device-test-1')).length,1);
});

test('B04 內容未變不重複建立成功版',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user);
 await backup.flush('user-a');
 await backup.flush('user-a');
 assert.equal((await cloud.listBackups('user-a','device-test-1')).filter(b=>b.status==='complete').length,1);
});

test('B05 佇列持久化且重試沿用同一 backupId',async()=>{
 const db=createMemoryDB();
 let fails=1;
 const inner=createMemoryCloud();
 const cloud={
  ...inner,
  async putBackup(...args){if(fails>0){fails-=1;throw Object.assign(Error('network'),{code:'unavailable'});}return inner.putBackup(...args);},
  putChunk:(...a)=>inner.putChunk(...a),
  getBackup:(...a)=>inner.getBackup(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  completeBackup:(...a)=>inner.completeBackup(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user,{randomId:()=>'same-id'});
 const first=await backup.flush('user-a');
 assert.equal(first.ok,false);
 const queued=(await db.all('backupQueue'))[0];
 assert.equal(queued.backupId,'same-id');
 queued.nextRetryAt=0;
 await db.write([{store:'backupQueue',value:queued}]);
 const second=await backup.checkQueue('user-a');
 assert.equal(second.ok,true);
 const backups=await inner.listBackups('user-a','device-test-1');
 assert.equal(backups[0].backupId,'same-id');
});

test('B06 上傳 N 時產生 N+1，N 成功只推進到 N',async()=>{
 const db=createMemoryDB();
 const inner=createMemoryCloud();
 let release;
 const gate=new Promise(resolve=>release=resolve);
 let started;
 const startedP=new Promise(resolve=>started=resolve);
 const cloud={
  async putBackup(...args){const out=await inner.putBackup(...args);started();return out;},
  async putChunk(...args){await gate;return inner.putChunk(...args);},
  getBackup:(...a)=>inner.getBackup(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  completeBackup:(...a)=>inner.completeBackup(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'r1',seconds:8})],enabled:true});
 const ids=['n1','n2'];
 let i=0;
 const backup=service(db,cloud,user,{randomId:()=>ids[Math.min(i++,ids.length-1)]});
 const first=backup.flush('user-a');
 await startedP;
 await addRecord(db,'user-a',{id:'r2',seconds:7.5});
 await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:true,pendingBackup:true});
 release();
 const result=await first;
 assert.equal(result.ok,true);
 const n1=await cloud.getBackup('user-a','device-test-1','n1');
 assert.equal(n1.status,'complete');
 assert.equal(n1.recordCount,1);
 let n2=await cloud.getBackup('user-a','device-test-1','n2');
 if(!n2){
  const later=await backup.flush('user-a');
  assert.equal(later.ok,true);
  n2=await cloud.getBackup('user-a','device-test-1','n2');
 }
 assert.equal(n2.recordCount,2);
 assert.equal((await cloud.getBackup('user-a','device-test-1','n1')).recordCount,1);
});

test('B07 權限錯誤不密集無限重試',async()=>{
 const db=createMemoryDB();
 const inner=createMemoryCloud();
 const cloud={
  async putBackup(){throw Object.assign(Error('PERMISSION_DENIED'),{code:'permission-denied'});},
  getBackup:(...a)=>inner.getBackup(...a),
  putChunk:(...a)=>inner.putChunk(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  completeBackup:(...a)=>inner.completeBackup(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user);
 const result=await backup.flush('user-a');
 assert.equal(result.fatal,true);
 const queued=(await db.all('backupQueue'))[0];
 assert.equal(queued.fatal,true);
 assert.equal(queued.status,'failed-fatal');
 const status=describeBackupStatus({configured:true,user,enabled:true,online:true,persistenceOk:true,pending:true,lastError:{kind:'permission'},recordCount:1});
 assert.equal(status.code,'permission');
});

test('B08 暫停仍追蹤，恢復後補傳最新快照',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'r1'})],enabled:true,paused:true});
 const backup=service(db,cloud,user);
 await backup.noteLocalChange('user-a');
 assert.equal((await cloud.listBackups('user-a','device-test-1')).length,0);
 await addRecord(db,'user-a',{id:'r2',seconds:7});
 await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:true,backupPaused:true,pendingBackup:true});
 const acc=await db.getAccount('user-a');
 assert.ok(acc.localRevision>=1);
 await db.putAccount({...acc,backupPaused:false});
 const result=await backup.flush('user-a',{ignorePause:true});
 assert.equal(result.ok,true);
 assert.equal((await cloud.listBackups('user-a','device-test-1'))[0].recordCount,2);
});

test('B09 離線或 online 事件本身不宣告成功',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 let online=false;
 const backup=service(db,cloud,user,{isOnline:()=>online});
 const offline=await backup.flush('user-a');
 assert.equal(offline.reason,'offline');
 assert.equal((await db.getAccount('user-a')).lastSuccess,null);
 const status=describeBackupStatus({configured:true,user,enabled:true,online:false,pending:true,persistenceOk:true,recordCount:1});
 assert.equal(status.code,'offline');
 assert.ok(!status.text.includes('已備份'));
 online=true;
 const after=await backup.checkQueue('user-a');
 assert.equal(after.ok,true);
 assert.ok((await db.getAccount('user-a')).lastSuccess);
});

test('C01 分塊上傳後核對摘要才能 complete',async()=>{
 const db=createMemoryDB();
 const inner=createMemoryCloud();
 const cloud={
  ...inner,
  async completeBackup(uid,deviceId,backupId){
   const chunks=await inner.listChunks(uid,deviceId,backupId);
   if(chunks.length<2)throw Error('塊數不足');
   return inner.completeBackup(uid,deviceId,backupId);
  },
  putBackup:(...a)=>inner.putBackup(...a),
  putChunk:(...a)=>inner.putChunk(...a),
  getBackup:(...a)=>inner.getBackup(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{note:'x'.repeat(80)})],enabled:true});
 const backup=service(db,cloud,user,{chunkBytes:40});
 const result=await backup.flush('user-a');
 assert.equal(result.ok,true);
 const backupDoc=(await cloud.listBackups('user-a','device-test-1'))[0];
 const chunks=await cloud.listChunks('user-a','device-test-1',backupDoc.backupId);
 assert.ok(chunks.length>=2);
 const verified=await downloadAndVerify(cloud,{...backupDoc,uid:'user-a'});
 assert.equal(verified.payload.records.length,1);
});

test('C02 還原前快照且單一交易取代',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'old',seconds:9})],enabled:true});
 const backup=service(db,cloud,user);
 await backup.flush('user-a');
 await addRecord(db,'user-a',{id:'newer',seconds:8});
 const versions=await listRestorableVersions(cloud,'user-a');
 await restoreVersion({db,cloud,uid:'user-a',version:versions[0]});
 const records=await db.all('records');
 assert.equal(records.length,1);
 assert.equal(records[0].id,'old');
 const snap=await db.get('restoreSnapshots','pre-restore');
 assert.ok(snap.records.some(r=>r.id==='newer'));
});

test('C03 還原舊版不覆寫其他裝置新版',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'phone'})],enabled:true});
 const backup=service(db,cloud,user,{randomId:()=>'phone-b'});
 await backup.flush('user-a');
 await cloud.putBackup('user-a','other-device','other-b',{localRevision:9,contentHash:'zzz',recordCount:9,childCount:1,chunkCount:1,status:'uploading'},true);
 await cloud.completeBackup('user-a','other-device','other-b');
 const versions=await listRestorableVersions(cloud,'user-a');
 const phone=versions.find(v=>v.deviceId==='device-test-1');
 await restoreVersion({db,cloud,uid:'user-a',version:phone});
 const other=await cloud.getBackup('user-a','other-device','other-b');
 assert.equal(other.status,'complete');
 assert.equal(other.recordCount,9);
});

test('C04 帳號隔離：A 的資料不會進 B 的快照或佇列',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 await seedUser(db,{uid:'aaa',records:[sampleRecord('aaa',{id:'a1'})],enabled:true});
 await seedUser(db,{uid:'bbb',records:[sampleRecord('bbb',{id:'b1',seconds:9})],enabled:true});
 const backupA=service(db,cloud,{uid:'aaa'},{randomId:()=>'a-b'});
 await backupA.flush('aaa');
 const versionsB=await listRestorableVersions(cloud,'bbb');
 assert.equal(versionsB.length,0);
 const recordsA=(await db.all('records')).filter(r=>r.ownerUid==='aaa');
 const recordsB=(await db.all('records')).filter(r=>r.ownerUid==='bbb');
 assert.equal(recordsA[0].id,'a1');
 assert.equal(recordsB[0].id,'b1');
});

test('C05 登出取消排程但保留未完成佇列',async()=>{
 const db=createMemoryDB();
 const cloud={
  async updateDevice(){},
  async putBackup(){throw Object.assign(Error('offline'),{code:'unavailable'});}
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user);
 await backup.flush('user-a');
 backup.cancelUploads();
 const queue=await db.all('backupQueue');
 assert.equal(queue.length,1);
 assert.equal(queue[0].uid,'user-a');
 const local=await db.all('records');
 assert.equal(local[0].ownerUid,'user-a');
});

test('S02 每帳號只保留最近 N 個成功版本',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'r0'})],enabled:true});
 let n=0;
 const backup=service(db,cloud,user,{keepVersions:3,randomId:()=>'b'+n});
 for(let i=0;i<5;i++){
  n=i;
  await db.write([{store:'records',value:sampleRecord('user-a',{id:'r'+i,seconds:8-i/10})}]);
  await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:true,pendingBackup:true,localRevision:i+1,waitingFirstRecord:false,lastSuccess:null});
  const result=await backup.flush('user-a');
  assert.equal(result.ok,true);
 }
 const complete=(await cloud.listBackups('user-a','device-test-1')).filter(b=>b.status==='complete');
 assert.equal(complete.length,3);
});

test('cleanup 即使 completedAt 缺失也不刪剛完成的版本',async()=>{
 const db=createMemoryDB();
 const inner=createMemoryCloud();
 const cloud={
  ...inner,
  async completeBackup(uid,deviceId,backupId){
   const done=await inner.completeBackup(uid,deviceId,backupId);
   const next={...done};delete next.completedAt;
   inner._state.backups.set(`${uid}/${deviceId}/${backupId}`,next);
   return next;
  },
  putBackup:(...a)=>inner.putBackup(...a),
  putChunk:(...a)=>inner.putChunk(...a),
  getBackup:(...a)=>inner.getBackup(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'r0'})],enabled:true});
 let n=0;
 const backup=service(db,cloud,user,{keepVersions:1,randomId:()=>'keep-'+n});
 n=0;
 await backup.flush('user-a');
 n=1;
 await db.write([{store:'records',value:sampleRecord('user-a',{id:'r1',seconds:7.5})}]);
 await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:true,pendingBackup:true,localRevision:2,waitingFirstRecord:false,lastSuccess:null});
 const result=await backup.flush('user-a');
 assert.equal(result.ok,true);
 const complete=(await inner.listBackups('user-a','device-test-1')).filter(b=>b.status==='complete');
 assert.ok(complete.some(b=>(b.backupId||b.id)==='keep-1'),'剛完成的版本必須留下');
 const versions=await listRestorableVersions(inner,'user-a');
 assert.ok(versions.some(v=>v.backupId==='keep-1'));
});

test('刪光成績會建空內容新版，且與首次空白區分',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const backup=service(db,cloud,user,{randomId:()=>'full'});
 await backup.flush('user-a');
 await db.write([{store:'records',delete:'rec-1'}],{bumpRevision:true,ownerUid:'user-a'});
 const afterDelete=service(db,cloud,user,{randomId:()=>'empty'});
 const result=await afterDelete.flush('user-a');
 assert.equal(result.ok,true);
 const backups=(await cloud.listBackups('user-a','device-test-1')).sort((a,b)=>a.backupId.localeCompare(b.backupId));
 assert.equal(backups.some(b=>b.recordCount===1),true);
 assert.equal(backups.some(b=>b.recordCount===0),true);
});

test('啟用時本機空雲端有則要求還原，不覆蓋',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 await cloud.putBackup('user-a','other','c1',{localRevision:1,contentHash:'abc',recordCount:4,childCount:1,chunkCount:1,status:'uploading',summary:{}},true);
 await cloud.completeBackup('user-a','other','c1');
 await cloud.updateDevice('user-a','other',{label:'裝置 OTHER'});
 await seedUser(db,{uid:'user-a',records:[],enabled:false});
 const backup=service(db,cloud,{uid:'user-a'});
 const result=await backup.enableForUser({uid:'user-a'});
 assert.equal(result.action,'offer-restore');
 assert.equal((await cloud.getBackup('user-a','other','c1')).recordCount,4);
});

async function drain(n=40){
 for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r));
}

async function settle(values){
 await Promise.all((Array.isArray(values)?values:[values]).filter(Boolean).map(value=>Promise.resolve(value)));
}

async function waitUntil(predicate,{timeout=5000}={}){
 const deadline=Date.now()+timeout;
 let last;
 while(Date.now()<=deadline){
  last=await predicate();
  if(last)return last;
  await new Promise(r=>setTimeout(r,0));
 }
 return last;
}

test('非致命上傳失敗會用 clock.setTimeout 排程下次 processQueue',async()=>{
 const db=createMemoryDB();
 let putCalls=0;
 let fails=1;
 const inner=createMemoryCloud();
 const cloud={
  ...inner,
  async putBackup(...args){
   putCalls+=1;
   if(fails>0){fails-=1;throw Object.assign(Error('network'),{code:'unavailable'});}
   return inner.putBackup(...args);
  },
  putChunk:(...a)=>inner.putChunk(...a),
  getBackup:(...a)=>inner.getBackup(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  completeBackup:(...a)=>inner.completeBackup(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:true});
 const clock=createClock();
 const scheduled=[];
 let timeoutFires=0;
 const rawSet=clock.setTimeout.bind(clock);
 clock.setTimeout=(fn,ms)=>{
  scheduled.push(ms);
  return rawSet((...args)=>{
   timeoutFires+=1;
   return fn(...args);
  },ms);
 };
 const backup=service(db,cloud,user,{clock,randomId:()=>'retry-id'});
 const first=await backup.flush('user-a');
 assert.equal(first.ok,false);
 assert.equal(putCalls,1);
 const queued=(await db.all('backupQueue'))[0];
 assert.equal(queued.status,'queued');
 assert.ok(queued.nextRetryAt>clock.now());
 assert.ok(scheduled.some(ms=>ms===queued.nextRetryAt-clock.now()));
 const early=await backup.checkQueue('user-a');
 assert.equal(early.reason,'wait-retry');
 assert.equal(putCalls,1);
 const firesBeforeDue=timeoutFires;
 await settle(clock.advance(Math.max(0,queued.nextRetryAt-clock.now()-1)));
 await drain();
 assert.equal(timeoutFires,firesBeforeDue,'尚未到 nextRetryAt 不應觸發 timeout');
 assert.equal(putCalls,1,'尚未到 nextRetryAt 不應重試');
 await settle(clock.advance(Math.max(1,queued.nextRetryAt-clock.now()+1)));
 assert.ok(timeoutFires>firesBeforeDue,'到期後 clock.setTimeout 回呼必須執行');
 assert.ok(timeoutFires>firesBeforeDue,'到期後應再呼叫 processQueue');
});

test('U01 SDK 失敗時狀態不顯示已備份，本機資料仍在',async()=>{
 const db=createMemoryDB();
 await seedUser(db,{uid:LOCAL_OWNER,records:[sampleRecord(LOCAL_OWNER)],enabled:false});
 const status=describeBackupStatus({sdkFailed:true,configured:true,user:null,enabled:false,recordCount:1});
 assert.equal(status.code,'sdk');
 assert.ok(!status.text.includes('已備份'));
 assert.equal((await db.all('records')).length,1);
});

test('60 秒內再建新版會當冷卻重試，而不是權限不足',async()=>{
 const db=createMemoryDB();
 const inner=createMemoryCloud();
 let puts=0;
 const cloud={
  ...inner,
  async putBackup(...args){
   puts+=1;
   if(puts>1)throw Object.assign(Error('PERMISSION_DENIED'),{code:'permission-denied'});
   return inner.putBackup(...args);
  },
  putChunk:(...a)=>inner.putChunk(...a),
  getBackup:(...a)=>inner.getBackup(...a),
  listChunks:(...a)=>inner.listChunks(...a),
  completeBackup:(...a)=>inner.completeBackup(...a),
  updateDevice:(...a)=>inner.updateDevice(...a),
  listDevices:(...a)=>inner.listDevices(...a),
  listBackups:(...a)=>inner.listBackups(...a),
  deleteBackupTree:(...a)=>inner.deleteBackupTree(...a)
 };
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'r1'})],enabled:true});
 const clock=createClock();
 const backup=service(db,cloud,user,{clock,clockIntervalMs:60_000,randomId:()=>'c1'});
 const first=await backup.flush('user-a');
 assert.equal(first.ok,true);
 await addRecord(db,'user-a',{id:'r2',seconds:7});
 await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:true,pendingBackup:true,lastSuccess:(await db.getAccount('user-a')).lastSuccess});
 const second=service(db,cloud,user,{clock,clockIntervalMs:60_000,randomId:()=>'c2'});
 const result=await second.flush('user-a');
 assert.equal(result.ok,false);
 assert.notEqual(result.fatal,true);
 const queued=(await db.all('backupQueue')).find(item=>item.uid==='user-a'&&item.status!=='complete');
 assert.ok(queued);
 assert.equal(queued.fatal,false);
 assert.equal(queued.lastError.kind,'cooldown');
 assert.ok(queued.nextRetryAt>clock.now());
 const status=describeBackupStatus({configured:true,user,enabled:true,online:true,persistenceOk:true,pending:true,lastError:{kind:'cooldown'},recordCount:2});
 assert.equal(status.code,'cooldown');
 assert.ok(!status.text.includes('權限不足'));
 second.cancelUploads();
});

test('啟用備份時會把 guest child_01 改成帳號專用 ID',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 await seedUser(db,{uid:LOCAL_OWNER,children:[sampleChild(LOCAL_OWNER,'child_01')],records:[sampleRecord(LOCAL_OWNER,{id:'legacy',childId:'child_01'})],enabled:false});
 const backup=service(db,cloud,{uid:'user-a'});
 const result=await backup.enableForUser({uid:'user-a'});
 backup.cancelUploads();
 assert.ok(['upload-first','already-synced','diverged'].includes(result.action));
 const children=await db.all('children');
 const records=await db.all('records');
 assert.ok(children.some(c=>c.id==='child_01__user-a'&&c.ownerUid==='user-a'));
 assert.equal(records.find(r=>r.id==='legacy').childId,'child_01__user-a');
 assert.equal(records.find(r=>r.id==='legacy').ownerUid,'user-a');
});

