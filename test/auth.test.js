import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferRedirect,applyAuthPersistence,persistenceUnavailableMessage} from '../auth.js';
import {resolveFirebaseConfig,shouldUseEmulator,FIREBASE_SDK_VERSION} from '../firebase.js';
import {describeBackupStatus} from '../backup.js';

test('A01 使用長期持久而非 session',async()=>{
 const calls=[];
 const authMod={
  indexedDBLocalPersistence:{name:'idb'},
  browserLocalPersistence:{name:'local'},
  browserSessionPersistence:{name:'session'},
  async setPersistence(auth,value){calls.push(value.name);if(value.name==='idb')return;}
 };
 const result=await applyAuthPersistence(authMod,{});
 assert.equal(result.ok,true);
 assert.equal(result.longLived,true);
 assert.equal(result.type,'indexedDB');
 assert.deepEqual(calls,['idb']);
 assert.ok(!calls.includes('session'));
});

test('A03 持久不可用時明確失敗，不改短暫登入',async()=>{
 const authMod={
  indexedDBLocalPersistence:{name:'idb'},
  browserLocalPersistence:{name:'local'},
  browserSessionPersistence:{name:'session'},
  async setPersistence(){throw Error('blocked');}
 };
 const result=await applyAuthPersistence(authMod,{});
 assert.equal(result.ok,false);
 assert.equal(result.longLived,false);
 assert.match(result.message||persistenceUnavailableMessage(),/無法長期記住登入/);
});

test('iPhone Safari 使用 redirect',()=>{
 assert.equal(preferRedirect('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'),true);
 assert.equal(preferRedirect('Mozilla/5.0 Chrome/120.0.0.0'),false);
});

test('A02 啟動先解析 auth 設定，未設定不誤報雲端成功',()=>{
 const unresolved=resolveFirebaseConfig({search:'',hostname:'localhost'});
 assert.equal(unresolved.configured,false);
 assert.equal(shouldUseEmulator('?emulator=1','localhost'),true);
 const status=describeBackupStatus({configured:false,sdkFailed:false,resolving:false,user:null,enabled:false,recordCount:0});
 assert.equal(status.code,'unconfigured');
 assert.ok(!status.text.includes('已備份'));
 const checking=describeBackupStatus({configured:true,resolving:true,user:null,enabled:false,recordCount:0});
 assert.equal(checking.code,'checking');
 assert.equal(FIREBASE_SDK_VERSION,'11.1.0');
});
