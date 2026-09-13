# 小步快跑 · 兒童跑步成績追蹤

手機優先、純前端、零執行期套件。資料保存在目前瀏覽器的 IndexedDB，不傳送到伺服器。

## 啟動

需要 Node.js 20 以上：

```sh
npm start
```

開啟 `http://localhost:3000`。不能直接雙擊 HTML，ES Modules、IndexedDB 與離線快取需由網站來源載入。

```sh
npm test
```

## 功能

- 首頁：今天日期、距離快捷鍵、記住上次距離、秒數快速輸入、備註與可選測試條件。
- 本機文字解析：公尺／米／m、秒／s、7秒42、全形字元、日期省略年份、多行預覽與修改；確認後才原子性寫入。
- 紀錄：日期排序、距離篩選、編輯、複製到表單、確認刪除、同距離前次比較、目前 PB（並列皆標示）。
- 分析：相同小孩／距離比較、首筆到最新改善率、SVG 日期軸趨勢、可反轉 Y 軸、可展開原始數據表。
- 設定：小孩名稱、JSON 全量備份與確認取代還原、Google Drive 備份（上傳相同 JSON、可從 Drive 選擇還原）、CSV 匯出（BOM 與公式注入防護）。
- 異常值及疑似重複值需確認，絕不自動修正。
- 基本 Service Worker 離線快取。未加入 PWA 安裝、帳號、同步、AI API 或多小孩切換。

## 資料與比較規則

平均速度 = 距離 / 原始秒數；時速 = 原始速度 × 3.6，最後才四捨五入。改善率 = (前次秒數 − 目前秒數) / 前次秒數 × 100。

前次是同小孩、同距離的測試日期前一筆；同一天依 createdAt、id 排序。補登、編輯與刪除後全部重新計算。首頁的最近指測試日期最新，不是最後輸入那筆。不同測試條件目前只標示，不額外分組，分析頁提醒在相近條件比較。

解析無日期使用裝置本地今天，無年份使用當年；來源文字存入備註。每行一筆，無單位秒數僅在距離移除後剩唯一數值時接受。多組數值或錯誤日期會拒絕，需修改原文再辨識。匯入存在錯誤列時不允許部分偷偷入庫。

資料模型包含 Child、RunRecord（childId、原始距離與秒數、條件、備註、建立／修改時間）；不保存計算衍生值。JSON 格式為 `{ version: 1, exportedAt, children, records, settings }`；本機匯出與 Google Drive 上傳使用同一份內容。还原先驗證日期、數值、唯一 ID、childId 關聯與條件，再於同一交易取代，失敗會回滾。若備份有多名小孩會完整保留，但本版僅顯示 child_01 或第一名。

## 靜態部署

公開網站：https://cworkfox-source.github.io/kid-running/

GitHub Actions 會把 `index.html`、`styles.css`、`app.js`、`core.js`、`db.js`、`drive.js`、`google-config.js`、`sw.js` 發到 GitHub Pages（無建置步驟）。資產路徑皆為相對路徑，可在專案子目錄下運作。`server.js` 僅供本機測試，不會上線。

首次啟用請到倉庫 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。若第一次 workflow 在開啟 Pages 前失敗，改完設定後到 **Actions** 重新執行 **Deploy static content to Pages**。

每次更新前端須同步提高 `sw.js` 的 CACHE 版本；新快取下載完成且舊分頁關閉後生效。不提供安裝 UI。離線功能需首次成功載入、Service Worker 完成安裝後才能使用；行動裝置經區網 HTTP 不支援 Service Worker，請用 HTTPS 測試。

## 注意

資料僅存在目前來源、瀏覽器與裝置，清除網站資料可能永久遺失。固定使用同一網址並定期匯出 JSON 或備份到你自己的 Google Drive，換網址或換手機前先備份。Google Drive 備份使用 `drive.file` 範圍，只能存取本應用建立的檔案，不會瀏覽你的其他雲端硬碟內容；授權只在你按下雲端硬碟按鈕時出現。CSV 是分析用途，不支援作為完整還原來源。首次使用是空白資料，不插入示範成績。無年齡百分位或健康推論。

