import {GOOGLE_CLIENT_ID} from './google-config.js';

export const DRIVE_APP='kid-running';
export const DRIVE_FOLDER_NAME='小步快跑備份';
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
const DRIVE_API='https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD='https://www.googleapis.com/upload/drive/v3';
const GIS_SRC='https://accounts.google.com/gsi/client';

let tokenClient=null,accessToken='',tokenExpiresAt=0,tokenInflight=null,gisPromise=null,cachedFolderId=null;

export function isGoogleClientId(id){return typeof id==='string'&&/^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(id.trim());}
export function driveConfigured(){return isGoogleClientId(GOOGLE_CLIENT_ID);}
export function escapeDriveQuery(value){return String(value).replaceAll('\\','\\\\').replaceAll("'","\\'");}
export function driveSearchQuery({foldersOnly=false,folderId='',filename='',backupsOnly=false}={}){
 const parts=['trashed=false'];
 if(foldersOnly){
  parts.push("mimeType='application/vnd.google-apps.folder'");
  parts.push(`appProperties has { key='app' and value='${DRIVE_APP}' }`);
 }else{
  parts.push("mimeType='application/json'");
  parts.push(backupsOnly?"appProperties has { key='kind' and value='backup' }":`appProperties has { key='app' and value='${DRIVE_APP}' }`);
  if(folderId)parts.push(`'${escapeDriveQuery(folderId)}' in parents`);
 }
 if(filename)parts.push(`name='${escapeDriveQuery(filename)}'`);
 return parts.join(' and ');
}
export function multipartRelated(metadata,content,contentType='application/json'){
 const boundary='kid_running_boundary';
 const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n${content}\r\n--${boundary}--`;
 return {body,contentType:`multipart/related; boundary=${boundary}`};
}
export function findFileByName(files,name){return (files||[]).find(f=>f.name===name)||null;}
export function sortDriveBackups(files){return [...files||[]].sort((a,b)=>(b.modifiedTime||'').localeCompare(a.modifiedTime||'')||(b.name||'').localeCompare(a.name||''));}
export function driveErrorMessage(err){
 if(!err)return 'Google Drive 備份未完成';
 const status=Number(err.status||err.statusCode||err.code||0);
 const text=`${err.reason||err.error||err.type||''} ${err.message||err.error_description||''}`;
 if(/popup_closed|closed by the user|access_denied|cancelled|canceled/i.test(text))return '已取消 Google 授權';
 if(/popup_failed|blocked/i.test(text))return '登入視窗被擋住，請允許彈出視窗後再試';
 if(/immediate_failed|opt_out_or_no_session/i.test(text))return '請再按一次以登入 Google';
 if(status===401||/invalid_token|unauthenticated|401/i.test(text))return 'Google 登入已過期，請再按一次';
 if(status===404||/notFound|404/i.test(text))return '找不到雲端硬碟備份檔';
 if(status===403||/accessNotConfigured|DRIVE_API|insufficientPermissions|403|has not been used/i.test(text))return '無法使用雲端硬碟（請在 Google Cloud 啟用 Drive API，且授權包含檔案存取）';
 if(/Failed to fetch|NetworkError|network/i.test(text))return '網路連線失敗，請稍後再試';
 if(/invalid_client|unauthorized_client|origin|redirect_uri|CLIENT_ID/i.test(text))return 'Google 用戶端設定無效，請檢查 README 的授權 JavaScript 來源';
 const message=String(err.message||'').trim();
 return message&&!/^Error$/i.test(message)?message:'Google Drive 備份未完成';
}

function hasFreshToken(){return Boolean(accessToken)&&Date.now()<tokenExpiresAt;}
function initTokenClient(){
 if(tokenClient)return;
 const oauth=globalThis.google?.accounts?.oauth2;
 if(!oauth)throw Error('無法載入 Google 登入元件，請檢查網路後再試');
 tokenClient=oauth.initTokenClient({client_id:GOOGLE_CLIENT_ID.trim(),scope:DRIVE_SCOPE,callback:()=>{},error_callback:()=>{}});
}
function requestToken(){
 return new Promise((resolve,reject)=>{
  if(!tokenClient){reject(Error('無法載入 Google 登入元件，請檢查網路後再試'));return;}
  const finish=err=>{tokenClient.callback=()=>{};tokenClient.error_callback=()=>{};if(err)reject(err instanceof Error?err:Error(driveErrorMessage(err)));};
  tokenClient.callback=resp=>{if(resp.error)return finish(resp);accessToken=resp.access_token;tokenExpiresAt=Date.now()+Math.max(30,Number(resp.expires_in||3600)-60)*1000;finish();resolve(accessToken);};
  tokenClient.error_callback=err=>finish(err);
  tokenClient.requestAccessToken({prompt:''});
 });
}
export function preloadGis(){
 if(!driveConfigured())return Promise.reject(Error('尚未設定 Google 用戶端 ID，請參考 README。'));
 if(globalThis.google?.accounts?.oauth2){initTokenClient();return Promise.resolve();}
 if(gisPromise)return gisPromise;
 gisPromise=new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src=GIS_SRC;s.async=true;
  s.onload=()=>{try{initTokenClient();resolve();}catch(e){reject(e);}};
  s.onerror=()=>reject(Error('無法載入 Google 登入元件，請檢查網路後再試'));
  document.head.appendChild(s);
 }).catch(e=>{gisPromise=null;throw e;});
 return gisPromise;
}
export function ensureDriveToken(){
 if(!driveConfigured())return Promise.reject(Error('尚未設定 Google 用戶端 ID，請參考 README。'));
 if(hasFreshToken())return Promise.resolve(accessToken);
 if(tokenInflight)return tokenInflight;
 if(globalThis.google?.accounts?.oauth2){
  try{initTokenClient();}catch(e){return Promise.reject(e);}
  tokenInflight=requestToken().finally(()=>{tokenInflight=null;});
  return tokenInflight;
 }
 tokenInflight=preloadGis().then(()=>requestToken()).finally(()=>{tokenInflight=null;});
 return tokenInflight;
}
async function driveJson(url,token,options={}){
 let res;
 try{res=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});}
 catch{throw Error('網路連線失敗，請稍後再試');}
 const text=await res.text();
 let data=null;if(text)try{data=JSON.parse(text);}catch{data=null;}
 if(!res.ok){
  if(res.status===401){accessToken='';tokenExpiresAt=0;}
  throw Error(driveErrorMessage({status:res.status,message:data?.error?.message||text.slice(0,180),reason:data?.error?.errors?.[0]?.reason||data?.error?.status||''}));
 }
 return data;
}
async function ensureBackupFolder(token){
 if(cachedFolderId){
  try{
   const meta=await driveJson(`${DRIVE_API}/files/${encodeURIComponent(cachedFolderId)}?fields=id,trashed`,token);
   if(meta&&!meta.trashed)return cachedFolderId;
  }catch{/* recreate below */}
  cachedFolderId=null;
 }
 const q=driveSearchQuery({foldersOnly:true,filename:DRIVE_FOLDER_NAME});
 const listed=await driveJson(`${DRIVE_API}/files?${new URLSearchParams({q,fields:'files(id,name)',pageSize:'10'})}`,token);
 const folder=(listed.files||[])[0];
 if(folder){cachedFolderId=folder.id;return folder.id;}
 const created=await driveJson(`${DRIVE_API}/files?fields=id,name`,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:DRIVE_FOLDER_NAME,mimeType:'application/vnd.google-apps.folder',appProperties:{app:DRIVE_APP,kind:'backup-folder'}})});
 cachedFolderId=created.id;return created.id;
}
async function createFile(token,folderId,filename,json){
 const {body,contentType}=multipartRelated({name:filename,mimeType:'application/json',parents:[folderId],appProperties:{app:DRIVE_APP,kind:'backup'}},json,'application/json');
 return driveJson(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`,token,{method:'POST',headers:{'Content-Type':contentType},body});
}
async function patchFile(token,fileId,json){
 return driveJson(`${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`,token,{method:'PATCH',headers:{'Content-Type':'application/json'},body:json});
}
export async function uploadBackupToDrive(json,filename,token){
 const access=token||await ensureDriveToken();
 const folderId=await ensureBackupFolder(access);
 const q=driveSearchQuery({folderId,filename,backupsOnly:true});
 const listed=await driveJson(`${DRIVE_API}/files?${new URLSearchParams({q,fields:'files(id,name)',pageSize:'10'})}`,access);
 const existing=findFileByName(listed.files||[],filename);
 return existing?patchFile(access,existing.id,json):createFile(access,folderId,filename,json);
}
export async function listDriveBackups(token){
 const access=token||await ensureDriveToken();
 const q=driveSearchQuery({backupsOnly:true});
 const data=await driveJson(`${DRIVE_API}/files?${new URLSearchParams({q,fields:'files(id,name,modifiedTime,size)',orderBy:'modifiedTime desc',pageSize:'50'})}`,access);
 return sortDriveBackups(data.files||[]);
}
export async function downloadDriveFile(fileId,token){
 const access=token||await ensureDriveToken();
 let res;
 try{res=await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,{headers:{Authorization:`Bearer ${access}`}});}
 catch{throw Error('網路連線失敗，請稍後再試');}
 const text=await res.text();
 if(!res.ok){
  if(res.status===401){accessToken='';tokenExpiresAt=0;}
  let data=null;try{data=JSON.parse(text);}catch{}
  throw Error(driveErrorMessage({status:res.status,message:data?.error?.message||text.slice(0,180),reason:data?.error?.errors?.[0]?.reason||''}));
 }
 if(new TextEncoder().encode(text).length>10*1024*1024)throw Error('備份檔請小於 10 MB');
 return text;
}
