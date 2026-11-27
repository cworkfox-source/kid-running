import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLine,parseText,validDate,validate,speed,summary,improvement,warnings,csv,validateBackup,stableStringify,backupContent,contentHash,splitUtf8Chunks,retryDelay,classifyBackupError,LOCAL_OWNER,duplicateGroups,dailyStatistics,chartSeries,remapBackupChildIds,repairChildOwnership,visibleAfterRepair,chartCaption,clockCooldownRemaining,BACKUP_CLOCK_INTERVAL_MS,defaultChildId,pickActiveChild,safeFilenamePart} from '../core.js';
const now='2026-09-13';
for(const [input,seconds] of [['30公尺 7.42秒',7.42],['30m 7.42s',7.42],['今天30公尺跑7秒42',7.42],['30米 7.42秒',7.42],['30 M 8秒5',8.5],['30公尺 8秒05',8.05],['30公尺 7秒420',7.42],['小孩今天30米跑7秒42',7.42],['30公尺跑了7.42秒',7.42],['３０ｍ ７．４２ｓ',7.42]])test(input,()=>{const r=parseLine(input,now);assert.equal(r.distance,30);assert.equal(r.seconds,seconds);assert.equal(r.date,now);});
for(const input of ['9/13 30米 7秒42','2026/9/13 30m 7.42秒','9-13 30m 7.42s','2026-09-13 30m 7.42s'])test(input,()=>assert.equal(parseLine(input,now).date,now));
test('批次無單位秒數與錯誤列',()=>{const rows=parseText('9/1 30m 8.12\n9/3 30m 7.95\n9/6 30m 7.72\n\n無法辨识',now);assert.equal(rows.length,4);assert.deepEqual(rows.slice(0,3).map(x=>x.record.seconds),[8.12,7.95,7.72]);assert.ok(rows[3].error);});
for(const input of ['30m 0秒','0m 7秒','-30m 7秒','30m -7秒','2026-09-13 30m -7秒','2/30 30m 7秒','30m 7秒 30m 8秒','30m 7.4秒2','30m','2026-13-01 30m 7秒'])test('拒絕 '+input,()=>assert.throws(()=>parseLine(input,now)));
test('日期與數值驗證',()=>{assert.ok(validDate('2024-02-29'));assert.ok(!validDate('2026-02-29'));for(const seconds of [NaN,Infinity,-1,0,'7'])assert.throws(()=>validate({date:now,distance:30,seconds,note:''}));});
const run=(seconds,date='2026-09-13',id='a',extra={})=>({id,childId:'child_01',date,distance:30,seconds,note:'',startType:'',surface:'',timingMethod:'',createdAt:date+'T12:00:00Z',updatedAt:date+'T12:00:00Z',...extra});
test('速度使用未捨入值',()=>{assert.equal(speed(run(7.42)).ms.toFixed(2),'4.04');assert.equal(speed(run(7.42)).kmh.toFixed(2),'14.56');assert.equal(improvement(8.12,7.42).percent.toFixed(1),'8.6');});
test('同距離同小孩，補登按日期排序',()=>{const s=summary([run(7.42),run(8.12,'2026-09-01','b'),run(1,now,'c',{distance:10}),run(2,now,'d',{childId:'other'})],30);assert.equal(s.first.seconds,8.12);assert.equal(s.best.seconds,7.42);assert.equal(s.latest.seconds,7.42);assert.equal(s.list.length,2);});
test('重複與異常提示，編輯不比較自身',()=>{const r=run(8);assert.equal(warnings(r,[r]).length,0);assert.equal(warnings({...r,id:'b'},[r]).length,1);assert.ok(warnings(run(74.2,now,'d'),[run(7,now,'a'),run(8,now,'b'),run(9,now,'c')]).length);});
test('重複掃描只分組完全相同的同一小孩資料',()=>{
 const rows=[run(7.42,'2026-09-01','a'),run(7.42,'2026-09-01','b'),run(7.4200001,'2026-09-01','c'),run(7.42,'2026-09-01','d',{childId:'child_02'})];
 const groups=duplicateGroups(rows,{childId:'child_01'});
 assert.equal(groups.length,1);assert.deepEqual(groups[0].map(r=>r.id),['a','b']);
});
test('單日統計會依距離分組，平均速度取每次速度平均',()=>{
 const rows=[run(6,'2026-09-10','a'),run(10,'2026-09-10','b'),run(5,'2026-09-10','c',{distance:20}),run(8,'2026-09-11','d')];
 const result=dailyStatistics(rows,'2026-09-10',{childId:'child_01'});
 assert.equal(result.count,3);assert.equal(result.totalDistance,80);assert.equal(result.byDistance.length,2);
 const thirty=result.byDistance.find(group=>group.distance===30);
 assert.equal(thirty.averageSeconds,8);assert.equal(thirty.bestSeconds,6);assert.equal(thirty.averageSpeed,4);
});
test('速度圖以日期範圍內同日每次速度平均，秒數保留逐筆',()=>{
 const rows=[run(6,'2026-09-01','a'),run(10,'2026-09-01','b'),run(7.5,'2026-09-02','c'),run(8,'2026-09-03','d')];
 const speedPoints=chartSeries(rows,{childId:'child_01',distance:30,start:'2026-09-01',end:'2026-09-02',metric:'ms'});
 assert.deepEqual(speedPoints.map(point=>[point.date,point.value,point.count]),[['2026-09-01',4,2],['2026-09-02',4,1]]);
 const seconds=chartSeries(rows,{childId:'child_01',distance:30,start:'2026-09-01',end:'2026-09-01'});
 assert.deepEqual(seconds.map(point=>point.value),[6,10]);
});
test('CSV BOM、引號與公式注入防護',()=>{const text=csv([run(7.42,now,'a',{note:'=1+1,"test"\n下一行'})]);assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('"\'=1+1,""test""\n下一行"'));});
test('備份格式與關聯驗證',()=>{const data={version:1,children:[{id:'child_01',name:'小孩',birthday:null}],records:[run(7.42)]};assert.equal(validateBackup(data),data);assert.throws(()=>validateBackup({...data,version:2}));assert.throws(()=>validateBackup({...data,records:[run(7),run(8)]}));assert.throws(()=>validateBackup({...data,children:[]}));assert.throws(()=>validateBackup({...data,records:[run(7,now,'a',{timingMethod:'invalid'})]}));});
test('穩定序列化與內容雜湊忽略鍵序',async()=>{
 const a={schemaVersion:1,settings:{reverse:true,theme:'x'},nested:{b:1,a:2}};
 const b={nested:{a:2,b:1},schemaVersion:1,settings:{theme:'x',reverse:true}};
 assert.equal(stableStringify(a),stableStringify(b));
 const rec={id:'r1',childId:'child_01',date:now,distance:30,seconds:7.42,note:'',startType:'',surface:'',timingMethod:'',createdAt:now+'T12:00:00Z',updatedAt:now+'T12:00:00Z',ownerUid:'user-a',updatedNetwork:'nope'};
 const payload=backupContent({children:[{id:'child_01',name:'小孩',birthday:null,ownerUid:'user-a'}],records:[rec],settings:[{id:'lastBackup',value:'t'},{id:'reverse:user-a',value:false},{id:'active-child:user-a',value:'child_01'}]},'user-a');
 assert.equal(payload.records[0].ownerUid,undefined);
 assert.deepEqual(payload.settings,{reverse:false});
 const hash=await contentHash(payload);
 assert.equal(hash.length,64);
 assert.equal(hash,await contentHash(JSON.parse(JSON.stringify(payload))));
});
test('UTF-8 分塊不切字元且退避有上限',()=>{
 const chunks=splitUtf8Chunks('你好世界',4);
 assert.ok(chunks.every(c=>new TextEncoder().encode(c).length<=4));
 assert.equal(chunks.join(''),'你好世界');
 const delay=retryDelay(10,()=>0.5);
 assert.equal(delay,300000);
 const classified=classifyBackupError({code:'permission-denied',message:'no'});
 assert.equal(classified.fatal,true);
 assert.equal(classifyBackupError({code:'unavailable'}).fatal,false);
 assert.equal(LOCAL_OWNER,'local-only');
});
test('圖表說明：跨日平均、單日各筆',()=>{
 assert.match(chartCaption({metric:'seconds'}),/每日平均秒數/);
 assert.match(chartCaption({metric:'seconds',start:'2026-09-01',end:'2026-09-10'}),/跨日顯示每日平均/);
 assert.match(chartCaption({metric:'seconds',start:'2026-09-01',end:'2026-09-01'}),/單日各筆連線/);
 assert.match(chartCaption({metric:'ms',start:'2026-09-01',end:'2026-09-01'}),/單日各筆速度/);
});
test('備份冷卻剩餘時間與權限錯誤可當冷卻重試',()=>{
 assert.equal(clockCooldownRemaining(null,1000),0);
 assert.equal(clockCooldownRemaining('1970-01-01T00:00:00.000Z',30_000),BACKUP_CLOCK_INTERVAL_MS-30_000);
 assert.equal(classifyBackupError({code:'permission-denied'},{withinClockCooldown:true}).kind,'cooldown');
 assert.equal(classifyBackupError({kind:'cooldown',message:'備份冷卻中'}).fatal,false);
 assert.equal(classifyBackupError({code:'permission-denied'}).fatal,true);
});
test('還原 child_01 會改寫成帳號專用 ID',()=>{
 const payload={children:[{id:'child_01',name:'小明',birthday:null}],records:[run(7.42)]};
 const remapped=remapBackupChildIds(payload,'user-a',new Set(['child_01']));
 assert.equal(remapped.children[0].id,'child_01__user-a');
 assert.equal(remapped.records[0].childId,'child_01__user-a');
 assert.equal(defaultChildId('user-a'),'child_01__user-a');
});
test('目前小孩可按本機選擇切換，無效選擇會回到預設小孩',()=>{
 const children=[
  {id:'child_01',name:'小安',birthday:null,ownerUid:LOCAL_OWNER},
  {id:'child_01__2',name:'小樂',birthday:null,ownerUid:LOCAL_OWNER}
 ];
 assert.equal(pickActiveChild(children,LOCAL_OWNER,'child_01__2').name,'小樂');
 assert.equal(pickActiveChild(children,LOCAL_OWNER,'missing').name,'小安');
});
test('還原後模擬重新整理：紀錄仍指向可見小孩',()=>{
 const children=[{id:'child_01',name:'小明',birthday:null,ownerUid:'user-a'}];
 const records=[run(7.42,'2026-09-13','rec-1')];
 records[0].ownerUid='user-a';
 const after=visibleAfterRepair({children,records,uid:'user-a'});
 assert.equal(after.visible.length,1);
 assert.equal(after.visible[0].id,'rec-1');
 assert.equal(after.child.ownerUid,'user-a');
});
test('登入前誤建 child_01 覆寫擁有者後，可修復失聯紀錄',()=>{
 const children=[{id:'child_01',name:'小孩',birthday:null,ownerUid:LOCAL_OWNER}];
 const records=[{...run(7.42,'2026-09-13','rec-1'),ownerUid:'user-a',childId:'child_01'}];
 const after=visibleAfterRepair({children,records,uid:'user-a'});
 assert.equal(after.visible.length,1);
 assert.equal(after.visible[0].id,'rec-1');
 assert.equal(after.child.id,'child_01');
 assert.equal(after.child.ownerUid,'user-a');
 const repaired=repairChildOwnership({children,records,uid:'user-a'});
 assert.ok(repaired.changes.some(c=>c.type==='reclaim'));
});
test('非 stub 的 child_01 被占用時，帳號紀錄改掛到自己的小孩',()=>{
 const children=[{id:'child_01',name:'本地小孩',birthday:null,ownerUid:LOCAL_OWNER}];
 const records=[
  {...run(8,'2026-09-12','local-1'),ownerUid:LOCAL_OWNER,childId:'child_01'},
  {...run(7.42,'2026-09-13','rec-1'),ownerUid:'user-a',childId:'child_01'}
 ];
 const after=visibleAfterRepair({children,records,uid:'user-a'});
 assert.equal(after.visible.length,1);
 assert.equal(after.visible[0].id,'rec-1');
 assert.equal(after.child.id,'child_01__user-a');
 assert.equal(after.child.ownerUid,'user-a');
});

