import {LOCAL_OWNER,sameOwner,backupContent,stableStringify,sha256,classifyBackupError} from './core.js';
import {deviceLabel,formatBackupTime} from './backup.js';

export async function listRestorableVersions(cloud,uid){
 if(!cloud)return [];
 const devices=await cloud.listDevices(uid);
 const versions=[];
 for(const device of devices){
  const backups=await cloud.listBackups(uid,device.deviceId);
  for(const backup of backups){
   if(backup.status!=='complete')continue;
   versions.push({
    ...backup,
    backupId:backup.backupId||backup.id,
    deviceLabel:device.label||deviceLabel(device.deviceId),
    completedLabel:formatBackupTime(backup.completedAt)
   });
  }
 }
 versions.sort((a,b)=>+new Date(b.completedAt?.toDate?.()||b.completedAt||0)-+new Date(a.completedAt?.toDate?.()||a.completedAt||0));
 return versions;
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
 for(const child of payload.children){
  changes.push({store:'children',value:{...child,ownerUid:uid}});
 }
 for(const rec of payload.records){
  changes.push({store:'records',value:{...rec,ownerUid:uid}});
 }
 if(payload.settings&&typeof payload.settings.reverse==='boolean'){
  changes.push({store:'settings',value:{id:reverseId,value:payload.settings.reverse,ownerUid:uid}});
 }
 await db.write(changes,{bumpRevision:true,ownerUid:uid,pendingBackup:true});
 const after=await db.getAccount(uid);
 await db.putAccount({
  ...after,
  waitingFirstRecord:payload.records.length===0,
  lastError:null
 });
 return {payload,hash:verified.hash};
}

export function restorePreview(version,localRecordCount){
 return {
  title:`還原 ${version.deviceLabel||deviceLabel(version.deviceId)} · ${version.completedLabel||formatBackupTime(version.completedAt)}`,
  recordCount:version.recordCount,
  childCount:version.childCount,
  replaceScope:`將取代目前這個帳號在本機的 ${localRecordCount} 筆紀錄（不是合併）。其他裝置的雲端版本不會被覆寫。`
 };
}

export {classifyBackupError};
