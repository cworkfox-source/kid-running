import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBackupService} from '../backup.js';
import {restoreVersion,downloadAndVerify} from '../restore.js';
import {createMemoryDB,sampleRecord,seedUser} from './support.js';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_FIRESTORE_EMULATOR_HOST;
let rulesTesting=null;
try{rulesTesting=await import('@firebase/rules-unit-testing');}catch{rulesTesting=null;}
const canRun=Boolean(rulesTesting&&emulatorHost);
const HASH='a'.repeat(64);

test('emulator 環境可用',{skip:!canRun},()=>{
 assert.ok(emulatorHost);
});

test('S01 規則與 Emulator 備份還原',{skip:!canRun},async()=>{
 const {initializeTestEnvironment,assertFails,assertSucceeds}=rulesTesting;
 const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
 const testEnv=await initializeTestEnvironment({
  projectId:'demo-kid-running-backup',
  firestore:{rules}
 });
 const savedHost=process.env.FIRESTORE_EMULATOR_HOST;
 delete process.env.FIRESTORE_EMULATOR_HOST;
 try{
  const aliceFs=testEnv.authenticatedContext('alice').firestore();
  const bobFs=testEnv.authenticatedContext('bob').firestore();
  const anonFs=testEnv.unauthenticatedContext().firestore();
  const ts=timestamp;
  const path='users/alice/devices/d1/backups/b1';
  await assertFails(anonFs.doc('users/alice').set({hack:true}));
  await assertFails(bobFs.doc(path).get());
  await assertFails(anonFs.doc(path).get());
  await assertFails(aliceFs.doc(path).set({
   schemaVersion:1,backupId:'b1',uid:'alice',deviceId:'d1',localRevision:1,
   contentHash:HASH,recordCount:1,childCount:1,chunkCount:1,status:'uploading'
  }));

  const first=aliceFs.batch();
  first.set(aliceFs.doc('users/alice'),{uid:'alice',lastBackupAt:ts(),lastBackupId:'b1'});
  first.set(aliceFs.doc(path),{
   schemaVersion:1,backupId:'b1',uid:'alice',deviceId:'d1',localRevision:1,
   contentHash:HASH,recordCount:1,childCount:1,chunkCount:1,status:'uploading',
   summary:{latestDate:'2026-09-13',recordCount:1,childCount:1},createdAt:ts()
  });
  await assertSucceeds(first.commit());

  const second=aliceFs.batch();
  second.set(aliceFs.doc('users/alice'),{uid:'alice',lastBackupAt:ts(),lastBackupId:'b2'},{merge:true});
  second.set(aliceFs.doc('users/alice/devices/d1/backups/b2'),{
   schemaVersion:1,backupId:'b2',uid:'alice',deviceId:'d1',localRevision:2,
   contentHash:HASH,recordCount:1,childCount:1,chunkCount:1,status:'uploading',
   summary:{latestDate:'2026-09-13',recordCount:1,childCount:1},createdAt:ts()
  });
  await assertFails(second.commit());

  const complete=aliceFs.batch();
  complete.update(aliceFs.doc(path),{status:'complete',completedAt:ts()});
  complete.set(aliceFs.doc('users/alice'),{completeCount:1,lastCompletedBackupId:'b1',lastCompletedDeviceId:'d1'},{merge:true});
  await assertSucceeds(complete.commit());
  await assertFails(aliceFs.doc(path).update({status:'uploading'}));

  const unboundBump=aliceFs.batch();
  unboundBump.set(aliceFs.doc('users/alice'),{completeCount:0,lastDeletedBackupId:'b1',lastDeletedDeviceId:'d1'},{merge:true});
  await assertFails(unboundBump.commit());

  await testEnv.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   await db.doc('users/alice').set({uid:'alice',completeCount:10,lastBackupAt:new Date(0),lastBackupId:'old'},{merge:true});
   await db.doc('users/alice/devices/d1/backups/b11').set({
    schemaVersion:1,backupId:'b11',uid:'alice',deviceId:'d1',localRevision:11,
    contentHash:HASH,recordCount:1,childCount:1,chunkCount:1,status:'uploading',
    summary:{recordCount:1},createdAt:new Date()
   });
  });
  const eleventh=aliceFs.batch();
  eleventh.update(aliceFs.doc('users/alice/devices/d1/backups/b11'),{status:'complete',completedAt:ts()});
  eleventh.set(aliceFs.doc('users/alice'),{completeCount:11,lastCompletedBackupId:'b11',lastCompletedDeviceId:'d1'},{merge:true});
  await assertFails(eleventh.commit());

  await testEnv.withSecurityRulesDisabled(async context=>{
   const db=context.firestore();
   await db.doc('users/alice').set({uid:'alice',completeCount:1,lastBackupAt:new Date(0),lastBackupId:'b1'},{merge:true});
  });

  const cloud=createCompatCloud(aliceFs);
  const db=createMemoryDB();
  await seedUser(db,{uid:'alice',records:[sampleRecord('alice',{id:'emu-1',seconds:7.42})],enabled:true});
  const backup=createBackupService({
   db,getCloud:()=>cloud,getUser:()=>({uid:'alice'}),getAppMeta:async()=>({deviceId:'emu-device'}),
   isOnline:()=>true,tabId:'emu-tab',randomId:()=>'emu-backup-1',clockIntervalMs:0
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
  assert.equal((await db.all('records'))[0].id,'emu-1');
  console.log('EMULATOR_BACKUP_OK',JSON.stringify({backupId:'emu-backup-1',status:remote.status,recordCount:remote.recordCount,chunkCount:remote.chunkCount,contentHash:remote.contentHash}));
 }finally{
  if(savedHost)process.env.FIRESTORE_EMULATOR_HOST=savedHost;
  await testEnv.cleanup();
 }
});

