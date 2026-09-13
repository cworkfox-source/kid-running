import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBackupService} from '../backup.js';
import {createFirestoreCloud} from '../cloud.js';
import {restoreVersion,downloadAndVerify} from '../restore.js';
import {createMemoryDB,sampleRecord,seedUser} from './support.js';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_FIRESTORE_EMULATOR_HOST;
let rulesTesting=null;
let firebaseApp=null;
let firebaseFs=null;

try{
 rulesTesting=await import('@firebase/rules-unit-testing');
 firebaseApp=await import('firebase/app');
 firebaseFs=await import('firebase/firestore');
}catch{
 rulesTesting=null;
}

const canRun=Boolean(rulesTesting&&emulatorHost);

test('emulator 環境可用',{skip:!canRun},()=>{
 assert.ok(emulatorHost);
});

async function loadRules(){
 return readFile(new URL('../firestore.rules',import.meta.url),'utf8');
}

test('S01 規則：不同 uid 不可互讀寫，未登入不可公開讀寫',{skip:!canRun},async()=>{
 const {initializeTestEnvironment,assertFails,assertSucceeds}=rulesTesting;
 const testEnv=await initializeTestEnvironment({
  projectId:'demo-kid-running-rules',
  firestore:{rules:await loadRules(),host:'127.0.0.1',port:Number(String(emulatorHost).split(':').at(-1)||8080)}
 });
 try{
  const alice=testEnv.authenticatedContext('alice');
  const bob=testEnv.authenticatedContext('bob');
  const anon=testEnv.unauthenticatedContext();
  const path='users/alice/devices/d1/backups/b1';
  await assertSucceeds(alice.firestore().doc(path).set({
   schemaVersion:1,backupId:'b1',uid:'alice',deviceId:'d1',localRevision:1,
   contentHash:'abc',recordCount:1,childCount:1,chunkCount:1,status:'uploading'
  }));
  await assertFails(bob.firestore().doc(path).get());
  await assertFails(bob.firestore().doc(path).set({status:'complete'}));
  await assertFails(anon.firestore().doc(path).get());
  await assertFails(anon.firestore().doc('users/alice').set({hack:true}));
  await assertSucceeds(alice.firestore().doc(path).update({status:'complete',contentHash:'abc',uid:'alice',deviceId:'d1',backupId:'b1',localRevision:1,recordCount:1,childCount:1,chunkCount:1,schemaVersion:1}));
  await assertFails(alice.firestore().doc(path).update({status:'uploading',contentHash:'abc',uid:'alice',deviceId:'d1',backupId:'b1',localRevision:1}));
 }finally{
  await testEnv.cleanup();
 }
});

test('Emulator 備份流程可完成並還原',{skip:!canRun},async()=>{
 const {initializeTestEnvironment}=rulesTesting;
 const port=Number(String(emulatorHost).split(':').at(-1)||8080);
 const testEnv=await initializeTestEnvironment({
  projectId:'demo-kid-running-backup',
  firestore:{rules:await loadRules(),host:'127.0.0.1',port}
 });
 try{
  const alice=testEnv.authenticatedContext('alice');
  const firestore=alice.firestore();
  // rules-unit-testing 給的是 compat；轉成我們的 adapter 介面
  const cloud=createCompatCloud(firestore);
  const db=createMemoryDB();
  await seedUser(db,{uid:'alice',records:[sampleRecord('alice',{id:'emu-1',seconds:7.42})],enabled:true});
  const backup=createBackupService({
   db,getCloud:()=>cloud,getUser:()=>({uid:'alice'}),getAppMeta:async()=>({deviceId:'emu-device'}),
   isOnline:()=>true,tabId:'emu-tab',randomId:()=>'emu-backup-1'
  });
  const result=await backup.flush('alice');
  assert.equal(result.ok,true,result.error?.message||result.reason||'flush');
  const remote=await cloud.getBackup('alice','emu-device','emu-backup-1');
  assert.equal(remote.status,'complete');
  assert.equal(remote.recordCount,1);
  const verified=await downloadAndVerify(cloud,{...remote,uid:'alice',deviceId:'emu-device',backupId:'emu-backup-1'});
  assert.equal(verified.payload.records[0].seconds,7.42);
  await db.write([{store:'records',delete:'emu-1'}]);
  await restoreVersion({db,cloud,uid:'alice',version:{...remote,uid:'alice',deviceId:'emu-device',backupId:'emu-backup-1'}});
  const restored=(await db.all('records'))[0];
  assert.equal(restored.id,'emu-1');
  console.log('EMULATOR_BACKUP_OK',JSON.stringify({backupId:'emu-backup-1',status:remote.status,recordCount:remote.recordCount,chunkCount:remote.chunkCount,contentHash:remote.contentHash}));
 }finally{
  await testEnv.cleanup();
 }
});

function createCompatCloud(firestore){
 const ts=()=>firebaseFs.Timestamp?.now?.()||new Date();
 return {
  async putBackup(uid,deviceId,backupId,data,isNew){
   const ref=firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`);
   const payload={schemaVersion:1,backupId,uid,deviceId,...data};
   if(isNew)payload.createdAt=new Date();
   await ref.set(payload,{merge:!isNew});
  },
  async putChunk(uid,deviceId,backupId,chunk){
   await firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}/chunks/${chunk.index}`).set(chunk);
  },
  async getBackup(uid,deviceId,backupId){
   const snap=await firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`).get();
   return snap.exists?{id:snap.id,...snap.data()}:null;
  },
  async listChunks(uid,deviceId,backupId){
   const snap=await firestore.collection(`users/${uid}/devices/${deviceId}/backups/${backupId}/chunks`).get();
   return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.index-b.index);
  },
  async completeBackup(uid,deviceId,backupId){
   const ref=firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`);
   await ref.update({status:'complete',completedAt:new Date()});
   const snap=await ref.get();
   return {id:snap.id,...snap.data()};
  },
  async updateDevice(uid,deviceId,patch){
   await firestore.doc(`users/${uid}/devices/${deviceId}`).set({uid,deviceId,...patch,updatedAt:new Date()},{merge:true});
  },
  async listDevices(uid){
   const snap=await firestore.collection(`users/${uid}/devices`).get();
   return snap.docs.map(d=>({id:d.id,...d.data()}));
  },
  async listBackups(uid,deviceId){
   const snap=await firestore.collection(`users/${uid}/devices/${deviceId}/backups`).get();
   return snap.docs.map(d=>({id:d.id,...d.data()}));
  },
  async deleteBackupTree(uid,deviceId,backupId){
   const chunks=await firestore.collection(`users/${uid}/devices/${deviceId}/backups/${backupId}/chunks`).get();
   for(const doc of chunks.docs)await doc.ref.delete();
   await firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`).delete();
  }
 };
}
