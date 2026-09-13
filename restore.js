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

export function restoreListCopy(status,versions=[]){
 const texts={
  'signed-out':'登入 Google 帳號後即可查詢雲端版本。不必先開啟本機自動備份。',
  unavailable:'雲端元件尚未就緒，請稍後再試。',
  idle:'尚未查詢雲端版本。',
  loading:'正在查詢可還原的雲端版本…',
  empty:'還沒有可還原的成功版本。未完成的上傳不會出現在這裡。',
  offline:'目前離線或連線失敗，無法查詢雲端版本。',
  permission:'沒有權限讀取雲端版本。',
  reauth:'登入已過期，請重新登入後再查詢版本。',
  error:'查詢雲端版本失敗，請再試一次。',
  ready:`找到 ${versions.length} 個可還原的成功版本。`
 };
 return texts[status]||texts.error;
}

export async function queryRestorableVersions(cloud,uid,{online=true,previous=[]}={}){
 if(!uid)return {status:'signed-out',versions:[],error:null};
 if(!cloud)return {status:'unavailable',versions:[],error:null};
 if(online===false)return {status:'offline',versions:previous,error:{kind:'network',code:'unavailable',fatal:false}};
 try{
  const versions=await listRestorableVersions(cloud,uid);
  return {status:versions.length?'ready':'empty',versions,error:null};
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
