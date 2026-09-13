import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBackupService} from '../backup.js';
import {restoreVersion,downloadAndVerify} from '../restore.js';
import {createMemoryDB,sampleRecord,seedUser} from './support.js';

const emulatorHost=process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_FIRESTORE_EMULATOR_HOST;
let rulesTesting=null;
try{rulesTesting=await import('@firebase/rules-unit-testing');}catch{rulesTesting=null;}
const canRun=Boolean(rulesTesting&&emulatorHost);

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
 // rules-unit-testing 的 useEmulator 必須在自動連線之前；否則會報 already been started
 const savedHost=process.env.FIRESTORE_EMULATOR_HOST;
 delete process.env.FIRESTORE_EMULATOR_HOST;
 try{
  const aliceFs=testEnv.authenticatedContext('alice').firestore();
  const bobFs=testEnv.authenticatedContext('bob').firestore();
  const anonFs=testEnv.unauthenticatedContext().firestore();
  const path='users/alice/devices/d1/backups/b1';
  await assertSucceeds(aliceFs.doc(path).set({
   schemaVersion:1,backupId:'b1',uid:'alice',deviceId:'d1',localRevision:1,
   contentHash:'abc',recordCount:1,childCount:1,chunkCount:1,status:'uploading'
  }));
  await assertFails(bobFs.doc(path).get());
  await assertFails(anonFs.doc(path).get());
  await assertFails(anonFs.doc('users/alice').set({hack:true}));
  await assertSucceeds(aliceFs.doc(path).update({status:'complete'}));
  await assertFails(aliceFs.doc(path).update({status:'uploading'}));

  const cloud=createCompatCloud(aliceFs);
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
  assert.equal((await db.all('records'))[0].id,'emu-1');
  console.log('EMULATOR_BACKUP_OK',JSON.stringify({backupId:'emu-backup-1',status:remote.status,recordCount:remote.recordCount,chunkCount:remote.chunkCount,contentHash:remote.contentHash}));
 }finally{
  if(savedHost)process.env.FIRESTORE_EMULATOR_HOST=savedHost;
  await testEnv.cleanup();
 }
});

function createCompatCloud(firestore){
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
