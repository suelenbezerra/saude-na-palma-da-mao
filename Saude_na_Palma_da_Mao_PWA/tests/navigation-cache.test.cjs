const {test}=require('node:test'),assert=require('node:assert/strict');
function browser(){const storage=new Map();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});}
const user={id:'user-a',name:'Pessoa de Teste',remote:true};
test('Dados carregados navegam sem rede; atualizações duplicadas compartilham uma requisição',async()=>{
 browser();const calls=[];let pending;
 globalThis.fetch=async(path)=>{calls.push(path);if(path==='/api/auth/login')return Response.json({user});if(path==='/api/auth/logout')return Response.json({ok:true});if(path==='/api/state'){if(pending)return new Promise(r=>pending.resolve=r);return Response.json({user,bookings:[]});}throw Error('Pedido inesperado '+path);};
 const repo=await import('../dist/js/store.js?cache-navigation');await repo.login('81988887777','Senha!123');const before=calls.length;
 for(let i=0;i<8;i++){await repo.currentUser();await repo.bookings();await repo.sync();}assert.equal(calls.length,before);
 const realNow=Date.now;Date.now=()=>realNow()+31000;pending={};const a=repo.sync(),b=repo.sync();assert.equal(a,b);assert.equal((await repo.currentUser()).id,user.id);assert.deepEqual(await repo.bookings(),[]);assert.equal(calls.length,before+1);pending.resolve(Response.json({user,bookings:[]}));await a;Date.now=realNow;
});
test('Alterações confirmadas atualizam o cache sem releitura e sem ressuscitar respostas antigas',async()=>{
 browser();let resolveOld;const calls=[],saved={id:'booking-a',userId:user.id,professionalId:'clara',date:'2026-12-01',time:'09:00',status:'scheduled'};
 globalThis.fetch=async(path,opts)=>{calls.push([path,opts.method]);if(path==='/api/auth/login')return Response.json({user});if(path==='/api/state'){if(resolveOld===null)return new Promise(r=>resolveOld=r);return Response.json({user,bookings:[]});}if(path==='/api/bookings')return Response.json({booking:saved});if(path==='/api/bookings/booking-a')return Response.json({booking:{...saved,status:'cancelled'}});if(path==='/api/me')return Response.json({user:{...user,name:'Nome atualizado'}});throw Error('Pedido inesperado');};
 const repo=await import('../dist/js/store.js?cache-mutations');await repo.login('81988887777','Senha!123');resolveOld=null;const old=repo.sync(true);const before=calls.length;
 await repo.saveBooking(user,{});resolveOld(Response.json({user,bookings:[]}));await old;assert.equal(calls.length,before+1);assert.deepEqual(await repo.bookings(),[saved]);
 await repo.cancelBooking(user,saved.id);assert.equal((await repo.bookings())[0].status,'cancelled');await repo.updateProfile(user,{name:'Nome atualizado',birth:'1955-03-10'});assert.equal((await repo.currentUser()).name,'Nome atualizado');
 assert.equal(calls.filter(([p])=>p==='/api/state').length,2);
});
test('Horários são pré-carregados em lote, reaproveitados e descartados após mudança de conta',async()=>{
 browser();const calls=[];let resolveSlots;
 globalThis.fetch=async(path,opts)=>{calls.push(path);if(path==='/api/auth/login')return Response.json({user});if(path==='/api/auth/logout')return Response.json({ok:true});if(path==='/api/state')return Response.json({user,bookings:[]});if(path.startsWith('/api/availability?'))return new Promise(r=>resolveSlots=r);throw Error('Pedido inesperado');};
 const repo=await import('../dist/js/store.js?cache-availability');await repo.login('81988887777','Senha!123');const dates=['2026-12-01','2026-12-02','2026-12-03'];
 const warm=repo.preloadAvailability('clara',dates);const selected=repo.availability('clara',dates[0]);assert.equal(calls.filter(p=>p.includes('availability')).length,1);assert.equal(repo.cachedAvailability('clara',dates[0]),null);
 resolveSlots(Response.json({days:Object.fromEntries(dates.map(d=>[d,['09:00','10:00']]))}));await warm;assert.deepEqual(await selected,['09:00','10:00']);await repo.availability('clara',dates[0]);assert.equal(calls.filter(p=>p.includes('availability')).length,1);
 await repo.signOut();assert.equal(repo.cachedAvailability('clara',dates[0]),null);
});
