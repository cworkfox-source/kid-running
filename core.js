export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
export function validate(r){if(!validDate(r.date))throw Error('請輸入有效日期');if(typeof r.distance!=='number'||!Number.isFinite(r.distance)||r.distance<=0)throw Error('距離必須大於 0');if(typeof r.seconds!=='number'||!Number.isFinite(r.seconds)||r.seconds<=0)throw Error('秒數必須大於 0');if(typeof r.note!=='string')throw Error('備註格式不正確');return r;}
export function parseLine(source,now=today()){
 let text=source.normalize('NFKC').trim();let date=now;
 const dm=text.match(/(?<!\d)(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})(?!\d)/);
 if(dm){date=`${dm[1]||now.slice(0,4)}-${dm[2].padStart(2,'0')}-${dm[3].padStart(2,'0')}`;text=text.replace(dm[0],' ');}
 if(/[-−]\s*\d/.test(text))throw Error('不接受負數');
 const distance=text.match(/(\d+(?:\.\d+)?)\s*(?:公尺|米|m)(?![a-z])/i);if(!distance)throw Error('找不到距離，請加上公尺或 m');
 text=text.replace(distance[0],' ');
 const time=text.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)(?![a-z])(?:\s*(\d+)(?!\d))?/i);
 let seconds;
 if(time){if(time[2]&&time[1].includes('.'))throw Error('秒數格式不明確');seconds=Number(time[1]+(time[2]?'.'+time[2]:''));text=text.replace(time[0],' ');}
 else{const nums=text.match(/\d+(?:\.\d+)?/g)||[];if(nums.length!==1)throw Error('找不到明確秒數');seconds=Number(nums[0]);text=text.replace(nums[0],' ');}
 if(/\d/.test(text))throw Error('一行含多組數字，請每行只放一筆成績');
 return validate({date,distance:Number(distance[1]),seconds,note:source.trim(),startType:'',surface:'',timingMethod:''});
}
export const parseText=(text,now=today())=>text.split(/\r?\n/).map((source,index)=>({source,line:index+1})).filter(x=>x.source.trim()).map(x=>{try{return {...x,record:parseLine(x.source,now)};}catch(e){return {...x,error:e.message};}});
export const chronological=records=>[...records].sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||'').localeCompare(b.createdAt||'')||a.id.localeCompare(b.id));
export const sameGroup=(a,b)=>a.childId===b.childId&&a.distance===b.distance;
export const duplicate=(a,b)=>sameGroup(a,b)&&a.date===b.date&&a.seconds===b.seconds;
export const speed=r=>({ms:r.distance/r.seconds,kmh:r.distance/r.seconds*3.6});
export const improvement=(before,after)=>({seconds:before-after,percent:(before-after)/before*100});
export function summary(records,distance,childId='child_01'){const list=chronological(records.filter(r=>r.distance===distance&&r.childId===childId));if(!list.length)return null;const first=list[0],latest=list.at(-1),previous=list.at(-2),best=list.reduce((a,b)=>a.seconds<=b.seconds?a:b);return {list,first,latest,previous,best,total:improvement(first.seconds,latest.seconds)};}
export function warnings(record,records){const group=records.filter(r=>sameGroup(r,record)&&r.id!==record.id);const messages=[];if(group.some(r=>duplicate(r,record)))messages.push('這筆資料可能已經存在，仍然新增嗎？');if(group.length>=3){const values=group.map(r=>r.seconds).sort((a,b)=>a-b),median=values[Math.floor(values.length/2)];if(record.seconds>median*2||record.seconds<median/2)messages.push(`這筆 ${record.seconds} 秒明顯偏離平常約 ${median} 秒，請確認小數點與測試條件。`);}return messages;}
export function duplicateGroups(records,{childId}={}){
 const buckets=new Map();
 for(const r of records){if(childId&&r.childId!==childId)continue;const key=[r.childId,r.date,r.distance,r.seconds].join('\u0000');const list=buckets.get(key)||[];list.push(r);buckets.set(key,list);}
 return [...buckets.values()].filter(list=>list.length>1).map(list=>chronological(list)).sort((a,b)=>a[0].date.localeCompare(b[0].date)||a[0].distance-b[0].distance||a[0].seconds-b[0].seconds);
}
export function recordsInRange(records,{childId,distance,start='',end='' }={}){
 return chronological(records.filter(r=>(!childId||r.childId===childId)&&(distance===undefined||distance===null||r.distance===distance)&&(!start||r.date>=start)&&(!end||r.date<=end)));
}
export function dailyStatistics(records,date,{childId}={}){
 const list=recordsInRange(records,{childId,start:date,end:date});
 const byDistance=[...new Set(list.map(r=>r.distance))].sort((a,b)=>a-b).map(distance=>{
  const group=list.filter(r=>r.distance===distance),speeds=group.map(r=>speed(r).ms),seconds=group.map(r=>r.seconds);
  return {distance,records:group,count:group.length,averageSeconds:seconds.reduce((a,b)=>a+b,0)/group.length,bestSeconds:Math.min(...seconds),slowestSeconds:Math.max(...seconds),averageSpeed:speeds.reduce((a,b)=>a+b,0)/group.length};
 });
 return {date,records:list,count:list.length,totalDistance:list.reduce((sum,r)=>sum+r.distance,0),totalSeconds:list.reduce((sum,r)=>sum+r.seconds,0),byDistance};
}
export function chartSeries(records,{childId,distance,start='',end='',metric='seconds'}={}){
 const list=recordsInRange(records,{childId,distance,start,end});
 const individual=Boolean(start&&end&&start===end);
 if(individual)return list.map((r,index)=>({date:r.date,label:`第 ${index+1} 次`,value:metric==='seconds'?r.seconds:metric==='kmh'?speed(r).kmh:speed(r).ms,count:1,bestSeconds:r.seconds,record:r,individual:true}));
 const days=new Map();
 for(const r of list){const group=days.get(r.date)||[];group.push(r);days.set(r.date,group);}
 return [...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,group])=>{
  const averageSpeed=group.reduce((sum,r)=>sum+speed(r).ms,0)/group.length;
  const averageSeconds=group.reduce((sum,r)=>sum+r.seconds,0)/group.length;
  return {date,label:date,value:metric==='seconds'?averageSeconds:metric==='kmh'?averageSpeed*3.6:averageSpeed,count:group.length,bestSeconds:Math.min(...group.map(r=>r.seconds)),records:group,individual:false};
 });
}
export function csv(records){const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+[['日期','距離公尺','秒數','速度m/s','時速km/h','備註'],...chronological(records).map(r=>[r.date,r.distance,r.seconds,speed(r).ms.toFixed(2),speed(r).kmh.toFixed(2),r.note])].map(row=>row.map(cell).join(',')).join('\r\n');}
export function validateBackup(data){if(data?.version!==1||!Array.isArray(data.children)||!Array.isArray(data.records))throw Error('不是支援的版本 1 備份檔');const children=new Set();for(const c of data.children){if(typeof c.id!=='string'||!c.id||children.has(c.id)||typeof c.name!=='string'||!c.name.trim()||(c.birthday!==null&&!validDate(c.birthday)))throw Error('小孩資料無效');children.add(c.id);}const ids=new Set();for(const r of data.records){validate(r);if(!children.has(r.childId)||typeof r.id!=='string'||!r.id||ids.has(r.id)||!Number.isFinite(Date.parse(r.createdAt))||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('紀錄 ID、時間或小孩關聯無效');for(const [field,allowed] of Object.entries({startType:['','standing','flying','free'],surface:['','indoor','track','asphalt','grass'],timingMethod:['','manual','video','electronic']})){if(!allowed.includes(r[field]??''))throw Error('測試條件無效');}ids.add(r.id);}return data;}

export const LOCAL_OWNER='local-only';
export const BACKUP_SCHEMA_VERSION=1;
export const CHUNK_MAX_BYTES=256*1024;
export const MAX_COMPLETE_VERSIONS=10;
export const MAX_BACKUP_BYTES=1024*1024;
export const MAX_BACKUP_RECORDS=3000;
export const MAX_BACKUP_CHILDREN=20;
export const MAX_BACKUP_CHUNKS=Math.ceil(MAX_BACKUP_BYTES/CHUNK_MAX_BYTES);
export const INCOMPLETE_TTL_MS=7*24*60*60*1000;
export const ownerOf=item=>item?.ownerUid||LOCAL_OWNER;
export const sameOwner=(item,uid)=>ownerOf(item)===uid;
export const BACKUP_CLOCK_INTERVAL_MS=60*1000;
export function defaultChildId(uid){return uid===LOCAL_OWNER?'child_01':`child_01__${uid}`;}
export function uniqueChildId(uid,occupied=new Set()){
 const base=defaultChildId(uid);
 if(!occupied.has(base))return base;
 let n=2;
 while(occupied.has(`${base}__${n}`))n+=1;
 return `${base}__${n}`;
}
export function uniqueRecordId(id,uid,occupied=new Set()){
 const safeUid=String(uid||'user').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,48)||'user';
 const base=`${String(id||'record')}__${safeUid}`;
 if(!occupied.has(base))return base;
 let n=2;
 while(occupied.has(`${base}__${n}`))n+=1;
 return `${base}__${n}`;
}
export function pickActiveChild(children,uid,preferredId=null){
 const scoped=(children||[]).filter(c=>sameOwner(c,uid));
 if(preferredId&&scoped.some(c=>c.id===preferredId))return scoped.find(c=>c.id===preferredId);
 return scoped.find(c=>c.id==='child_01'||c.id===defaultChildId(uid))||scoped[0]||null;
}
export function visibleRecordsForChild(records,child){
 if(!child)return [];
 return (records||[]).filter(r=>sameOwner(r,ownerOf(child))&&r.childId===child.id);
}
function isStubChild(child,records){
 if(!child)return false;
 const owned=(records||[]).filter(r=>r.childId===child.id&&sameOwner(r,ownerOf(child)));
 return (child.name==='小孩'||!String(child.name||'').trim())&&(child.birthday==null||child.birthday==='')&&owned.length===0;
}
export function remapBackupChildIds(payload,uid,occupiedIds=new Set(),occupiedRecordIds=new Set()){
 const used=new Set(occupiedIds);
 const usedRecords=new Set(occupiedRecordIds);
 const idMap=new Map();
 const recordIdMap=new Map();
 const children=[];
 for(const child of payload.children||[]){
  const reserved=uid!==LOCAL_OWNER&&child.id===defaultChildId(LOCAL_OWNER);
  let nextId=child.id;
  if(reserved||occupiedIds.has(child.id))nextId=uniqueChildId(uid,used);
  if(used.has(nextId))nextId=uniqueChildId(uid,used);
  idMap.set(child.id,nextId);
  used.add(nextId);
  children.push({...child,id:nextId});
 }
 const records=(payload.records||[]).map(r=>{
  let id=r.id;
  if(usedRecords.has(id))id=uniqueRecordId(id,uid,usedRecords);
  usedRecords.add(id);
  recordIdMap.set(r.id,id);
  return {...r,id,childId:idMap.get(r.childId)||r.childId};
 });
 return {children,records,idMap,recordIdMap,settings:payload.settings};
}

