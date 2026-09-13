# 驗收表 · Google 帳號綁定 + Firestore 版本備份

更新日期：2026-09-13。環境：Cloud Agent、Node 22、OpenJDK 21。

## Firebase 盤點

公開 Web config 已寫入 `firebase-config.js`（僅可公開欄位）。**沒有**加入 client secret／service account，**沒有** deploy Hosting，**沒有** merge main，**沒有**升 Blaze。正式 `firestore.rules` **已經部署**到專案 `kid-running`（手動／MCP，不是 GitHub Actions）。

| 項目 | 狀態 |
|---|---|
| 專案 | `kid-running` 已存在 |
| `.firebaserc` | `default=kid-running`；別名 `emulator=demo-kid-running` 供 Emulator 測試 |
| `firebase.json` | Auth 9099／Firestore 8080 |
| `firebase-config.js` | 已填公開 Web config（`projectId: kid-running`） |
| Google provider | 已啟用 |
| 授權網域 | 已含 `localhost`、`cworkfox-source.github.io` |
| Firestore | `(default)`，`asia-east1` |
| 正式 `firestore.rules` | **已部署**（ruleset `2bad0407-6adf-4732-be9f-c94b6b0029ad`；Rules test 4/4 SUCCESS；未登入 REST 寫入 → 403 `PERMISSION_DENIED`）。GitHub Actions **仍不會**自動部署規則 |
| 正式 Google 登入端到端 | 此環境未完成 OAuth popup／真機；設定已就緒，U02 仍需使用者驗收 |

## `npm test`（本次修正後重跑，exit 0）

```
> kid-running@1.1.0 test
> node --test test/*.test.js

# tests 65
# pass 63
# fail 0
# skipped 2
```

含 A01–C05、S02、U01、iPhone popup-first／redirect 失敗可見、非致命備份失敗會排程 `processQueue`。`npm test` 不啟動 Emulator，故 S01 在此指令下 SKIP；S01 以 `npm run test:emulator` 為準。A02 斷言 `projectId === 'kid-running'`；空 config 覆寫時仍為未設定且不顯示「已備份」。

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
| A04 | iPhone／Safari 先 popup；redirect 失敗可見 | 通過 | `npm test`：iPhone UA 仍 popup；`getRedirectResult` 錯誤／空結果寫入 `loadError` |
| B01 | 本機有、雲端無 → 上傳第一個完整版本 | 通過 | `npm test` |
| B02 | 兩邊空白 → 等待第一筆，不建空成功版 | 通過 | `npm test` |
| B03 | 5 秒 debounce、持續改動重設、最長等待強制 | 通過 | `npm test` |
| B04 | 內容未變不重複建成功版 | 通過 | `npm test` |
| B05 | 佇列持久化、重試同一 backupId | 通過 | `npm test` |
| B06 | 上傳 N 時出現 N+1，N 只推進到 N | 通過 | `npm test` |
| B07 | 權限／配額／需重登不密集無限重試 | 通過 | `npm test` |
| B08 | 暫停仍追蹤，恢復後補傳最新快照 | 通過 | `npm test` |
| B09 | 離線不宣告成功；online 事件不直接成功 | 通過 | `npm test` |
| B10 | 非致命上傳失敗會用 `clock.setTimeout` 在 `nextRetryAt` 再跑 processQueue | 通過 | `npm test` fake timers |
| C01 | 分塊＋摘要核對通過才 complete | 通過 | `npm test` |
| C02 | 還原前快照、單一交易取代 | 通過 | `npm test` |
| C03 | 還原舊版不覆寫其他裝置新版 | 通過 | `npm test` |
| C04 | 帳號隔離 A 不可給 B | 通過 | `npm test` |
| C05 | 登出取消排程、保留未完成佇列 | 通過 | `npm test` |
| S01 | Rules：不同 uid 不可互操作、禁止公開讀寫 | 通過 | `npm run test:emulator`；見上方 PERMISSION_DENIED log。正式專案 ruleset `2bad0407-6adf-4732-be9f-c94b6b0029ad` 已部署 |
| S02 | 每裝置保留最近 30 個成功版本 | 通過 | `npm test` |
| U01 | Firebase SDK 失敗／未設定時本機仍可記錄 | 通過 | `npm test`；未登入時狀態不是「已備份」 |
| U02 | iPhone Safari 真機 | 需使用者真機驗收 | 此環境無 iPhone。單元測試：一律先 popup，被擋才 redirect；`getRedirectResult` 失敗會進 `loadError` |

## 備份流程是否真能完成？

**可以（Firestore Emulator，不需正式專案）。**

```
EMULATOR_BACKUP_OK {"backupId":"emu-backup-1","status":"complete","recordCount":1,"chunkCount":1,"contentHash":"e9b912f6eb872ee3d89f4ab87711117088a5eb6a1a03ba5d1458b651df0af70c"}
```

本機快照 → `uploading` → chunk → 核對摘要 → `complete` → 還原後紀錄 id 仍為 `emu-1`。

正式 Google 登入端到端：**此 Cloud Agent 未跑 OAuth popup**（設定已就緒：專案／Google provider／授權網域／已部署的正式 rules）。

## 剩餘缺口

- GitHub Actions **不會**自動部署 `firestore.rules`；目前正式規則是手動／MCP 部署，請勿把 CI 寫成會 deploy 規則。
- 不要升 Blaze、不要把 service account 私鑰放進倉庫，也不要 deploy Firebase Hosting。
- U02 iPhone Safari 真機：確認 popup-first 登入（GitHub Pages 跨網域 redirect 曾失敗）。
- 真機／本機瀏覽器對 `http://localhost:3000` 或 GitHub Pages 做一次 Google 登入＋備份。

**不要**把 service account 私鑰放進倉庫或前端。Web config 不是密鑰；真保護靠 Auth + Rules。
