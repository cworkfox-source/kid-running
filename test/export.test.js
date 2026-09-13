import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 canShareFiles,createExportFile,exportFile,exportOutcomeMessage,isShareCanceled,triggerDownload
} from '../export.js';
import {jsonExportPayload,validateBackup,csv} from '../core.js';
import {sampleChild,sampleRecord} from './support.js';

class FakeFile{
 constructor(parts,name,opts={}){
  this.parts=parts;
  this.name=name;
  this.type=opts.type||'';
 }
}

test('canShare 必須探測 files，不是用 iPhone UA 判斷',()=>{
 const iphone={userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'};
 const file=createExportFile('a.json','{}','application/json',FakeFile);
 assert.equal(canShareFiles(iphone,file),false);
 let probed=null;
 const shareNav={
  userAgent:iphone.userAgent,
  canShare(data){probed=data;return Array.isArray(data.files)&&data.files[0]===file;},
  share:async()=>{}
 };
 assert.equal(canShareFiles(shareNav,file),true);
 assert.ok(Array.isArray(probed.files));
 assert.equal(canShareFiles({canShare:()=>true},file),false);
});

test('canShare files 成功則走分享且不下載',async()=>{
 const shares=[];
 const result=await exportFile({
  filename:'run-data.json',
  content:'{"version":1}',
  mimeType:'application/json',
  FileImpl:FakeFile,
  navigator:{
   canShare:data=>Array.isArray(data.files),
   share:async data=>{shares.push(data);}
  },
  download:()=>{throw new Error('不應下載');}
 });
 assert.equal(result.method,'share');
 assert.equal(shares[0].files[0].name,'run-data.json');
 assert.equal(exportOutcomeMessage(result).toast.includes('分享'),true);
});

test('使用者取消分享是乾淨結束，不當失敗、不改走下載',async()=>{
 let downloaded=false;
 const result=await exportFile({
  filename:'run-data.json',
  content:'{}',
  mimeType:'application/json',
  FileImpl:FakeFile,
  navigator:{
   canShare:()=>true,
   share:async()=>{throw Object.assign(Error('AbortError'),{name:'AbortError'});}
  },
  download:()=>{downloaded=true;return {invoked:true,supported:true};}
 });
 assert.equal(result.method,'share-canceled');
 assert.equal(downloaded,false);
 const outcome=exportOutcomeMessage(result);
 assert.equal(outcome.toast,null);
 assert.equal(outcome.showFallback,false);
});

test('Share canceled 文字也視為取消',()=>{
 assert.equal(isShareCanceled({name:'Error',message:'Share canceled'}),true);
 assert.equal(isShareCanceled({name:'NotAllowedError',message:'Permission denied'}),false);
});

test('沒有 canShare files 時即使 UA 是 iPhone 也走下載',async()=>{
 const result=await exportFile({
  filename:'run-data.json',
  content:'{}',
  mimeType:'application/json',
  FileImpl:FakeFile,
  navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'},
  download:()=>({invoked:true,supported:true,inert:false})
 });
 assert.equal(result.method,'download');
 assert.equal(exportOutcomeMessage(result).toast,'已送出下載，請確認檔案');
});

test('分享非取消錯誤會改走下載',async()=>{
 const result=await exportFile({
  filename:'a.csv',
  content:'a,b',
  mimeType:'text/csv',
  FileImpl:FakeFile,
  navigator:{
   canShare:()=>true,
   share:async()=>{throw Object.assign(Error('not from user gesture'),{name:'NotAllowedError'});}
  },
  download:()=>({invoked:true,supported:true})
 });
 assert.equal(result.method,'download');
});

test('下載屬性不支援或 click 無效時改顯示內容',async()=>{
 const inert=await exportFile({
  filename:'a.json',
  content:'{"ok":true}',
  mimeType:'application/json',
  FileImpl:FakeFile,
  navigator:{},
  download:()=>({invoked:true,supported:false,inert:true})
 });
 assert.equal(inert.method,'content-fallback');
 assert.equal(exportOutcomeMessage(inert).showFallback,true);
 const missing=await exportFile({
  filename:'a.json',
  content:'{}',
  mimeType:'application/json',
  FileImpl:FakeFile,
  navigator:{},
  download:()=>({invoked:false,supported:false,inert:true})
 });
 assert.equal(missing.method,'content-fallback');
});

test('triggerDownload 會設定 download 檔名並 click',()=>{
 const clicks=[];
 const created=[];
 const doc={
  body:{appendChild(node){created.push(node);return node;}},
  createElement(name){
   const node={name,style:{},click(){clicks.push(this);},remove(){}};
   return node;
  }
 };
 const urls=[];
 const urlApi={
  createObjectURL(blob){urls.push(blob);return 'blob:test';},
  revokeObjectURL(){}
 };
 const result=triggerDownload({filename:'x.json',content:'{}',mimeType:'application/json',document:doc,URL:urlApi});
 assert.equal(result.invoked,true);
 assert.equal(clicks[0].download,'x.json');
 assert.equal(clicks[0].href,'blob:test');
});

test('匯出 JSON 可再匯入且筆數相符',()=>{
 const uid='user-a';
 const records=[sampleRecord(uid,{id:'r1'}),sampleRecord(uid,{id:'r2',seconds:8.1})];
 const children=[sampleChild(uid)];
 const payload=jsonExportPayload({children,records,settings:[{id:'distance',value:30}]},uid);
 const parsed=validateBackup(JSON.parse(JSON.stringify(payload)));
 assert.equal(parsed.records.length,2);
 assert.equal(parsed.children.length,1);
 assert.equal(csv(parsed.records).includes('7.42'),true);
});

test('app.js 用共用匯出模組，且成功文案不是已存檔',async()=>{
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
 assert.match(app,/from '\.\/export\.js'/);
 assert.match(app,/exportFile\(/);
 assert.match(app,/已送出下載，請確認檔案|exportOutcomeMessage/);
 assert.doesNotMatch(app,/已產生 JSON 備份，請確認檔案已下載保存/);
 assert.match(app,/INERT_DOWNLOAD_HINT/);
 assert.doesNotMatch(app,/請改用 Safari 並清除網站資料/);
});
