import {BACKUP_SCHEMA_VERSION} from './core.js';

function pathNames(uid,deviceId,backupId){
 return {
  user:`users/${uid}`,
  device:`users/${uid}/devices/${deviceId}`,
  backup:`users/${uid}/devices/${deviceId}/backups/${backupId}`,
  chunks:`users/${uid}/devices/${deviceId}/backups/${backupId}/chunks`
 };
}

export function createFirestoreCloud({firestore,fs}){
 const {doc,setDoc,getDoc,collection,getDocs,deleteDoc,writeBatch,serverTimestamp,updateDoc}=fs;
 if(!firestore)throw Error('Firestore 尚未初始化');

 function backupRef(uid,deviceId,backupId){return doc(firestore,'users',uid,'devices',deviceId,'backups',backupId);}
 function deviceRef(uid,deviceId){return doc(firestore,'users',uid,'devices',deviceId);}
 function chunkRef(uid,deviceId,backupId,index){return doc(firestore,'users',uid,'devices',deviceId,'backups',backupId,'chunks',String(index));}

 async function putBackup(uid,deviceId,backupId,data,isNew){
  const payload={
   schemaVersion:BACKUP_SCHEMA_VERSION,
   backupId,uid,deviceId,
   localRevision:data.localRevision,
   contentHash:data.contentHash,
   recordCount:data.recordCount,
   childCount:data.childCount,
   chunkCount:data.chunkCount,
   status:data.status||'uploading',
   summary:data.summary||null
  };
  if(isNew)payload.createdAt=serverTimestamp();
  await setDoc(backupRef(uid,deviceId,backupId),payload,{merge:!isNew});
 }

 async function putChunk(uid,deviceId,backupId,chunk){
  await setDoc(chunkRef(uid,deviceId,backupId,chunk.index),{
   index:chunk.index,
   data:chunk.data,
   digest:chunk.digest
  });
 }

 async function getBackup(uid,deviceId,backupId){
  const snap=await getDoc(backupRef(uid,deviceId,backupId));
  return snap.exists()?{id:snap.id,...snap.data()}:null;
 }

 async function listChunks(uid,deviceId,backupId){
  const snap=await getDocs(collection(firestore,'users',uid,'devices',deviceId,'backups',backupId,'chunks'));
  return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.index-b.index);
 }

 async function completeBackup(uid,deviceId,backupId){
  await updateDoc(backupRef(uid,deviceId,backupId),{status:'complete',completedAt:serverTimestamp()});
  return getBackup(uid,deviceId,backupId);
 }

 async function updateDevice(uid,deviceId,patch){
  await setDoc(deviceRef(uid,deviceId),{deviceId,uid,...patch,updatedAt:serverTimestamp()},{merge:true});
 }

 async function listDevices(uid){
  const snap=await getDocs(collection(firestore,'users',uid,'devices'));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
 }

 async function listBackups(uid,deviceId){
  const snap=await getDocs(collection(firestore,'users',uid,'devices',deviceId,'backups'));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
 }

 async function deleteChunk(uid,deviceId,backupId,index){
  await deleteDoc(chunkRef(uid,deviceId,backupId,index));
 }

 async function deleteBackupTree(uid,deviceId,backupId){
  const chunks=await listChunks(uid,deviceId,backupId);
  for(let i=0;i<chunks.length;i+=400){
   const batch=writeBatch(firestore);
   for(const chunk of chunks.slice(i,i+400))batch.delete(chunkRef(uid,deviceId,backupId,chunk.index));
   await batch.commit();
  }
  await deleteDoc(backupRef(uid,deviceId,backupId));
 }

 return {pathNames,putBackup,putChunk,getBackup,listChunks,completeBackup,updateDevice,listDevices,listBackups,deleteChunk,deleteBackupTree};
}

export function createMemoryCloud(){
 const devices=new Map();
 const backups=new Map();
 const chunks=new Map();
 const key=(uid,deviceId,backupId)=>`${uid}/${deviceId}/${backupId}`;
 const now=()=>new Date();

 return {
  _state:{devices,backups,chunks},
  async putBackup(uid,deviceId,backupId,data,isNew){
   const id=key(uid,deviceId,backupId);
   const prev=backups.get(id);
   if(prev?.status==='complete')throw Object.assign(Error('完成的版本不可修改'),{code:'failed-precondition'});
   backups.set(id,{
    ...prev,
    schemaVersion:BACKUP_SCHEMA_VERSION,
    backupId,uid,deviceId,
    ...data,
    createdAt:prev?.createdAt||now()
   });
  },
  async putChunk(uid,deviceId,backupId,chunk){
   const id=key(uid,deviceId,backupId);
   if(!chunks.has(id))chunks.set(id,[]);
   const list=chunks.get(id).filter(c=>c.index!==chunk.index);
   list.push({...chunk});
   chunks.set(id,list.sort((a,b)=>a.index-b.index));
  },
  async getBackup(uid,deviceId,backupId){return backups.get(key(uid,deviceId,backupId))||null;},
  async listChunks(uid,deviceId,backupId){return [...(chunks.get(key(uid,deviceId,backupId))||[])];},
  async completeBackup(uid,deviceId,backupId){
   const id=key(uid,deviceId,backupId);
   const prev=backups.get(id);
   if(!prev)throw Error('找不到備份');
   if(prev.status==='complete')return prev;
   const next={...prev,status:'complete',completedAt:now()};
   backups.set(id,next);
   return next;
  },
  async updateDevice(uid,deviceId,patch){
   const id=`${uid}/${deviceId}`;
   devices.set(id,{...(devices.get(id)||{}),uid,deviceId,...patch,updatedAt:now()});
  },
  async listDevices(uid){return [...devices.values()].filter(d=>d.uid===uid);},
  async listBackups(uid,deviceId){
   return [...backups.values()].filter(b=>b.uid===uid&&b.deviceId===deviceId);
  },
  async deleteChunk(uid,deviceId,backupId,index){
   const id=key(uid,deviceId,backupId);
   chunks.set(id,(chunks.get(id)||[]).filter(c=>c.index!==index));
  },
  async deleteBackupTree(uid,deviceId,backupId){
   const id=key(uid,deviceId,backupId);
   chunks.delete(id);backups.delete(id);
  }
 };
}
