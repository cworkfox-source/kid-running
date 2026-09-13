# 驗收表 · Google 帳號綁定 + Firestore 版本備份

重跑日期：2026-09-13。環境：Cloud Agent、Node 22、OpenJDK 21。

## Firebase 盤點（正式專案仍不存在，不等管理者）

Grok Bot 端 Firebase MCP 已登入 `cworkfox@gmail.com`，`firebase_list_projects` **傳回 0 個專案**：無 active project ID、無 Web app、無 SDK config。

此 Cloud Agent 工作階段**沒有** Firebase MCP 工具；依指示**沒有**建專案、**沒有**開付費、**沒有** deploy 正式環境、**沒有**把私鑰寫進 repo。

本分支自測設定（足夠 Emulator，不是正式專案）：

| 項目 | 現況 |
|---|---|
| `.firebaserc` | `default=demo-kid-running`（Emulator demo ID） |
| `firebase.json` | Auth 9099／Firestore 8080 |
| `firebase-config.js` | 空佔位（`apiKey`／`projectId`／`appId` 皆空） |
| 正式 Google 登入 | 未測（無專案／無 provider／無授權網域） |

## `npm test`（2026-09-13 重跑，exit 0）

```
> kid-running@1.1.0 test
> node --test test/*.test.js

ok 1 - A01 使用長期持久而非 session
ok 2 - A03 持久不可用時明確失敗，不改短暫登入
ok 3 - iPhone Safari 使用 redirect
ok 4 - A02 啟動先解析 auth 設定，未設定不誤報雲端成功
ok 5 - B01 本機有雲端無會上傳第一個完整版本
ok 6 - B02 兩邊空白時等待第一筆，不建空成功版
ok 7 - B03 debounce 5 秒，持續改動重設，最長等待後仍會備份
ok 8 - B04 內容未變不重複建立成功版
ok 9 - B05 佇列持久化且重試沿用同一 backupId
ok 10 - B06 上傳 N 時產生 N+1，N 成功只推進到 N
ok 11 - B07 權限錯誤不密集無限重試
ok 12 - B08 暫停仍追蹤，恢復後補傳最新快照
ok 13 - B09 離線或 online 事件本身不宣告成功
ok 14 - C01 分塊上傳後核對摘要才能 complete
ok 15 - C02 還原前快照且單一交易取代
ok 16 - C03 還原舊版不覆寫其他裝置新版
ok 17 - C04 帳號隔離：A 的資料不會進 B 的快照或佇列
ok 18 - C05 登出取消排程但保留未完成佇列
ok 19 - S02 每裝置只保留最近 30 個成功版本
ok 20 - 刪光成績會建空內容新版，且與首次空白區分
ok 21 - 啟用時本機空雲端有則要求還原，不覆蓋
ok 22 - U01 SDK 失敗時狀態不顯示已備份，本機資料仍在
…既有 core 解析／CSV／JSON 驗證 23–55 通過…
ok 56 - emulator 環境可用 # SKIP
ok 57 - S01 規則與 Emulator 備份還原 # SKIP

# tests 57
# pass 55
# fail 0
# skipped 2
# duration_ms 318.461655
EXIT:0
```

`npm test` 不啟動 Emulator，故 S01 在此指令下 SKIP；S01 以 `npm run test:emulator` 為準。

## `npm run test:emulator`（2026-09-13 重跑，exit 0）

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
| A01 | Google 登入使用本機持久（非僅分頁 session） | 通過 | `npm test` ok 1 |
| A02 | 啟動先等 auth 狀態再判斷，不誤報雲端成功 | 通過 | `npm test` ok 4 |
| A03 | 持久不可用時明確提示 | 通過 | `npm test` ok 2 |
| B01 | 本機有、雲端無 → 上傳第一個完整版本 | 通過 | `npm test` ok 5 |
| B02 | 兩邊空白 → 等待第一筆，不建空成功版 | 通過 | `npm test` ok 6 |
| B03 | 5 秒 debounce、持續改動重設、最長等待強制 | 通過 | `npm test` ok 7 |
| B04 | 內容未變不重複建成功版 | 通過 | `npm test` ok 8 |
| B05 | 佇列持久化、重試同一 backupId | 通過 | `npm test` ok 9 |
| B06 | 上傳 N 時出現 N+1，N 只推進到 N | 通過 | `npm test` ok 10 |
| B07 | 權限／配額／需重登不密集無限重試 | 通過 | `npm test` ok 11 |
| B08 | 暫停仍追蹤，恢復後補傳最新快照 | 通過 | `npm test` ok 12 |
| B09 | 離線不宣告成功；online 事件不直接成功 | 通過 | `npm test` ok 13 |
| C01 | 分塊＋摘要核對通過才 complete | 通過 | `npm test` ok 14 |
| C02 | 還原前快照、單一交易取代 | 通過 | `npm test` ok 15 |
| C03 | 還原舊版不覆寫其他裝置新版 | 通過 | `npm test` ok 16 |
| C04 | 帳號隔離 A 不可給 B | 通過 | `npm test` ok 17 |
| C05 | 登出取消排程、保留未完成佇列 | 通過 | `npm test` ok 18 |
| S01 | Rules：不同 uid 不可互操作、禁止公開讀寫 | 通過 | `npm run test:emulator` ok 2；見上方 PERMISSION_DENIED log |
| S02 | 每裝置保留最近 30 個成功版本 | 通過 | `npm test` ok 19 |
| U01 | Firebase SDK 失敗／未設定時本機仍可記錄 | 通過 | `npm test` ok 22；Chrome：狀態 `unconfigured`，仍可新增 |
| U02 | iPhone Safari 真機 | 需使用者真機驗收 | 此環境無 iPhone |

## 備份流程是否真能完成？

**可以（Firestore Emulator，不需正式專案）。**

```
EMULATOR_BACKUP_OK {"backupId":"emu-backup-1","status":"complete","recordCount":1,"chunkCount":1,"contentHash":"e9b912f6eb872ee3d89f4ab87711117088a5eb6a1a03ba5d1458b651df0af70c"}
```

本機快照 → `uploading` → chunk → 核對摘要 → `complete` → 還原後紀錄 id 仍為 `emu-1`。

正式 Google 登入端到端：**未測**（帳號下 0 個 Firebase 專案）。

## 管理者缺口（清單，不等待）

要做真實 Google 登入／換機還原，管理者之後需自行：

1. 用 `cworkfox@gmail.com` 建立 Firebase 專案（免費 Spark 即可；**不要**為此開付費）。
2. Authentication → 啟用 Google provider。
3. 授權網域加入 `localhost` 與 `cworkfox-source.github.io`。
4. 建立 Firestore，並自行部署本倉庫 `firestore.rules`（本 PR 不 deploy 正式環境）。
5. 新增 Web app，把 `apiKey`／`authDomain`／`projectId`／`appId` 填入 `firebase-config.js`，或未追蹤的 `firebase-config.local.js`。
6. Redirect 登入：網站來源須在授權網域內；`authDomain` 通常是 `PROJECT_ID.firebaseapp.com`。

**不要**把 service account 私鑰放進倉庫或前端。Web config 不是密鑰；真保護靠 Auth + Rules。
