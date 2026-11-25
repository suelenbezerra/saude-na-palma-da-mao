-- Projeto acadêmico Saúde na Palma da Mão. Executar somente no projeto Supabase destinado a esta aplicação.
begin;
create table public.spm_users (
 id uuid primary key, name text not null check(char_length(name) between 3 and 120),
 phone text not null unique check(phone ~ '^[0-9]{10,11}$'), birth date not null,
 password_hash text not null, recovery_hash text not null,
 created_at timestamptz not null default now()
);
create table public.spm_sessions (
 token_hash text primary key, user_id uuid not null references public.spm_users(id) on delete cascade,
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index spm_sessions_user on public.spm_sessions(user_id);
create index spm_sessions_expiry on public.spm_sessions(expires_at);
create table public.spm_bookings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.spm_users(id) on delete cascade,
 clinic_id text not null, specialty_id text not null, professional_id text not null,
 date date not null, time text not null check(time ~ '^[0-2][0-9]:[0-5][0-9]$'),
 status text not null default 'scheduled' check(status in ('scheduled','cancelled')),
 previous jsonb not null default '[]'::jsonb check(jsonb_typeof(previous)='array'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index spm_bookings_user_date on public.spm_bookings(user_id,date,time);
create unique index spm_unique_professional_slot on public.spm_bookings(professional_id,date,time) where status='scheduled';
create unique index spm_unique_patient_slot on public.spm_bookings(user_id,date,time) where status='scheduled';
create table public.spm_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.spm_users(id) on delete cascade,
 type text not null check(type in ('inicio_agendamento','agendamento','reagendamento','cancelamento')),
 at timestamptz not null default now()
);
create index spm_events_user on public.spm_events(user_id,at);
create table public.spm_rate_limits (key_hash text primary key, count integer not null, resets_at timestamptz not null);
create index spm_rate_limits_expiry on public.spm_rate_limits(resets_at);
alter table public.spm_users enable row level security;
alter table public.spm_sessions enable row level security;
alter table public.spm_bookings enable row level security;
alter table public.spm_events enable row level security;
alter table public.spm_rate_limits enable row level security;
-- Sem políticas públicas: somente o backend usa service_role. A API autentica e filtra o proprietário em cada operação.
revoke all on public.spm_users,public.spm_sessions,public.spm_bookings,public.spm_events,public.spm_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on public.spm_users,public.spm_sessions,public.spm_bookings,public.spm_events,public.spm_rate_limits to service_role;

create function public.spm_rate_limit(p_key text,p_max integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.spm_rate_limits(key_hash,count,resets_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
 on conflict(key_hash) do update set count=case when spm_rate_limits.resets_at<=now() then 1 else spm_rate_limits.count+1 end,
 resets_at=case when spm_rate_limits.resets_at<=now() then now()+make_interval(secs=>p_seconds) else spm_rate_limits.resets_at end
 returning count into n;
 delete from public.spm_rate_limits where resets_at<now()-interval '1 day';
 delete from public.spm_sessions where expires_at<now();
 return n<=p_max;
end $$;

create function public.spm_register(p_user jsonb,p_session jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=(p_user->>'id')::uuid;
begin
 insert into public.spm_users(id,name,phone,birth,password_hash,recovery_hash)
 values(uid,p_user->>'name',p_user->>'phone',(p_user->>'birth')::date,p_user->>'password_hash',p_user->>'recovery_hash');
 insert into public.spm_sessions(token_hash,user_id,expires_at) values(p_session->>'token_hash',uid,(p_session->>'expires_at')::timestamptz);
 return uid;
end $$;

create function public.spm_recover(p_user uuid,p_expected text,p_password text,p_recovery text,p_session jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.spm_users where id=p_user and recovery_hash=p_expected for update;
 if not found then return false; end if;
 update public.spm_users set password_hash=p_password,recovery_hash=p_recovery where id=p_user;
 delete from public.spm_sessions where user_id=p_user;
 insert into public.spm_sessions(token_hash,user_id,expires_at) values(p_session->>'token_hash',p_user,(p_session->>'expires_at')::timestamptz);
 return true;
end $$;

create function public.spm_save_booking(p_user uuid,p_data jsonb,p_id uuid default null) returns public.spm_bookings
language plpgsql security invoker set search_path='' as $$
declare old public.spm_bookings; result public.spm_bookings;
begin
 -- Serializa reservas da mesma pessoa. Os índices únicos resolvem disputas entre pessoas diferentes.
 perform 1 from public.spm_users where id=p_user for update;
 if not found then raise exception 'user_missing' using errcode='P0002'; end if;
 if p_id is not null then
  select * into old from public.spm_bookings where id=p_id and user_id=p_user and status='scheduled' for update;
  if not found or (old.date+old.time::time)<=timezone('America/Recife',now()) then
   raise exception 'booking_unavailable' using errcode='P0002';
  end if;
  update public.spm_bookings set clinic_id=p_data->>'clinicId',specialty_id=p_data->>'specialtyId',professional_id=p_data->>'professionalId',
   date=(p_data->>'date')::date,time=p_data->>'time',updated_at=now(),previous=old.previous||jsonb_build_array(jsonb_build_object('date',old.date,'time',old.time))
   where id=p_id and user_id=p_user returning * into result;
 else
  insert into public.spm_bookings(user_id,clinic_id,specialty_id,professional_id,date,time)
   values(p_user,p_data->>'clinicId',p_data->>'specialtyId',p_data->>'professionalId',(p_data->>'date')::date,p_data->>'time') returning * into result;
 end if;
 insert into public.spm_events(user_id,type) values(p_user,case when p_id is null then 'agendamento' else 'reagendamento' end);
 return result;
end $$;

create function public.spm_cancel_booking(p_user uuid,p_id uuid) returns public.spm_bookings
language plpgsql security invoker set search_path='' as $$
declare result public.spm_bookings;
begin
 update public.spm_bookings set status='cancelled',updated_at=now()
 where id=p_id and user_id=p_user and status='scheduled' and (date+time::time)>timezone('America/Recife',now()) returning * into result;
 if not found then raise exception 'booking_unavailable' using errcode='P0002'; end if;
 insert into public.spm_events(user_id,type) values(p_user,'cancelamento');
 return result;
end $$;

revoke all on function public.spm_rate_limit(text,integer,integer),public.spm_register(jsonb,jsonb),public.spm_recover(uuid,text,text,text,jsonb),public.spm_save_booking(uuid,jsonb,uuid),public.spm_cancel_booking(uuid,uuid) from public,anon,authenticated;
grant execute on function public.spm_rate_limit(text,integer,integer),public.spm_register(jsonb,jsonb),public.spm_recover(uuid,text,text,text,jsonb),public.spm_save_booking(uuid,jsonb,uuid),public.spm_cancel_booking(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
