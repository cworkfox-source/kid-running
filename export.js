export const EXPORT_SHARE_TITLE='小步快跑備份';
export const INERT_DOWNLOAD_HINT='此瀏覽器可能無法直接存檔。可用「顯示內容／複製內容」，或用系統分享存到「檔案」。Safari 與 App 內建瀏覽器的本機資料可能不是同一份，請勿只改用 Safari 或清除網站資料來尋找紀錄。';

export function createExportFile(filename,content,mimeType,FileImpl=globalThis.File){
 if(typeof FileImpl==='function')return new FileImpl([content],filename,{type:mimeType,lastModified:Date.now()});
 return {name:filename,type:mimeType,content};
}

export function canShareFiles(nav,file){
 if(!nav||typeof nav.canShare!=='function'||typeof nav.share!=='function'||!file)return false;
 try{return nav.canShare({files:[file]})===true;}catch{return false;}
}

export function isShareCanceled(error){
 const name=String(error?.name||'');
 if(name==='AbortError')return true;
 const text=`${name} ${error?.message||error||''}`.toLowerCase();
 return /aborterror/.test(text)||(/share/.test(text)&&/cancel|cancell/.test(text)&&!/notallowed/.test(text));
}

export function downloadAttributeSupported(doc=globalThis.document){
 if(!doc?.createElement)return false;
 try{return 'download' in doc.createElement('a');}catch{return false;}
}

export function triggerDownload({filename,content,mimeType,document:doc=globalThis.document,URL:urlApi=globalThis.URL}){
 if(!doc?.createElement||!urlApi?.createObjectURL)return {invoked:false,supported:false,inert:true};
 const blob=typeof Blob==='function'?new Blob([content],{type:mimeType}):null;
 if(!blob)return {invoked:false,supported:false,inert:true};
 const url=urlApi.createObjectURL(blob);
 const a=doc.createElement('a');
 const supported='download' in a;
 a.href=url;
 a.download=filename;
 a.rel='noopener';
 a.target='_blank';
 a.style.display='none';
 (doc.body||doc.documentElement)?.appendChild?.(a);
 a.click();
 const cleanup=()=>{
  try{a.remove?.();}catch{/* ignore */}
  try{urlApi.revokeObjectURL(url);}catch{/* ignore */}
 };
 if(typeof globalThis.setTimeout==='function'){
  const timer=globalThis.setTimeout(cleanup,30000);
  timer?.unref?.();
 }else cleanup();
 return {invoked:true,supported,inert:!supported};
}

export async function exportFile({
 filename,
 content,
 mimeType,
 navigator:nav=globalThis.navigator,
 download=triggerDownload,
 FileImpl=globalThis.File
}={}){
 if(!filename||content==null)throw Error('匯出內容不完整');
 const file=createExportFile(filename,content,mimeType,FileImpl);
 if(canShareFiles(nav,file)){
  try{
   await nav.share({files:[file],title:filename,text:EXPORT_SHARE_TITLE});
   return {ok:true,method:'share',file,filename,content};
  }catch(error){
   if(isShareCanceled(error))return {ok:true,method:'share-canceled',file,filename,content};
  }
 }
 const downloaded=await download({filename,content,mimeType});
 if(!downloaded?.invoked||downloaded.inert||downloaded.supported===false){
  return {ok:true,method:'content-fallback',file,filename,content,reason:'inert-download',offerFallback:true};
 }
 return {ok:true,method:'download',file,filename,content,offerFallback:true};
}

export function exportOutcomeMessage(result){
 if(!result||result.method==='share-canceled')return {toast:null,showFallback:false};
 if(result.method==='share')return {toast:'已開啟分享，請選擇「存到檔案」或傳送',showFallback:false};
 if(result.method==='download')return {toast:'已送出下載，請確認檔案',showFallback:true};
 if(result.method==='content-fallback')return {toast:'無法直接存檔，請複製內容或用分享存到檔案',showFallback:true};
 return {toast:null,showFallback:Boolean(result?.offerFallback)};
}