export function repairChildOwnership({children=[],records=[],uid}={}){
 const nextChildren=children.map(c=>({...c}));
 const nextRecords=records.map(r=>({...r}));
 const byId=new Map(nextChildren.map(c=>[c.id,c]));
 const mine=nextRecords.filter(r=>sameOwner(r,uid));
 const needed=[...new Set(mine.map(r=>r.childId).filter(Boolean))];
 const recordRemap=new Map();
 const changes=[];
 for(const childId of needed){
  const child=byId.get(childId);
  if(child&&sameOwner(child,uid))continue;
  if(child&&!sameOwner(child,uid)&&isStubChild(child,nextRecords)){
   child.ownerUid=uid;
   changes.push({type:'reclaim',child});
   continue;
  }
  if(child&&!sameOwner(child,uid)){
   const targetId=uniqueChildId(uid,new Set(byId.keys()));
   const created={id:targetId,name:child.name||'小孩',birthday:child.birthday??null,ownerUid:uid};
   nextChildren.push(created);
   byId.set(targetId,created);
   changes.push({type:'create',child:created,sourceChildId:childId});
   recordRemap.set(childId,targetId);
   continue;
  }
  if(!child){
   const created={id:childId,name:'小孩',birthday:null,ownerUid:uid};
   nextChildren.push(created);
   byId.set(childId,created);
   changes.push({type:'create',child:created});
  }
 }
 for(const rec of nextRecords){
  if(sameOwner(rec,uid)&&recordRemap.has(rec.childId))rec.childId=recordRemap.get(rec.childId);
 }
 if(!nextChildren.some(c=>sameOwner(c,uid))){
  const created={id:uniqueChildId(uid,new Set(nextChildren.map(c=>c.id))),name:'小孩',birthday:null,ownerUid:uid};
  nextChildren.push(created);
  changes.push({type:'create',child:created});
 }
 return {children:nextChildren,records:nextRecords,changes,recordRemap};
}
export function safeFilenamePart(value,fallback='child'){
 const clean=String(value??'').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001F]/g,'-').replace(/[. ]+$/g,'').trim().slice(0,40);
 return clean||fallback;
}
export function visibleAfterRepair({children,records,uid}){
 const repaired=repairChildOwnership({children,records,uid});
 const child=pickActiveChild(repaired.children,uid);
 return {repaired,child,visible:visibleRecordsForChild(repaired.records,child)};
}
export function chartCaption({metric='seconds',start='',end=''}={}){
 const individual=Boolean(start&&end&&start===end);
 const ranged=Boolean(start||end);
 if(metric==='seconds'){
  if(individual)return '單日各筆連線；秒數越低越好。';
  if(ranged)return '跨日顯示每日平均秒數；秒數越低越好。沒有測試的日期不補 0。';
  return '未選日期時跨日顯示每日平均秒數；選同一天可看各筆連線。秒數越低越好。';
 }
 if(individual)return '單日各筆速度連線；沒有測試的次數不補 0。';
 return '同一距離以每天各次速度的平均值呈現；沒有測試的日期不補 0。';
}
export function clockCooldownRemaining(lastClockWriteAt,now,interval=BACKUP_CLOCK_INTERVAL_MS){
 if(!lastClockWriteAt)return 0;
 const t=+new Date(lastClockWriteAt);
 if(!Number.isFinite(t))return 0;
 return Math.max(0,t+interval-now);
}

