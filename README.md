# 小步快跑 · 兒童跑步成績追蹤

手機優先、純前端。日常資料保存在目前瀏覽器的 IndexedDB；可選使用 Google 帳號把完整快照備份到 Firestore（版本備份，不是即時雙向同步）。

## 啟動

需要 Node.js 20 以上：

```sh
npm start
```

開啟 `http://localhost:3000`。不能直接雙擊 HTML，ES Modules、IndexedDB 與離線快取需由網站來源載入。

```sh
npm test
```

本機連 Firestore Emulator（規則與備份流程自測，不 deploy 正式環境）：

```sh
npm install --no-save firebase@11.1.0 @firebase/rules-unit-testing@4.0.1
# 另開終端
npm start
# 瀏覽器開啟 http://localhost:3000/?emulator=1
npm run test:emulator
```

`npm run test:emulator` 使用 `.firebaserc` 的 `emulator` 別名 `demo-kid-running`，不必登入正式專案。

## 功能

- 首頁：今天日期、距離快捷鍵、記住上次距離、秒數快速輸入、備註與可選測試條件。
- 本機文字解析：公尺／米／m、秒／s、7秒42、全形字元、日期省略年份、多行預覽與修改；確認後才原子性寫入。
- 紀錄：日期排序、距離篩選、編輯、複製到表單、確認刪除、同距離前次比較、目前 PB（並列皆標示），以及手動掃描「日期＋距離＋秒數」完全相同的疑似重複資料後逐筆選擇刪除。
- 分析：相同小孩／距離比較、首筆到最新改善率、日期區間篩選、SVG 日期軸趨勢、可反轉秒數 Y 軸、單日按距離統計；速度模式採同日各次 m/s 的平均值顯示。
- 設定：小孩名稱、Google 帳號雲端版本備份、JSON 全量備份與確認取代還原、CSV 匯出（BOM 與公式注入防護）。
- 異常值及疑似重複值需確認，絕不自動修正。
- 基本 Service Worker 離線快取。未加入 PWA 安裝、AI API、跨裝置即時雙向同步、家庭共編或多小孩切換。

## Google 帳號與雲端版本備份

- 本機 IndexedDB 仍是日常操作來源：先寫入本機成功，再排程雲端備份；雲端慢不會讓新增失敗。
- 點「使用 Google 帳號啟用備份」後，同一網站來源、同一瀏覽器在正常情況下會用 Firebase Auth 本機持久保存，不必每次重登。文案「登入一次，之後自動備份」在清除網站資料、無痕、換機／換瀏覽器、或撤銷 Google 授權時不適用。
- 若瀏覽器無法長期記住登入，會明確提示，不會改成短暫 session 還宣稱長期保存。
- 所有權以 Firebase `uid` 為準，不用顯示名稱或 email。
- 變更（成績增刪改、複製後確認新增、批次匯入、JSON 還原、小孩名稱、需跨機的顯示偏好）以遞增 revision + 穩定序列化 SHA-256 判斷，不靠筆數。速度／PB／進步率等衍生值不備份。
- 本機交易成功後約 5 秒 debounce，持續改動會重設，最長約 30 秒強制嘗試；「立即備份」略過等待。內容沒變不會再建立成功版本。
- 待備份佇列寫在 IndexedDB，斷線或重開後補傳；非致命上傳失敗會依退避在 `nextRetryAt` 自動再試，不必只靠重開或切回前景。成功只在伺服器確認 `complete` 且塊數／摘要核對通過後才顯示「已備份」。`online` 事件只會檢查佇列。
- 雲端路徑：`users/{uid}/devices/{deviceId}/backups/{backupId}`，內容分塊（≤256 KiB）在 `chunks` 子集合。每裝置保留最近 30 個**成功**版本；完成的版本不可改。
- 換機：登入同一帳號 → 選成功版本（標來源裝置）→ 預覽後確認取代本機該帳號資料。這是選版取代，不是合併，也不會覆寫其他裝置既有雲端版本。
- 可暫停自動備份：仍追蹤變更，恢復後補傳最新快照。
- 不含：Google Drive、匿名驗證、跨裝置即時同步、自動合併、家庭共編、排程背景執行、給一般使用者的 Firebase 管理介面。

### Firebase 專案現況（不把密鑰放進倉庫、不 deploy Hosting、不升 Blaze）

Web config 可以公開，不是密鑰；真正保護靠 Auth + `firestore.rules`。請**不要**把 service account 私鑰或 OAuth client secret 放進倉庫或前端。`firebase-config.js` 已填入專案 `kid-running` 的公開 Web 設定。

