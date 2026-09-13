# 驗收表 · Google 帳號綁定 + Firestore 版本備份

測試日期：2026-09-13。環境：Cloud Agent、Node 22、OpenJDK 21。未設定正式 Firebase 專案（`firebase-config.js` 為空佔位），正式 Google 登入與 GitHub Pages 授權網域需管理者補齊。

| 編號 | 項目 | 結果 | 證據／原因 |
|---|---|---|---|
| A01 | Google 登入使用本機持久（非僅分頁 session） | 通過 | `test/auth.test.js`：只嘗試 indexedDB／local persistence，絕不改 session |
| A02 | 啟動先等 auth 狀態再判斷，不誤報雲端成功 | 通過 | 啟動呼叫 `auth.start()` 後才 `checkQueue`／enable；未設定時狀態為「尚未設定」，不含「已備份」 |
| A03 | 持久不可用時明確提示 | 通過 | persistence 失敗回傳長期不可用文案，`ok:false` |
| B01 | 本機有、雲端無 → 上傳第一個完整版本 | 通過 | `B01` 測試：complete、recordCount=1 |
| B02 | 兩邊空白 → 等待第一筆，不建空成功版 | 通過 | `B02`：flush 回 `waitingFirst`，雲端 0 筆 |
| B03 | 5 秒 debounce、持續改動重設、最長等待強制 | 通過 | 縮時測試：改動期間不上傳，超過 maxWait 後有成功版 |
| B04 | 內容未變不重複建成功版 | 通過 | 連續 flush 仍只有 1 個 complete |
| B05 | 佇列持久化、重試同一 backupId | 通過 | 網路失敗後佇列仍在，成功時 backupId 不變 |
| B06 | 上傳 N 時出現 N+1，N 只推進到 N | 通過 | 雲端 n1.recordCount=1、n2.recordCount=2 |
| B07 | 權限／配額／需重登不密集無限重試 | 通過 | `failed-fatal`，狀態「備份權限不足」 |
| B08 | 暫停仍追蹤，恢復後補傳最新快照 | 通過 | 暫停期間 0 上傳；恢復後 2 筆 |
| B09 | 離線不宣告成功；online 事件不直接成功 | 通過 | 離線 `lastSuccess=null`；之後 `checkQueue` 才成功 |
| C01 | 分塊＋摘要核對通過才 complete | 通過 | ≥2 塊，`downloadAndVerify` 通過 |
| C02 | 還原前快照、單一交易取代 | 通過 | 還原後只剩舊版；snapshot 含較新本機筆 |
| C03 | 還原舊版不覆寫其他裝置新版 | 通過 | other-device 仍 complete、recordCount=9 |
| C04 | 帳號隔離 A 不可給 B | 通過 | B 看不到 A 的雲端版本 |
| C05 | 登出取消排程、保留未完成佇列 | 通過 | 佇列仍屬原 uid |
| S01 | Rules：不同 uid 不可互操作、禁止公開讀寫 | 通過 | Firestore Emulator：`assertFails` 拒絕 bob／未登入讀寫 alice 路徑；完成版不可改回 uploading。預期的 PERMISSION_DENIED log 見 emulator 輸出 |
| S02 | 每裝置保留最近 30 個成功版本 | 通過 | keepVersions=3 時只留 3 個 complete |
| U01 | Firebase SDK 失敗時本機仍可記錄 | 通過 | 單元測試 + Chrome headless：無 Web config 時狀態 `unconfigured`「尚未設定雲端備份」，不含「已備份」；仍可新增 1 筆、紀錄／分析／設定（含立即備份／JSON／CSV）可用 |
| U02 | iPhone Safari 真機 | 需使用者真機驗收 | 此環境無 iPhone。程式對 iOS／Safari 走 redirect，並說明無痕／清資料例外 |

## 備份流程是否真能完成？

**可以，Firestore Emulator 已完整跑通。**

```
EMULATOR_BACKUP_OK {"backupId":"emu-backup-1","status":"complete","recordCount":1,"chunkCount":1,"contentHash":"e9b912f6eb872ee3d89f4ab87711117088a5eb6a1a03ba5d1458b651df0af70c"}
```

流程：本機快照 → `uploading` → 上傳 chunk → 核對塊數／摘要 → `complete` → 下載還原後紀錄 id 仍為 `emu-1`。指令：`npm run test:emulator`（firebase-tools 13.29.3 + Firestore Emulator 1.19.8 + 規則測試 SDK 4.0.1 + Firebase JS 11.1.0）。

正式 Google 登入／GitHub Pages 授權網域：未測（倉庫沒有 Web config，依規定不開專案、不部署正式環境）。

## 管理者缺口

- 無 Firebase 專案、無 Web config、未啟用 Google provider、未加入 `localhost` 與 `cworkfox-source.github.io` 授權網域、未自行部署 `firestore.rules`。
- 填好 `firebase-config.js` 或未追蹤的 `firebase-config.local.js` 後，才能在真實 Google 帳號做 popup／redirect 端到端。