test('不同來源的小孩衝突時各自修復，不合併紀錄且可重複執行',()=>{
 const children=[
  {id:'foreign-a',name:'甲',birthday:null,ownerUid:'other'},
  {id:'foreign-b',name:'乙',birthday:null,ownerUid:'other'},
  {id:'mine',name:'原有',birthday:null,ownerUid:'user-a'}
 ];
 const records=[
  {...run(8,'2026-09-12','r1'),ownerUid:'user-a',childId:'foreign-a'},
  {...run(9,'2026-09-13','r2'),ownerUid:'user-a',childId:'foreign-b'}
 ];
 const repaired=repairChildOwnership({children,records,uid:'user-a'});
 assert.notEqual(repaired.records[0].childId,repaired.records[1].childId);
 assert.deepEqual(repaired.records.map(record=>repaired.children.find(child=>child.id===record.childId)?.name),['甲','乙']);
 const again=repairChildOwnership({children:repaired.children,records:repaired.records,uid:'user-a'});
 assert.equal(again.changes.length,0);
 assert.deepEqual(again.records,repaired.records);
});

test('CSV 檔名片段會保留姓名並移除不合法字元',()=>{
 assert.equal(safeFilenamePart(' 小安/測試:*? '),'小安-測試---');
 assert.equal(safeFilenamePart('...'),'child');
});


