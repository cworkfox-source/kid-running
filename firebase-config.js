/** 公開 Web 設定（不是密鑰）。真保護靠 Firebase Auth 與 firestore.rules。不要把 client secret 或 service account 私鑰放進這個檔案。 */
export const firebaseWebConfig={
 apiKey:'AIzaSyA4oH_yMLUT5eGZfuAE9tM8n1DhftZY8NY',
 authDomain:'kid-running.firebaseapp.com',
 projectId:'kid-running',
 storageBucket:'kid-running.firebasestorage.app',
 messagingSenderId:'145255751966',
 appId:'1:145255751966:web:3229147605b748678ba90f'
};

export const firebaseEmulator={
 host:'127.0.0.1',
 authPort:9099,
 firestorePort:8080
};

export function isFirebaseConfigured(config=firebaseWebConfig){
 return Boolean(config?.apiKey&&config?.projectId&&config?.appId);
}
