import {test} from 'node:test';
import assert from 'node:assert/strict';

// 極簡 IndexedDB 假物件：只模擬 db.js 用到的 open/transaction/get/getAll/put/delete
function createFakeIndexedDB(){
 const data=new Map();
 const opened=[];
 function makeConnection(){
  const conn={
   closed:false,
   objectStoreNames:{contains:()=>true},
   close(){conn.closed=true;},
   transaction(stores){
    if(conn.closed){const e=new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.");e.name='InvalidStateError';throw e;}
    const tx={oncomplete:null,onerror:null,onabort:null};
    let pending=0;
    const done=()=>{if(--pending===0)queueMicrotask(()=>tx.oncomplete?.());};
    const req=fn=>{pending++;const r={};queueMicrotask(()=>{r.result=fn();r.onsuccess?.({target:r});done();});return r;};
    tx.objectStore=name=>{
     if(!data.has(name))data.set(name,new Map());
     const m=data.get(name);
     return {
      getAll:()=>req(()=>[...m.values()]),
      get:id=>req(()=>m.get(id)),
      put:v=>req(()=>m.set(v.id,v)),
      delete:id=>req(()=>m.delete(id)),
      clear:()=>req(()=>m.clear())
     };
    };
    pending++;setTimeout(done,0);
    return tx;
   }
  };
  return conn;
 }
 return {
  opened,
  open(){
   const r={};
   queueMicrotask(()=>{r.result=makeConnection();opened.push(r.result);r.onsuccess?.();});
   return r;
  }
 };
}

test('IndexedDB 連線被瀏覽器關閉後，下次讀寫會自動重開而不是丟 connection is closing',async()=>{
 const fake=createFakeIndexedDB();
 globalThis.indexedDB=fake;
 const db=await import('../db.js');
 await db.openDB();
 await db.write([{store:'meta',value:{id:'app',deviceId:'d1'}}]);
 assert.equal(fake.opened.length,1);

 // 模擬登入跳轉／背景時瀏覽器關閉連線，但沒有觸發 onclose
 fake.opened[0].close();
 assert.deepEqual(await db.get('meta','app'),{id:'app',deviceId:'d1'});
 assert.equal(fake.opened.length,2);

 // 觸發 onclose 的情況也會重開
 fake.opened[1].close();fake.opened[1].onclose?.();
 await db.write([{store:'records',value:{id:'r1'}}],{bumpRevision:true,ownerUid:'u1'});
 assert.equal(fake.opened.length,3);
 assert.equal((await db.getAccount('u1')).localRevision,1);
 assert.equal(await db.acquireLock('tab',1000,0),true);
 await db.releaseLock('tab');

 // 其他 InvalidStateError 以外的錯誤照常拋出
 fake.opened[2].transaction=()=>{throw new TypeError('bad store');};
 await assert.rejects(db.all('records'),TypeError);
});
