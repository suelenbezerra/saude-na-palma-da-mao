export const clinics = [
 { id:'recanto',name:'Clínica Recanto da Saúde',district:'Boa Viagem',city:'Recife',address:'Rua das Palmeiras, 120',access:'Entrada sem degraus',specialties:['geral','cardio','orto','dermato'] },
 { id:'boa-viagem',name:'Unidade Boa Viagem',district:'Boa Viagem',city:'Recife',address:'Avenida do Cuidado, 240',access:'Próxima ao transporte público',specialties:['geral','cardio','dermato'] },
 { id:'caxanga',name:'Centro Médico Caxangá',district:'Caxangá',city:'Recife',address:'Avenida dos Encontros, 85',access:'Acesso por elevador',specialties:['geral','orto'] }
];
export const specialties=[
 {id:'geral',name:'Clínica geral',description:'Consultas de cuidado geral'},
 {id:'cardio',name:'Cardiologia',description:'Cuidados com o coração'},
 {id:'orto',name:'Ortopedia',description:'Cuidados com ossos e articulações'},
 {id:'dermato',name:'Dermatologia',description:'Cuidados com pele, cabelos e unhas'}
];
export const professionals=[
 {id:'helena',name:'Dra. Helena Prado',initials:'HP',specialty:'cardio',clinics:['recanto','boa-viagem']},
 {id:'rafael',name:'Dr. Rafael Menezes',initials:'RM',specialty:'cardio',clinics:['recanto']},
 {id:'ana',name:'Dra. Ana Fontes',initials:'AF',specialty:'cardio',clinics:['boa-viagem']},
 {id:'clara',name:'Dra. Clara Nunes',initials:'CN',specialty:'geral',clinics:['recanto','boa-viagem','caxanga']},
 {id:'paulo',name:'Dr. Paulo Freitas',initials:'PF',specialty:'geral',clinics:['recanto','caxanga']},
 {id:'marcos',name:'Dr. Marcos Andrade',initials:'MA',specialty:'orto',clinics:['recanto','caxanga']},
 {id:'lucia',name:'Dra. Lúcia Costa',initials:'LC',specialty:'dermato',clinics:['recanto','boa-viagem']}
];
export const times=['09:00','09:30','10:00','10:45','14:00','15:30'];
export const lookup=(list,id)=>list.find(x=>x.id===id);
export const clinic=id=>lookup(clinics,id);
export const specialty=id=>lookup(specialties,id);
export const professional=id=>lookup(professionals,id);
export function localISO(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function dateObject(iso){return new Date(`${iso}T12:00:00`);}
export function dates(){let result=[],d=new Date();d.setHours(12,0,0,0);while(result.length<18){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)result.push(localISO(d));}return result;}
export function dateLabel(iso,short=false){return dateObject(iso).toLocaleDateString('pt-BR',short?{weekday:'short',day:'numeric',month:'short'}:{weekday:'long',day:'numeric',month:'long',year:'numeric'});}
export const timeLabel=t=>t.replace(':00','h').replace(':','h');
export function age(birth){const now=new Date(),d=dateObject(birth);let n=now.getFullYear()-d.getFullYear();if(now.getMonth()<d.getMonth()||(now.getMonth()===d.getMonth()&&now.getDate()<d.getDate()))n--;return n;}
export function availableTimes(profId,date,bookings=[],excluding=null){
 // Availability is a deterministic academic scenario, never a real clinic calendar.
 const day=dateObject(date).getDate(),p=professional(profId);
 if(!p||date<localISO()||day%11===0)return [];
 return times.filter((time,i)=>(day+p.id.length+i)%7!==0&&!bookings.some(b=>b.id!==excluding&&b.status==='scheduled'&&b.professionalId===profId&&b.date===date&&b.time===time));
}
export function syntheticSessions(){
 const result=[],today=new Date();today.setHours(12,0,0,0);
 for(let i=0;i<180;i++){
  const d=new Date(today);d.setDate(d.getDate()-(i%30));
  const older=i%3===0,converted=i%10> (older?3:1),step=converted?'concluido':['clinica','atendimento','horario','revisao'][i%4];
  result.push({id:`sintetica-${i+1}`,date:localISO(d),ageGroup:older?'60+':'18–59',clinicId:clinics[Math.floor(i/3)%3].id,outcome:converted?'concluido':'abandono',step,validationErrors:older?i%4:i%2,invalidTaps:older?i%6:i%3,source:'Cenário sintético acadêmico'});
 }
 return result;
}