test('跨帳號還原遇到相同紀錄 ID 時會重新編號，不覆寫既有紀錄',()=>{
 const payload={children:[{id:'child_01',name:'小明',birthday:null}],records:[run(7.42,'2026-09-13','same-id')]};
 const remapped=remapBackupChildIds(payload,'user-a',new Set(),new Set(['same-id']));
 assert.notEqual(remapped.records[0].id,'same-id');
 assert.match(remapped.records[0].id,/same-id__user-a/);
 assert.equal(remapped.records[0].childId,defaultChildId('user-a'));
});

test('貼上重複比對：與既有紀錄或本次較前面的列相同才標記，且只比對同一位小孩',async()=>{
 const {pasteDuplicateInfo,pasteImportPlan}=await import('../core.js');
 const existing=[
  {id:'a',childId:'c1',date:'2026-09-13',distance:30,seconds:7.42,createdAt:'2026-09-13T01:00:00Z'},
  {id:'b',childId:'c2',date:'2026-09-13',distance:30,seconds:8,createdAt:'2026-09-13T01:00:00Z'}
 ];
 const items=[
  {line:1,record:{date:'2026-09-13',distance:30,seconds:7.42}},
  {line:2,record:{date:'2026-09-13',distance:30,seconds:8}},
  {line:3,error:'無法辨識',source:'xx'},
  {line:4,record:{date:'2026-09-13',distance:30,seconds:8}}
 ];
 const info=pasteDuplicateInfo(items,existing,'c1');
 assert.deepEqual(info[0].existing.map(r=>r.id),['a']);
 assert.equal(info[1],null,'其他小孩的相同成績不算重複');
 assert.equal(info[2],null);
 assert.deepEqual(info[3],{existing:[],earlierLines:[2]});

 assert.deepEqual(pasteImportPlan(items,info).importItems.map(i=>i.line),[2],'重複列預設不匯入');
 items[0].keep=true;
 const plan=pasteImportPlan(items,info);
 assert.deepEqual(plan.importItems.map(i=>i.line),[1,2]);
 assert.deepEqual(plan.skipped.map(i=>i.line),[4]);
});

