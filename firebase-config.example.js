/**
 * 複製為未追蹤的 firebase-config.local.js 可覆寫本機設定。
 * 公開 Web config 已寫在 firebase-config.js（可公開，不是密鑰）。
 * 不要把 service account 私鑰或 OAuth client secret 放進這個檔案或倉庫。
 *
 * 正式環境現況：專案 kid-running、Google provider 已啟用、
 * 授權網域含 localhost 與 cworkfox-source.github.io、
 * Firestore (default) 在 asia-east1。正式 firestore.rules 已部署到 kid-running
 * （手動／MCP，GitHub Actions 不會自動部署規則）。本倉庫不 deploy Firebase Hosting。
 *
 * 本機 Emulator：http://localhost:3000/?emulator=1
 * `.firebaserc` 的 emulator 別名是 demo-kid-running；`npm run test:emulator` 使用該 demo ID，不必登入正式專案。
 */
export const firebaseWebConfig={
 apiKey:'YOUR_API_KEY',
 authDomain:'YOUR_PROJECT_ID.firebaseapp.com',
 projectId:'YOUR_PROJECT_ID',
 storageBucket:'YOUR_PROJECT_ID.appspot.com',
 messagingSenderId:'YOUR_SENDER_ID',
 appId:'YOUR_APP_ID'
};