function timestamp(){return firebase.firestore.FieldValue.serverTimestamp();}

function createCompatCloud(firestore){
 const ts=timestamp;
 return {
  async putBackup(uid,deviceId,backupId,data,isNew){
   const ref=firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`);
   const payload={schemaVersion:1,backupId,uid,deviceId,...data};
   if(isNew){
    payload.createdAt=ts();
    const batch=firestore.batch();
    batch.set(firestore.doc(`users/${uid}`),{uid,lastBackupAt:ts(),lastBackupId:backupId},{merge:true});
    batch.set(ref,payload);
    await batch.commit();
    return;
   }
   await ref.set(payload,{merge:true});
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
  async initializeCompleteCount(uid){
   const userRef=firestore.doc(`users/${uid}`);
   const userSnap=await userRef.get();
   if(userSnap.exists&&Number.isFinite(userSnap.data()?.completeCount))return userSnap.data().completeCount;
   const groups=await Promise.all((await this.listDevices(uid)).map(device=>this.listBackups(uid,device.deviceId||device.id)));
   const count=groups.flat().filter(backup=>backup.status==='complete').length;
   await userRef.set({completeCount:count,completeCountInitializedAt:ts()},{merge:true});
   return count;
  },
  async completeBackup(uid,deviceId,backupId){
   const userRef=firestore.doc(`users/${uid}`);
   const userSnap=await userRef.get();
   const count=userSnap.exists&&Number.isFinite(userSnap.data()?.completeCount)?userSnap.data().completeCount:0;
   const batch=firestore.batch();
   batch.update(firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`),{status:'complete',completedAt:ts()});
   batch.set(userRef,{completeCount:count+1,lastCompletedBackupId:backupId,lastCompletedDeviceId:deviceId},{merge:true});
   await batch.commit();
   const snap=await firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`).get();
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
   const metaSnap=await firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`).get();
   const meta=metaSnap.exists?metaSnap.data():null;
   const chunks=await firestore.collection(`users/${uid}/devices/${deviceId}/backups/${backupId}/chunks`).get();
   for(const doc of chunks.docs)await doc.ref.delete();
   const batch=firestore.batch();
   batch.delete(firestore.doc(`users/${uid}/devices/${deviceId}/backups/${backupId}`));
   if(meta?.status==='complete'){
    const userRef=firestore.doc(`users/${uid}`);
    const snap=await userRef.get();
    const count=snap.exists&&Number.isFinite(snap.data()?.completeCount)?snap.data().completeCount:0;
    batch.set(userRef,{completeCount:Math.max(0,count-1),lastDeletedBackupId:backupId,lastDeletedDeviceId:deviceId},{merge:true});
   }
   await batch.commit();
  }
 };
}
