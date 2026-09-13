import {
 LOCAL_OWNER,BACKUP_SCHEMA_VERSION,MAX_COMPLETE_VERSIONS,INCOMPLETE_TTL_MS,
 backupContent,stableStringify,sha256,splitUtf8Chunks,retryDelay,classifyBackupError,sameOwner,defaultChildId
} from './core.js';

function deviceLabel(deviceId){
 return `裝置 ${String(deviceId||'').replace(/-/g,'').slice(0,4).toUpperCase()||'未知'}`;
}

export function describeBackupStatus(state){
 const {
  sdkFailed,configured,resolving,user,persistenceOk,enabled,paused,online,
  waitingFirst,pending,uploading,lastSuccess,lastError,recordCount,fatalKind
 }=state;
 if(sdkFailed)return {code:'sdk',text:'雲端元件暫時無法使用，本機仍可記錄',tone:'warn'};
 if(!configured)return {code:'unconfigured',text:'尚未設定雲端備份（請管理者填入 Firebase Web 設定）',tone:'muted'};
 if(resolving)return {code:'checking',text:'確認帳號中…',tone:'muted'};
 if(!user||!enabled)return {code:'not-enabled',text:'尚未啟用雲端備份',tone:'muted'};
 if(persistenceOk===false)return {code:'persistence',text:'無法長期記住登入，關閉分頁後需重新登入',tone:'warn'};
 if(fatalKind==='reauth'||lastError?.kind==='reauth')return {code:'reauth',text:'需重新登入後才能備份',tone:'error'};
 if(fatalKind==='permission'||lastError?.kind==='permission')return {code:'permission',text:'備份權限不足',tone:'error'};
 if(fatalKind==='quota'||lastError?.kind==='quota')return {code:'quota',text:'備份配額已用盡',tone:'error'};
  if(paused)return {code:'paused',text:pending?'已暫停自動備份，尚有新變更':'已暫停自動備份',tone:'warn'};
  if(!online)return {code:'offline',text:'離線，將在連線後補傳',tone:'warn'};
  if(uploading)return {code:'uploading',text:'備份中…',tone:'live'};
  if(waitingFirst&&recordCount===0)return {code:'waiting-first',text:'已啟用，等待第一筆',tone:'ok'};
  if(pending&&lastSuccess)return {code:'dirty',text:'尚有新變更未備份',tone:'live'};
  if(pending)return {code:'pending',text:'已存本機，等待備份',tone:'live'};
  if(lastSuccess){
  const when=formatBackupTime(lastSuccess.completedAt);
  return {code:'ok',text:`已備份 · ${when} · ${lastSuccess.recordCount??recordCount} 筆`,tone:'ok'};
 }
 if(pending)return {code:'pending',text:'已存本機，等待備份',tone:'live'};
 return {code:'idle',text:'已啟用雲端備份',tone:'muted'};
}

