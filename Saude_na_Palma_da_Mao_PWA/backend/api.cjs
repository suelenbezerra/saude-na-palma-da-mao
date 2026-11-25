'use strict';
const crypto=require('node:crypto'),{promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt),SESSION_SECONDS=7*24*60*60;
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const random=()=>crypto.randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function hashPassword(value){const salt=crypto.randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(value,salt,64)).toString('hex')}`;}
async function verifyPassword(value,encoded){const [alg,salt,hash]=String(encoded||'').split(':');if(alg!=='scrypt'||!salt||!hash)return false;return equal((await scrypt(value,salt,64)).toString('hex'),hash);}
const publicUser=u=>u?{id:u.id,name:u.name,phone:u.phone,birth:u.birth,createdAt:u.created_at,remote:true}:null;
const booking=b=>({id:b.id,userId:b.user_id,clinicId:b.clinic_id,specialtyId:b.specialty_id,professionalId:b.professional_id,date:b.date,time:b.time,status:b.status,previous:b.previous,createdAt:b.created_at,updatedAt:b.updated_at});
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
function validatePassword(p){if(typeof p!=='string'||p.length<8||p.length>128)fail(400,'Use uma senha entre 8 e 128 caracteres.');}
function validatePhone(p){if(typeof p!=='string'||!/^\d{10,11}$/.test(p))fail(400,'Informe o telefone com DDD, usando 10 ou 11 números.');}
function validateProfile(body,data){
 if(typeof body.name!=='string'||body.name.trim().length<3||body.name.trim().length>120)fail(400,'Informe um nome entre 3 e 120 caracteres.');
 if(typeof body.birth!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.birth)||!Number.isFinite(Date.parse(body.birth+'T12:00:00Z'))||new Date(body.birth+'T12:00:00Z').toISOString().slice(0,10)!==body.birth||body.birth<'1900-01-01'||body.birth>data.localISO()||data.age(body.birth)<18)fail(400,'Informe uma data de nascimento válida. Cadastro para maiores de 18 anos.');
 return {name:body.name.trim(),birth:body.birth};
}
function createApi({env=process.env,fetchImpl=fetch}={}){
 const serverKey=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 const configured=Boolean(env.SUPABASE_URL&&serverKey&&env.RATE_LIMIT_SECRET?.length>=32&&env.APP_ORIGIN);
 let catalog;
 const loadCatalog=()=>catalog||(catalog=import('../dist/js/data.js'));
 async function db(resource,{method='GET',query={},body,prefer='return=representation'}={}){
  if(!configured)fail(503,'O servidor ainda não foi configurado. A demonstração local continua disponível.');
  const url=new URL(`/rest/v1/${resource}`,env.SUPABASE_URL);url.search=new URLSearchParams(query).toString();
  let res;try{res=await fetchImpl(url,{method,headers:{apikey:serverKey,...(serverKey.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${serverKey}`}), 'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});}catch{fail(503,'Não foi possível acessar o banco agora. Tente novamente.');}
  const value=await res.json().catch(()=>null);
  if(!res.ok){
   if(value?.code==='23505')fail(409,resource.includes('register')?'Já existe uma conta com esse telefone. Entre ou recupere o acesso.':'Esse horário não está mais disponível, ou você já tem uma consulta nele. Escolha outro.');
   if(value?.code==='P0002')fail(404,'Esta consulta não está disponível para alteração.');
   console.error(JSON.stringify({event:'database_error',resource,code:value?.code,status:res.status}));fail(503,'Não foi possível concluir no servidor. Tente novamente.');
  }return value;
 }
 const rpc=(name,body)=>db(`rpc/${name}`,{method:'POST',body});
 function sessionData(userId){const token=random();return {token,record:{token_hash:digest(token),user_id:userId,expires_at:new Date(Date.now()+SESSION_SECONDS*1000).toISOString()}};}
 function setCookie(res,token){const secure=new URL(env.APP_ORIGIN).protocol==='https:';res.setHeader('Set-Cookie',`spm_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token?SESSION_SECONDS:0}${secure?'; Secure':''}`);}
 const tokenOf=req=>{const match=String(req.headers.cookie||'').match(/(?:^|;\s*)spm_session=([a-f0-9]{64})(?:;|$)/);return match?.[1]||'';};
 async function currentUser(req){
  const token=tokenOf(req);if(!token)return null;
  const sessions=await db('spm_sessions',{query:{select:'spm_users!inner(id,name,phone,birth,created_at)',token_hash:`eq.${digest(token)}`,expires_at:`gt.${new Date().toISOString()}`,limit:1}});
  return sessions[0]?.spm_users||null;
 }
 async function rate(req,action,phone=''){
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim();
  for(const [subject,max] of [[`ip:${ip}`,action==='write'?120:30],...(phone?[[`phone:${phone}`,12]]:[])]){
   const key=crypto.createHmac('sha256',env.RATE_LIMIT_SECRET).update(`${action}:${subject}`).digest('hex');
   if(!await rpc('spm_rate_limit',{p_key:key,p_max:max,p_seconds:900}))fail(429,'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
  }
 }
 async function bodyOf(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'Envie os dados em JSON.');
  let text='',size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)fail(413,'Pedido muito grande.');text+=chunk.toString('utf8');}
  let body;try{body=JSON.parse(text);}catch{fail(400,'Dados inválidos.');}if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'Dados inválidos.');return body;
 }
 async function handler(req,res){
  const id=crypto.randomUUID();res.setHeader('X-Request-Id',id);res.setHeader('Cache-Control','no-store, private');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
  try{
   const url=new URL(req.url,'http://localhost'),route=url.pathname,method=req.method;
   if(route==='/api/health'&&method==='GET'){if(configured)await db('spm_users',{query:{select:'id',limit:0}});return send(configured?200:503,{ok:configured,service:'saude-na-palma-backend',database:configured?'connected':'not_configured',version:'2.1.0'});}
   if(!configured)fail(503,'O servidor ainda não foi configurado. A demonstração local continua disponível.');
   const data=await loadCatalog();
   if(route==='/api/catalog'&&method==='GET')return send(200,{clinics:data.clinics,specialties:data.specialties,professionals:data.professionals,dates:data.dates(),fictitious:true});
   const changing=!['GET','HEAD'].includes(method);
   if(changing){
    if(!['POST','PATCH','DELETE'].includes(method))fail(405,'Método não disponível.');
    if(req.headers.origin!==env.APP_ORIGIN||req.headers['sec-fetch-site']==='cross-site')fail(403,'Origem do pedido não permitida.');
   }
   if(route==='/api/auth/register'&&method==='POST'){
    const body=await bodyOf(req);validatePhone(body.phone);validatePassword(body.password);const fields=validateProfile(body,data);
    if(body.acceptedTerms!==true)fail(400,'Confirme os termos do projeto antes de continuar.');
    await rate(req,'register',body.phone);
    const recovery=`SPM-${crypto.randomBytes(16).toString('hex').toUpperCase()}`,uid=crypto.randomUUID(),session=sessionData(uid);
    const user={id:uid,...fields,phone:body.phone,password_hash:await hashPassword(body.password),recovery_hash:digest(recovery)};
    await rpc('spm_register',{p_user:user,p_session:session.record});setCookie(res,session.token);return send(201,{user:publicUser(user),recovery});
   }
   if(route==='/api/auth/login'&&method==='POST'){
    const body=await bodyOf(req);validatePhone(body.phone);validatePassword(body.password);await rate(req,'login',body.phone);
    const users=await db('spm_users',{query:{select:'*',phone:`eq.${body.phone}`,limit:1}}),u=users[0];
    const valid=await verifyPassword(body.password,u?.password_hash||'scrypt:00000000000000000000000000000000:'+('0'.repeat(128)));
    if(!u||!valid)fail(401,'Telefone ou senha não conferem. Confira os dados ou recupere o acesso.');
    const s=sessionData(u.id);await db('spm_sessions',{method:'POST',body:s.record});setCookie(res,s.token);return send(200,{user:publicUser(u)});
   }
   if(route==='/api/auth/recover'&&method==='POST'){
    const body=await bodyOf(req);validatePhone(body.phone);validatePassword(body.password);await rate(req,'recover',body.phone);
    const supplied=String(body.recovery||'').trim().toUpperCase();if(!/^SPM-[A-F0-9]{32}$/.test(supplied))fail(400,'Telefone ou código de recuperação não conferem.');
    const users=await db('spm_users',{query:{select:'*',phone:`eq.${body.phone}`,limit:1}}),u=users[0];
    if(!u||!equal(digest(supplied),u.recovery_hash))fail(400,'Telefone ou código de recuperação não conferem.');
    const recovery=`SPM-${crypto.randomBytes(16).toString('hex').toUpperCase()}`,s=sessionData(u.id);
    if(!await rpc('spm_recover',{p_user:u.id,p_expected:u.recovery_hash,p_password:await hashPassword(body.password),p_recovery:digest(recovery),p_session:s.record}))fail(400,'O código já foi utilizado.');
    setCookie(res,s.token);return send(200,{user:publicUser(u),recovery});
   }
   if(route==='/api/auth/logout'&&method==='POST'){
    const token=tokenOf(req);if(token)await db('spm_sessions',{method:'DELETE',query:{token_hash:`eq.${digest(token)}`}});setCookie(res,'');return send(200,{ok:true});
   }
   const user=await currentUser(req);
   if(route==='/api/me'&&method==='GET')return send(200,{user:publicUser(user)});
   if(route==='/api/state'&&method==='GET')return send(200,{user:publicUser(user),bookings:user?(await db('spm_bookings',{query:{select:'*',user_id:`eq.${user.id}`,order:'date.asc,time.asc'}})).map(booking):[]});
   if(!user)fail(401,'Entre na sua conta para continuar.');
   if(changing)await rate(req,'write');
   if(route==='/api/me'&&method==='PATCH'){
    const fields=validateProfile(await bodyOf(req),data);const changed=await db('spm_users',{method:'PATCH',query:{id:`eq.${user.id}`,select:'id,name,phone,birth,created_at'},body:fields});return send(200,{user:publicUser(changed[0])});
   }
   if(route==='/api/me'&&method==='DELETE'){
    const body=await bodyOf(req);if(body.confirm!==true)fail(400,'Confirme a exclusão da conta.');await db('spm_users',{method:'DELETE',query:{id:`eq.${user.id}`}});setCookie(res,'');return send(200,{ok:true});
   }
   if(route==='/api/bookings'&&method==='GET')return send(200,{bookings:(await db('spm_bookings',{query:{select:'*',user_id:`eq.${user.id}`,order:'date.asc,time.asc'}})).map(booking)});
   if(route==='/api/availability'&&method==='GET'){
    const prof=url.searchParams.get('professionalId'),date=url.searchParams.get('date'),excluding=url.searchParams.get('exclude');
    const batch=url.searchParams.has('dates'),requested=batch?[...new Set(url.searchParams.get('dates').split(','))]:[date],allowed=data.dates();
    if(!data.professional(prof)||!requested.length||requested.length>4||requested.some(d=>!allowed.includes(d)))fail(400,'Escolha um profissional e uma data válidos.');
    const occupied=await db('spm_bookings',{query:{select:'id,user_id,date,time',professional_id:`eq.${prof}`,date:batch?`in.(${requested.join(',')})`:`eq.${date}`,status:'eq.scheduled'}});
    const filtered=occupied.filter(b=>!(b.id===excluding&&b.user_id===user.id));
    const days=Object.fromEntries(requested.map(d=>[d,data.availableTimes(prof,d,filtered.map(b=>({id:b.id,professionalId:prof,date:b.date,time:b.time,status:'scheduled'})))]));
    return send(200,batch?{days}:{times:days[date]});
   }
   const edit=route.match(/^\/api\/bookings\/([^/]+)$/);
   if((route==='/api/bookings'&&method==='POST')||(edit&&method==='PATCH')){
    if(edit&&!uuid(edit[1]))fail(400,'Consulta inválida.');
    const body=await bodyOf(req),p=data.professional(body.professionalId);
    if(!p||!p.clinics.includes(body.clinicId)||p.specialty!==body.specialtyId||!data.dates().includes(body.date)||!data.availableTimes(p.id,body.date).includes(body.time))fail(400,'Confira a clínica, o profissional, o dia e o horário.');
    const result=await rpc('spm_save_booking',{p_user:user.id,p_data:{clinicId:body.clinicId,specialtyId:body.specialtyId,professionalId:body.professionalId,date:body.date,time:body.time},p_id:edit?edit[1]:null});return send(edit?200:201,{booking:booking(result)});
   }
   if(edit&&method==='DELETE'){
    if(!uuid(edit[1]))fail(400,'Consulta inválida.');return send(200,{booking:booking(await rpc('spm_cancel_booking',{p_user:user.id,p_id:edit[1]}))});
   }
   if(route==='/api/events'&&method==='POST'){
    const body=await bodyOf(req);if(body.type!=='inicio_agendamento')fail(400,'Evento inválido.');await db('spm_events',{method:'POST',body:{user_id:user.id,type:body.type}});return send(201,{ok:true});
   }
   if(route==='/api/events'&&method==='GET')return send(200,{events:await db('spm_events',{query:{select:'id,type,at',user_id:`eq.${user.id}`,order:'at.desc',limit:100}})});
   fail(404,'Recurso não encontrado.');
  }catch(err){const status=err.status||500;if(status>=500)console.error(JSON.stringify({event:'api_error',requestId:id,status,code:err.status?'upstream':'unexpected'}));send(status,{error:status===500?'Não foi possível concluir. Tente novamente.':err.message,requestId:id});}
 }
 return handler;
}
module.exports={createApi,hashPassword,verifyPassword,publicUser};
