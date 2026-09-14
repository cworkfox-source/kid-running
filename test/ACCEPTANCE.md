# 驗收表 · Google 帳號綁定 + Firestore 版本備份

更新日期：2026-09-14。環境：Cloud Agent、Node 24、OpenJDK 21。

## Firebase 盤點

公開 Web config 已寫入 `firebase-config.js`（僅可公開欄位）。**沒有**加入 client secret／service account，**沒有** deploy Hosting，**沒有**升 Blaze。正式專案目前仍是舊 `firestore.rules`；本次新規則在倉庫內，需手動部署後才生效。GitHub Actions **不會**自動部署規則。

| 項目 | 狀態 |
|---|---|
| 專案 | `kid-running` 已存在 |
| `.firebaserc` | `default=kid-running`；別名 `emulator=demo-kid-running` 供 Emulator 測試 |
| `firebase.json` | Auth 9099／Firestore 8080 |
| `firebase-config.js` | 已填公開 Web config（`projectId: kid-running`） |
| Google provider | 已啟用 |
| 授權網域 | 已含 `localhost`、`cworkfox-source.github.io` |
| Firestore | `(default)`，`asia-east1` |
| 正式 `firestore.rules` | 倉庫已更新，**尚未**部署到正式專案（舊 ruleset `2bad0407-6adf-4732-be9f-c94b6b0029ad` 仍在線上）。GitHub Actions **仍不會**自動部署規則 |
| 正式 Google 登入端到端 | 此環境未完成 OAuth popup／真機；設定已就緒，U02 仍需使用者驗收 |

## `npm test`（本次修正後重跑，exit 0）

```
> kid-running@1.1.0 test
> node --test test/*.test.js

# tests 102
# pass 100
# fail 0
# skipped 2
```

含 A01–C05、S02、U01、日期區間清除、圖表跨日／單日說明、還原→重新整理筆數一致、備份 60 秒冷卻改重試、啟用時 remap `child_01`。`npm test` 不啟動 Emulator，故 S01 在此指令下 SKIP；S01 以 `npm run test:emulator` 為準。A02 斷言 `projectId === 'kid-running'`；空 config 覆寫時仍為未設定且不顯示「已備份」。

## `npm run test:emulator`（填入 Web config 後重跑，exit 0；仍用 demo-kid-running 別名）

```
> npx firebase-tools@13.29.3 emulators:exec --project demo-kid-running --only firestore
  "node --test --test-concurrency=1 test/emulator.test.js"

i  emulators: Detected demo project ID "demo-kid-running"
i  firestore: Firestore Emulator logging to firestore-debug.log
ok 1 - emulator 環境可用

# PERMISSION_DENIED（S01 預期拒絕，不是失敗）：
# Write … Code: 7 PERMISSION_DENIED:
#   false for 'create' @ L12, false for 'create' @ L51,
#   false for 'update' @ L12, false for 'update' @ L51
# Write … Code: 7 PERMISSION_DENIED:
#   evaluation error at L28:28 for 'update' @ L28, false for 'update' @ L51

# EMULATOR_BACKUP_OK {"backupId":"emu-backup-1","status":"complete","recordCount":1,"chunkCount":1,"contentHash":"e9b912f6eb872ee3d89f4ab87711117088a5eb6a1a03ba5d1458b651df0af70c"}
ok 2 - S01 規則與 Emulator 備份還原

# tests 2
# pass 2
# fail 0
# skipped 0
✔  Script exited successfully (code 0)
EXIT:0
```

### S01 結果對照

測試：alice 可建立 `uploading` 備份並改為 `complete`；bob 讀取失敗；未登入讀取／寫入失敗；complete 後不可改回 `uploading`。

