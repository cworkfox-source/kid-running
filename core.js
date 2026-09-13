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
export function csv(records){const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+[['日期','距離公尺','秒數','速度m/s','時速km/h','備註'],...chronological(records).map(r=>[r.date,r.distance,r.seconds,speed(r).ms.toFixed(2),speed(r).kmh.toFixed(2),r.note])].map(row=>row.map(cell).join(',')).join('\r\n');}
export function validateBackup(data){if(data?.version!==1||!Array.isArray(data.children)||!Array.isArray(data.records))throw Error('不是支援的版本 1 備份檔');const children=new Set();for(const c of data.children){if(typeof c.id!=='string'||!c.id||children.has(c.id)||typeof c.name!=='string'||!c.name.trim()||(c.birthday!==null&&!validDate(c.birthday)))throw Error('小孩資料無效');children.add(c.id);}const ids=new Set();for(const r of data.records){validate(r);if(!children.has(r.childId)||typeof r.id!=='string'||!r.id||ids.has(r.id)||!Number.isFinite(Date.parse(r.createdAt))||!Number.isFinite(Date.parse(r.updatedAt)))throw Error('紀錄 ID、時間或小孩關聯無效');for(const [field,allowed] of Object.entries({startType:['','standing','flying','free'],surface:['','indoor','track','asphalt','grass'],timingMethod:['','manual','video','electronic']})){if(!allowed.includes(r[field]??''))throw Error('測試條件無效');}ids.add(r.id);}return data;}
export const backupPayload=(children,records,settings,exportedAt=new Date().toISOString())=>({version:1,exportedAt,children,records,settings});
export const backupFilename=(date=today())=>`run-data-${date}.json`;
