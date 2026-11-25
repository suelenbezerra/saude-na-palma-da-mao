import {availableTimes,localISO,age,professional} from './data.js';
const DB_NAME='saude-palma-pwa-v1';
let db;
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
function done(t){return new Promise((resolve,reject)=>{t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Não foi possível salvar.'));});}
export async function init(){
 if(db)return;
 const r=indexedDB.open(DB_NAME,1);
 r.onupgradeneeded=()=>{const d=r.result;const u=d.createObjectStore('users',{keyPath:'id'});u.createIndex('phone','phone',{unique:true});d.createObjectStore('bookings',{keyPath:'id'});d.createObjectStore('activity',{keyPath:'id'});};
 db=await req(r);
 db.onversionchange=()=>{db.close();db=null;};
}
async function getAll(store){return req(db.transaction(store).objectStore(store).getAll());}
async function put(store,value){const t=db.transaction(store,'readwrite');const wait=done(t);t.objectStore(store).put(value);await wait;return value;}
const encoder=new TextEncoder();
const toHex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>toHex(crypto.getRandomValues(new Uint8Array(16)));
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return toHex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:120000,hash:'SHA-256'},key,256));}
async function recoveryHash(key){return toHex(await crypto.subtle.digest('SHA-256',encoder.encode(key.trim().toUpperCase())));}
export async function currentUser(){const id=sessionStorage.getItem('spm-session');if(!id)return null;return req(db.transaction('users').objectStore('users').get(id));}
export const signOut=()=>sessionStorage.removeItem('spm-session');
export async function register({name,phone,birth,password}){
 const existing=await req(db.transaction('users').objectStore('users').index('phone').get(phone));
 if(existing)throw new Error('Este telefone já tem uma conta neste navegador. Entre ou recupere o acesso.');
 const salt=random(),recovery=`SPM-${random().slice(0,16).toUpperCase()}`;
 const user={id:crypto.randomUUID(),name,phone,birth,salt,passwordHash:await passwordHash(password,salt),recoveryHash:await recoveryHash(recovery),createdAt:new Date().toISOString()};
 await put('users',user);sessionStorage.setItem('spm-session',user.id);return {user,recovery};
}
export async function login(phone,password){
 const u=await req(db.transaction('users').objectStore('users').index('phone').get(phone));
 if(!u||u.passwordHash!==await passwordHash(password,u.salt))throw new Error('Telefone ou senha não conferem. Confira os dados ou recupere o acesso.');
 sessionStorage.setItem('spm-session',u.id);return u;
}
export async function demo(){
 let u=(await getAll('users')).find(x=>x.demo);
 if(!u){u={id:crypto.randomUUID(),name:'Maria Aparecida da Silva',phone:'81999990000',birth:'1954-04-12',demo:true,createdAt:new Date().toISOString()};await put('users',u);}
 sessionStorage.setItem('spm-session',u.id);return u;
}
export async function recover(phone,key,password){
 const u=await req(db.transaction('users').objectStore('users').index('phone').get(phone));
 if(!u||u.demo||await recoveryHash(key)!==u.recoveryHash)throw new Error('Telefone ou código de recuperação não conferem neste navegador.');
 u.salt=random();u.passwordHash=await passwordHash(password,u.salt);await put('users',u);
}
export async function updateProfile(user,fields){
 const u=await req(db.transaction('users').objectStore('users').get(user.id));
 await put('users',{...u,name:fields.name,birth:fields.birth});return currentUser();
}
export async function bookings(){return getAll('bookings');}
export async function userBookings(user){return (await bookings()).filter(b=>b.userId===user.id).sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));}
export async function activity(type,detail={}){try{await put('activity',{id:crypto.randomUUID(),type,at:new Date().toISOString(),date:localISO(),...detail});}catch{/* Telemetry must not block the patient flow. */}}
export async function events(){return getAll('activity');}
export async function saveBooking(user,draft,changeId=null){
 const p=professional(draft.professionalId);
 if(!p||!p.clinics.includes(draft.clinicId)||p.specialty!==draft.specialtyId)throw new Error('Confira a clínica e o profissional antes de confirmar.');
 if(draft.date<localISO())throw new Error('Escolha uma data futura.');
 const t=db.transaction('bookings','readwrite'),wait=done(t),s=t.objectStore('bookings');
 const all=await req(s.getAll());
 const old=changeId?all.find(b=>b.id===changeId):null;
 if(changeId&&(!old||old.userId!==user.id||old.status!=='scheduled')){t.abort();await wait.catch(()=>{});throw new Error('Esta consulta não pode mais ser alterada.');}
 if(!availableTimes(draft.professionalId,draft.date,all,changeId).includes(draft.time)){t.abort();await wait.catch(()=>{});throw new Error('Esse horário não está mais disponível. Escolha outro.');}
 if(all.some(b=>b.id!==changeId&&b.userId===user.id&&b.status==='scheduled'&&b.date===draft.date&&b.time===draft.time)){t.abort();await wait.catch(()=>{});throw new Error('Você já tem uma consulta nesse horário. Escolha outro.');}
 const b={id:changeId||crypto.randomUUID(),userId:user.id,clinicId:draft.clinicId,specialtyId:draft.specialtyId,professionalId:draft.professionalId,date:draft.date,time:draft.time,status:'scheduled',createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),previous:old?[...(old.previous||[]),{date:old.date,time:old.time}]:[],ageGroup:age(user.birth)>=60?'60+':'18–59'};
 s.put(b);await wait;await activity(changeId?'reagendamento':'agendamento',{clinicId:b.clinicId,ageGroup:b.ageGroup,bookingId:b.id});return b;
}
export async function cancelBooking(user,id){
 const t=db.transaction('bookings','readwrite'),wait=done(t),s=t.objectStore('bookings'),b=await req(s.get(id));
 if(!b||b.userId!==user.id||b.status!=='scheduled'){t.abort();await wait.catch(()=>{});throw new Error('Esta consulta não está disponível para cancelamento.');}
 b.status='cancelled';b.updatedAt=new Date().toISOString();s.put(b);await wait;await activity('cancelamento',{bookingId:b.id,clinicId:b.clinicId});return b;
}
export async function deleteAccount(user){
 const t=db.transaction(['users','bookings'],'readwrite'),wait=done(t);
 const list=await req(t.objectStore('bookings').getAll());list.filter(b=>b.userId===user.id).forEach(b=>t.objectStore('bookings').delete(b.id));t.objectStore('users').delete(user.id);await wait;signOut();
}
