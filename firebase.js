import {firebaseWebConfig,firebaseEmulator,isFirebaseConfigured} from './firebase-config.js';

export const FIREBASE_SDK_VERSION='11.1.0';
export const FIREBASE_CDN=`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

const DEMO_CONFIG={
 apiKey:'demo',
 authDomain:'localhost',
 projectId:'demo-kid-running',
 storageBucket:'demo-kid-running.appspot.com',
 messagingSenderId:'0',
 appId:'1:0:web:demo'
};

export function shouldUseEmulator(search=globalThis.location?.search||'',hostname=globalThis.location?.hostname||''){
 const params=new URLSearchParams(search);
 if(params.get('emulator')==='1'||params.get('emulator')==='true')return true;
 try{return localStorage.getItem('kid-running-emulator')==='1';}catch{return hostname==='localhost'&&params.has('emulator');}
}

export async function loadLocalFirebaseConfig(){
 try{
  const local=await import('./firebase-config.local.js');
  return local.firebaseWebConfig||local.default||null;
 }catch{
  return null;
 }
}

export function resolveFirebaseConfig({search,hostname,localConfig,envConfig}={}){
 const emulator=shouldUseEmulator(search,hostname);
 const filled=localConfig||envConfig||(isFirebaseConfigured(firebaseWebConfig)?firebaseWebConfig:null);
 if(emulator)return {config:filled&&filled.projectId?{...DEMO_CONFIG,...filled,projectId:filled.projectId}:DEMO_CONFIG,emulator:true,configured:true};
 if(filled&&isFirebaseConfigured(filled))return {config:filled,emulator:false,configured:true};
 return {config:null,emulator:false,configured:false};
}

export async function loadFirebaseModules(cdn=FIREBASE_CDN,loader=url=>import(url)){
 const app=await loader(`${cdn}/firebase-app.js`);
 const auth=await loader(`${cdn}/firebase-auth.js`);
 const firestore=await loader(`${cdn}/firebase-firestore.js`);
 return {app,auth,firestore};
}

export async function initFirebase({modules,config,emulator=false,emulatorHost=firebaseEmulator.host,authPort=firebaseEmulator.authPort,firestorePort=firebaseEmulator.firestorePort}){
 const {initializeApp,getApps}=modules.app;
 const app=getApps?.().length?getApps()[0]:initializeApp(config);
 const auth=modules.auth.getAuth(app);
 const firestore=modules.firestore.getFirestore(app);
 if(emulator){
  try{modules.auth.connectAuthEmulator(auth,`http://${emulatorHost}:${authPort}`,{disableWarnings:true});}catch(error){if(!/already/i.test(String(error.message||error)))throw error;}
  try{modules.firestore.connectFirestoreEmulator(firestore,emulatorHost,firestorePort);}catch(error){if(!/already/i.test(String(error.message||error)))throw error;}
 }
 return {app,auth,firestore};
}