## Google Drive 備份（選用）

網站本身沒有後端，備份直接從瀏覽器上傳到**使用者自己的** Google Drive。公開的 OAuth「網頁應用程式」用戶端 ID 可放在 `google-config.js`，**不要**提交用戶端密鑰（client secret）。

### 1. 建立 Google Cloud 專案並啟用 API

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/) 並建立專案（或選既有專案）。
2. **API 和服務 → 程式庫** 啟用 **Google Drive API**。未啟用時，上傳會失敗。

### 2. OAuth 同意畫面

1. **API 和服務 → OAuth 同意畫面**。使用者類型選「外部」即可（個人 Gmail 也能測）。
2. 填應用程式名稱與開發者聯絡信箱。
3. 範圍請加入非敏感範圍 `https://www.googleapis.com/auth/drive.file`（建立與管理此應用開啟／建立的檔案）。不要申請完整 `drive` 範圍。
4. 發布狀態若為「測試中」，把你自己的 Google 帳號加到測試使用者，否則同意畫面會被拒。

### 3. 建立「網頁應用程式」OAuth 用戶端

1. **API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID**，應用程式類型選 **網頁應用程式**。
2. **已授權的 JavaScript 來源**（GIS token 流程必要；來源不含路徑）：
   - 公開網站：`https://cworkfox-source.github.io`
   - 本機：`http://localhost:3000`（若用 127.0.0.1 再開 `http://127.0.0.1:3000`）
3. **已授權的重新導向 URI**（GIS 彈出視窗／token 流程建議一併加上，與來源相同、不含 `/kid-running/`）：
   - `https://cworkfox-source.github.io`
   - `http://localhost:3000`
4. 建立後只複製 **用戶端 ID**（形如 `123-abc.apps.googleusercontent.com`）。用戶端密鑰留給有後端的應用，此專案用不到，也不可放進前端。

### 4. 把用戶端 ID 放進專案

編輯 `google-config.js`：

```js
export const GOOGLE_CLIENT_ID='你的用戶端ID.apps.googleusercontent.com';
```

留空則設定頁仍顯示雲端硬碟按鈕，但會提示尚未設定。此檔會隨 GitHub Pages 一併部署。改完後記得提高 `sw.js` 的 CACHE 版本，否則舊快取可能仍用空的 ID。

### 5. 使用方式

- **設定 → 備份與資料 → 備份到雲端硬碟**：登入 Google 並同意後，把與「匯出 JSON」相同的 `{ version: 1, exportedAt, children, records, settings }` 上傳到雲端硬碟資料夾「小步快跑備份」。檔名為 `run-data-YYYY-MM-DD.json`；同一天再備份會覆寫當日檔案。
- **從雲端硬碟選擇**：列出本應用上傳的備份，選一份先檢查再確認取代。也可在 Drive 下載該 JSON，再用既有的「選擇檔案」還原。
- 第一次請允許瀏覽器彈出視窗；授權不會在第一次開啟網站時出現。

本機驗證：`npm start` 後開啟 `http://localhost:3000`，確認 OAuth 來源已含 localhost，再到設定頁走一次連線 → 備份 → 在 Drive 看到檔案 → 本機 JSON 還原仍可用。

## 驗證狀態

核心自動測試含備份格式、Drive 查詢／錯誤對應等純邏輯（`npm test`），JavaScript 語法及 Git whitespace 檢查通過。

`scripts/browser-check.mjs` 包含手機新增／編輯／刪除／複製、預覽不入庫、PB、重新載入、JSON 還原、無效檔案、320–1280px 溢出、離線重開及新增的瀏覽器測試。本次執行環境未安裝 Chromium，下載逾時，故這些端對端案例尚未完成實測，亦尚未完成 iPhone Safari 視覺驗收。

有 Playwright 與 Chromium 的開發環境可先啟動網站，再執行 `node scripts/browser-check.mjs`；若 Playwright 非本機相依套件，可用 `PLAYWRIGHT_MODULE` 指定其完整模組路徑。
