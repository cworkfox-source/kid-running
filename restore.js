import {LOCAL_OWNER,sameOwner,backupContent,stableStringify,sha256,classifyBackupError,remapBackupChildIds} from './core.js';
import {deviceLabel,formatBackupTime,resolveDeviceId} from './backup.js';

function mapRestorable(backup,device,deviceId){
 return {
  ...backup,
  backupId:backup.backupId||backup.id,
  deviceId:backup.deviceId||deviceId,
  deviceLabel:device?.label||deviceLabel(deviceId),
  completedLabel:formatBackupTime(backup.completedAt)
 };
}

export async function listRestorableVersions(cloud,uid,{lastSuccess}={}){
 if(!cloud||!uid)return [];
 const versions=[];
 const seen=new Set();
 async function collect(device){
  const deviceId=resolveDeviceId(device);
  if(!deviceId||seen.has(deviceId))return;
  seen.add(deviceId);
  const backups=await cloud.listBackups(uid,deviceId);
  for(const backup of backups){
   if(backup.status!=='complete')continue;
   versions.push(mapRestorable(backup,device,deviceId));
  }
 }
 const devices=await cloud.listDevices(uid);
 for(const device of devices)await collect(device);
 const hintId=resolveDeviceId(lastSuccess);
 if(hintId&&!seen.has(hintId)){
  await collect({id:hintId,deviceId:hintId,label:lastSuccess.deviceLabel});
  if(typeof cloud.updateDevice==='function'){
   try{
    await cloud.updateDevice(uid,hintId,{
     label:lastSuccess.deviceLabel||deviceLabel(hintId),
     lastBackupId:lastSuccess.backupId,
     lastLocalRevision:lastSuccess.localRevision,
     lastContentHash:lastSuccess.contentHash,
     lastRecordCount:lastSuccess.recordCount,
     lastCompletedAt:lastSuccess.completedAt
    });
   }catch{/* 修復父文件失敗仍回傳已列出的版本 */}
  }
 }
 versions.sort((a,b)=>+new Date(b.completedAt?.toDate?.()||b.completedAt||0)-+new Date(a.completedAt?.toDate?.()||a.completedAt||0));
 return versions;
}

export function restoreListCopy(status,versions=[],extra={}){
 const texts={
  'signed-out':'登入 Google 帳號後即可查詢雲端版本。不必先開啟本機自動備份。',
  unavailable:'雲端元件尚未就緒，請稍後再試。',
  idle:'尚未查詢雲端版本。',
  loading:'正在查詢可還原的雲端版本…',
  empty:'還沒有可還原的成功版本。未完成的上傳不會出現在這裡。',
  inconsistent:'本機顯示已備份，但雲端目前找不到可還原的成功版本。請按「立即備份」再查一次。',
  offline:'目前離線或連線失敗，無法查詢雲端版本。',
  permission:'沒有權限讀取雲端版本。',
  reauth:'登入已過期，請重新登入後再查詢版本。',
  error:'查詢雲端版本失敗，請再試一次。',
  ready:`找到 ${versions.length} 個可還原的成功版本。`
 };
 if(status==='empty'&&(extra.lastSuccess?.deviceId||extra.lastSuccess?.backupId))return texts.inconsistent;
 return texts[status]||texts.error;
}

export async function queryRestorableVersions(cloud,uid,{online=true,previous=[],lastSuccess}={}){
 if(!uid)return {status:'signed-out',versions:[],error:null};
 if(!cloud)return {status:'unavailable',versions:[],error:null};
 if(online===false)return {status:'offline',versions:previous,error:{kind:'network',code:'unavailable',fatal:false}};
 try{
  const versions=await listRestorableVersions(cloud,uid,{lastSuccess});
  if(versions.length)return {status:'ready',versions,error:null};
  if(lastSuccess?.deviceId||lastSuccess?.backupId)return {status:'inconsistent',versions,error:null};
  return {status:'empty',versions,error:null};
 }catch(error){
  const classified=classifyBackupError(error);
  const status=classified.kind==='reauth'?'reauth':classified.kind==='permission'?'permission':classified.kind==='network'?'offline':'error';
  return {status,versions:previous,error:classified};
 }
}

