// Optional: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/browser-check.mjs
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const artifactDir=await mkdtemp(join(tmpdir(),'kid-running-check-'));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
let nextDialog='accept';page.on('dialog',dialog=>{const action=nextDialog;nextDialog='accept';return action==='dismiss'?dialog.dismiss():dialog.accept();});
const count=()=>page.evaluate(async()=>{const {all}=await import('./db.js');return (await all('records')).length;});
const nav=async name=>page.locator(`nav [data-page="${name}"]`).click();
try{
 await page.goto('http://localhost:3000');await page.locator('#seconds').waitFor();
 await page.screenshot({path:join(artifactDir,'mobile-empty.png'),fullPage:true});
 assert.equal(await count(),0);
 await page.locator('#paste').fill('9/1 30m 8.12\n9/3 30m 7.95\n9/6 30m 7.72');await page.locator('#parse').click();
 assert.equal(await page.locator('.preview-row').count(),3);assert.equal(await count(),0);
 await page.locator('#confirm-import').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已匯入 3'));assert.equal(await count(),3);
 await page.locator('#date').fill('2026-09-13');await page.locator('#seconds').fill('7.42');await page.locator('.add').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('新個人最佳'));assert.equal(await count(),4);
 assert.ok((await page.locator('.progress-card').innerText()).includes('8.6%'));
 await page.screenshot({path:join(artifactDir,'mobile-home.png'),fullPage:true});
 await page.reload();await page.locator('#seconds').waitFor();assert.equal(await count(),4);assert.equal(await page.locator('#distance').inputValue(),'30');
 await nav('records');assert.equal(await page.locator('.record').count(),4);
 await page.locator('[data-edit]').first().click();await page.locator('#seconds').fill('7.31');await page.locator('.add').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='紀錄已更新');assert.equal(await count(),4);
 await nav('records');await page.locator('[data-copy]').first().click();assert.equal(await count(),4);assert.equal(await page.locator('#seconds').inputValue(),'7.31');await page.locator('.add').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('已新增'));assert.equal(await count(),5);
 await nav('records');await page.locator('[data-delete]').first().click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.startsWith('已刪除'));assert.equal(await count(),4);
 await nav('analysis');assert.equal(await page.locator('svg circle').count(),4);await page.locator('#analysis-start').fill('2026-09-13');await page.locator('#analysis-end').fill('2026-09-13');assert.equal(await page.locator('svg circle').count(),4);assert.equal(await page.locator('#analysis-start').inputValue(),'2026-09-13');assert.equal(await page.locator('#analysis-end').inputValue(),'2026-09-13');await page.locator('#apply-analysis-range').click();assert.equal(await page.locator('svg circle').count(),1);assert.equal(await page.locator('#analysis-start').inputValue(),'2026-09-13');assert.equal(await page.locator('#analysis-end').inputValue(),'2026-09-13');assert.equal(await page.locator('#analysis-metric option').count(),2);await page.locator('#reverse').uncheck();await page.waitForFunction(()=>document.querySelector('svg').getAttribute('aria-label').includes('位置越低'));
 await page.screenshot({path:join(artifactDir,'mobile-analysis.png'),fullPage:true});
 await nav('settings');const dl=page.waitForEvent('download');await page.locator('#export-json').click();const download=await dl;await download.saveAs(join(artifactDir,'test-backup.json'));
 await page.locator('#import-json').setInputFiles(join(artifactDir,'test-backup.json'));await page.locator('#restore').waitFor();assert.equal(await count(),4);await page.locator('#restore').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('備份已還原'));assert.equal(await count(),4);
 await page.locator('#import-json').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":9}')});await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('不是支援'));assert.equal(await count(),4);assert.equal(await page.locator('#restore').count(),0);
 await nav('home');await page.locator('#paste').fill('30m 0s\n30m 7s');await page.locator('#parse').click();assert.ok(await page.locator('#confirm-import').isDisabled());assert.equal(await count(),4);
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});for(const route of ['home','records','analysis','settings']){await nav(route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px ${route} overflow`);}}
 await page.setViewportSize({width:1280,height:1000});await nav('home');await page.screenshot({path:join(artifactDir,'desktop-home.png'),fullPage:true});
 await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();await page.locator('#seconds').waitFor();assert.equal(await count(),4);await page.locator('#seconds').fill('7.2');await page.locator('.add').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('新個人最佳'));assert.equal(await count(),5);
 await context.setOffline(false);await nav('home');await page.locator('#seconds').fill('9.1');await nav('settings');await page.locator('#new-child-name').fill('不要新增');nextDialog='dismiss';await page.getByRole('button',{name:'＋ 新增小孩',exact:true}).click();assert.equal(await page.locator('#active-child option').count(),1);await nav('home');assert.equal(await page.locator('#seconds').inputValue(),'9.1');await page.locator('#seconds').fill('');
 await nav('settings');await page.locator('#new-child-name').fill('小安');await page.getByRole('button',{name:'＋ 新增小孩',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已新增小跑者：小安'));assert.equal(await page.locator('#active-child').inputValue(),'child_01__2');
 await nav('home');await page.locator('#seconds').fill('8.2');await page.locator('.add').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('已新增'));assert.equal(await count(),6);
 await nav('settings');await page.locator('#new-child-name').fill('小樂');await page.getByRole('button',{name:'＋ 新增小孩',exact:true}).click();assert.equal(await page.locator('#active-child').inputValue(),'child_01__3');await nav('records');assert.equal(await page.locator('.record').count(),0);
 await nav('settings');await page.locator('#active-child').selectOption('child_01');await nav('records');assert.equal(await page.locator('.record').count(),5);
 await nav('settings');await page.locator('#active-child').selectOption('child_01__2');assert.match(await page.locator('#export-csv').innerText(),/小安/);await nav('records');assert.equal(await page.locator('.record').count(),1);await page.reload();await page.locator('.record').waitFor();assert.equal(await page.locator('.record').count(),1);
 assert.deepEqual(errors,[]);console.log('PASS: mobile CRUD, preview, PB, persistence, backup restore, invalid import, responsive 320–1280px, offline reload/write, child add/switch/persistence; no browser errors.');
}finally{await browser.close();}
