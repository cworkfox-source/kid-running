import {today,validate,parseText,summary,speed,improvement,chronological,warnings,csv,validateBackup,LOCAL_OWNER,sameOwner,jsonExportPayload,defaultChildId,duplicateGroups,dailyStatistics,chartSeries} from './core.js';
import {openDB,all,write,ensureAppMeta,getAccount,putAccount,acquireLock,heartbeatLock,releaseLock,saveRestoreSnapshot} from './db.js';
import {createAuthService,persistenceUnavailableMessage,shouldCompleteBackupEnable,writeEnableIntent,readEnableIntent,clearEnableIntent} from './auth.js';
import {loadFirebaseModules,resolveFirebaseConfig,initFirebase,loadLocalFirebaseConfig} from './firebase.js';
import {createFirestoreCloud} from './cloud.js';
import {createBackupService,describeBackupStatus} from './backup.js';
import {restoreVersion,restorePreview,queryRestorableVersions,restoreListCopy} from './restore.js';
import {exportFile,exportOutcomeMessage,INERT_DOWNLOAD_HINT} from './export.js';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'⌂',records:'☷',analysis:'↗',settings:'⚙'};
let records=[],children=[],settings=[],page='home',distance=30,filter='all',preview=[],backup=null,editing=null,busy=false,pasteDraft='',duplicateScanOpen=false;
let analysisStart='',analysisEnd='',analysisDay=today(),analysisMetric='seconds';
let draft={date:today(),distance:30,seconds:'',note:'',startType:'',surface:'',timingMethod:''};
let appMeta=null,accountState=null,authUser=null,authInfo={ready:false,resolving:true,configured:false,available:false,persistence:{ok:true,longLived:true}},cloud=null,backupService=null,authService=null,tabId='tab',versions=[],restoreOffer=null,online=typeof navigator==='undefined'?true:navigator.onLine!==false,statusExtra={};
let versionsQuery={status:'idle',versions:[],error:null},versionsUid=null,versionsLoading=false,selectedRestore=null,exportFallback=null,lastSuccessKey='';
const ownerId=()=>authUser?.uid||LOCAL_OWNER;
const scopedChildren=()=>children.filter(c=>sameOwner(c,ownerId()));
const scopedRecords=()=>records.filter(r=>sameOwner(r,ownerId()));
const active=()=>scopedChildren().find(c=>c.id==='child_01'||c.id===defaultChildId(ownerId()))||scopedChildren()[0];
const own=()=>active()?scopedRecords().filter(r=>r.childId===active().id):[];
const reverseOn=()=>{const exact=settings.find(s=>s.id===`reverse:${ownerId()}`);if(exact)return exact.value!==false;if(ownerId()===LOCAL_OWNER)return settings.find(s=>s.id==='reverse')?.value!==false;return true;};
const stat=()=>active()?summary(scopedRecords(),Number(distance),active().id):null;
const f=n=>Number(n).toFixed(2), short=d=>`${Number(d.slice(5,7))}/${Number(d.slice(8,10))}`;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),4500);}
function delta(before,after){const v=improvement(before,after);return Math.abs(v.seconds)<1e-9?'與前一次相同':`${v.seconds>0?'快':'慢'} ${f(Math.abs(v.seconds))} 秒（${v.seconds>0?'+':'−'}${Math.abs(v.percent).toFixed(1)}%）`;}
function options(values,value){return values.map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('');}
function distanceSelect(){return `<label class="filter-label">測試距離<select id="analysis-distance">${[...new Set([10,20,30,40,50,60,100,...own().map(r=>r.distance),Number(distance)])].sort((a,b)=>a-b).map(d=>`<option value="${d}" ${d===Number(distance)?'selected':''}>${d} 公尺</option>`).join('')}</select></label>`;}
function statusView(){
 const acc=accountState||{};
 return describeBackupStatus({
  sdkFailed:Boolean(authInfo.configured&&authInfo.loadError&&!authInfo.available),
  configured:Boolean(authInfo.configured),
  resolving:Boolean(authInfo.resolving),
  user:authUser,
  persistenceOk:authInfo.persistence?.ok!==false,
  enabled:Boolean(acc.backupEnabled&&authUser),
  paused:Boolean(acc.backupPaused),
  online,
  waitingFirst:Boolean(acc.waitingFirstRecord),
  pending:Boolean(acc.pendingBackup),
  uploading:Boolean(statusExtra.uploading||backupService?.isUploading?.()),
  lastSuccess:acc.lastSuccess,
  lastError:acc.lastError||statusExtra.lastError,
  fatalKind:acc.lastError?.kind||statusExtra.fatalKind,
  recordCount:scopedRecords().length,
  dirty:Boolean(acc.lastSuccess&&acc.pendingBackup)
 });
}
function backupLine(){const s=statusView();return `<p class="backup-status ${s.tone}" id="backup-status" data-state="${s.code}">${esc(s.text)}</p>`;}
function enableBanner(){
 if(authUser&&accountState?.backupEnabled)return '';
 if(appMeta?.enablePromptDismissed)return '';
 return `<section class="card backup-banner"><div class="section-head"><h2>雲端版本備份</h2><span class="pill">可稍後</span></div><p>登入一次，之後自動備份。本機仍會先存好，不會擋住你記錄成績。</p><p class="quiet">清除網站資料、無痕、換機／換瀏覽器，或撤銷 Google 授權後需要再登入。</p><div class="banner-actions"><button class="primary" id="enable-backup" type="button">使用 Google 帳號啟用備份</button><button class="secondary" id="dismiss-backup" type="button">稍後設定</button></div></section>`;
}
function render(){const titles={home:['每一步，都算數。','記下今天的努力，看見明天的進步。'],records:['努力，有跡可循。','每一筆紀錄，都是成長的一小步。'],analysis:['看見自己的進步。','和上一次的自己比，就很好。'],settings:['準備好，再出發。','你的紀錄，由你保管。']};const name=active()?.name||'小孩';$('#app').innerHTML=`<div class="shell"><header><a class="brand" href="#home"><span class="brandmark">↗</span><span>小步快跑<small>LITTLE STRIDES</small></span></a><span class="profile"><span class="avatar">${esc(name.slice(0,1))}</span>${esc(name)}</span></header><main><div class="page-heading"><p class="eyebrow">${{home:'READY, SET, GROW',records:'RUNNING JOURNAL',analysis:'YOUR PROGRESS',settings:'MAKE IT YOURS'}[page]}</p><h1>${titles[page][0]}</h1><p>${titles[page][1]}</p></div>${page==='home'?home():page==='records'?recordPage():page==='analysis'?analysis():settingPage()}</main><footer>小小的步伐，也有大大的進步。</footer></div><nav aria-label="主要導覽">${Object.entries({home:'首頁',records:'紀錄',analysis:'分析',settings:'設定'}).map(([key,label])=>`<button data-page="${key}" class="nav-item ${page===key?'active':''}" ${page===key?'aria-current="page"':''}><span aria-hidden="true">${icons[key]}</span>${label}</button>`).join('')}</nav>`;bind();}
function home(){const s=stat();return `<div class="home-grid"><div>${enableBanner()}<section class="card input-card"><div class="section-head"><h2>${editing?'編輯紀錄':'記錄今天的成績'}</h2><span class="pill">${editing?'修改中':'QUICK ADD'}</span></div><form id="run-form"><label class="date-row">測試日期<input aria-label="測試日期" id="date" type="date" required value="${esc(draft.date)}"></label><div class="metric-inputs"><label>距離 <span>公尺</span><input id="distance" type="number" inputmode="decimal" min="0.01" step="any" required value="${esc(draft.distance)}"></label><span class="divider">/</span><label>時間 <span>秒</span><input id="seconds" type="number" inputmode="decimal" min="0.001" step="any" placeholder="7.42" required value="${esc(draft.seconds)}"></label></div><div class="chips" aria-label="距離快捷鍵">${[10,20,30,40,50,60,100].map(d=>`<button type="button" data-distance="${d}" class="chip ${Number(draft.distance)===d?'selected':''}">${d}<small>m</small></button>`).join('')}<button type="button" id="custom" class="chip">自訂</button></div><details ${draft.note||draft.startType||draft.surface||draft.timingMethod?'open':''}><summary>＋ 備註與測試條件 <span>選填</span></summary><label>備註<textarea id="note" placeholder="場地、鞋子、天氣，或今天的小發現…">${esc(draft.note)}</textarea></label><div class="conditions"><label>起跑<select id="startType">${options([['','未指定'],['standing','靜止起跑'],['flying','助跑'],['free','自由跑']],draft.startType)}</select></label><label>場地<select id="surface">${options([['','未指定'],['indoor','室內'],['track','操場'],['asphalt','柏油'],['grass','草地']],draft.surface)}</select></label><label>計時<select id="timingMethod">${options([['','未指定'],['manual','手動'],['video','影片'],['electronic','電子計時']],draft.timingMethod)}</select></label></div></details><button class="primary add" type="submit">${editing?'儲存修改':'＋ 新增紀錄'}<span>↗</span></button>${editing?'<button class="secondary full" type="button" id="cancel-edit">取消編輯</button>':''}<p class="quiet centered">只需輸入秒數，就能記下這一步。</p></form></section><section class="card paste-card"><div class="section-head"><h2><span class="mini-icon">≡</span> 貼上文字，輕鬆記錄</h2><span class="muted">支援多筆</span></div><p class="muted">手邊已經有紀錄？整段貼上就好。</p><textarea id="paste" rows="3" aria-label="貼上跑步紀錄" placeholder="30公尺 7秒42&#10;9/13 30m 7.42秒"></textarea><button class="secondary full" id="parse">自動辨識 <span>→</span></button><div id="preview">${previewHTML()}</div></section></div><aside><section class="card progress-card"><div class="section-head"><h2>最近表現</h2><span class="live-dot">●</span></div>${distanceSelect()}${s?summaryHTML(s):empty('新的起跑線','新增第一筆成績，這裡就會開始記錄進步。')}<button class="text-button" data-page="analysis">查看完整分析 <span>↗</span></button></section><section class="encourage"><div class="track-art" aria-hidden="true"><i></i><i></i><i></i><b>↗</b></div><p>不必跑得比別人快。<br><strong>每次，都更靠近自己。</strong></p></section>${restoreOfferHTML()}${backupLine()}<p class="storage-note">◉ 日常資料存在這台裝置，雲端只做版本備份<br><button class="text-button" data-page="settings">備份與帳號設定 →</button></p></aside></div>`;}
function summaryHTML(s){const v=s.total;return `<p class="muted">最近一次 · ${short(s.latest.date)}</p><div class="hero-number">${f(s.latest.seconds)}<span>秒</span></div><div class="speed-line">${f(speed(s.latest).ms)} m/s <span>· ${f(speed(s.latest).kmh)} km/h</span></div>${s.latest.seconds===s.best.seconds?'<span class="pb">🏆 目前最佳成績</span>':''}<div class="stat-pair"><div><span>個人最佳</span><strong>${f(s.best.seconds)}<small> 秒</small></strong></div><div><span>第一次</span><strong>${f(s.first.seconds)}<small> 秒</small></strong></div></div>${s.list.length>1?`<div class="improvement ${v.seconds<0?'slower':''}"><span>${v.seconds>=0?'↗':'↘'} 比第一次${v.seconds>=0?'進步':'慢了'}</span><strong>${f(Math.abs(v.seconds))} 秒 <small>（${Math.abs(v.percent).toFixed(1)}%）</small></strong></div><p class="recent-label">近 ${Math.min(3,s.list.length)} 次 <span>${s.list.slice(-3).map(r=>f(r.seconds)).join(' → ')}</span></p><p class="quiet">${s.list.length>=3&&s.list.slice(-3).every((r,i,a)=>i===0||r.seconds<a[i-1].seconds)?'持續進步 ↑':s.previous?`比前一次${delta(s.previous.seconds,s.latest.seconds)}`:''}</p>`:'<p class="quiet">第一筆紀錄，新的起點！</p>'}`;}
function empty(title,text){return `<div class="empty"><span>↗</span><h3>${title}</h3><p>${text}</p></div>`;}
function previewHTML(){if(!preview.length)return '';return `<div class="import-preview"><h3>辨識預覽 · ${preview.filter(x=>x.record).length} 筆</h3><p class="quiet">尚未儲存。可修改辨識值；錯誤列請修正原文後重新辨識。</p>${preview.map((p,i)=>p.error?`<div class="error">第 ${p.line} 行：${esc(p.source)}<br>${esc(p.error)}</div>`:`<div class="preview-row"><span>第 ${p.line} 行</span><label>日期<input type="date" data-preview="${i}" data-field="date" value="${p.record.date}"></label><label>公尺<input type="number" inputmode="decimal" step="any" data-preview="${i}" data-field="distance" value="${p.record.distance}"></label><label>秒數<input type="number" inputmode="decimal" step="any" data-preview="${i}" data-field="seconds" value="${p.record.seconds}"></label></div>`).join('')}<button class="primary full" id="confirm-import" ${preview.some(x=>x.error)?'disabled':''}>確認匯入 ${preview.filter(x=>x.record).length} 筆紀錄</button></div>`;}
function restoreOfferHTML(){
 if(!restoreOffer)return '';
 const latest=restoreOffer.versions[0];
 if(!latest)return '';
 const p=restorePreview(latest,scopedRecords().length);
 return `<section class="card restore-offer"><h2>雲端已有備份</h2><p>${esc(p.title)}</p><p class="muted">${latest.recordCount} 筆紀錄 · ${latest.childCount} 位小孩</p><p class="quiet">${esc(p.replaceScope)}</p><div class="banner-actions"><button class="primary" id="offer-restore" type="button">預覽並還原最新版</button><button class="secondary" id="keep-local" type="button">${restoreOffer.action==='diverged'?'保留這台裝置的版本':'稍後到設定頁選擇'}</button></div></section>`;
}
function duplicateScanner(){const groups=duplicateGroups(scopedRecords(),{childId:active()?.id});if(!duplicateScanOpen)return `<button class="secondary" id="scan-duplicates">檢查重複資料</button>`;if(!groups.length)return `<section class="card duplicate-scanner"><div class="section-head"><h2>重複資料檢查</h2><button class="text-button" id="close-duplicates">關閉</button></div><p class="muted">沒有找到相同日期、距離及秒數的紀錄。</p></section>`;const extras=groups.reduce((sum,g)=>sum+g.length-1,0);return `<section class="card duplicate-scanner"><div class="section-head"><h2>重複資料檢查</h2><button class="text-button" id="close-duplicates">關閉</button></div><p class="muted">找到 ${groups.length} 組疑似重複，共 ${groups.reduce((sum,g)=>sum+g.length,0)} 筆；每組保留一筆最多可刪除 ${extras} 筆。</p>${groups.map((group,i)=>`<fieldset class="duplicate-group"><legend>${group[0].date} · ${group[0].distance}m · ${f(group[0].seconds)} 秒</legend>${group.map((r,j)=>`<label class="duplicate-row"><input type="checkbox" data-duplicate-id="${esc(r.id)}"><span>${j===0?'最早建立':'另一筆'} · ${esc(new Date(r.createdAt).toLocaleString('zh-TW'))}${r.note?`<small>${esc(r.note)}</small>`:''}</span></label>`).join('')}<button class="text-button" data-keep-first="${i}">保留最早一筆</button></fieldset>`).join('')}<button class="danger-button" id="delete-duplicates" disabled>刪除所選 0 筆</button><p class="quiet">不會自動刪除；若同一天真的跑出相同成績，可全部保留。</p></section>`;}
function recordPage(){let list=chronological(own().filter(r=>filter==='all'||r.distance===Number(filter))).reverse();const scanner=duplicateScanner(),scannerAction=duplicateScanOpen?'':scanner,scannerPanel=duplicateScanOpen?scanner:'';return `<div class="section-head list-heading"><h2>全部紀錄 <span class="count">${list.length}</span></h2><div><label>距離 <select id="record-filter">${options([['all','全部距離'],...[...new Set(own().map(r=>r.distance))].sort((a,b)=>a-b).map(d=>[String(d),`${d} 公尺`])],filter)}</select></label> ${scannerAction}</div></div>${scannerPanel}${!list.length?`<section class="card">${empty('還沒有跑步紀錄','從今天的第一筆開始吧。')}<button class="primary full" data-page="home">＋ 記錄成績</button></section>`:`<div class="record-list">${list.map(r=>{const s=summary(scopedRecords(),r.distance,r.childId),idx=s.list.findIndex(x=>x.id===r.id),previous=s.list[idx-1];return `<article class="card record"><div class="record-date">${short(r.date)}<small>${r.date.slice(0,4)}</small></div><div class="record-main"><div class="record-title"><strong>${r.distance}<small> m</small></strong><b>${f(r.seconds)}<small> 秒</small></b>${r.seconds===s.best.seconds?'<span class="pb">🏆 PB</span>':''}</div><p class="muted">${f(speed(r).ms)} m/s · ${f(speed(r).kmh)} km/h</p>${previous?`<p class="comparison ${r.seconds>previous.seconds?'slower':''}">比前一次${delta(previous.seconds,r.seconds)}</p>`:'<p class="quiet">這個距離的第一筆紀錄</p>'}${r.note?`<p class="record-note">${esc(r.note)}</p>`:''}<div class="tags">${[({standing:'靜止起跑',flying:'助跑',free:'自由跑'})[r.startType],({indoor:'室內',track:'操場',asphalt:'柏油',grass:'草地'})[r.surface],({manual:'手動',video:'影片',electronic:'電子計時'})[r.timingMethod]].filter(Boolean).map(t=>`<span>${t}</span>`).join('')}</div><div class="record-actions"><button data-edit="${esc(r.id)}">編輯／備註</button><button data-copy="${esc(r.id)}">複製</button><button class="danger" data-delete="${esc(r.id)}">刪除</button></div></div></article>`;}).join('')}</div>`}`;}
function chart(points,metric){if(!points.length)return empty('這個範圍沒有資料','調整日期或距離後再試。');const values=points.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.15,.1),low=Math.max(0,min-pad),high=max+pad,reverse=metric==='seconds'&&reverseOn(),times=points.map(p=>Date.parse(p.date+'T12:00:00Z')),tmin=Math.min(...times),tmax=Math.max(...times),label=metric==='seconds'?'秒數':metric==='ms'?'平均速度 m/s':'平均時速 km/h',aria=metric==='seconds'?`${distance} 公尺秒數趨勢圖，${reverse?'秒數越低位置越高':'秒數越低位置越低'}`:`${distance} 公尺${label}趨勢圖`,x=i=>50+(tmax===tmin?(points.length===1?.5:i/(points.length-1)):(times[i]-tmin)/(tmax-tmin))*550,y=v=>30+(reverse?(v-low)/(high-low):(high-v)/(high-low))*210;return `<div class="chart-wrap"><svg viewBox="0 0 640 300" role="img" aria-label="${aria}">${Array.from({length:5},(_,i)=>{const v=low+(high-low)*i/4;return `<line x1="50" x2="610" y1="${y(v)}" y2="${y(v)}" stroke="#e6eae9" stroke-dasharray="4 4"/><text x="40" y="${y(v)+4}" text-anchor="end">${v.toFixed(2)}</text>`;}).join('')}<polyline points="${points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ')}" fill="none" stroke="#188870" stroke-width="3" stroke-linejoin="round"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="5" fill="#188870" stroke="white" stroke-width="2"><title>${p.date}：${f(p.value)} ${metric==='seconds'?'秒':metric==='ms'?'m/s':'km/h'}${p.count>1?`（${p.count} 次平均）`:''}</title></circle>${i===0||i===points.length-1||points.length<=6?`<text x="${x(i)}" y="270" text-anchor="middle">${short(p.date)}</text>`:''}`).join('')}</svg></div><details><summary>查看圖表數據</summary><table><thead><tr><th>日期</th><th>${label}</th><th>次數</th><th>當日最佳</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.date}</td><td>${f(p.value)} ${metric==='seconds'?'秒':metric==='ms'?'m/s':'km/h'}</td><td>${p.count}</td><td>${f(p.bestSeconds)} 秒</td></tr>`).join('')}</tbody></table></details>`;}
function dayStatistics(){const result=dailyStatistics(scopedRecords(),analysisDay,{childId:active()?.id});return `<section class="card"><div class="section-head"><h2>單日統計</h2><label class="filter-label">日期 <input id="analysis-day" type="date" value="${analysisDay}"></label></div>${!result.count?'<p class="muted">這一天尚無紀錄。</p>':`<div class="day-total"><strong>${result.count}</strong><span>次測試</span><span>總距離 ${f(result.totalDistance)}m</span><span>總測試時間 ${f(result.totalSeconds)} 秒</span></div><table><thead><tr><th>距離</th><th>次數</th><th>平均秒數</th><th>最佳秒數</th><th>平均速度</th></tr></thead><tbody>${result.byDistance.map(g=>`<tr><td>${g.distance}m</td><td>${g.count}</td><td>${f(g.averageSeconds)} 秒</td><td>${f(g.bestSeconds)} 秒</td><td>${f(g.averageSpeed)} m/s<br><small>${f(g.averageSpeed*3.6)} km/h</small></td></tr>`).join('')}</tbody></table><p class="quiet">平均速度為該日每次速度的平均，不以平均秒數反推。</p>`}</section>`;}
function analysis(){const s=stat(),points=chartSeries(scopedRecords(),{childId:active()?.id,distance:Number(distance),start:analysisStart,end:analysisEnd,metric:analysisMetric}),label=analysisMetric==='seconds'?'秒數':analysisMetric==='ms'?'每日平均速度':'每日平均時速';return `<section class="card"><div class="section-head"><h2>成績趨勢</h2>${distanceSelect()}</div><div class="analysis-filters"><label>開始日期<input id="analysis-start" type="date" value="${analysisStart}"></label><label>結束日期<input id="analysis-end" type="date" value="${analysisEnd}"></label><label>顯示<select id="analysis-metric">${options([['seconds','秒數'],['ms','平均速度 m/s'],['kmh','平均時速 km/h']],analysisMetric)}</select></label></div><p class="muted">${analysisMetric==='seconds'?'逐筆顯示；秒數越低越好。':'同一距離以每天各次速度的平均值呈現；沒有測試的日期不補 0。'}</p>${analysisMetric==='seconds'?`<label class="checkbox"><input id="reverse" type="checkbox" ${reverseOn()?'checked':''}>反轉 Y 軸，讓進步向上</label>`:''}${chart(points,analysisMetric)}</section>${dayStatistics()}${s?`<section class="card analysis-summary"><h2>${distance} 公尺 · 進步摘要</h2>${summaryHTML(s)}</section>`:''}<section class="card"><h2>個人最佳紀錄</h2>${own().length?`<div class="pb-grid">${[...new Set(own().map(r=>r.distance))].sort((a,b)=>a-b).map(d=>{const b=summary(scopedRecords(),d,active().id).best;return `<div><span>${d} 公尺</span><strong>${f(b.seconds)}<small> 秒</small></strong><span>${b.date}</span></div>`;}).join('')}</div>`:'<p class="muted">第一筆成績會成為你的起始紀錄。</p>'}<p class="quiet">手動計時、場地與起跑方式都可能影響成績，建議在相近條件下觀察趨勢。</p></section>`;}
function restoreStatusCode(){
 if(versionsLoading)return 'loading';
 if(versionsQuery.status&&versionsQuery.status!=='idle')return versionsQuery.status;
 if(!authUser)return 'signed-out';
 if(!cloud)return 'unavailable';
 return 'idle';
}
function restorePanelHTML(){
 const status=restoreStatusCode();
 const shown=versionsQuery.versions||versions;
 const copy=restoreListCopy(status,shown,{lastSuccess:accountState?.lastSuccess});
 const retryLabel=status==='loading'?'查詢中…':status==='ready'||status==='empty'||status==='inconsistent'?'重新整理':status==='signed-out'||status==='idle'?'查詢雲端版本':'再試一次';
 const canQuery=Boolean(authUser);
 const hideList=['signed-out','unavailable','empty','inconsistent'].includes(status);
 const list=hideList?[]:shown;
 const listHTML=Array.isArray(list)&&list.length?`<ul class="version-list">${list.map((v,i)=>`<li><div><strong>${esc(v.deviceLabel||v.deviceId)}</strong><p>${esc(v.completedLabel||'時間未知')} · 雲端 ${v.recordCount??0} 筆${i===0?' · 最近完成':''}</p></div><button class="secondary" data-restore="${esc(v.backupId)}" data-device="${esc(v.deviceId)}">預覽還原</button></li>`).join('')}</ul>`:'';
 const preview=selectedRestore?restorePreview(selectedRestore,scopedRecords().length):null;
 const previewHTML=preview?`<div class="notice restore-preview-card" id="restore-preview-card"><strong>${esc(preview.title)}</strong><p>備份時間：${esc(preview.completedLabel)}</p><p>來源裝置：${esc(preview.deviceLabel)}</p><p>雲端 ${preview.recordCount??0} 筆紀錄 · 將取代本機 ${preview.localRecordCount} 筆</p><p class="quiet">${esc(preview.replaceScope)}</p><div class="banner-actions"><button class="primary" id="confirm-restore" type="button">確認取代並還原</button><button class="secondary" id="cancel-restore-preview" type="button">取消</button></div></div>`:'';
 return `<div class="settings-row" id="firebase-restore-entry"><div><strong>從 Firebase 還原</strong><p>查詢這個 Google 帳號的成功版本；不必先開啟本機自動備份。</p></div><button class="secondary" id="refresh-restore-versions" ${canQuery&&!versionsLoading?'':'disabled'}>${esc(retryLabel)}</button></div>
<p class="restore-status ${esc(status)}" id="restore-list-status" data-state="${esc(status)}">${esc(copy)}</p>
${listHTML}${previewHTML}<div id="restore-preview"></div>`;
}
function exportFallbackHTML(){
 if(!exportFallback)return '';
 if(!exportFallback.expanded)return `<p class="quiet" id="export-fallback-prompt">沒看到檔案？<button class="text-button" id="show-export-fallback" type="button">顯示內容／複製內容</button></p>`;
 return `<div class="notice export-fallback" id="export-fallback"><strong>顯示內容／複製內容</strong><p>檔案「${esc(exportFallback.filename)}」已準備好。若沒有出現分享或下載，請複製後自行存檔。</p><p class="quiet">${esc(INERT_DOWNLOAD_HINT)}</p><textarea id="export-fallback-text" readonly rows="8">${esc(exportFallback.content)}</textarea><div class="banner-actions"><button class="secondary" id="copy-export-content" type="button">複製內容</button><button class="text-button" id="dismiss-export-fallback" type="button">關閉</button></div></div>`;
}
function settingPage(){
 const s=statusView();
 const persistenceNote=authInfo.persistence?.ok===false?`<div class="notice warn">${esc(persistenceUnavailableMessage())}</div>`:'';
 const authErrorNote=authInfo.loadError&&authInfo.available?`<div class="notice warn">${esc(authInfo.loadError.message||'Google 登入未完成')}</div>`:'';
 const accountLine=authUser?`${esc(authUser.displayName||authUser.email||authUser.uid)}`:'尚未登入';
 return `${persistenceNote}${authErrorNote}<section class="card"><h2>小跑者</h2><form id="child-form"><label>顯示名稱<input id="child-name" value="${esc(active()?.name||'')}" maxlength="30" required></label><button class="secondary" type="submit">儲存名稱</button></form><p class="quiet">第一版使用一位小孩，資料已保留 childId 供未來擴充。</p></section>
<section class="card" id="cloud-backup"><h2>Google 帳號與雲端版本</h2>${backupLine()}<p class="muted">帳號：${accountLine}</p><p class="quiet">以 Firebase 使用者 ID 區隔資料，不用名字或 email 當所有權。換機請登入同一 Google 帳號後選擇版本還原；這是選版取代，不是合併。</p>
<div class="settings-row"><div><strong>使用 Google 帳號啟用備份</strong><p>登入一次，之後自動備份（無痕、清資料、換瀏覽器除外）</p></div><button class="secondary" id="enable-backup" ${authUser&&accountState?.backupEnabled?'disabled':''}>${authUser&&accountState?.backupEnabled?'已啟用':'啟用備份'}</button></div>
<div class="settings-row"><div><strong>立即備份</strong><p>略過等待，把目前本機快照上傳</p></div><button class="secondary" id="backup-now" ${authUser&&accountState?.backupEnabled?'':'disabled'}>立即備份</button></div>
<div class="settings-row"><div><strong>暫停自動備份</strong><p>仍會追蹤變更，恢復後補傳最新快照</p></div><label class="checkbox"><input id="pause-backup" type="checkbox" ${accountState?.backupPaused?'checked':''} ${authUser&&accountState?.backupEnabled?'':'disabled'}>暫停</label></div>
<div class="settings-row"><div><strong>登出</strong><p>畫面會離開這個帳號的資料；未完成的備份佇列會保留到下次回來</p></div><button class="secondary" id="sign-out" ${authUser?'':'disabled'}>登出</button></div>
${restorePanelHTML()}
<p class="quiet">狀態：${esc(s.text)}。成功才會顯示「已備份」；連線恢復只會檢查佇列，不會直接宣告成功。</p></section>
<section class="card"><h2>本機 JSON／CSV</h2><div class="notice">資料仍以這台裝置的 IndexedDB 為日常來源。清除網站資料或更換手機前，建議再匯出一份 JSON。</div>${exportFallbackHTML()}<div class="settings-row"><div><strong>JSON 完整備份</strong><p>保留目前帳號的紀錄、小孩與必要偏好</p></div><button class="secondary" id="export-json">匯出 JSON</button></div><div class="settings-row"><div><strong>CSV 成績表</strong><p>供 Excel、Google Sheets 或分析使用</p></div><button class="secondary" id="export-csv">匯出 CSV</button></div><div class="settings-row"><div><strong>還原 JSON 備份</strong><p>先檢查內容，再確認取代目前帳號的本機資料</p></div><label class="secondary file-label">選擇檔案<input id="import-json" type="file" accept=".json,application/json"></label></div><div id="backup-preview"></div><p class="quiet">目前這個帳號共 ${scopedRecords().length} 筆紀錄。${settings.find(s=>s.id==='lastBackup')?`上次匯出：${esc(new Date(settings.find(s=>s.id==='lastBackup').value).toLocaleString('zh-TW'))}`:'尚未匯出備份。'}</p></section>
<section class="card"><h2>關於小步快跑</h2><p class="muted">快速記錄、文字解析與分析都在你的裝置完成。雲端備份是選用的版本保險，不是即時雙向同步。</p><p class="quiet">首次開啟需要網路；載入完成後會準備離線快取。Firebase SDK 若暫時失敗，本機仍可記錄。新增時保留原始秒數，畫面顯示四捨五入至小數點後兩位。</p></section>`;}
function capture(){for(const k of ['date','distance','seconds','note','startType','surface','timingMethod'])if($('#'+k))draft[k]=$('#'+k).value;}
function changePage(p){if(page==='home')capture();page=p;history.replaceState(null,'','#'+p);if(p==='settings'){if(authUser&&!['ready','empty','inconsistent','offline','permission','reauth','error'].includes(versionsQuery.status))versionsQuery={...versionsQuery,status:'loading'};render();loadVersions().finally(render);}else render();window.scrollTo(0,0);}
async function refresh(){[records,children,settings]=await Promise.all([all('records'),all('children'),all('settings')]);appMeta=await ensureAppMeta();accountState=await getAccount(ownerId());}
async function ensureChild(){if(active())return;await write([{store:'children',value:{id:defaultChildId(ownerId()),name:'小孩',birthday:null,ownerUid:ownerId()}}]);await refresh();}
async function safe(fn){if(busy)return;busy=true;try{await fn();}catch(e){toast(`未完成：${e.message}。資料未成功儲存時請勿關閉頁面。`);}finally{busy=false;}}
function makeRecord(r,index=0){const time=new Date(Date.now()+index).toISOString();return {...r,id:crypto.randomUUID(),childId:active().id,ownerUid:ownerId(),createdAt:time,updatedAt:time};}
async function writeLocal(changes){await write(changes.map(c=>c.value&&(c.store==='records'||c.store==='children')?{...c,value:{...c.value,ownerUid:ownerId()}}:c),{bumpRevision:true,ownerUid:ownerId()});if(backupService&&authUser&&accountState?.backupEnabled)backupService.noteLocalChange(ownerId());}
async function saveRecords(incoming){const candidate=[...records];for(const r of incoming){validate(r);const notes=warnings(r,candidate);if(notes.length&&!confirm(notes.join('\n')+'\n\n確認保留原數值並繼續？'))return false;candidate.push(r);}await writeLocal(incoming.map(value=>({store:'records',value})));await refresh();return true;}
async function setSetting(id,value){if(id==='reverse'){await writeLocal([{store:'settings',value:{id:`reverse:${ownerId()}`,value,ownerUid:ownerId()}}]);settings=await all('settings');return;}await write([{store:'settings',value:{id,value}}]);settings=await all('settings');}
function clearRestoreList(){versions=[];versionsQuery={status:authUser?'loading':'signed-out',versions:[],error:null};versionsUid=authUser?.uid||null;selectedRestore=null;}
async function loadVersions(){
 const uid=authUser?.uid||null;
 if(uid!==versionsUid){
  versions=[];
  selectedRestore=null;
  versionsQuery={status:uid?'loading':'signed-out',versions:[],error:null};
  versionsUid=uid;
 }
 if(!uid){versionsQuery={status:'signed-out',versions:[],error:null};versions=[];return;}
 if(!cloud){versionsQuery={status:'unavailable',versions:[],error:null};return;}
 versionsLoading=true;
 versionsQuery={status:'loading',versions,error:null};
 const statusEl=$('#restore-list-status');
 if(statusEl){statusEl.textContent=restoreListCopy('loading',versions);statusEl.dataset.state='loading';statusEl.className='restore-status loading';}
 const btn=$('#refresh-restore-versions');
 if(btn){btn.disabled=true;btn.textContent='查詢中…';}
 try{
  const result=await queryRestorableVersions(cloud,uid,{online,previous:versions,lastSuccess:accountState?.lastSuccess});
  if(authUser?.uid!==uid)return;
  versionsQuery=result;
  versions=result.versions||[];
  versionsUid=uid;
 }finally{versionsLoading=false;}
}
async function exportCurrentFile(filename,content,mimeType,{remember=false}={}){
 const result=await exportFile({filename,content,mimeType});
 if(result.method==='share-canceled')return result;
 const outcome=exportOutcomeMessage(result);
 if(outcome.showFallback||result.method==='content-fallback')exportFallback={filename:result.filename,content:result.content,expanded:result.method==='content-fallback'};
 if(remember)await setSetting('lastBackup',new Date().toISOString());
 if(page==='settings')render();
 if(outcome.toast)toast(outcome.toast);
 return result;
}
async function handleEnable(){
 if(!authInfo.configured){toast('尚未設定 Firebase Web 設定，無法登入。本機仍可記錄。');return;}
 if(authInfo.configured&&!authInfo.available){toast(authInfo.loadError?.message||'雲端元件暫時無法使用，本機仍可記錄。');return;}
 if(authInfo.persistence?.ok===false){toast(persistenceUnavailableMessage());return;}
 try{
  markEnableIntent();
  const result=await authService.signInWithGoogle();
  if(result?.pending){toast('正在導向 Google 登入…');return;}
  if(!result?.user){toast('Google 登入未完成，尚未啟用備份。請再試一次。');return;}
  await finishEnable();
 }catch(error){toast(`登入未完成：${error.message||error}`);}
}
function intentStores(){
 const stores=[];
 try{if(globalThis.localStorage)stores.push(localStorage);}catch{/* ignore */}
 try{if(globalThis.sessionStorage)stores.push(sessionStorage);}catch{/* ignore */}
 return stores;
}
function markEnableIntent(){for(const store of intentStores())writeEnableIntent(store);}
function hasEnableIntent(){return intentStores().some(store=>readEnableIntent(store));}
function clearEnableIntents(){for(const store of intentStores())clearEnableIntent(store);}
let enableInFlight=null;
async function finishEnable(){
 if(enableInFlight)return enableInFlight;
 enableInFlight=(async()=>{
  const snap=authService.snapshot();
  authUser=snap.user;authInfo=snap;
  if(!authUser){
   if(hasEnableIntent())toast('Google 登入未完成，尚未啟用備份。請再試一次，並允許彈出視窗。');
   return;
  }
  if(authService.getFirebase()?.firestore&&cloud===null){
   const mods=authService.getModules();
   cloud=createFirestoreCloud({firestore:authService.getFirebase().firestore,fs:mods.firestore});
  }
  const result=await backupService.enableForUser(authUser);
  clearEnableIntents();
  await refresh();await ensureChild();
  if(result.action==='offer-restore'||result.action==='diverged')restoreOffer={action:result.action,versions:result.versions||[]};
  else restoreOffer=null;
  await loadVersions();
  render();
  if(result.action==='error')toast(`帳號已登入，但備份尚未完成：${result.error?.message||result.classified?.kind||'請稍後再試'}`);
  else if(result.action==='wait-first')toast('已啟用，等待第一筆');
  else if(result.action==='already-synced')toast('雲端版本與本機相同，沿用既有備份');
  else if(result.action==='upload-first')toast('已啟用，正在上傳第一個版本');
  else if(result.action==='offer-restore')toast('已登入，雲端已有備份，可選擇還原');
  else if(result.action==='diverged')toast('本機已保留為這台裝置的獨立版本，可選擇還原雲端其他版本');
  else toast('已用 Google 帳號啟用備份');
 })();
 try{await enableInFlight;}
 finally{enableInFlight=null;}
}
async function maybeFinishEnableFromAuth(user){
 if(!user||enableInFlight)return;
 const acc=await getAccount(user.uid);
 if(!shouldCompleteBackupEnable({
  user,
  backupEnabled:Boolean(acc.backupEnabled),
  enableIntent:hasEnableIntent()
 }))return;
 await finishEnable();
}
async function handleSignOut(){
 const pending=accountState?.pendingBackup||(await all('backupQueue')).some(item=>item.uid===ownerId()&&item.status!=='complete');
 if(pending&&!confirm('還有未完成的雲端備份。登出後這個帳號的資料會從畫面移除，佇列會留在本機等你回來續傳。確定登出？'))return;
 backupService?.cancelUploads();
 await authService.signOut();
 clearEnableIntents();
 authUser=null;restoreOffer=null;lastSuccessKey='';
 clearRestoreList();
 await refresh();await ensureChild();render();
 toast('已登出。本機快速記錄仍可繼續使用。');
}
async function handleRestore(version){
 if(!version||!authUser)return;
 const preview=restorePreview(version,scopedRecords().length);
 if(!confirm(`${preview.title}\n來源裝置：${preview.deviceLabel}\n備份時間：${preview.completedLabel}\n雲端 ${preview.recordCount??0} 筆紀錄，將取代本機 ${preview.localRecordCount} 筆\n${preview.replaceScope}\n\n確定取代？`))return;
 const pending=accountState?.pendingBackup||(await all('backupQueue')).some(item=>item.uid===authUser.uid&&item.status!=='complete');
 if(pending){
  const flushed=await backupService.flush(authUser.uid);
  if(!flushed.ok&&!flushed.unchanged&&!flushed.waitingFirst){
   if(!confirm('尚有未備份變更且上傳未成功。按確定會先匯出 JSON，再繼續還原。'))return;
   const exported=await exportCurrentFile(`run-data-${today()}.json`,JSON.stringify(jsonExportPayload({children,records,settings},ownerId()),null,2),'application/json',{remember:true});
   if(exported.method==='share-canceled')return;
   if(!confirm('請確認 JSON 已保存。仍要用雲端版本取代本機資料嗎？'))return;
  }
 }
 try{
  await restoreVersion({db:{all,write,getAccount,putAccount,saveRestoreSnapshot},cloud,uid:authUser.uid,version});
 }catch(error){
  await refresh();
  toast(`還原未完成：${error.message||error}。本機資料未被刪除。`);
  return;
 }
 await refresh();await ensureChild();restoreOffer=null;selectedRestore=null;render();
 toast('已用選擇的雲端版本取代本機資料。其他裝置的新版本未被覆寫。');
}
function bindBackupUi(){
 $('#enable-backup')?.addEventListener('click',()=>safe(handleEnable));
 $('#dismiss-backup')?.addEventListener('click',()=>safe(async()=>{appMeta={...appMeta,enablePromptDismissed:true};await write([{store:'meta',value:appMeta}]);render();}));
 $('#backup-now')?.addEventListener('click',()=>safe(async()=>{if(!authUser)return;const result=await backupService.flush(authUser.uid);await refresh();await loadVersions();render();toast(result.ok||result.unchanged||result.waitingFirst?'已送出備份（成功才會顯示已備份）':'備份尚未完成，本機資料仍在');}));
 $('#pause-backup')?.addEventListener('change',e=>safe(async()=>{if(!authUser)return;const acc=await getAccount(authUser.uid);await putAccount({...acc,backupPaused:e.target.checked});if(!e.target.checked)await backupService.flush(authUser.uid,{ignorePause:true});await refresh();await loadVersions();render();}));
 $('#sign-out')?.addEventListener('click',()=>safe(handleSignOut));
 $('#offer-restore')?.addEventListener('click',()=>safe(async()=>{if(!restoreOffer?.versions?.[0])return;selectedRestore=restoreOffer.versions[0];page='settings';history.replaceState(null,'','#settings');render();await loadVersions();render();$('#restore-preview-card')?.scrollIntoView({block:'nearest'});}));
 $('#keep-local')?.addEventListener('click',()=>{restoreOffer=null;render();});
 $('#refresh-restore-versions')?.addEventListener('click',()=>safe(async()=>{await loadVersions();render();}));
 $('#confirm-restore')?.addEventListener('click',()=>safe(async()=>{if(!selectedRestore)return;await handleRestore(selectedRestore);}));
 $('#cancel-restore-preview')?.addEventListener('click',()=>{selectedRestore=null;render();});
 document.querySelectorAll('[data-restore]').forEach(btn=>btn.onclick=()=>{selectedRestore=versions.find(v=>v.backupId===btn.dataset.restore&&v.deviceId===btn.dataset.device)||null;render();$('#restore-preview-card')?.scrollIntoView({block:'nearest'});});
}
function bind(){document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>changePage(b.dataset.page));$('.brand').onclick=e=>{e.preventDefault();changePage('home');};
 if($('#run-form')){$('#run-form').oninput=capture;$('#custom').onclick=()=>{$('#distance').focus();$('#distance').select();};document.querySelectorAll('[data-distance]').forEach(b=>b.onclick=()=>{capture();draft.distance=Number(b.dataset.distance);distance=draft.distance;render();$('#seconds').focus();});$('#cancel-edit')?.addEventListener('click',()=>{editing=null;draft={...draft,date:today(),seconds:'',note:'',startType:'',surface:'',timingMethod:''};render();});$('#run-form').onsubmit=e=>{e.preventDefault();safe(async()=>{capture();const r=validate({...draft,distance:Number(draft.distance),seconds:Number(draft.seconds)});const previousBest=summary(records,r.distance,active().id)?.best;let message;
 if(editing){const old=records.find(x=>x.id===editing);const updated={...old,...r,updatedAt:new Date().toISOString(),ownerUid:ownerId()};const notes=warnings(updated,records);if(notes.length&&!confirm(notes.join('\n')+'\n確認儲存修改？'))return;await writeLocal([{store:'records',value:updated}]);await refresh();message='紀錄已更新';}
 else{if(!await saveRecords([makeRecord(r)]))return;message=previousBest&&r.seconds<previousBest.seconds?`🏆 新個人最佳！${r.distance} 公尺 ${f(r.seconds)} 秒，比原紀錄 ${f(previousBest.seconds)} 秒快 ${f(previousBest.seconds-r.seconds)} 秒`:`已新增 ${r.distance} 公尺 · ${f(r.seconds)} 秒${!previousBest?'，第一筆 PB！':''}`;}
 editing=null;distance=r.distance;draft={...draft,date:today(),distance:r.distance,seconds:'',note:'',startType:'',surface:'',timingMethod:''};await setSetting('distance',r.distance);render();toast(message);$('#seconds').focus();});};$('#parse').onclick=()=>{preview=parseText($('#paste').value);$('#preview').innerHTML=previewHTML();bindPreview();if(!preview.length)toast('請先貼上跑步紀錄');};bindPreview();}
 $('#analysis-distance')?.addEventListener('change',e=>{if(page==='home')capture();distance=Number(e.target.value);render();});$('#record-filter')?.addEventListener('change',e=>{filter=e.target.value;render();});
 const updateAnalysisRange=()=>{const start=$('#analysis-start')?.value||'',end=$('#analysis-end')?.value||'';if(start&&end&&start>end){toast('開始日期不可晚於結束日期');render();return;}analysisStart=start;analysisEnd=end;render();};
 $('#analysis-start')?.addEventListener('change',updateAnalysisRange);$('#analysis-end')?.addEventListener('change',updateAnalysisRange);
 $('#analysis-metric')?.addEventListener('change',e=>{analysisMetric=e.target.value;render();});$('#analysis-day')?.addEventListener('change',e=>{analysisDay=e.target.value||today();render();});
 $('#scan-duplicates')?.addEventListener('click',()=>{duplicateScanOpen=true;render();});$('#close-duplicates')?.addEventListener('click',()=>{duplicateScanOpen=false;render();});
 const selectedDuplicateIds=()=>[...document.querySelectorAll('[data-duplicate-id]:checked')].map(input=>input.dataset.duplicateId);
 const updateDuplicateButton=()=>{const ids=selectedDuplicateIds(),button=$('#delete-duplicates');if(button){button.disabled=!ids.length;button.textContent=`刪除所選 ${ids.length} 筆`;}};
 document.querySelectorAll('[data-duplicate-id]').forEach(input=>input.addEventListener('change',updateDuplicateButton));
 document.querySelectorAll('[data-keep-first]').forEach(button=>button.addEventListener('click',()=>{button.closest('.duplicate-group').querySelectorAll('[data-duplicate-id]').forEach((input,index)=>input.checked=index>0);updateDuplicateButton();}));
 $('#delete-duplicates')?.addEventListener('click',()=>safe(async()=>{const ids=selectedDuplicateIds();if(!ids.length)return;const currentIds=new Set(scopedRecords().map(record=>record.id));if(ids.some(id=>!currentIds.has(id))){duplicateScanOpen=false;render();toast('資料已變動，請重新掃描。');return;}if(!confirm(`刪除所選 ${ids.length} 筆紀錄？\n這會更新統計與雲端備份。`))return;await writeLocal(ids.map(id=>({store:'records',delete:id})));await refresh();duplicateScanOpen=true;render();toast(`已刪除 ${ids.length} 筆重複紀錄。`);}));
 $('#reverse')?.addEventListener('change',e=>safe(async()=>{await setSetting('reverse',e.target.checked);render();}));
 document.querySelectorAll('[data-edit],[data-copy]').forEach(b=>b.onclick=()=>{const r=records.find(x=>x.id===(b.dataset.edit||b.dataset.copy));editing=b.dataset.edit?r.id:null;draft={...r,date:b.dataset.copy?today():r.date};page='home';render();window.scrollTo(0,0);$('#seconds').focus();if(b.dataset.copy)toast('已複製到輸入欄，確認後再新增');});document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>safe(async()=>{const r=records.find(x=>x.id===b.dataset.delete);if(!confirm(`刪除 ${r.date} · ${r.distance} 公尺 ${r.seconds} 秒？\n刪除後本機無法復原，除非已有 JSON 或雲端版本。`))return;await writeLocal([{store:'records',delete:r.id}]);await refresh();render();toast('已刪除這筆紀錄；既有雲端成功版本仍會保留。');}));
 $('#child-form')?.addEventListener('submit',e=>{e.preventDefault();safe(async()=>{const name=$('#child-name').value.trim();if(!name)throw Error('名稱不可空白');await writeLocal([{store:'children',value:{...active(),name,ownerUid:ownerId()}}]);await refresh();render();toast('名稱已更新');});});
 $('#export-json')?.addEventListener('click',()=>safe(async()=>{await exportCurrentFile(`run-data-${today()}.json`,JSON.stringify(jsonExportPayload({children,records,settings},ownerId()),null,2),'application/json',{remember:true});}));
 $('#export-csv')?.addEventListener('click',()=>safe(async()=>{await exportCurrentFile(`run-data-${today()}.csv`,csv(own()),'text/csv;charset=utf-8');}));
 $('#copy-export-content')?.addEventListener('click',()=>safe(async()=>{const text=exportFallback?.content||$('#export-fallback-text')?.value||'';if(!text)return;if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else{const box=$('#export-fallback-text');if(box){box.focus();box.select();document.execCommand('copy');}}toast('已複製內容，請自行貼上存檔');}));
 $('#show-export-fallback')?.addEventListener('click',()=>{if(exportFallback)exportFallback={...exportFallback,expanded:true};render();});
 $('#dismiss-export-fallback')?.addEventListener('click',()=>{exportFallback=null;render();});
 $('#import-json')?.addEventListener('change',e=>safe(async()=>{backup=null;$('#backup-preview').innerHTML='';const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('備份檔請小於 10 MB');backup=validateBackup(JSON.parse(await file.text()));$('#backup-preview').innerHTML=`<div class="notice"><strong>有效備份：${backup.records.length} 筆紀錄、${backup.children.length} 位小孩</strong><p>將取代目前這個帳號的 ${scopedRecords().length} 筆紀錄。建議先匯出目前資料。其他 Google 帳號在本機的資料不受影響。</p><button id="restore" class="primary">確認取代並還原</button></div>`;$('#restore').onclick=()=>safe(async()=>{if(!confirm('確定以備份取代目前帳號的本機紀錄、名字與必要偏好？\n未備份的現有資料將無法復原。'))return;const b=backup;if(!b.children.length)throw Error('備份至少需有一位小孩');const owner=ownerId();const existingChildren=children.filter(c=>sameOwner(c,owner));const existingRecords=records.filter(r=>sameOwner(r,owner));const reverseId=`reverse:${owner}`;const deletes=[...existingRecords.map(r=>({store:'records',delete:r.id})),...existingChildren.map(c=>({store:'children',delete:c.id})),...(settings.find(s=>s.id===reverseId)?[{store:'settings',delete:reverseId}]:[])];const importedReverse=(Array.isArray(b.settings)?b.settings:[]).find(s=>s.id==='reverse'&&typeof s.value==='boolean');const safeSettings=(Array.isArray(b.settings)?b.settings:[]).filter(s=>(s.id==='distance'&&typeof s.value==='number'&&s.value>0&&Number.isFinite(s.value)));await writeLocal([...deletes,...b.records.map(value=>({store:'records',value:{...value,ownerUid:owner}})),...b.children.map(value=>({store:'children',value:{...value,ownerUid:owner}})),...safeSettings.map(value=>({store:'settings',value})),...(importedReverse?[{store:'settings',value:{id:reverseId,value:importedReverse.value,ownerUid:owner}}]:[])]);await refresh();distance=settings.find(s=>s.id==='distance')?.value||30;draft={date:today(),distance,seconds:'',note:'',startType:'',surface:'',timingMethod:''};editing=null;preview=[];backup=null;render();toast('備份已還原，原本機這個帳號的資料已被取代。');});}));
 bindBackupUi();
}
function bindPreview(){if($('#paste')){$('#paste').value=pasteDraft;$('#paste').oninput=e=>{pasteDraft=e.target.value;preview=[];$('#preview').innerHTML='';};}document.querySelectorAll('[data-preview]').forEach(input=>input.oninput=()=>{preview[Number(input.dataset.preview)].record[input.dataset.field]=input.dataset.field==='date'?input.value:Number(input.value);});$('#confirm-import')?.addEventListener('click',()=>safe(async()=>{if(preview.some(x=>x.error)||!preview.length)return;const incoming=preview.map((p,i)=>makeRecord(validate(p.record),i));if(!await saveRecords(incoming))return;preview=[];pasteDraft='';capture();render();toast(`已匯入 ${incoming.length} 筆紀錄`);}));}
function attachNetworkHooks(){
 window.addEventListener('online',()=>{online=true;if(authUser)backupService?.checkQueue(authUser.uid);if(authUser&&(page==='settings')&&['offline','error'].includes(versionsQuery.status))loadVersions().then(render);});
 window.addEventListener('offline',()=>{online=false;render();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&authUser)backupService?.checkQueue(authUser.uid);});
}
try{
 await openDB();
 appMeta=await ensureAppMeta();
 try{tabId=sessionStorage.getItem('kid-running-tab')||crypto.randomUUID();sessionStorage.setItem('kid-running-tab',tabId);}catch{tabId=crypto.randomUUID();}
 const localConfig=await loadLocalFirebaseConfig();
 authService=createAuthService({
  loadModules:()=>loadFirebaseModules(),
  resolveConfig:()=>resolveFirebaseConfig({search:location.search,hostname:location.hostname,localConfig}),
  initFirebase
 });
 authService.subscribe(snap=>{
  const prevUid=authUser?.uid||null;
  const nextUid=snap.user?.uid||null;
  authInfo=snap;authUser=snap.user;
  if(prevUid!==nextUid){
   lastSuccessKey='';
   clearRestoreList();
   if(page==='settings')queueMicrotask(()=>loadVersions().finally(render));
  }
  if(snap.user&&cloud===null&&authService.getFirebase()?.firestore){
   const mods=authService.getModules();
   cloud=createFirestoreCloud({firestore:authService.getFirebase().firestore,fs:mods.firestore});
  }
  if(snap.user&&backupService&&snap.ready&&!snap.resolving)queueMicrotask(()=>maybeFinishEnableFromAuth(snap.user).catch(error=>toast(`登入未完成：${error.message||error}`)));
 });
 backupService=createBackupService({
  db:{all,write,getAccount,putAccount,acquireLock,heartbeatLock,releaseLock,saveRestoreSnapshot},
  getCloud:()=>cloud,
  getUser:()=>authUser,
  getAppMeta:()=>ensureAppMeta(),
  isOnline:()=>navigator.onLine!==false,
  tabId,
  onStatus:extra=>{
   statusExtra=extra;
   accountState&&(accountState={...accountState,...(extra.lastSuccess?{lastSuccess:extra.lastSuccess}:{}),...(extra.lastError?{lastError:extra.lastError}:{})});
   const bar=$('#backup-status');
   if(bar){const s=statusView();bar.textContent=s.text;bar.dataset.state=s.code;bar.className=`backup-status ${s.tone}`;}
   const successKey=extra.lastSuccess?`${extra.lastSuccess.backupId||''}:${extra.lastSuccess.completedAt||''}`:'';
   if(successKey&&successKey!==lastSuccessKey&&extra.uploading===false){
    lastSuccessKey=successKey;
    loadVersions().then(()=>{if(page==='settings')render();});
   }
  }
 });
 await refresh();await ensureChild();
 const bootAuth=await authService.start();
 authInfo=bootAuth;authUser=bootAuth.user;
 if(bootAuth.loadError)toast(bootAuth.available?(bootAuth.loadError.message||'Google 登入未完成'):'雲端元件暫時無法使用，本機仍可記錄。');
 else if(!authUser&&hasEnableIntent())toast('Google 登入未完成，尚未啟用備份。請再試一次，並允許彈出視窗。');
 if(authUser&&authService.getFirebase()?.firestore){
  const mods=authService.getModules();
  cloud=createFirestoreCloud({firestore:authService.getFirebase().firestore,fs:mods.firestore});
 }
 distance=settings.find(s=>s.id==='distance')?.value||30;draft.distance=distance;
 if(authUser){
  await refresh();
  const acc=await getAccount(authUser.uid);
  if(shouldCompleteBackupEnable({
   user:authUser,
   backupEnabled:Boolean(acc.backupEnabled),
   enableIntent:hasEnableIntent()
  }))await finishEnable();
  else if(acc.backupEnabled)await backupService.checkQueue(authUser.uid);
 }
 await refresh();await ensureChild();
 const route=location.hash.slice(1);if(['home','records','analysis','settings'].includes(route))page=route;
 if(page==='settings')await loadVersions();
 render();
 attachNetworkHooks();
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update().catch(()=>{})).catch(()=>toast('離線快取未啟用；請保持網路連線。'));
}catch(e){$('#app').innerHTML=`<main class="card"><h1>無法開啟本機儲存空間</h1><p>${esc(e.message)}</p><p>請允許瀏覽器使用網站儲存空間，或改用一般瀏覽模式後重新整理。尚未寫入任何新紀錄。</p><button onclick="location.reload()">重新整理</button></main>`;}
