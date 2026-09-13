# 驗收表 · Google 帳號綁定 + Firestore 版本備份

更新日期：2026-09-13。環境：Cloud Agent、Node 22、OpenJDK 21。

## Firebase 盤點

公開 Web config 已寫入 `firebase-config.js`（僅可公開欄位）。**沒有**加入 client secret／service account，**沒有** deploy 規則或 Hosting，**沒有** merge main，**沒有**升 Blaze。

| 項目 | 狀態 |
|---|---|
| 專案 | `kid-running` 已存在 |
| `.firebaserc` | `default=kid-running`；別名 `emulator=demo-kid-running` 供 Emulator 測試 |
| `firebase.json` | Auth 9099／Firestore 8080 |
| `firebase-config.js` | 已填公開 Web config（`projectId: kid-running`） |
| Google provider | 已啟用 |
| 授權網域 | 已含 `localhost`、`cworkfox-source.github.io` |
| Firestore | `(default)`，`asia-east1` |
| 正式 `firestore.rules` | **尚未部署**（依紅線） |
| 正式 Google 登入端到端 | 此環境未完成 OAuth popup／真機；設定已就緒，U02 仍需使用者驗收 |

## `npm test`（填入 Web config 後重跑，exit 0）

```
> kid-running@1.1.0 test
> node --test test/*.test.js

ok 4 - A02 啟動先解析 auth 設定，已設定仍不誤報雲端成功
…A01–C05、S02、U01 與 core 測試通過…
ok 56 - emulator 環境可用 # SKIP
ok 57 - S01 規則與 Emulator 備份還原 # SKIP

# tests 57
# pass 55
# fail 0
# skipped 2
# duration_ms 315.786948
```

`npm test` 不啟動 Emulator，故 S01 在此指令下 SKIP；S01 以 `npm run test:emulator` 為準。A02 現在斷言 `projectId === 'kid-running'`；空 config 覆寫時仍為未設定且不顯示「已備份」。

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
| A01 | Google 登入使用本機持久（非僅分頁 session） | 通過 | `npm test` ok 1 |
| A02 | 啟動先等 auth 狀態再判斷，不誤報雲端成功 | 通過 | `npm test` ok 4：已設定 `kid-running`；未登入狀態為「尚未啟用」，不含「已備份」 |
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
| U01 | Firebase SDK 失敗／未設定時本機仍可記錄 | 通過 | `npm test` ok 22；未登入時狀態不是「已備份」 |
| U02 | iPhone Safari 真機 | 需使用者真機驗收 | 此環境無 iPhone |

## 備份流程是否真能完成？

**可以（Firestore Emulator，不需正式專案）。**

```
EMULATOR_BACKUP_OK {"backupId":"emu-backup-1","status":"complete","recordCount":1,"chunkCount":1,"contentHash":"e9b912f6eb872ee3d89f4ab87711117088a5eb6a1a03ba5d1458b651df0af70c"}
```

本機快照 → `uploading` → chunk → 核對摘要 → `complete` → 還原後紀錄 id 仍為 `emu-1`。

正式 Google 登入端到端：**此 Cloud Agent 未跑 OAuth popup**（設定已就緒：專案／Google provider／授權網域）。對正式 Firestore 寫入在 **rules 尚未部署** 前不可當成已上線。

## 剩餘缺口（依紅線不在此 PR 處理）

- **自行部署** 本倉庫 `firestore.rules` 到正式 Firestore（本 PR 禁止 deploy 規則／Hosting）。
- 不要升 Blaze、不要 merge 此 PR（除非管理者明確要求）。
- U02 iPhone Safari 真機登入持久與 redirect。
- 真機／本機瀏覽器對 `http://localhost:3000` 或 GitHub Pages 做一次 Google 登入＋備份（rules 部署後）。

**不要**把 service account 私鑰放進倉庫或前端。Web config 不是密鑰；真保護靠 Auth + Rules。
