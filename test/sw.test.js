import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sw=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const pages=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');

test('CACHE 至少為 kid-running-v4',()=>{
 const match=sw.match(/CACHE\s*=\s*'kid-running-v(\d+)'/);
 assert.ok(match,'sw.js 必須宣告 CACHE');
 assert.ok(Number(match[1])>=4,`CACHE 應 ≥ v4，實際 v${match[1]}`);
});

test('install 會 skipWaiting，activate 會清舊快取並 claim',()=>{
 assert.match(sw,/skipWaiting\s*\(/);
 assert.match(sw,/clients\.claim\s*\(/);
 assert.match(sw,/startsWith\(\s*['"]kid-running-['"]\s*\)/);
});

test('HTML／導覽與 app.js 為 network-first，且只攔 same-origin GET',()=>{
 assert.match(sw,/mode\s*===\s*['"]navigate['"]/);
 assert.match(sw,/text\/html/);
 assert.match(sw,/app\.js/);
 assert.match(sw,/method\s*!==\s*['"]GET['"]|method\s*===\s*['"]GET['"]/);
 assert.match(sw,/origin\s*!==\s*self\.location\.origin|origin\s*===\s*self\.location\.origin/);
 assert.match(sw,/type\s*!==\s*['"]opaque['"]/);
});

test('Pages assemble 仍複製 sw.js；註冊時不走 HTTP 快取 SW 腳本',()=>{
 assert.match(pages,/\bsw\.js\b/);
 assert.match(app,/serviceWorker\.register\(\s*['"]\.\/sw\.js['"]\s*,\s*\{\s*updateViaCache\s*:\s*['"]none['"]/);
});