export function portableChild(c){return {id:c.id,name:c.name,birthday:c.birthday??null};}
export function portableRecord(r){return {id:r.id,childId:r.childId,date:r.date,distance:r.distance,seconds:r.seconds,note:r.note||'',startType:r.startType||'',surface:r.surface||'',timingMethod:r.timingMethod||'',createdAt:r.createdAt,updatedAt:r.updatedAt};}
export function portableSettings(settings,uid){
 const reverse=settings.find(s=>s.id===`reverse:${uid}`)??(uid===LOCAL_OWNER?settings.find(s=>s.id==='reverse'):null);
 return {reverse:reverse?.value!==false};
}
export function backupContent({children,records,settings},uid){
 return {
  schemaVersion:BACKUP_SCHEMA_VERSION,
  children:[...children].filter(c=>sameOwner(c,uid)).map(portableChild).sort((a,b)=>a.id.localeCompare(b.id)),
  records:[...records].filter(r=>sameOwner(r,uid)).map(portableRecord).sort((a,b)=>a.id.localeCompare(b.id)),
  settings:portableSettings(settings,uid)
 };
}
export function backupLimitError({payloadText='',recordCount=0,childCount=0}={}){
 const bytes=new TextEncoder().encode(payloadText).length;
 if(recordCount>MAX_BACKUP_RECORDS)return Error(`備份紀錄超過 ${MAX_BACKUP_RECORDS} 筆上限`);
 if(childCount>MAX_BACKUP_CHILDREN)return Error(`備份小孩資料超過 ${MAX_BACKUP_CHILDREN} 筆上限`);
 if(bytes>MAX_BACKUP_BYTES)return Error(`備份內容超過 ${MAX_BACKUP_BYTES/1024/1024} MiB 上限`);
 return null;
}
export function stableStringify(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;
 return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
export async function sha256(text,subtle=globalThis.crypto?.subtle){
 if(!subtle)throw Error('這個瀏覽器不支援 SHA-256');
 const bytes=new TextEncoder().encode(text);
 const digest=await subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function contentHash(payload,subtle){return sha256(stableStringify(payload),subtle);}
export function splitUtf8Chunks(text,maxBytes=CHUNK_MAX_BYTES){
 const encoder=new TextEncoder();
 const chunks=[];
 let current='',currentBytes=0;
 for(const char of text){
  const size=encoder.encode(char).length;
  if(size>maxBytes)throw Error('內容無法分塊');
  if(currentBytes+size>maxBytes&&current){chunks.push(current);current='';currentBytes=0;}
  current+=char;currentBytes+=size;
 }
 chunks.push(current);
 return chunks;
}
export function retryDelay(attempt,random=Math.random){
 const steps=[5000,15000,30000,60000];
 const base=attempt<steps.length?steps[attempt]:300000;
 const capped=Math.min(Math.max(base,0),300000);
 const jitter=capped*0.2*(random()*2-1);
 return Math.round(Math.max(1000,capped+jitter));
}
export function classifyBackupError(error,context={}){
 const code=String(error?.code||error?.name||'');
 const message=String(error?.message||error||'');
 const text=`${code} ${message}`.toLowerCase();
 if(/unauth|id-token|requires.recent|need.?reauth|token.*expired/.test(text))return {fatal:true,kind:'reauth',code:'unauthenticated'};
 if(error?.kind==='cooldown'||/cooldown|冷卻/.test(text))return {fatal:false,kind:'cooldown',code:code||'unavailable'};
 if(/permission|insufficient|unauthorized/.test(text)){
  if(context.withinClockCooldown)return {fatal:false,kind:'cooldown',code:'permission-denied'};
  return {fatal:true,kind:'permission',code:'permission-denied'};
 }
 if(/resource-exhausted|quota|exceeded.*quota|resource_exhausted/.test(text))return {fatal:true,kind:'quota',code:'resource-exhausted'};
 if(/failed-precondition|aborted|unavailable|deadline|network|fetch|offline|failed to fetch/.test(text))return {fatal:false,kind:'network',code:'unavailable'};
 return {fatal:false,kind:'retry',code:code||'unknown'};
}
export function jsonExportPayload({children,records,settings},uid){
 return {
  version:1,
  exportedAt:new Date().toISOString(),
  children:children.filter(c=>sameOwner(c,uid)).map(portableChild),
  records:records.filter(r=>sameOwner(r,uid)).map(portableRecord),
  settings:settings.filter(s=>s.id==='distance'||s.id==='reverse'||s.id===`reverse:${uid}`||s.id==='lastBackup').map(s=>{
   if(s.id===`reverse:${uid}`)return {id:'reverse',value:s.value};
   const copy={id:s.id,value:s.value};
   return copy;
  })
 };
}
