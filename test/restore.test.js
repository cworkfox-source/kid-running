import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {restoreVersion,restorePreview,queryRestorableVersions,restoreListCopy,listRestorableVersions} from '../restore.js';
import {createBackupService} from '../backup.js';
import {createMemoryCloud} from '../cloud.js';
import {createMemoryDB,sampleRecord,seedUser} from './support.js';
import {splitUtf8Chunks} from '../core.js';

function service(db,cloud,user){
 return createBackupService({
  db,getCloud:()=>cloud,getUser:()=>user,getAppMeta:async()=>({deviceId:'device-test-1'}),
  isOnline:()=>true,tabId:'tab-1',randomId:()=>'backup-fixed',random:()=>0.5,
  splitChunks:text=>splitUtf8Chunks(text,256*1024)
 });
}

test('離線／權限／登入過期不可標成還沒有備份',async()=>{
 const empty=await queryRestorableVersions({async listDevices(){return [];}},'user-a');
 assert.equal(empty.status,'empty');
 assert.match(restoreListCopy(empty.status),/還沒有可還原/);

 const offline=await queryRestorableVersions({async listDevices(){throw Object.assign(Error('offline'),{code:'unavailable'});}},'user-a');
 assert.equal(offline.status,'offline');
 assert.doesNotMatch(restoreListCopy(offline.status),/還沒有可還原/);

 const skipped=await queryRestorableVersions({async listDevices(){throw Error('should not fetch');}},'user-a',{online:false});
 assert.equal(skipped.status,'offline');
 assert.doesNotMatch(restoreListCopy(skipped.status),/還沒有可還原/);

 const permission=await queryRestorableVersions({async listDevices(){throw Object.assign(Error('PERMISSION_DENIED'),{code:'permission-denied'});}},'user-a');
 assert.equal(permission.status,'permission');
 assert.doesNotMatch(restoreListCopy(permission.status),/還沒有可還原/);

 const reauth=await queryRestorableVersions({async listDevices(){throw Object.assign(Error('token expired'),{code:'unauthenticated'});}},'user-a');
 assert.equal(reauth.status,'reauth');
 assert.doesNotMatch(restoreListCopy(reauth.status),/還沒有可還原/);

 const signedOut=await queryRestorableVersions(null,null);
 assert.equal(signedOut.status,'signed-out');
 assert.match(restoreListCopy(signedOut.status),/不必先開啟本機自動備份/);
});

test('已登入即可查版本，不必本機 backupEnabled',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a')],enabled:false});
 const user={uid:'user-a'};
 const enabled=service(db,cloud,user);
 await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:true});
 await enabled.flush('user-a');
 await db.putAccount({...(await db.getAccount('user-a')),backupEnabled:false});
 const listed=await queryRestorableVersions(cloud,'user-a');
 assert.equal(listed.status,'ready');
 assert.equal(listed.versions.length,1);
});

test('還原預覽含日期、來源裝置、筆數與本機將被取代數',()=>{
 const preview=restorePreview({
  deviceId:'device-test-1',
  deviceLabel:'裝置 TEST',
  completedAt:'2026-09-13T01:02:00.000Z',
  completedLabel:'9/13 09:02',
  recordCount:4,
  childCount:1
 },7);
 assert.equal(preview.deviceLabel,'裝置 TEST');
 assert.equal(preview.completedLabel,'9/13 09:02');
 assert.equal(preview.recordCount,4);
 assert.equal(preview.localRecordCount,7);
 assert.match(preview.replaceScope,/7 筆/);
});

test('完整性檢查失敗時不刪本機資料、不寫還原快照',async()=>{
 const db=createMemoryDB();
 const cloud=createMemoryCloud();
 const user={uid:'user-a'};
 await seedUser(db,{uid:'user-a',records:[sampleRecord('user-a',{id:'keep-me',seconds:9})],enabled:true});
 const backup=service(db,cloud,user);
 await backup.flush('user-a');
 const versions=await listRestorableVersions(cloud,'user-a');
 const broken={...versions[0],contentHash:'0'.repeat(64)};
 let writes=0;
 const wrapped={
  ...db,
  async write(changes,options){writes+=1;return db.write(changes,options);},
  async saveRestoreSnapshot(snapshot){throw Error('不應先存快照');}
 };
 await assert.rejects(()=>restoreVersion({db:wrapped,cloud,uid:'user-a',version:broken}),/內容摘要不符|完整性/);
 assert.equal(writes,0);
 const records=await db.all('records');
 assert.equal(records.length,1);
 assert.equal(records[0].id,'keep-me');
 assert.equal(await db.get('restoreSnapshots','pre-restore'),undefined);
});

test('查詢失敗會保留先前版本，不改寫成空清單',async()=>{
 const previous=[{backupId:'old',deviceId:'d1',recordCount:3}];
 const result=await queryRestorableVersions({
  async listDevices(){throw Object.assign(Error('network'),{code:'unavailable'});}
 },'user-a',{previous});
 assert.equal(result.status,'offline');
 assert.equal(result.versions,previous);
});

test('app.js 設定頁還原入口不依 backupEnabled 隱藏，備份成功會刷新清單',async()=>{
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
 assert.match(app,/從 Firebase 還原/);
 assert.match(app,/queryRestorableVersions/);
 assert.match(app,/loadVersions\(\)/);
 assert.match(app,/lastSuccessKey/);
 assert.match(app,/clearRestoreList/);
 assert.doesNotMatch(app,/if\(!authUser\|\|!accountState\?\.backupEnabled\)return '<p class="quiet">啟用備份後/);
 assert.doesNotMatch(app,/catch\{versions=\[\];\}/);
 assert.match(app,/本機資料未被刪除/);
 assert.match(app,/confirm-restore/);
});
