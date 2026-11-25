const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {createApi,hashPassword,verifyPassword}=require('../backend/api.cjs');
const uid='589511e6-d2f1-4bce-a8c3-63145b067884',bid='228d0984-878b-4c92-9f9b-2d18d156e223';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-secret',RATE_LIMIT_SECRET:'a'.repeat(64),APP_ORIGIN:'https://project.example'};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
async function withApi(fn,fetchImpl=async()=>Response.json([]),config=env){
 const server=http.createServer(createApi({env:config,fetchImpl}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body,headers={})=>{const response=await fetch(url+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{Origin:env.APP_ORIGIN}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {response,data:await response.json()};};
 try{await fn(call);}finally{await new Promise(r=>server.close(r));}
}
test('Senha tem sal independente, valida somente o segredo correto e não aparece em resposta pública',async()=>{
 const a=await hashPassword('Senha!123'),b=await hashPassword('Senha!123');assert.notEqual(a,b);assert(await verifyPassword('Senha!123',a));assert(!await verifyPassword('Senha errada',a));
});
test('Chave secreta moderna usa apikey somente no servidor, sem tratá-la como JWT',async()=>withApi(async call=>{
 assert.equal((await call('/api/health')).response.status,200);
},async(url,options)=>{assert.equal(options.headers.apikey,'sb_secret_test-value');assert.equal(options.headers.Authorization,undefined);return Response.json([]);},{...env,SUPABASE_SECRET_KEY:'sb_secret_test-value'}));
test('Configuração ausente não finge persistência no servidor',async()=>withApi(async call=>{
 assert.equal((await call('/api/health')).response.status,503);assert.equal((await call('/api/state')).response.status,503);
},undefined,{}));
test('Solicitações sem sessão não acessam nem alteram consultas',async()=>withApi(async call=>{
 for(const [route,method,body] of [['/api/bookings','GET'],['/api/bookings','POST',{}],['/api/me','PATCH',{}],['/api/events','GET']])assert.equal((await call(route,method,body)).response.status,401);
}));
test('Bloqueia origem diferente e JSON ausente antes de escrever',async()=>withApi(async call=>{
 assert.equal((await call('/api/auth/logout','POST',{}, {Origin:'https://evil.example'})).response.status,403);
 assert.equal((await call('/api/auth/register','POST')).response.status,415);
}));
test('Valida cadastro, datas impossíveis e concordância no servidor',async()=>withApi(async call=>{
 const base={name:'Pessoa de Teste',phone:'81988887777',birth:'1957-08-21',password:'Senha!123',acceptedTerms:true};
 for(const fields of [{phone:'abc'},{name:'x'},{birth:'1957-02-31'},{birth:'2020-01-01'},{password:'curta'},{acceptedTerms:false}])assert.equal((await call('/api/auth/register','POST',{...base,...fields})).response.status,400);
}));
test('Cadastro emite cookie HttpOnly, SameSite e Secure; não retorna hashes ou token em JSON',async()=>{
 const requests=[];await withApi(async call=>{
  const {response,data}=await call('/api/auth/register','POST',{name:'Pessoa de Teste',phone:'81988887777',birth:'1957-08-21',password:'Senha!123',acceptedTerms:true});
  assert.equal(response.status,201);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);assert.match(data.recovery,/^SPM-[A-F0-9]{32}$/);assert.equal(data.user.remote,true);
  assert(!JSON.stringify(data).includes('password_hash'));assert(!JSON.stringify(data).includes('token_hash'));assert(!JSON.stringify(data).includes('test-server-secret'));
 },async(url,opts)=>{requests.push({url:String(url),body:JSON.parse(opts.body||'{}')});return Response.json(String(url).includes('spm_rate_limit')?true:uid);});
 const registration=requests.find(x=>x.url.includes('spm_register'));assert.match(registration.body.p_user.password_hash,/^scrypt:/);assert.equal(registration.body.p_session.token_hash.length,64);assert(!registration.body.p_user.password_hash.includes('Senha!123'));
});
test('Listagem e mutação usam o usuário da sessão e ignoram um userId forjado',async()=>{
 const token='a'.repeat(64),requests=[];
 await withApi(async call=>{
  const headers={Cookie:`spm_session=${token}`};
  const result=await call('/api/state','GET',undefined,headers);assert.equal(result.response.status,200);assert.equal(result.data.user.id,uid);assert(!JSON.stringify(result.data).includes('sensitive-hash'));
  const data=await import('../dist/js/data.js');const date=data.dates().find(d=>data.availableTimes('clara',d).length);const time=data.availableTimes('clara',date)[0];
  const changed=await call('/api/bookings/'+bid,'PATCH',{userId:'forged-user',clinicId:'recanto',specialtyId:'geral',professionalId:'clara',date,time},headers);assert.equal(changed.response.status,200);
 },async(url,opts)=>{
  url=new URL(url);const body=JSON.parse(opts.body||'{}');requests.push({url,body});
  if(url.pathname.endsWith('spm_sessions')){assert.equal(url.searchParams.get('token_hash'),`eq.${digest(token)}`);assert.equal(url.searchParams.get('select'),'spm_users!inner(id,name,phone,birth,created_at)');return Response.json([{spm_users:{id:uid,name:'Pessoa de Teste',phone:'81988887777',birth:'1957-08-21'}}]);}
  if(url.pathname.endsWith('spm_users'))return Response.json([{id:uid,name:'Pessoa de Teste',phone:'81988887777',birth:'1957-08-21',password_hash:'sensitive-hash'}]);
  if(url.pathname.endsWith('spm_bookings')){assert.equal(url.searchParams.get('user_id'),`eq.${uid}`);return Response.json([]);}
  if(url.pathname.endsWith('spm_rate_limit'))return Response.json(true);
  if(url.pathname.endsWith('spm_save_booking'))return Response.json({id:bid,user_id:uid,clinic_id:'recanto',specialty_id:'geral',professional_id:'clara',date:body.p_data.date,time:body.p_data.time,status:'scheduled',previous:[]});
  throw new Error('Unexpected '+url.pathname);
 });
 assert.equal(requests.find(x=>x.url.pathname.endsWith('spm_save_booking')).body.p_user,uid);
});
test('Consulta três dias de disponibilidade em uma leitura e não expõe dados de pacientes',async()=>{
 const data=await import('../dist/js/data.js'),dates=data.dates().slice(0,3);let authReads=0,bookingReads=0;
 await withApi(async call=>{
  const result=await call('/api/availability?'+new URLSearchParams({professionalId:'clara',dates:dates.join(',')}),'GET',undefined,{Cookie:'spm_session='+('a'.repeat(64))});
  assert.equal(result.response.status,200);assert.deepEqual(Object.keys(result.data.days),dates);assert.deepEqual(result.data.days[dates[0]],data.availableTimes('clara',dates[0]));assert(!JSON.stringify(result.data).includes(uid));assert.equal(authReads,1);assert.equal(bookingReads,1);
  assert.equal((await call('/api/availability?professionalId=clara&dates=invalid','GET',undefined,{Cookie:'spm_session='+('a'.repeat(64))})).response.status,400);
 },async(url)=>{url=new URL(url);if(url.pathname.endsWith('spm_sessions')){authReads++;return Response.json([{spm_users:{id:uid,name:'Pessoa de Teste',phone:'81988887777',birth:'1957-08-21'}}]);}if(url.pathname.endsWith('spm_bookings')){bookingReads++;assert.equal(url.searchParams.get('date'),`in.(${dates.join(',')})`);return Response.json([]);}throw Error('Leitura extra inesperada');});
});