| 項目 | 狀態 |
|---|---|
| 專案 | `kid-running`（`.firebaserc` default） |
| Google provider | 已啟用 |
| 授權網域 | `localhost`、`cworkfox-source.github.io` |
| Firestore | `(default)`，區域 `asia-east1` |
| 正式 `firestore.rules` | **已部署**到 `kid-running`（ruleset `2bad0407-6adf-4732-be9f-c94b6b0029ad`；Rules test 4/4 SUCCESS；未登入 REST 寫入 → 403 `PERMISSION_DENIED`）。GitHub Actions **不會**自動部署規則；此次為手動／MCP 部署 |
| Auth domain | `kid-running.firebaseapp.com` |

本機 Emulator：`http://localhost:3000/?emulator=1`。規則測試用別名 `demo-kid-running`（見 `.firebaserc` 的 `emulator`）。Google 登入一律先 `signInWithPopup`（含 iPhone／Safari）；僅在 popup 被擋或不支援時才 fallback `signInWithRedirect`。

Firebase JS SDK 釘死 **11.1.0**，由 CDN 載入。CDN 暫時失敗時本機頁面仍可記錄，只是雲端備份不可用。

## 資料與比較規則

平均速度 = 距離 / 原始秒數；時速 = 原始速度 × 3.6，最後才四捨五入。改善率 = (前次秒數 − 目前秒數) / 前次秒數 × 100。速度趨勢將所選日期內同一距離的每次 m/s 做每日平均，不用平均秒數反推。

前次是同小孩、同距離的測試日期前一筆；同一天依 createdAt、id 排序。補登、編輯與刪除後全部重新計算。首頁的最近指測試日期最新，不是最後輸入那筆。不同測試條件目前只標示，不額外分組，分析頁提醒在相近條件比較。

解析無日期使用裝置本地今天，無年份使用當年；來源文字存入備註。每行一筆，無單位秒數僅在距離移除後剩唯一數值時接受。多組數值或錯誤日期會拒絕，需修改原文再辨識。匯入存在錯誤列時不允許部分偷偷入庫。

資料模型包含 Child、RunRecord（childId、原始距離與秒數、條件、備註、建立／修改時間、ownerUid）；不保存計算衍生值。JSON 格式仍為 `{ version: 1, exportedAt, children, records, settings }`；還原先驗證日期、數值、唯一 ID、childId 關聯與條件，再於同一交易取代目前帳號資料，失敗會回滾。IndexedDB 升到 v2 只新增多餘 store 與 `ownerUid`，**不會清空舊紀錄**。

## 靜態部署

公開網站：https://cworkfox-source.github.io/kid-running/

GitHub Actions 會把靜態檔（含 auth/backup/restore/firebase/cloud 模組）發到 GitHub Pages（無建置步驟）。資產路徑皆為相對路徑，可在專案子目錄下運作。`server.js` 僅供本機測試，不會上線。這個 workflow **不會**部署 Firebase 正式環境。

首次啟用請到倉庫 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。若第一次 workflow 在開啟 Pages 前失敗，改完設定後到 **Actions** 重新執行 **Deploy static content to Pages**。

每次更新前端須同步提高 `sw.js` 的 CACHE 版本（目前 `kid-running-v7`）。新 SW 安裝時會 `skipWaiting()`，啟用時刪除舊的 `kid-running-*` 快取並 `clients.claim()`；導覽／HTML 與 `app.js` 採 network-first（離線才回退快取），一般重新整理即可拿到新頁面，不必手動清除網站資料。不提供安裝 UI。離線功能需首次成功載入、Service Worker 完成安裝後才能使用；行動裝置經區網 HTTP 不支援 Service Worker，請用 HTTPS 測試。

## 注意

資料主要存在目前來源、瀏覽器與裝置。啟用雲端備份後，成功版本可在同一 Google 帳號下換機還原；未備份的本機變更仍可能遺失。固定使用同一網址並定期匯出 JSON。CSV 是分析用途，不支援作為完整還原來源。首次使用是空白資料，不插入示範成績。無年齡百分位或健康推論。

## 驗證狀態

見 `test/ACCEPTANCE.md`。`npm test` 含核心解析／備份狀態機／帳號隔離。Firestore Emulator 規則與實際上傳／還原見 `npm run test:emulator`。正式 `firestore.rules` 已部署到 `kid-running`（見上方 ruleset 證據）；GitHub Actions 仍不會自動部署規則。

`scripts/browser-check.mjs` 包含手機新增／編輯／刪除／複製、預覽不入庫、PB、重新載入、JSON 還原、無效檔案、320–1280px 溢出、離線重開及新增的瀏覽器測試。iPhone Safari 真機登入持久請見驗收表 U02。
