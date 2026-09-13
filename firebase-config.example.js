/**
 * 複製為未追蹤的 firebase-config.local.js，或直接填入 firebase-config.js。
 * 不要把 service account 私鑰放進這個檔案或倉庫。
 *
 * 管理者需完成：
 * 1. 建立 Firebase 專案（免費 Spark 即可，不要為此專案開付費）
 * 2. Authentication → Sign-in method 啟用 Google
 * 3. 授權網域加入 localhost 與 cworkfox-source.github.io
 * 4. 建立 Firestore 資料庫，並部署本倉庫的 firestore.rules（本 PR 不會代你部署正式環境）
 * 5. 專案設定 → 新增 Web 應用程式，把 firebaseConfig 填到 firebase-config.js
 * 6. authDomain 通常是 PROJECT_ID.firebaseapp.com；若用 redirect 登入，authorized domains 必須含實際網站來源
 */
export const firebaseWebConfig={
 apiKey:'YOUR_API_KEY',
 authDomain:'YOUR_PROJECT_ID.firebaseapp.com',
 projectId:'YOUR_PROJECT_ID',
 storageBucket:'YOUR_PROJECT_ID.appspot.com',
 messagingSenderId:'YOUR_SENDER_ID',
 appId:'YOUR_APP_ID'
};
