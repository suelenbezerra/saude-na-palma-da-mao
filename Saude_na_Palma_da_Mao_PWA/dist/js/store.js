import * as local from './demo-store.js';
const STATE_TTL=30000,SLOTS_TTL=15000;
let snapshot={user:null,bookings:[]},lastSync=0,lastAttempt=0,revision=0,syncSequence=0,inFlight=null;
const slots=new Map(),slotRequests=new Map();
export let lastError='';
export const isRemote=()=>sessionStorage.getItem('spm-mode')!=='demo';
export const peek=()=>snapshot;
async function call(path,{method='GET',body}={}){
 const startedRevision=revision;
 if(!navigator.onLine)throw new Error('Você está sem internet. Conecte-se para acessar ou alterar a conta online. A demonstração local está disponível.');
 let response;try{response=await fetch('/api/'+path,{method,credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(18000)});}catch{throw new Error('Não foi possível conectar ao servidor. Tente novamente quando a conexão voltar.');}
 const result=await response.json().catch(()=>({}));
 if(!response.ok){if(response.status===401&&startedRevision===revision)clearSnapshot();throw new Error(result.error||'Não foi possível concluir no servidor.');}
 return result;
}
function invalidate(){revision++;inFlight=null;slots.clear();slotRequests.clear();}
function clearSnapshot(){invalidate();snapshot={user:null,bookings:[]};lastSync=0;lastAttempt=0;lastError='';}
export function sync(force=false){
 if(!isRemote())return Promise.resolve(false);
 if(inFlight?.revision===revision)return inFlight.promise;
 if(!force&&(Date.now()-lastSync<STATE_TTL||Date.now()-lastAttempt<5000))return Promise.resolve(false);
 const version=revision,sequence=++syncSequence;lastAttempt=Date.now();
 const promise=(async()=>{
  try{const result=await call('state');
   if(version!==revision||sequence!==syncSequence)return false;
   const changed=JSON.stringify(snapshot)!==JSON.stringify(result);
   snapshot=result;lastSync=Date.now();lastError='';return changed;
  }catch(err){if(version===revision&&sequence===syncSequence)lastError=err.message;return false;}
  finally{if(inFlight?.promise===promise)inFlight=null;}
 })();
 inFlight={revision:version,promise};return promise;
}
export async function init(){await local.init();await sync(true);}
export async function currentUser(){return isRemote()?snapshot.user:local.currentUser();}
export async function bookings(){return isRemote()?snapshot.bookings:local.bookings();}
export async function userBookings(user){return (await bookings()).filter(b=>b.userId===user.id);}
export async function demo(){if(snapshot.user)await call('auth/logout',{method:'POST'});clearSnapshot();sessionStorage.setItem('spm-mode','demo');return local.demo();}
function online(result,{fresh=false}={}){invalidate();sessionStorage.setItem('spm-mode','online');local.signOut();snapshot={user:result.user,bookings:result.bookings||[]};lastSync=fresh?Date.now():0;lastAttempt=0;lastError='';return result;}
export async function register(fields){return online(await call('auth/register',{method:'POST',body:{...fields,acceptedTerms:true}}),{fresh:true});}
export async function login(phone,password){const result=online(await call('auth/login',{method:'POST',body:{phone,password}}));await sync(true);return result.user;}
export async function recover(phone,recovery,password){const result=online(await call('auth/recover',{method:'POST',body:{phone,recovery,password}}));await sync(true);return result;}
export async function signOut(){if(isRemote())await call('auth/logout',{method:'POST'});else local.signOut();clearSnapshot();sessionStorage.setItem('spm-mode','online');}
export async function updateProfile(user,fields){
 if(!isRemote())return local.updateProfile(user,fields);
 const result=await call('me',{method:'PATCH',body:fields});invalidate();snapshot={...snapshot,user:result.user};lastSync=Date.now();lastError='';return result.user;
}
function commitBooking(value){invalidate();snapshot={...snapshot,bookings:[...snapshot.bookings.filter(b=>b.id!==value.id),value]};lastSync=Date.now();lastError='';return value;}
export async function saveBooking(user,draft,changeId=null){if(!isRemote())return local.saveBooking(user,draft,changeId);const result=await call(changeId?'bookings/'+encodeURIComponent(changeId):'bookings',{method:changeId?'PATCH':'POST',body:draft});return commitBooking(result.booking);}
export async function cancelBooking(user,id){if(!isRemote())return local.cancelBooking(user,id);return commitBooking((await call('bookings/'+encodeURIComponent(id),{method:'DELETE',body:{}})).booking);}
export async function deleteAccount(user){if(!isRemote())await local.deleteAccount(user);else await call('me',{method:'DELETE',body:{confirm:true}});clearSnapshot();sessionStorage.setItem('spm-mode','online');}
const slotKey=(prof,date,exclude)=>JSON.stringify([prof,date,exclude||'']);
export function cachedAvailability(prof,date,exclude){return slots.get(slotKey(prof,date,exclude))?.times??null;}
export async function preloadAvailability(prof,dateList,exclude){
 if(!isRemote()||!prof)return false;
 const dates=[...new Set(dateList)].filter(Boolean),pending=[],missing=[];
 for(const date of dates){const key=slotKey(prof,date,exclude),entry=slots.get(key);if(entry&&Date.now()-entry.at<SLOTS_TTL)continue;const existing=slotRequests.get(key);if(existing)pending.push(existing);else missing.push(date);}
 if(missing.length){
  const version=revision;
  const request=call('availability?'+new URLSearchParams({professionalId:prof,dates:missing.join(','),...(exclude?{exclude}:{})})).then(result=>{
   if(version!==revision||!isRemote())return false;
   let changed=false;
   for(const date of missing){const key=slotKey(prof,date,exclude),times=result.days[date];if(JSON.stringify(slots.get(key)?.times)!==JSON.stringify(times))changed=true;slots.set(key,{times,at:Date.now()});}
   return changed;
  }).finally(()=>{for(const date of missing){const key=slotKey(prof,date,exclude);if(slotRequests.get(key)===request)slotRequests.delete(key);}});
  for(const date of missing)slotRequests.set(slotKey(prof,date,exclude),request);pending.push(request);
 }
 return (await Promise.all([...new Set(pending)])).some(Boolean);
}
export async function availability(prof,date,exclude){if(!isRemote())return null;await preloadAvailability(prof,[date],exclude);return cachedAvailability(prof,date,exclude);}
export async function activity(type,detail={}){if(!isRemote())return local.activity(type,detail);if(!snapshot.user||type!=='inicio_agendamento')return;try{await call('events',{method:'POST',body:{type}});}catch{/* Contagem não interrompe o fluxo. */}}
export async function events(){return isRemote()?(await call('events')).events:local.events();}
