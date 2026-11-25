import * as data from './data.js';
import * as repo from './store.js';
import {shell,view,icon,e,button,clinicResults,filteredSessions} from './views.js';
const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
const readJSON=(key,fallback,storage=localStorage)=>{try{return JSON.parse(storage.getItem(key))||fallback;}catch{return fallback;}};
const state={route:'welcome',user:null,bookings:[],allBookings:[],draft:readJSON('spm-draft',{},sessionStorage),changeId:sessionStorage.getItem('spm-change'),original:null,query:'',tab:'upcoming',dateOffset:0,recovery:'',lastBooking:null,wasChange:false,prefs:readJSON('spm-preferences',{scale:1,contrast:false}),filters:{period:'30',age:'all',clinic:'all'},installPrompt:null,installed:matchMedia('(display-mode: standalone)').matches||navigator.standalone===true};
let generation=0;
let backgroundRefresh=null,lastShownError='';
const dataRoute=r=>['home','appointments','account'].includes(r)||r.startsWith('detail/');
function refreshAccount(force=false){
 if(backgroundRefresh||!repo.isRemote()||!navigator.onLine)return;
 const previousUser=repo.peek().user?.id;
 backgroundRefresh=repo.sync(force).then(changed=>{
  if(!repo.isRemote())return;
  const authChanged=previousUser!==repo.peek().user?.id;
  if(changed&&(authChanged||(dataRoute(state.route)&&!dialog.open&&!document.activeElement?.closest('form'))))return render({focus:false,refresh:false,loadSlots:false});
 }).catch(()=>{}).finally(()=>{
  backgroundRefresh=null;
  if(repo.lastError&&repo.lastError!==lastShownError){lastShownError=repo.lastError;message(repo.lastError);}
  if(!repo.lastError)lastShownError='';
 });
}
function warmSlots(n){
 const d=state.draft,prof=d.professionalId,exclude=state.changeId;
 const days=[...new Set([...data.dates().slice(state.dateOffset,state.dateOffset+3),d.date].filter(Boolean))];
 repo.preloadAvailability(prof,days,exclude).then(changed=>{
  if(n!==generation||state.route!=='time'||!repo.isRemote())return;
  if(changed||state.slotsLoading||state.slotError){state.slotError='';return render({focus:false,refresh:false,loadSlots:false});}
 }).catch(err=>{
  if(n!==generation||state.route!=='time')return;
  state.slotError=err.message;render({focus:false,refresh:false,loadSlots:false}).catch(fatal);
 });
}
const protectedRoute=r=>['home','clinic','specialty','professional','time','review','success','appointments','account','edit-profile','backup'].includes(r)||r.startsWith('detail/');
const persistDraft=()=>{sessionStorage.setItem('spm-draft',JSON.stringify(state.draft));if(state.changeId)sessionStorage.setItem('spm-change',state.changeId);else sessionStorage.removeItem('spm-change');};
const goto=r=>{if(location.hash==='#'+r)render();else location.hash=r;};
function preferences(){
 const scale=[1,1.15,1.3].includes(Number(state.prefs.scale))?Number(state.prefs.scale):1;
 document.documentElement.style.setProperty('--scale',scale);document.body.dataset.contrast=state.prefs.contrast?'high':'normal';localStorage.setItem('spm-preferences',JSON.stringify({...state.prefs,scale}));
}
function announce(text){document.querySelector('#announcements').textContent=text;}
function message(text){const box=document.querySelector('#message');box.innerHTML=`<span>${e(text)}</span><button type="button" data-action="dismiss-message" aria-label="Fechar mensagem">${icon('close')}</button>`;box.hidden=false;}
function error(form,text,id){
 form.querySelector('#form-error').innerHTML=`${icon('info')}<span>${e(text)}</span>`;
 if(id){const input=form.elements.namedItem(id),target=form.querySelector(`#${id}-error`);input?.setAttribute('aria-invalid','true');if(target){target.textContent=text;target.hidden=false;input.setAttribute('aria-describedby',`${id}-error`);}input?.focus();}
 else form.querySelector('#form-error').scrollIntoView({block:'center',behavior:'instant'});
}
function clearErrors(form){form.querySelector('#form-error').textContent='';form.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));form.querySelectorAll('.field-error').forEach(x=>x.hidden=true);}
function download(name,content,type='text/plain;charset=utf-8'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function clearFlow(){state.draft={};state.changeId=null;state.original=null;state.query='';state.dateOffset=0;persistDraft();}
function modal(title,body,buttons){dialog.innerHTML=`<div class="dialog-icon">${icon('calendar')}</div><h2 id="dialog-title">${title}</h2>${body}<div class="actions">${buttons}</div>`;dialog.showModal();dialog.querySelector('button')?.focus();}

async function render({focus=true,refresh=true,loadSlots=true}={}){
 const n=++generation,y=window.scrollY,active=document.activeElement;
 const activeAction=active?.dataset?.action,activeId=active?.dataset?.id;
 const [user,all]=await Promise.all([repo.currentUser(),repo.bookings()]);if(n!==generation)return;
 state.remote=repo.isRemote();state.serverError=repo.lastError;state.user=user;state.allBookings=all;state.bookings=user?all.filter(b=>b.userId===user.id).sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)):[];
 state.route=decodeURIComponent(location.hash.slice(1)|| (user?'home':'welcome'));
 if(state.route==='home'&&!user){goto('welcome');return;}
 if(protectedRoute(state.route)&&!user){goto('login');return;}
 const d=state.draft;
 if(state.changeId){state.original=state.bookings.find(b=>b.id===state.changeId);if(!state.original||state.original.status!=='scheduled'){clearFlow();if(['time','review'].includes(state.route)){goto('appointments');return;}}}
 if(['specialty','professional','time','review'].includes(state.route)&&!data.clinic(d.clinicId)){goto('clinic');return;}
 if(['professional','time','review'].includes(state.route)&&!data.specialty(d.specialtyId)){goto('specialty');return;}
 if(['time','review'].includes(state.route)&&!data.professional(d.professionalId)){goto('professional');return;}
 if(state.route==='review'&&(!d.date||!d.time)){goto('time');return;}
 if(state.route==='success'&&!state.lastBooking){goto('appointments');return;}
 if(state.route==='backup'&&!state.recovery){goto('home');return;}
 const slotKey=state.route==='time'?JSON.stringify([d.professionalId,d.date,state.changeId]):'';
 if(state.slotKey!==slotKey){state.slotKey=slotKey;state.slotError='';}
 const cached=state.remote&&state.route==='time'&&d.date?repo.cachedAvailability(d.professionalId,d.date,state.changeId):null;
 state.remoteSlots=cached||[];state.slotsLoading=Boolean(state.remote&&state.route==='time'&&d.date&&cached===null&&!state.slotError);
 app.innerHTML=shell(state,view(state));preferences();
 const title=document.querySelector('h1')?.textContent||'Saúde na Palma da Mão';document.title=`${title} | Saúde na Palma da Mão`;
 if(focus){window.scrollTo({top:0,behavior:'instant'});document.querySelector('#main').focus({preventScroll:true});announce(title);}
 else {window.scrollTo({top:y,behavior:'instant'});if(activeAction){[...document.querySelectorAll('[data-action]')].find(x=>x.dataset.action===activeAction&&x.dataset.id===activeId)?.focus({preventScroll:true});}}
 if(refresh&&state.remote&&dataRoute(state.route))refreshAccount();
 if(loadSlots&&state.remote&&state.route==='time')warmSlots(n);
}