| 拒絕 | Rules 行 | 含義 |
|---|---|---|
| `create`/`update` @ L12 與 L51 | `users/{uid}` 僅 `isOwner`；catchall 全拒 | 未登入寫 `users/alice` 被拒（禁止公開讀寫） |
| `update` @ L28 與 L51 | 僅 `status==uploading` 可更新 | 完成版改回 `uploading` 被拒 |

bob 讀 alice 路徑由 `assertFails(get)` 覆蓋（讀取拒絕不會出現在上述 Write log）。

## 驗收編號

| 編號 | 項目 | 結果 | 證據／原因 |
|---|---|---|---|
| A01 | Google 登入使用本機持久（非僅分頁 session） | 通過 | `npm test` |
| A02 | 啟動先等 auth 狀態再判斷，不誤報雲端成功 | 通過 | `npm test`：已設定 `kid-running`；未登入狀態為「尚未啟用」，不含「已備份」 |
| A03 | 持久不可用時明確提示 | 通過 | `npm test` |
| A04 | iPhone／Safari 先 popup；redirect 失敗可見；回來後要啟用備份 | 通過 | `npm test`：popup-first；`getRedirectResult` 錯誤／空結果寫入 `loadError`；redirect user 不被第一次 null auth 清掉；有 user 且尚未 backupEnabled 會走 enableForUser |
| B01 | 本機有、雲端無 → 上傳第一個完整版本 | 通過 | `npm test` |
| B02 | 兩邊空白 → 等待第一筆，不建空成功版 | 通過 | `npm test` |
| B03 | 5 秒 debounce、持續改動重設、最長等待強制 | 通過 | `npm test` |
| B04 | 內容未變不重複建成功版 | 通過 | `npm test` |
| B05 | 佇列持久化、重試同一 backupId | 通過 | `npm test` |
| B06 | 上傳 N 時出現 N+1，N 只推進到 N | 通過 | `npm test` |
| B07 | 權限／配額／需重登不密集無限重試 | 通過 | `npm test` |
| B08 | 暫停仍追蹤，恢復後補傳最新快照 | 通過 | `npm test` |
| B09 | 離線不宣告成功；online 事件不直接成功 | 通過 | `npm test` |
| B10 | 非致命上傳失敗會用 `clock.setTimeout` 在 `nextRetryAt` 再跑 processQueue | 通過 | 預設計時器以 `globalThis` 呼叫；`npm test` 另驗證 Window 綁定與不重入。 |
| C01 | 分塊＋摘要核對通過才 complete | 通過 | `npm test` |
| C02 | 還原前快照、單一交易取代 | 通過 | `npm test` |
| C03 | 還原舊版不覆寫其他裝置新版 | 通過 | `npm test` |
| C04 | 帳號隔離 A 不可給 B | 通過 | `npm test` |
| C05 | 登出取消排程、保留未完成佇列 | 通過 | `npm test` |
| S01 | Rules：不同 uid 不可互操作、禁止公開讀寫 | 通過 | `npm run test:emulator` 已驗證；建立備份須同批寫入 `lastBackupId`；60 秒內第二筆拒絕；`completeCount` 上限 10 且須與 complete／delete 同批。**正式規則仍需部署才生效**。 |
| S02 | 每帳號保留最近 10 個成功版本 | 通過 | `npm test` 客戶端清理；rules `completeCount <= 10` 綁定實際 complete／delete |
| U01 | Firebase SDK 失敗／未設定時本機仍可記錄 | 通過 | `npm test`；未登入時狀態不是「已備份」 |
| U02 | iPhone Safari 真機 | 需使用者真機驗收 | 此環境無 iPhone。單元測試：一律先 popup，被擋才 redirect；`getRedirectResult` 失敗會進 `loadError` |
| P0 | 還原後重新整理紀錄仍可見 | 通過 | 開機先等 auth 再 `ensureChild`；還原前停止既有上傳並清除舊佇列，還原後才重新排程；小孩與成績 ID 碰撞會 remap。 |
| B11 | 60 秒冷卻被拒會重試，不當成權限不足 | 通過 | `npm test` |
| A05 | 分析頁日期區間一鍵清除、跨日平均／單日各筆說明 | 通過 | `npm test` 與畫面 `#clear-analysis-range` |

