/** 公開 Web 設定（不是密鑰）。真保護靠 Firebase Auth 與 firestore.rules。 */
export const firebaseWebConfig={
 apiKey:'',
 authDomain:'',
 projectId:'',
 storageBucket:'',
 messagingSenderId:'',
 appId:''
};

export const firebaseEmulator={
 host:'127.0.0.1',
 authPort:9099,
 firestorePort:8080
};

export function isFirebaseConfigured(config=firebaseWebConfig){
 return Boolean(config?.apiKey&&config?.projectId&&config?.appId);
}