export function formatBackupTime(value){
 if(!value)return '時間未知';
 const date=value.toDate?value.toDate():new Date(value);
 if(!Number.isFinite(+date))return '時間未知';
 try{return date.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
 catch{return date.toISOString();}
}

async function hashText(text,sha=sha256){return sha(text);}

export function createBackupService(deps){
 const {
  db,
  getCloud,
  getUser,
  getAppMeta,
  isOnline=()=>true,
  clock={now:()=>Date.now(),setTimeout:setTimeout,clearTimeout:clearTimeout},
  randomId=()=>crypto.randomUUID(),
  random=Math.random,
  tabId,
  debounceMs=5000,
  maxWaitMs=30000,
  lockTtl=25000,
  keepVersions=MAX_COMPLETE_VERSIONS,
  incompleteTtlMs=INCOMPLETE_TTL_MS,
  onStatus=()=>{},
  sha=sha256,
  splitChunks=splitUtf8Chunks
 }=deps;

 let debounceTimer=null;
 let forceTimer=null;
 let forceStartedAt=0;
 let canceled=false;
 let uploading=false;
 let currentUid=null;
 let lastStatus=null;

 function emit(extra={}){
  lastStatus={...lastStatus,...extra,updatedAt:clock.now()};
  onStatus(lastStatus);
  return lastStatus;
 }

 async function account(uid){return db.getAccount(uid);}

 async function snapshotFor(uid){
  const [records,children,settings,acc]=await Promise.all([db.all('records'),db.all('children'),db.all('settings'),account(uid)]);
  const payload=backupContent({children,records,settings},uid);
  const payloadText=stableStringify(payload);
  const hash=await hashText(payloadText,sha);
  return {payload,payloadText,hash,recordCount:payload.records.length,childCount:payload.children.length,revision:acc.localRevision||0,records,children,settings,account:acc};
 }

 async function persistQueue(item){await db.write([{store:'backupQueue',value:item}]);}
 async function removeQueue(id){await db.write([{store:'backupQueue',delete:id}]);}

 function summaryOf(payload){
  const latest=payload.records.map(r=>r.date).sort().at(-1)||null;
  return {latestDate:latest,recordCount:payload.records.length,childCount:payload.children.length};
 }

  async function enqueueCurrent(uid,{allowEmpty=false,ignorePause=false}={}){
  const snap=await snapshotFor(uid);
  const acc=snap.account;
  if(!acc.backupEnabled)return null;
  if(acc.backupPaused&&!ignorePause)return {paused:true,snap};
  if(snap.recordCount===0&&acc.waitingFirstRecord&&!allowEmpty){
   await db.putAccount({...acc,pendingBackup:false});
   return {waitingFirst:true,snap};
  }
  if(acc.lastSuccess?.contentHash===snap.hash){
   await db.putAccount({...acc,pendingBackup:false,lastError:null});
   return {unchanged:true,snap};
  }
  const queue=await db.all('backupQueue');
  const mine=queue.filter(item=>item.uid===uid);
  const existing=mine.find(item=>item.contentHash===snap.hash&&item.status!=='complete');
  if(existing)return {item:existing,snap};
  const inflight=mine.find(item=>item.status==='uploading'||item.status==='queued');
  const item={
   id:randomId(),
   backupId:null,
   uid,deviceId:(await getAppMeta()).deviceId,
   localRevision:snap.revision,
   contentHash:snap.hash,
   recordCount:snap.recordCount,
   childCount:snap.childCount,
   schemaVersion:BACKUP_SCHEMA_VERSION,
   payloadText:snap.payloadText,
   summary:summaryOf(snap.payload),
   status:'queued',
   createdAt:new Date(clock.now()).toISOString(),
   attempts:0,
   nextRetryAt:0,
   lastError:null,
   fatal:false
  };
  item.backupId=item.id;
  if(inflight&&inflight.status==='uploading'){
   // N 上傳中時 N+1 只入列，不打斷
  }
  await persistQueue(item);
  return {item,snap};
 }

 async function verifyUploaded(cloud,item,expectedChunks,expectedHash){
  const meta=await cloud.getBackup(item.uid,item.deviceId,item.backupId);
  if(!meta)throw Error('伺服器沒有這份備份');
  const chunks=await cloud.listChunks(item.uid,item.deviceId,item.backupId);
  if(chunks.length!==expectedChunks.length)throw Error('塊數不符');
  const ordered=[...chunks].sort((a,b)=>a.index-b.index);
  for(let i=0;i<expectedChunks.length;i++){
   if(ordered[i].index!==i)throw Error('塊序不符');
   if(ordered[i].digest!==expectedChunks[i].digest)throw Error('塊摘要不符');
  }
  const text=ordered.map(c=>c.data).join('');
  const hash=await hashText(text,sha);
  if(hash!==expectedHash)throw Error('內容摘要不符');
  if(meta.chunkCount!==expectedChunks.length||meta.contentHash!==expectedHash)throw Error('備份摘要不符');
  return {meta,text};
 }

 async function cleanupVersions(cloud,uid,deviceId){
  const all=await cloud.listBackups(uid,deviceId);
  const complete=all.filter(b=>b.status==='complete').sort((a,b)=>{
   const ta=+new Date(a.completedAt?.toDate?.()||a.completedAt||0);
   const tb=+new Date(b.completedAt?.toDate?.()||b.completedAt||0);
   return tb-ta;
  });
  const staleIncomplete=all.filter(b=>{
   if(b.status==='complete')return false;
   const created=+new Date(b.createdAt?.toDate?.()||b.createdAt||0);
   return created&&clock.now()-created>incompleteTtlMs;
  });
  const extra=complete.slice(keepVersions);
  for(const old of [...extra,...staleIncomplete]){
   try{await cloud.deleteBackupTree(uid,deviceId,old.backupId||old.id);}catch{/* 清失敗不影響本次成功 */}
  }
 }

 async function uploadItem(item){
  const cloud=getCloud();
  if(!cloud)throw Object.assign(Error('雲端尚未就緒'),{code:'unavailable'});
  const user=getUser();
  if(!user||user.uid!==item.uid)throw Object.assign(Error('需重新登入後才能備份'),{code:'unauthenticated'});
  if(!isOnline())throw Object.assign(Error('離線'),{code:'unavailable'});
  const chunks=splitChunks(item.payloadText);
  const expected=[];
  for(let i=0;i<chunks.length;i++){
   expected.push({index:i,data:chunks[i],digest:await hashText(chunks[i],sha)});
  }
  const existing=await cloud.getBackup(item.uid,item.deviceId,item.backupId);
  if(!existing){
   await cloud.putBackup(item.uid,item.deviceId,item.backupId,{
    localRevision:item.localRevision,
    contentHash:item.contentHash,
    recordCount:item.recordCount,
    childCount:item.childCount,
    chunkCount:expected.length,
    status:'uploading',
    summary:item.summary
   },true);
  }else if(existing.status==='complete'){
   return existing;
  }
  const remoteChunks=existing?await cloud.listChunks(item.uid,item.deviceId,item.backupId):[];
  const have=new Set(remoteChunks.map(c=>`${c.index}:${c.digest}`));
  for(const chunk of expected){
   if(canceled)throw Error('已取消');
   if(getUser()?.uid!==item.uid)throw Object.assign(Error('需重新登入後才能備份'),{code:'unauthenticated'});
   if(!have.has(`${chunk.index}:${chunk.digest}`))await cloud.putChunk(item.uid,item.deviceId,item.backupId,chunk);
   await db.heartbeatLock(tabId,lockTtl,clock.now());
  }
  await verifyUploaded(cloud,item,expected,item.contentHash);
  const completed=await cloud.completeBackup(item.uid,item.deviceId,item.backupId);
  await verifyUploaded(cloud,item,expected,item.contentHash);
  if(completed.status!=='complete')throw Error('伺服器未確認完成');
  await cloud.updateDevice(item.uid,item.deviceId,{
   label:deviceLabel(item.deviceId),
   lastBackupId:item.backupId,
   lastLocalRevision:item.localRevision,
   lastContentHash:item.contentHash,
   lastRecordCount:item.recordCount,
   lastCompletedAt:completed.completedAt||new Date(clock.now()).toISOString()
  });
  await cleanupVersions(cloud,item.uid,item.deviceId);
  return completed;
 }

  async function processQueue(uid,{ignorePause=false}={}){
  if(canceled)return {ok:false,reason:'canceled'};
  const user=getUser();
  if(!user||user.uid!==uid)return {ok:false,reason:'auth'};
  const acc=await account(uid);
  if(!acc.backupEnabled)return {ok:false,reason:'disabled'};
  if(acc.backupPaused&&!ignorePause)return {ok:false,reason:'paused'};
  if(!isOnline()){
   emit({online:false,pending:true,uploading:false});
   return {ok:false,reason:'offline'};
  }
  const locked=await db.acquireLock(tabId,lockTtl,clock.now());
  if(!locked)return {ok:false,reason:'locked'};
  uploading=true;emit({uploading:true,uid});
  try{
   let lastCompleted=null;
   for(let pass=0;pass<4;pass++){
    if(canceled||getUser()?.uid!==uid)break;
    const live=await snapshotFor(uid);
    let queue=(await db.all('backupQueue')).filter(item=>item.uid===uid&&item.status!=='complete'&&!item.fatal);
    for(const item of queue){
     if(item.status!=='uploading'&&item.contentHash!==live.hash)await removeQueue(item.id);
    }
    queue=(await db.all('backupQueue')).filter(item=>item.uid===uid&&item.status!=='complete'&&!item.fatal)
     .sort((a,b)=>(a.status==='uploading'?0:1)-(b.status==='uploading'?0:1)||a.localRevision-b.localRevision||a.createdAt.localeCompare(b.createdAt));
    if(!queue.length){
     const made=await enqueueCurrent(uid,{ignorePause});
     if(!made?.item){
      emit({uploading:false,pending:false,dirty:false,waitingFirst:Boolean(made?.waitingFirst),lastSuccess:(await account(uid)).lastSuccess});
      return {ok:true,unchanged:Boolean(made?.unchanged),waitingFirst:Boolean(made?.waitingFirst),completed:lastCompleted};
     }
     queue=[made.item];
    }
    const item=queue[0];
    if(item.nextRetryAt&&item.nextRetryAt>clock.now()){
     emit({uploading:false,pending:true});
     return {ok:false,reason:'wait-retry',completed:lastCompleted};
    }
    const working={...item,status:'uploading'};
    await persistQueue(working);
    try{
     const completed=await uploadItem(working);
     lastCompleted=completed;
     await removeQueue(working.id);
     const fresh=await account(uid);
     const latest=await snapshotFor(uid);
     const stillPending=latest.hash!==working.contentHash;
     await db.putAccount({
      ...fresh,
      pendingBackup:stillPending,
      waitingFirstRecord:false,
      lastError:null,
      lastSuccess:{
       backupId:working.backupId,
       uid:working.uid,
       deviceId:working.deviceId,
       localRevision:working.localRevision,
       contentHash:working.contentHash,
       recordCount:working.recordCount,
       completedAt:completed.completedAt?.toDate?.()?.toISOString?.()||completed.completedAt||new Date(clock.now()).toISOString()
      }
     });
     if(!stillPending){
      emit({uploading:false,pending:false,dirty:false,lastSuccess:(await account(uid)).lastSuccess});
      return {ok:true,completed:lastCompleted};
     }
    }catch(error){
     const classified=classifyBackupError(error);
     const attempts=(working.attempts||0)+1;
     const failed={
      ...working,
      status:classified.fatal?'failed-fatal':'queued',
      fatal:classified.fatal,
      attempts,
      lastError:{kind:classified.kind,code:classified.code,message:error.message||String(error),at:new Date(clock.now()).toISOString()},
      nextRetryAt:classified.fatal?Number.MAX_SAFE_INTEGER:clock.now()+retryDelay(attempts-1,random)
     };
     await persistQueue(failed);
     const fresh=await account(uid);
     await db.putAccount({...fresh,lastError:failed.lastError});
     emit({uploading:false,pending:true,lastError:failed.lastError,fatalKind:classified.kind});
     if(classified.fatal)return {ok:false,fatal:true,error};
     return {ok:false,error};
    }
   }
   const latest=await snapshotFor(uid);
   const accNow=await account(uid);
   emit({
    uploading:false,
    pending:Boolean(accNow.pendingBackup&&accNow.lastSuccess?.contentHash!==latest.hash),
    dirty:accNow.lastSuccess?.contentHash&&accNow.lastSuccess.contentHash!==latest.hash,
    lastSuccess:accNow.lastSuccess,
    waitingFirst:accNow.waitingFirstRecord&&latest.recordCount===0
   });
   return {ok:true,completed:lastCompleted};
  }finally{
   uploading=false;
   await db.releaseLock(tabId);
  }
 }

 function clearTimers(){
  if(debounceTimer)clock.clearTimeout(debounceTimer);
  if(forceTimer)clock.clearTimeout(forceTimer);
  debounceTimer=null;forceTimer=null;forceStartedAt=0;
 }

 function schedule(uid){
  currentUid=uid;
  if(debounceTimer)clock.clearTimeout(debounceTimer);
  debounceTimer=clock.setTimeout(()=>processQueue(uid).catch(()=>{}),debounceMs);
  if(!forceTimer){
   forceStartedAt=clock.now();
   forceTimer=clock.setTimeout(()=>{forceTimer=null;processQueue(uid).catch(()=>{});},maxWaitMs);
  }else if(clock.now()-forceStartedAt>=maxWaitMs){
   processQueue(uid).catch(()=>{});
  }
 }

 return {
  deviceLabel,
  describe:describeBackupStatus,
  noteLocalChange(uid){
   canceled=false;currentUid=uid;
   const accPromise=account(uid).then(acc=>{
    if(!acc.backupEnabled||acc.backupPaused)return;
    schedule(uid);
   });
   return accPromise;
  },
  async flush(uid,{ignorePause=true}={}){
   clearTimers();
   const made=await enqueueCurrent(uid,{ignorePause});
   if(made?.waitingFirst)return {ok:true,waitingFirst:true};
   if(made?.unchanged)return {ok:true,unchanged:true};
   if(made?.paused)return {ok:false,reason:'paused'};
   return processQueue(uid,{ignorePause});
  },
  async checkQueue(uid){
   if(!uid)return {ok:false,reason:'auth'};
   return processQueue(uid);
  },
  cancelUploads(){
   canceled=true;clearTimers();
  },
  resetCancel(){canceled=false;},
  isUploading:()=>uploading,
  async enableForUser(user){
   canceled=false;
   const uid=user.uid;
   const [records,children,localAcc,userAcc,app]=await Promise.all([
    db.all('records'),db.all('children'),account(LOCAL_OWNER),account(uid),getAppMeta()
   ]);
   const localRecords=records.filter(r=>sameOwner(r,LOCAL_OWNER));
   const localChildren=children.filter(c=>sameOwner(c,LOCAL_OWNER));
   const userRecords=records.filter(r=>sameOwner(r,uid));
   const userChildren=children.filter(c=>sameOwner(c,uid));
   const changes=[];
   if(!userRecords.length&&localRecords.length){
    for(const rec of localRecords)changes.push({store:'records',value:{...rec,ownerUid:uid}});
    for(const child of localChildren)changes.push({store:'children',value:{...child,ownerUid:uid}});
   }else if(!userChildren.length){
    changes.push({store:'children',value:{id:defaultChildId(uid),name:'小孩',birthday:null,ownerUid:uid}});
   }
   if(changes.length)await db.write(changes);
   const bound=await snapshotFor(uid);
   const emptyLocal=bound.recordCount===0;
   const cloud=getCloud();
   let remote=[];
   if(cloud){
    try{
     const devices=await cloud.listDevices(uid);
     for(const device of devices){
      const backups=await cloud.listBackups(uid,device.deviceId);
      remote.push(...backups.filter(b=>b.status==='complete').map(b=>({...b,deviceLabel:device.label||deviceLabel(device.deviceId)})));
     }
    }catch(error){
     const classified=classifyBackupError(error);
     await db.putAccount({
      ...userAcc,
      ownerUid:uid,
      backupEnabled:true,
      waitingFirstRecord:emptyLocal,
      pendingBackup:!emptyLocal,
      lastError:{kind:classified.kind,code:classified.code,message:error.message||String(error),at:new Date(clock.now()).toISOString()}
     });
     return {action:'error',error,classified};
    }
   }
   remote.sort((a,b)=>+new Date(b.completedAt?.toDate?.()||b.completedAt||0)-+new Date(a.completedAt?.toDate?.()||a.completedAt||0));
   const same=remote.find(b=>b.contentHash===bound.hash);
   const next={
    ...userAcc,
    ownerUid:uid,
    backupEnabled:true,
    backupPaused:false,
    waitingFirstRecord:emptyLocal&&!remote.length,
    pendingBackup:!emptyLocal||Boolean(remote.length&&!emptyLocal&&!same),
    lastError:null,
    deviceId:app.deviceId
   };
   if(emptyLocal&&!remote.length){
    next.pendingBackup=false;
    await db.putAccount(next);
    return {action:'wait-first'};
   }
   if(!emptyLocal&&!remote.length){
    await db.putAccount(next);
    await enqueueCurrent(uid);
    processQueue(uid).catch(()=>{});
    return {action:'upload-first'};
   }
   if(emptyLocal&&remote.length){
    next.pendingBackup=false;
    next.waitingFirstRecord=false;
    await db.putAccount(next);
    return {action:'offer-restore',versions:remote};
   }
   if(same){
    next.pendingBackup=false;
    next.lastSuccess={
     backupId:same.backupId||same.id,
     uid,deviceId:same.deviceId,
     localRevision:same.localRevision,
     contentHash:same.contentHash,
     recordCount:same.recordCount,
     completedAt:same.completedAt?.toDate?.()?.toISOString?.()||same.completedAt||new Date(clock.now()).toISOString()
    };
    await db.putAccount(next);
    return {action:'already-synced',version:same};
   }
   await db.putAccount(next);
   await enqueueCurrent(uid);
   processQueue(uid).catch(()=>{});
   return {action:'diverged',versions:remote};
  }
 };
}

export {deviceLabel};