## 備份流程是否真能完成？

**可以（Firestore Emulator，不需正式專案）。**

```
EMULATOR_BACKUP_OK {"backupId":"emu-backup-1","status":"complete","recordCount":1,"chunkCount":1,"contentHash":"e9b912f6eb872ee3d89f4ab87711117088a5eb6a1a03ba5d1458b651df0af70c"}
```

本機快照 → `uploading` → chunk → 核對摘要 → `complete` → 還原後紀錄 id 仍為 `emu-1`。

正式 Google 登入端到端：**此 Cloud Agent 未跑 OAuth popup**（設定已就緒：專案／Google provider／授權網域／已部署的正式 rules）。

## 剩餘缺口

- GitHub Actions **不會**自動部署 `firestore.rules`。前端推到 `main` 後 Pages 會更新；**伺服器端 10 筆上限與一次時間戳綁一個 backupId，要等正式規則手動部署後才生效。**
- 不要升 Blaze、不要把 service account 私鑰放進倉庫，也不要 deploy Firebase Hosting。
- U02 iPhone Safari 真機：確認 popup-first 登入（GitHub Pages 跨網域 redirect 曾失敗）。
- 真機請**先不要清除網站資料、也不要刪舊備份**。更新後重新整理即可；若仍看不到紀錄，到設定頁從雲端版本還原。
- 此環境未跑 `npm run test:emulator`（無 Firestore Emulator）。S01 以 Emulator 為準。

## 2026-09-14：啟動與多小孩驗收

- 啟動先讀取 IndexedDB 並繪製可見首頁，再於背景初始化 Firebase；尚在解析帳號時，資料寫入與小孩切換會提示稍候，避免誤寫到訪客資料。
- Firebase App、Auth、Firestore 三個 CDN 模組並行載入。已有 Service Worker 快取時，網路等待 1.8 秒後回退快取；首次開啟仍使用網路內容。
- 本機瀏覽器驗收：新增「小安」→ 新增 30m／7.42 秒 → 切換預設「小孩」後紀錄為 0 → 切回「小安」後紀錄為 1 → 重新整理後仍選取「小安」且紀錄為 1。
- 目前選取的小孩以帳號區隔的本機設定保存；JSON 與雲端快照只保存小孩與成績資料，不保存裝置上的選取狀態。

### 修正後追加驗收

- 本機 Chromium 連續 5 次重新整理至紀錄可見：511、125、124、115、120 ms；平均 199 ms、最慢 511 ms，皆低於 1.8 秒快取回退門檻。
- 新增小孩與切換小孩共用草稿保護：取消新增後 9.1 秒草稿仍保留且小孩未新增；確認後才清除草稿並切換。
- 實機新增第三位小孩並建立紀錄，切換另外兩位後各自只顯示所屬紀錄；重新整理仍保留目前小孩與該小孩紀錄。
- 兩個不同來源的失聯 `childId` 各自建立帳號專用小孩；紀錄不合併，重複執行修復不再新增資料。
- 自訂名稱或多位小孩即使尚無成績，也能建立包含全部小孩的成功備份版本；訪客資料登入時也會移轉。只有預設「小孩」且無成績時等待第一筆。
- CSV 入口與檔名包含目前小孩名稱，並移除 Windows 與瀏覽器不允許的檔名字元；內容仍只含目前小孩。
- 日期區間選取時不再於 `change` 事件重繪頁面；開始與結束日期都選好後，按「套用日期區間」才更新圖表。分析頁僅提供秒數與平均速度 m/s，不提供平均時速 km/h。

**不要**把 service account 私鑰放進倉庫或前端。Web config 不是密鑰；真保護靠 Auth + Rules。
