import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isGoogleClientId,escapeDriveQuery,driveSearchQuery,multipartRelated,findFileByName,sortDriveBackups,driveErrorMessage,driveConfigured,DRIVE_FOLDER_NAME,DRIVE_APP} from '../drive.js';

test('公開用戶端 ID 格式',()=>{
 assert.equal(isGoogleClientId(''),false);
 assert.equal(isGoogleClientId('not-a-client'),false);
 assert.equal(isGoogleClientId('YOUR_CLIENT_ID.apps.googleusercontent.com'),false);
 assert.ok(isGoogleClientId('1234567890-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com'));
 assert.equal(driveConfigured(),false);
});
test('Drive 查詢字串與資料夾名稱',()=>{
 assert.equal(DRIVE_FOLDER_NAME,'小步快跑備份');
 assert.equal(escapeDriveQuery("O'Brien"),"O\\'Brien");
 const q=driveSearchQuery({filename:'run-data-2026-09-13.json',folderId:'abc',backupsOnly:true});
 assert.ok(q.includes("name='run-data-2026-09-13.json'"));
 assert.ok(q.includes("'abc' in parents"));
 assert.ok(q.includes("appProperties has { key='kind' and value='backup' }"));
 assert.ok(q.includes('trashed=false'));
 const folder=driveSearchQuery({foldersOnly:true,filename:DRIVE_FOLDER_NAME});
 assert.ok(folder.includes("mimeType='application/vnd.google-apps.folder'"));
 assert.ok(folder.includes(`value='${DRIVE_APP}'`));
 assert.ok(folder.includes(`name='${DRIVE_FOLDER_NAME}'`));
});
test('multipart/related 上傳本體',()=>{
 const {body,contentType}=multipartRelated({name:'run-data-2026-09-13.json',mimeType:'application/json'},'{"version":1}','application/json');
 assert.equal(contentType,'multipart/related; boundary=kid_running_boundary');
 assert.ok(body.includes('{"name":"run-data-2026-09-13.json","mimeType":"application/json"}'));
 assert.ok(body.includes('{"version":1}'));
 assert.ok(body.startsWith('--kid_running_boundary\r\n'));
 assert.ok(body.endsWith('--kid_running_boundary--'));
});
test('依修改時間排序並找同名檔',()=>{
 const files=[{name:'run-data-2026-09-12.json',modifiedTime:'2026-09-12T10:00:00.000Z'},{name:'run-data-2026-09-13.json',modifiedTime:'2026-09-13T08:00:00.000Z'}];
 assert.equal(sortDriveBackups(files)[0].name,'run-data-2026-09-13.json');
 assert.equal(findFileByName(files,'run-data-2026-09-13.json').modifiedTime,'2026-09-13T08:00:00.000Z');
 assert.equal(findFileByName(files,'missing.json'),null);
});
test('Drive 錯誤訊息對應',()=>{
 assert.equal(driveErrorMessage({error:'popup_closed'}),'已取消 Google 授權');
 assert.equal(driveErrorMessage({type:'popup_failed_to_open'}),'登入視窗被擋住，請允許彈出視窗後再試');
 assert.equal(driveErrorMessage({status:401}),'Google 登入已過期，請再按一次');
 assert.equal(driveErrorMessage({status:404}),'找不到雲端硬碟備份檔');
 assert.equal(driveErrorMessage({status:403,message:'Google Drive API has not been used'}),'無法使用雲端硬碟（請在 Google Cloud 啟用 Drive API，且授權包含檔案存取）');
 assert.equal(driveErrorMessage({message:'Failed to fetch'}),'網路連線失敗，請稍後再試');
 assert.equal(driveErrorMessage({error:'invalid_client'}),'Google 用戶端設定無效，請檢查 README 的授權 JavaScript 來源');
 assert.equal(driveErrorMessage({message:'自訂錯誤'}),'自訂錯誤');
});
