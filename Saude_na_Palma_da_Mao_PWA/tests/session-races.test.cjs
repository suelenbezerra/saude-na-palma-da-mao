const {test}=require('node:test'),assert=require('node:assert/strict');
test('Respostas antigas não apagam um login novo nem restauram uma sessão encerrada',async()=>{
 const storage=new Map();Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 const user={id:'current-user',name:'Pessoa Teste',remote:true};let resolvePending,hold=true;
 globalThis.fetch=async path=>{
  if(path==='/api/state'&&hold){hold=false;return new Promise(resolve=>resolvePending=resolve);}
  if(path==='/api/auth/login')return Response.json({user});
  if(path==='/api/auth/logout')return Response.json({ok:true});
  if(path==='/api/state')return Response.json({user,bookings:[]});
  throw Error('Unexpected request');
 };
 const repo=await import('../dist/js/store.js');
 const oldAnonymous=repo.sync(true);await repo.login('81988887777','Senha!123');resolvePending(Response.json({user:null,bookings:[]}));await oldAnonymous;assert.equal((await repo.currentUser()).id,user.id);
 hold=true;const oldAccount=repo.sync(true);await repo.signOut();resolvePending(Response.json({user,bookings:[{id:'private-data'}]}));await oldAccount;assert.equal(await repo.currentUser(),null);assert.deepEqual(await repo.bookings(),[]);
});