async function handleAction(b){
 const action=b.dataset.action,id=b.dataset.id,d=state.draft;
 switch(action){
 case 'reload':location.reload();return;
 case 'dismiss-message':document.querySelector('#message').hidden=true;return;
 case 'read-settings':goto('settings');return;
 case 'password':{const input=document.getElementById(b.dataset.input);input.type=input.type==='password'?'text':'password';b.setAttribute('aria-label',input.type==='password'?'Mostrar senha':'Ocultar senha');return;}
 case 'demo':await repo.demo();clearFlow();goto('home');return;
 case 'new-booking':clearFlow();void repo.activity('inicio_agendamento');goto('clinic');return;
 case 'back':{
  const r=state.route;
  const previous={login:'welcome',register:'login',recover:'login',clinic:'home',specialty:'clinic',professional:'specialty',time:state.changeId?`detail/${state.changeId}`:'professional',review:'time',success:'appointments','edit-profile':'account',backup:'home'};
  goto(r.startsWith('detail/')?'appointments':previous[r]||'home');return;
 }
 case 'clinic':state.draft={clinicId:id};persistDraft();await render({focus:false});return;
 case 'clear-search':state.query='';await render({focus:false});document.querySelector('#clinic-search')?.focus();return;
 case 'next-clinic':if(!d.clinicId){message('Escolha uma clínica para continuar.');return;}goto('specialty');return;
 case 'specialty':state.draft={clinicId:d.clinicId,specialtyId:id};persistDraft();await render({focus:false});return;
 case 'next-specialty':if(!d.specialtyId){message('Escolha uma especialidade para continuar.');return;}goto('professional');return;
 case 'professional':state.draft={clinicId:d.clinicId,specialtyId:d.specialtyId,professionalId:id};state.dateOffset=0;persistDraft();await render({focus:false});return;
 case 'next-professional':if(!d.professionalId){message('Escolha um profissional para continuar.');return;}goto('time');return;
 case 'dates-prev':state.dateOffset=Math.max(0,state.dateOffset-3);await render({focus:false});return;
 case 'dates-next':state.dateOffset=Math.min(15,state.dateOffset+3);await render({focus:false});return;
 case 'date':state.draft={...d,date:id,time:null};persistDraft();await render({focus:false});announce(`Dia escolhido: ${data.dateLabel(id)}.`);return;
 case 'time':state.draft={...d,time:id};persistDraft();await render({focus:false});announce(`Horário escolhido: ${data.timeLabel(id)}.`);return;
 case 'next-time':if(!d.date||!d.time){message('Escolha um dia e um horário para continuar.');return;}goto('review');return;
 case 'confirm-booking':{
  b.disabled=true;
  try{const result=await repo.saveBooking(state.user,d,state.changeId);state.lastBooking=result;state.wasChange=Boolean(state.changeId);clearFlow();goto('success');}
  catch(err){message(err.message);b.disabled=false;await render({focus:false});}
  return;
 }
 case 'tab':state.tab=id;await render({focus:false});return;
 case 'reschedule':{
  const booking=state.bookings.find(x=>x.id===id);if(!booking)return;
  state.changeId=id;state.original=booking;state.draft={clinicId:booking.clinicId,specialtyId:booking.specialtyId,professionalId:booking.professionalId};state.dateOffset=0;persistDraft();goto('time');return;
 }
 case 'abort-change':{const original=state.changeId;clearFlow();goto(`detail/${original}`);return;}
 case 'cancel':{
  const booking=state.bookings.find(x=>x.id===id);if(!booking)return;
  modal('Cancelar esta consulta?',`<p>${e(data.dateLabel(booking.date))}, às ${e(data.timeLabel(booking.time))}.<br>${e(data.professional(booking.professionalId).name)}.</p><p>Ao cancelar, o horário fica disponível para outra pessoa nesta demonstração.</p>`,button('Manter minha consulta','close-modal')+button('Sim, cancelar consulta','confirm-cancel','danger',`data-id="${id}"`));return;
 }
 case 'close-modal':dialog.close();return;
 case 'confirm-cancel':b.disabled=true;await repo.cancelBooking(state.user,id);dialog.close();message('Consulta cancelada. O horário foi liberado na demonstração.');await render();return;
 case 'font':state.prefs.scale=Number(id);preferences();await render({focus:false});announce('Tamanho das letras atualizado.');return;
 case 'reset-prefs':state.prefs={scale:1,contrast:false};preferences();await render({focus:false});return;
 case 'logout':await repo.signOut();clearFlow();goto('welcome');return;
 case 'delete-account':modal(state.remote?'Apagar sua conta online?':'Apagar esta conta local?',state.remote?'<p>Seu cadastro, sessões e consultas serão removidos do servidor. Não é possível desfazer.</p>':'<p>O cadastro e suas consultas serão removidos deste navegador. Não é possível desfazer.</p>',button('Manter minha conta','close-modal')+button('Apagar conta e consultas','confirm-delete-account','danger'));return;
 case 'confirm-delete-account':await repo.deleteAccount(state.user);dialog.close();clearFlow();goto('welcome');message(state.remote?'Conta e consultas removidas do servidor.':'Conta e consultas removidas deste navegador.');return;
 case 'download-recovery':download('Meu_codigo_de_recuperacao.txt',`Saúde na Palma da Mão - código de recuperação local\n\n${state.recovery}\n\nGuarde este código em segurança. Ele recupera sua conta online. Após usá-lo, um código novo será gerado e as sessões anteriores serão encerradas. Não envia SMS.\n`);return;
 case 'finish-signup':state.recovery='';goto('home');return;
 case 'export-account':{
  const u=state.user;download('Meus_dados_Saude_na_Palma.json',JSON.stringify({projeto:'Saúde na Palma da Mão',natureza:state.remote?'Dados da conta online acadêmica':'Dados locais da demonstração',exportadoEm:new Date().toISOString(),perfil:{nome:u.name,telefone:u.phone,nascimento:u.birth},consultas:state.bookings},null,2),'application/json');return;
 }
 case 'calendar':{
  const booking=state.bookings.find(x=>x.id===id);if(!booking)return;
  const iso=booking.date.replaceAll('-','')+'T'+booking.time.replace(':','')+'00';
  const dt=new Date(`${booking.date}T${booking.time}`);dt.setMinutes(dt.getMinutes()+30);const end=data.localISO(dt).replaceAll('-','')+'T'+String(dt.getHours()).padStart(2,'0')+String(dt.getMinutes()).padStart(2,'0')+'00';
  download('Consulta_demonstracao.ics',`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Saude na Palma//PWA Academica//PT-BR\r\nBEGIN:VEVENT\r\nUID:${booking.id}@saude-palma.local\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}\r\nDTSTART:${iso}\r\nDTEND:${end}\r\nSUMMARY:Demonstração - ${data.specialty(booking.specialtyId).name}\r\nDESCRIPTION:Agendamento fictício do projeto acadêmico. Não é consulta real.\r\nLOCATION:${data.clinic(booking.clinicId).name}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,'text/calendar;charset=utf-8');return;
 }
 case 'export-csv':{
  const rows=filteredSessions(state.filters),cols=['id','date','ageGroup','clinicId','outcome','step','validationErrors','invalidTaps','source'];
  const safe=x=>`"${String(x??'').replaceAll('"','""')}"`;
  download('Base_sintetica_recorte.csv','\uFEFF'+[cols.join(';'),...rows.map(r=>cols.map(k=>safe(r[k])).join(';'))].join('\r\n'),'text/csv;charset=utf-8');return;
 }
 case 'export-dictionary':download('Dicionario_base_sintetica.txt',`BASE SINTÉTICA ACADÊMICA - SAÚDE NA PALMA DA MÃO\nUma linha representa uma sessão fictícia. 180 sessões, distribuídas nos últimos 30 dias da data em que o painel é aberto. Geradas por regras determinísticas em js/data.js. Nenhum registro pertence a paciente real ou às 45.230 sessões dos slides.\n\nid: identificador único da sessão.\ndate: data ISO YYYY-MM-DD, usada no filtro de período.\nageGroup: 18–59 ou 60+; idade 60 incluída em 60+.\nclinicId: recanto, boa-viagem ou caxanga.\noutcome: concluido ou abandono.\nstep: última etapa: clinica, atendimento, horario, revisao ou concluido.\nvalidationErrors: número inteiro de erros de validação na sessão.\ninvalidTaps: número inteiro de toques inválidos na sessão.\nsource: identificação de origem sintética.\n\nTratamentos: IDs únicos, campos obrigatórios preenchidos, categorias e datas válidas por construção; exclusões não aplicadas.\nTaxa de abandono = sessões com outcome abandono / todas as sessões do recorte * 100.\nErros por sessão = soma validationErrors / total de sessões do recorte.\nAbandono por etapa é uma contagem, não taxa de conversão por etapa.\nFiltros de período, idade e clínica aplicados em conjunto antes dos cálculos.\nA exportação CSV contém o recorte exibido.\n\nAs ações reais realizadas neste navegador ficam separadas desse cenário e não são somadas aos indicadores sintéticos.\n`);return;
 case 'install-entry':
 case 'install':{
  if(state.installed)return;
  if(!state.installPrompt){goto('install');return;}
  const pending=state.installPrompt;state.installPrompt=null;b.disabled=true;
  try{await pending.prompt();const result=await pending.userChoice;if(result.outcome==='accepted')message('Instalação solicitada. Siga a confirmação do navegador.');}
  catch{goto('install');message('Veja como instalar pelo menu do seu navegador.');return;}
  await render({focus:false,refresh:false,loadSlots:false});return;
 }
 case 'check-pwa':await showPwaStatus();return;
 }
}

async function handleForm(form){
 clearErrors(form);const values=Object.fromEntries(new FormData(form));
 const phone=String(values.phone||'').replace(/\D/g,'');
 const badPhone=()=>!/^\d{10,11}$/.test(phone);
 const badBirth=()=>!/^\d{4}-\d{2}-\d{2}$/.test(values.birth)||values.birth<'1900-01-01'||values.birth>data.localISO()||data.age(values.birth)<18;
 if(['login-form','register-form','recover-form'].includes(form.id)&&badPhone()){error(form,'Digite o DDD e o número completo do telefone.','phone');return;}
 if(['register-form','profile-form'].includes(form.id)){
  if(String(values.name||'').trim().length<3){error(form,'Informe seu nome com pelo menos 3 caracteres.','name');return;}
  if(badBirth()){error(form,'Informe uma data válida. Esta demonstração é para pessoas com 18 anos ou mais.','birth');return;}
 }
 if(['register-form','recover-form'].includes(form.id)&&String(values.password||'').length<8){error(form,'Use uma senha com pelo menos 8 caracteres.','password');return;}
 if(form.id==='login-form'&&!values.password){error(form,'Digite sua senha para entrar.','password');return;}
 if(form.id==='register-form'&&!form.elements.terms.checked){error(form,'Leia e marque a concordância com os termos antes de continuar.','terms');return;}
 const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;
 try{
  if(form.id==='register-form'){const result=await repo.register({name:values.name.trim(),phone,birth:values.birth,password:values.password});state.recovery=result.recovery;clearFlow();goto('backup');}
  if(form.id==='login-form'){await repo.login(phone,values.password);clearFlow();goto('home');}
  if(form.id==='recover-form'){if(!String(values.recovery||'').trim())throw new Error('Informe seu código de recuperação.');const result=await repo.recover(phone,values.recovery,values.password);state.recovery=result.recovery;clearFlow();message('Senha atualizada. Guarde o novo código de recuperação.');goto('backup');}
  if(form.id==='profile-form'){await repo.updateProfile(state.user,{name:values.name.trim(),birth:values.birth});message('Seus dados foram atualizados.');goto('account');}
 }catch(err){error(form,err.message||'Não foi possível salvar. Tente novamente.');if(submit)submit.disabled=false;}
}

document.addEventListener('click',event=>{
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
 event.preventDefault();handleAction(b).catch(err=>{message(err.message||'Não foi possível concluir esta ação.');b.disabled=false;});
});
document.addEventListener('submit',event=>{const form=event.target;if(form.id==='dashboard-filters'){event.preventDefault();return;}if(form.id.endsWith('-form')){event.preventDefault();handleForm(form).catch(err=>error(form,err.message));}});
document.addEventListener('input',event=>{
 if(event.target.id==='clinic-search'){
  state.query=event.target.value;const result=clinicResults(state.query,state.draft);
  document.querySelector('#clinic-results').innerHTML=result.html;document.querySelector('#results-count').textContent=`${result.count} clínica${result.count===1?'':'s'} encontrada${result.count===1?'':'s'}`;
 }
});
document.addEventListener('change',event=>{
 if(event.target.id==='contrast'){state.prefs.contrast=event.target.checked;preferences();announce('Preferência de contraste salva.');}
 if(event.target.closest('#dashboard-filters')){const f=document.querySelector('#dashboard-filters');state.filters=Object.fromEntries(new FormData(f));render({focus:false});}
});
window.addEventListener('hashchange',()=>{if(dialog.open)dialog.close();render().catch(fatal);});
function refreshConnectivity(){
 const current=document.querySelector('.connection');
 if(navigator.onLine)current?.remove();
 else if(!current)document.querySelector('.demo-strip')?.insertAdjacentHTML('afterend',`<div class="connection">${icon('offline')}<span>${repo.isRemote()?'Sem internet · alterações na conta online indisponíveis':'Sem internet · demonstração local disponível'}</span></div>`);
 if(state.route==='install')showPwaStatus();
 announce(navigator.onLine?'Conexão disponível.':repo.isRemote()?'Sem internet. Conecte-se para alterar a conta online.':'Sem internet. A demonstração local continua disponível.');
}
window.addEventListener('online',()=>{refreshConnectivity();if(dataRoute(state.route))refreshAccount(true);else if(state.route==='time')render({focus:false});});window.addEventListener('offline',refreshConnectivity);
window.addEventListener('focus',()=>{if(dataRoute(state.route))refreshAccount();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&dataRoute(state.route))refreshAccount();});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();state.installPrompt=event;if(state.route==='install')render({focus:false});});
window.addEventListener('appinstalled',()=>{state.installPrompt=null;state.installed=true;message('Aplicativo instalado neste dispositivo.');render({focus:false,refresh:false,loadSlots:false}).catch(fatal);});
window.addEventListener('pageshow',()=>{if(state.user)render({focus:false});});
async function showPwaStatus(){
 const box=document.querySelector('#pwa-status');if(!box)return;
 const registration='serviceWorker' in navigator?await navigator.serviceWorker.getRegistration():null;
 const cached='caches' in window?(await caches.keys()).some(k=>k.startsWith('saude-palma-shell-')):false;
 const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 box.innerHTML=`<p><strong>Recursos offline:</strong> ${registration?.active&&cached?'prontos neste navegador.':'aguardando o primeiro carregamento completo.'}</p><p><strong>Modo de exibição:</strong> ${installed?'aplicativo instalado.':'aba do navegador.'}</p><p><strong>Conexão:</strong> ${navigator.onLine?'disponível.':'sem internet; dados locais disponíveis.'}</p>`;
}
async function setupWorker(){
 if(!('serviceWorker' in navigator))return;
 try{
  const registration=await navigator.serviceWorker.register('./sw.js');
  navigator.serviceWorker.addEventListener('controllerchange',()=>message('Versão atualizada disponível. Recarregue a página quando terminar o que está fazendo.'));
  if(registration.waiting)message('Uma nova versão está disponível. Feche as outras abas e abra o aplicativo novamente para atualizar.');
  registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&!navigator.serviceWorker.controller)announce('Aplicativo pronto para uso offline.');});});
 }catch{message('Não foi possível preparar o uso offline. Verifique a conexão e recarregue o aplicativo.');}
}
function fatal(err){app.innerHTML=`<main class="starting"><h1>Não conseguimos abrir seus dados.</h1><p>Verifique se o navegador permite armazenar dados deste site. Se estiver no modo privado, tente uma aba normal.</p><p class="hint">${e(err.message)}</p><button class="button" type="button" data-action="reload">Tentar novamente</button></main>`;}
try{if(!window.isSecureContext)throw new Error('Abra por HTTPS ou por localhost para usar os recursos do aplicativo.');await repo.init();preferences();await render();await setupWorker();}catch(err){fatal(err);}
