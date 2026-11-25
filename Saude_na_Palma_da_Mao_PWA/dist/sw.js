const CACHE='saude-palma-shell-v2.1.1';
const ASSETS=['./','./index.html','./css/style.css','./js/app.js','./js/data.js','./js/store.js','./js/demo-store.js','./js/views.js','./manifest.json','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('saude-palma-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put('./index.html',response.clone());}return response;}).catch(()=>caches.match('./index.html')));
  return;
 }
 // Only the declared application shell is cached; no personal data is sent to this worker.
 const scope=new URL('./',self.location).pathname;
 const known=ASSETS.some(asset=>new URL(asset,self.location).pathname===url.pathname);
 if(url.pathname.startsWith(scope)&&known)event.respondWith(caches.match(request).then(hit=>hit||fetch(request)));
});
