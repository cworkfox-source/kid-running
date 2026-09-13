const CACHE='kid-running-v13';
const ASSETS=['./','./index.html','./styles.css','./app.js','./core.js','./db.js','./auth.js','./backup.js','./restore.js','./export.js','./firebase.js','./firebase-config.js','./cloud.js'];

self.addEventListener('install',event=>{
 event.waitUntil(
  caches.open(CACHE)
   .then(cache=>cache.addAll(ASSETS))
   .then(()=>self.skipWaiting())
 );
});

self.addEventListener('activate',event=>{
 event.waitUntil(
  caches.keys()
   .then(keys=>Promise.all(keys.filter(k=>k.startsWith('kid-running-')&&k!==CACHE).map(k=>caches.delete(k))))
   .then(()=>self.clients.claim())
 );
});

function isSameOriginGet(request){
 return request.method==='GET'&&new URL(request.url).origin===self.location.origin;
}

function isNetworkFirst(request){
 if(request.mode==='navigate')return true;
 const accept=request.headers.get('accept')||'';
 if(accept.includes('text/html'))return true;
 const path=new URL(request.url).pathname;
 return path.endsWith('/')||path.endsWith('/index.html')||path.endsWith('.js');
}

function canCache(response){
 return Boolean(response&&response.ok&&response.type!=='opaque'&&response.type!=='opaqueredirect');
}

function putInCache(request,response){
 if(!canCache(response))return;
 const copy=response.clone();
 caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
}

function networkFirst(request){
 return fetch(request).then(response=>{
  putInCache(request,response);
  return response;
 }).catch(async()=>{
  const cached=await caches.match(request);
  if(cached)return cached;
  if(request.mode==='navigate'||(request.headers.get('accept')||'').includes('text/html')){
   return (await caches.match('./index.html'))||(await caches.match('./'));
  }
  return Response.error();
 });
}

function cacheFirst(request){
 return caches.match(request).then(cached=>{
  if(cached)return cached;
  return fetch(request).then(response=>{
   putInCache(request,response);
   return response;
  });
 });
}

self.addEventListener('fetch',event=>{
 if(!isSameOriginGet(event.request))return;
 event.respondWith((isNetworkFirst(event.request)?networkFirst:cacheFirst)(event.request));
});