import {sportOf,terrainOf,eventKey,eventLabel,portableRecord,duplicate} from '../core.js';
test('滑步車：文字關鍵字與目前運動預設',()=>{
 const a=parseLine('滑步車 山坡 20m 9秒8',now);assert.equal(a.sport,'balance');assert.equal(a.terrain,'slope');assert.equal(a.seconds,9.8);
 const b=parseLine('山坡10米 5.2秒',now);assert.equal(b.sport,'run','地形關鍵字不改變運動');assert.equal(b.terrain,'slope');
 const c=parseLine('30m 7.42秒',now);assert.equal(c.sport,'run');assert.equal(c.terrain,'flat');
 const d=parseLine('20m 9秒',now,{sport:'balance',terrain:'slope'});assert.equal(d.sport,'balance');assert.equal(d.terrain,'slope');
 const e=parseLine('跑步 30m 7秒',now,{sport:'balance'});assert.equal(e.sport,'run');
 const rows=parseText('9/1 平地 10m 5.1\n9/1 山坡 10m 6.3',now,{sport:'balance'});assert.equal(parseLine('滑步車 20m 9秒',now).sport,'balance');assert.deepEqual(rows.map(x=>eventKey(x.record)),['balance:flat:10','balance:slope:10']);
});
test('滑步車：分組、摘要、重複判斷不與跑步或其他地形混算',()=>{
 const rows=[run(5,'2026-09-01','a',{distance:10}),run(6,'2026-09-01','b',{distance:10,sport:'balance',terrain:'flat'}),run(8,'2026-09-02','c',{distance:10,sport:'balance',terrain:'slope'}),run(6,'2026-09-01','d',{distance:10,sport:'balance',terrain:'slope'})];
 assert.equal(summary(rows,10).list.length,1,'數字距離＝跑步，向下相容');
 assert.equal(summary(rows,{sport:'balance',terrain:'slope',distance:10}).best.id,'d');
 assert.equal(duplicate(rows[1],rows[3]),false);
 assert.equal(duplicateGroups(rows,{childId:'child_01'}).length,0);
 const day=dailyStatistics(rows,'2026-09-01',{childId:'child_01'});assert.deepEqual(day.byDistance.map(g=>g.label),['跑步 平地 10 公尺','滑步車 平地 10 公尺','滑步車 山坡 10 公尺']);
 assert.equal(dailyStatistics(rows,'2026-09-01',{childId:'child_01',sport:'balance'}).count,2);
 assert.equal(chartSeries(rows,{childId:'child_01',event:{sport:'balance',terrain:'slope',distance:10}}).length,2);
 assert.equal(eventLabel({sport:'balance',terrain:'slope',distance:20}),'山坡 20 公尺');
 assert.equal(sportOf({}),'run');assert.equal(terrainOf({sport:'balance'}),'flat');
});
test('滑步車：驗證、備份欄位與 CSV',()=>{
 assert.throws(()=>validate({...run(5),sport:'swim'}));assert.throws(()=>validate({...run(5),terrain:'hill'}));
 assert.equal('sport' in portableRecord(run(5)),false,'跑步紀錄備份內容不變，雜湊不受影響');
 assert.deepEqual([portableRecord(run(5,now,'x',{sport:'balance',terrain:'slope'})).sport,portableRecord(run(5,now,'x',{sport:'balance',terrain:'slope'})).terrain],['balance','slope']);
 const data={version:1,children:[{id:'child_01',name:'小孩',birthday:null}],records:[run(5,now,'x',{sport:'balance',terrain:'flat'})]};assert.equal(validateBackup(data),data);
 assert.ok(csv([run(5,now,'x',{sport:'balance',terrain:'slope'})]).includes('"滑步車","山坡"'));
});

test('跑步也分平地／山坡；舊跑步紀錄視為平地，備份內容不變',()=>{
 const legacy=run(7,'2026-09-01','a'),flat=run(7,'2026-09-02','b',{sport:'run',terrain:'flat'}),slope=run(9,'2026-09-03','c',{sport:'run',terrain:'slope'});
 assert.equal(eventKey(legacy),'run:flat:30');assert.equal(eventKey(legacy),eventKey(flat));assert.notEqual(eventKey(flat),eventKey(slope));
 assert.equal(summary([legacy,flat,slope],30).list.length,2,'數字距離＝跑步平地');
 assert.equal(summary([legacy,flat,slope],{sport:'run',terrain:'slope',distance:30}).best.id,'c');
 assert.equal('terrain' in portableRecord(flat),false);assert.equal(portableRecord(slope).terrain,'slope');assert.equal('sport' in portableRecord(slope),false);
 assert.equal(eventLabel(slope,{full:true}),'跑步 山坡 30 公尺');
});