export async function downloadAndVerify(cloud,version,sha=sha256){
 const chunks=await cloud.listChunks(version.uid,version.deviceId,version.backupId);
 if(chunks.length!==version.chunkCount)throw Error('還原失敗：塊數不完整');
 const ordered=[...chunks].sort((a,b)=>a.index-b.index);
 for(let i=0;i<ordered.length;i++){
  if(ordered[i].index!==i)throw Error('還原失敗：塊序不正確');
  const digest=await sha(ordered[i].data);
  if(digest!==ordered[i].digest)throw Error('還原失敗：塊摘要不符');
 }
 const text=ordered.map(c=>c.data).join('');
 const hash=await sha(text);
 if(hash!==version.contentHash)throw Error('還原失敗：內容摘要不符');
 const payload=JSON.parse(text);
 if(!payload||payload.schemaVersion!==1||!Array.isArray(payload.records)||!Array.isArray(payload.children))throw Error('還原失敗：內容格式無效');
 const roundTrip=await sha(stableStringify(payload));
 if(roundTrip!==version.contentHash&&roundTrip!==hash){
  // payload 可能已是穩定序列化字串的 JSON 還原；以實際下載字串雜湊為準
 }
 return {payload,text,hash};
}

export async function restoreVersion({db,cloud,uid,version,settings,sha=sha256}){
 const verified=await downloadAndVerify(cloud,version,sha);
 if(!verified?.payload)throw Error('還原失敗：完整性檢查未通過');
 const payload=verified.payload;
 const [records,children,allSettings,account]=await Promise.all([
  db.all('records'),db.all('children'),db.all('settings'),db.getAccount(uid)
 ]);
 await db.saveRestoreSnapshot({
  ownerUid:uid,
  records:records.filter(r=>sameOwner(r,uid)),
  children:children.filter(c=>sameOwner(c,uid)),
  settings:allSettings.filter(s=>s.id===`reverse:${uid}`||(uid===LOCAL_OWNER&&s.id==='reverse')),
  account
 });
 const changes=[];
 for(const rec of records.filter(r=>sameOwner(r,uid)))changes.push({store:'records',delete:rec.id});
 for(const child of children.filter(c=>sameOwner(c,uid)))changes.push({store:'children',delete:child.id});
 const reverseId=`reverse:${uid}`;
 const reverse=allSettings.find(s=>s.id===reverseId);
 if(reverse)changes.push({store:'settings',delete:reverseId});
 const occupied=new Set(children.filter(c=>!sameOwner(c,uid)).map(c=>c.id));
 const remapped=remapBackupChildIds(payload,uid,occupied);
 for(const child of remapped.children){
  changes.push({store:'children',value:{...child,ownerUid:uid}});
 }
 for(const rec of remapped.records){
  changes.push({store:'records',value:{...rec,ownerUid:uid}});
 }
 if(payload.settings&&typeof payload.settings.reverse==='boolean'){
  changes.push({store:'settings',value:{id:reverseId,value:payload.settings.reverse,ownerUid:uid}});
 }
 await db.write(changes,{bumpRevision:true,ownerUid:uid,pendingBackup:true});
 const after=await db.getAccount(uid);
 await db.putAccount({
  ...after,
  waitingFirstRecord:remapped.records.length===0,
  lastError:null
 });
 return {payload:{...payload,children:remapped.children,records:remapped.records},hash:verified.hash,idMap:remapped.idMap};
}

export function restorePreview(version,localRecordCount){
 const device=version.deviceLabel||deviceLabel(version.deviceId);
 const when=version.completedLabel||formatBackupTime(version.completedAt);
 return {
  title:`還原 ${device} · ${when}`,
  deviceLabel:device,
  completedLabel:when,
  recordCount:version.recordCount,
  childCount:version.childCount,
  localRecordCount,
  replaceScope:`將取代目前這個帳號在本機的 ${localRecordCount} 筆紀錄（不是合併）。其他裝置的雲端版本不會被覆寫。`
 };
}

export {classifyBackupError};
