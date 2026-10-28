-- Clube do Livro. Apply once through Supabase migrations, never from the browser.
-- No participant/admin fixtures, no public policies, and no embedded credentials.
begin;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.settings (
  singleton boolean primary key default true check (singleton),
  open boolean not null default false,
  responsible text check (char_length(responsible) between 1 and 200),
  channel text check (char_length(channel) between 1 and 300),
  retention_days integer check (retention_days between 1 and 3650),
  notice_version text,
  form_version text not null default '2026-10-28-v1-proposta',
  reading_year integer not null default 2026,
  revision bigint not null default 1 check (revision > 0),
  data_revision bigint not null default 1 check (data_revision > 0),
  updated_at timestamptz not null default now(),
  constraint privacy_before_open check (not open or (
    nullif(btrim(responsible), '') is not null and nullif(btrim(channel), '') is not null
    and retention_days is not null and nullif(btrim(notice_version), '') is not null
  ))
);
insert into public.settings(singleton) values (true);
create table public.responses (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique default ('CL-' || replace(gen_random_uuid()::text, '-', '')),
  idempotency_key uuid not null unique,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  form_version text not null,
  privacy_notice_version text not null,
  privacy_snapshot jsonb not null,
  received_at timestamptz not null default now(),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  status text not null default 'novo' check (status in ('novo','contatado','convidado_primeiro_encontro','confirmado_primeiro_encontro','nao_participara')),
  notes text not null default '' check (char_length(notes) <= 1000),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false check (not is_demo),
  constraint contact_consent check (
    answers->>'q13_autorizacao' is not null and answers->>'q13_autorizacao' in ('sim','nao')
    and case when answers->>'q13_autorizacao' = 'sim'
      then answers->'q14_contato' is not null and jsonb_typeof(answers->'q14_contato') = 'object'
        and answers->'q14_contato'->>'channel' is not null and answers->'q14_contato'->>'channel' in ('instagram','whatsapp')
        and answers->'q14_contato'->>'value' is not null and char_length(answers->'q14_contato'->>'value') between 1 and 100
      else not (answers ? 'q14_contato') end
  ),
  constraint status_consent check (status = 'novo' or answers->>'q13_autorizacao' = 'sim')
);
create index responses_received on public.responses(received_at desc, id desc);
create index responses_answers on public.responses using gin(answers jsonb_path_ops);
create index responses_status on public.responses(status);
create table public.admin_history (
  id bigint generated always as identity primary key,
  response_id uuid references public.responses(id) on delete cascade,
  action text not null check (action in ('status_notes','settings')),
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  before_status text,
  after_status text,
  notes_changed boolean not null default false,
  confirmation_asserted boolean not null default false,
  before_open boolean,
  after_open boolean,
  revision bigint not null,
  constraint history_target check ((action = 'settings' and response_id is null) or (action = 'status_notes' and response_id is not null))
);
create index history_response on public.admin_history(response_id, occurred_at, id);
-- Random IDs only. No protocol, hash, name, answers, contact, notes, IP or user agent.
-- Retain restricted tombstones until all backups capable of restoring the row expire.
create table public.deletion_log (
  response_id uuid primary key,
  idempotency_key uuid not null unique,
  deleted_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null
);
-- Aggregate fixed-window counters, never identity/IP based. At most a few rows.
create table public.abuse_windows (
  scope text primary key check (scope in ('new_submission', 'public_config')),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);

alter table public.responses enable row level security;
alter table public.responses force row level security;
alter table public.admin_users enable row level security;
alter table public.admin_users force row level security;
alter table public.settings enable row level security;
alter table public.settings force row level security;
alter table public.admin_history enable row level security;
alter table public.admin_history force row level security;
alter table public.deletion_log enable row level security;
alter table public.deletion_log force row level security;
alter table public.abuse_windows enable row level security;
alter table public.abuse_windows force row level security;
revoke all on table public.responses, public.admin_users, public.settings, public.admin_history, public.deletion_log, public.abuse_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.responses, public.admin_users, public.settings, public.admin_history, public.deletion_log, public.abuse_windows to service_role;
revoke all on sequence public.admin_history_id_seq from public, anon, authenticated;
grant usage, select on sequence public.admin_history_id_seq to service_role;

-- All functions are SECURITY INVOKER, with an empty search path. Only service_role
-- has EXECUTE. Auth users never call them directly even if allowlisted.
create function public.clube_assert_admin(p_actor uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_actor is null or not exists(select 1 from public.admin_users where user_id = p_actor) then
    raise sqlstate 'PT403' using message = 'Administrador não autorizado.';
  end if;
end $$;
create function public.clube_rate(p_scope text) returns void
language plpgsql security invoker set search_path = '' as $$
declare n integer; maximum integer; stamp timestamptz := date_trunc('minute', clock_timestamp());
begin
  maximum := case p_scope when 'new_submission' then 60 when 'public_config' then 600 else null end;
  if maximum is null then raise sqlstate 'PT400' using message = 'Escopo inválido.'; end if;
  insert into public.abuse_windows(scope, window_start, attempts) values(p_scope, stamp, 1)
    on conflict(scope) do update set window_start = stamp,
      attempts = case when public.abuse_windows.window_start = stamp then public.abuse_windows.attempts + 1 else 1 end
    returning attempts into n;
  if n > maximum then raise sqlstate 'PT429' using message = 'Muitas tentativas. Aguarde um minuto.'; end if;
end $$;
create function public.clube_public_config() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s public.settings;
begin
  perform public.clube_rate('public_config');
  select * into strict s from public.settings where singleton;
  return jsonb_build_object('open', s.open, 'form_version', s.form_version,
    'privacy', jsonb_build_object('responsible', s.responsible, 'channel', s.channel,
      'retention_days', s.retention_days, 'notice_version', s.notice_version));
end $$;
create function public.clube_submit(p_answers jsonb, p_form_version text, p_idempotency_key uuid, p_payload_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.responses; s public.settings;
begin
  if p_idempotency_key is null or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise sqlstate 'PT400' using message = 'Envio inválido.';
  end if;
  -- Serialize the same random attempt, including simultaneous requests/timeout replay.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  if exists(select 1 from public.deletion_log where idempotency_key = p_idempotency_key) then
    raise sqlstate 'PT409' using message = 'Esta resposta foi excluída. Não reenvie esta tentativa.';
  end if;
  select * into r from public.responses where idempotency_key = p_idempotency_key;
  if found then
    if r.payload_hash <> p_payload_hash then raise sqlstate 'PT409' using message = 'Esta chave já foi usada com respostas diferentes.'; end if;
    -- Replay precedes closed-collection and rate checks.
    return jsonb_build_object('protocol', r.protocol, 'received_at', r.received_at);
  end if;
  select * into strict s from public.settings where singleton for update;
  if not s.open then raise sqlstate 'PT409' using message = 'A coleta está encerrada.'; end if;
  if p_form_version is distinct from s.form_version then raise sqlstate 'PT400' using message = 'Versão do formulário desatualizada.'; end if;
  perform public.clube_rate('new_submission');
  -- Defense in depth: discard unauthorized contact even from a trusted caller.
  if p_answers->>'q13_autorizacao' is distinct from 'sim' then p_answers := p_answers - 'q14_contato'; end if;
  insert into public.responses(answers, form_version, idempotency_key, payload_hash, privacy_notice_version, privacy_snapshot)
    values(p_answers, p_form_version, p_idempotency_key, p_payload_hash, s.notice_version,
      jsonb_build_object('responsible', s.responsible, 'channel', s.channel, 'retention_days', s.retention_days, 'notice_version', s.notice_version))
    returning * into r;
  update public.settings set data_revision = data_revision + 1 where singleton;
  return jsonb_build_object('protocol', r.protocol, 'received_at', r.received_at);
end $$;
create function public.clube_detail(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.responses; h jsonb;
begin
  perform public.clube_assert_admin(p_actor);
  select * into r from public.responses where id = p_id;
  if not found then raise sqlstate 'PT404' using message = 'Resposta não encontrada.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at, x.id), '[]'::jsonb) into h from public.admin_history x where response_id = p_id;
  return (to_jsonb(r) - 'idempotency_key' - 'payload_hash') || jsonb_build_object('history', h);
end $$;
create function public.clube_update(p_actor uuid, p_id uuid, p_revision bigint, p_status text, p_notes text, p_confirmed boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.responses;
begin
  perform public.clube_assert_admin(p_actor);
  -- Same lock order as submit/delete/export so generation checks are atomic.
  perform 1 from public.settings where singleton for update;
  select * into r from public.responses where id = p_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Resposta não encontrada.'; end if;
  if p_revision is distinct from r.revision then raise sqlstate 'PT409' using message = 'A resposta foi alterada. Recarregue antes de salvar.'; end if;
  if p_status is null or p_status not in ('novo','contatado','convidado_primeiro_encontro','confirmado_primeiro_encontro','nao_participara')
    or p_notes is null or char_length(p_notes) > 1000 or p_confirmed is null then
    raise sqlstate 'PT400' using message = 'Status ou observação inválidos.';
  end if;
  if p_status <> 'novo' and r.answers->>'q13_autorizacao' is distinct from 'sim' then
    raise sqlstate 'PT400' using message = 'Acompanhamento exige contato autorizado.';
  end if;
  if p_status = 'confirmado_primeiro_encontro' and not p_confirmed then
    raise sqlstate 'PT400' using message = 'Confirme que houve retorno real do interessado.';
  end if;
  update public.responses set status = p_status, notes = p_notes, revision = revision + 1, updated_at = clock_timestamp() where id = p_id;
  insert into public.admin_history(response_id, actor_id, action, before_status, after_status, notes_changed, confirmation_asserted, revision)
    values(p_id, p_actor, 'status_notes', r.status, p_status, r.notes is distinct from p_notes, p_confirmed, r.revision + 1);
  update public.settings set data_revision = data_revision + 1 where singleton;
  return public.clube_detail(p_actor, p_id);
end $$;
create function public.clube_delete(p_actor uuid, p_id uuid, p_revision bigint, p_confirm_protocol text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.responses;
begin
  perform public.clube_assert_admin(p_actor);
  perform 1 from public.settings where singleton for update;
  select * into r from public.responses where id = p_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Resposta não encontrada.'; end if;
  if p_revision is distinct from r.revision then raise sqlstate 'PT409' using message = 'A resposta foi alterada. Recarregue antes de excluir.'; end if;
  if p_confirm_protocol is distinct from r.protocol then raise sqlstate 'PT400' using message = 'Protocolo de confirmação não corresponde.'; end if;
  insert into public.deletion_log(response_id, idempotency_key, actor_id) values(r.id, r.idempotency_key, p_actor);
  delete from public.responses where id = p_id; -- cascades linked administrative history
  update public.settings set data_revision = data_revision + 1 where singleton;
  return jsonb_build_object('deleted', true);
end $$;
create function public.clube_settings(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s public.settings;
begin
  perform public.clube_assert_admin(p_actor);
  select * into strict s from public.settings where singleton;
  return (to_jsonb(s) - 'singleton' - 'data_revision') || jsonb_build_object('privacy',
    jsonb_build_object('responsible', s.responsible, 'channel', s.channel, 'retention_days', s.retention_days, 'notice_version', s.notice_version));
end $$;
create function public.clube_settings_update(p_actor uuid, p_revision bigint, p_open boolean, p_responsible text, p_channel text, p_retention_days integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s public.settings; notice text;
begin
  perform public.clube_assert_admin(p_actor);
  select * into strict s from public.settings where singleton for update;
  if p_revision is distinct from s.revision then raise sqlstate 'PT409' using message = 'A configuração foi alterada. Recarregue antes de salvar.'; end if;
  p_responsible := nullif(btrim(p_responsible), ''); p_channel := nullif(btrim(p_channel), '');
  if p_open is null or char_length(p_responsible) > 200 or char_length(p_channel) > 300
    or (p_retention_days is not null and p_retention_days not between 1 and 3650)
    or (p_open and (p_responsible is null or p_channel is null or p_retention_days is null)) then
    raise sqlstate 'PT400' using message = 'Preencha os dados reais de privacidade antes de abrir.';
  end if;
  -- Fixed notice template + monotonically versioned operational privacy data.
  -- Every response stores the exact privacy snapshot presented at collection time.
  notice := s.notice_version;
  if (p_responsible, p_channel, p_retention_days) is distinct from (s.responsible, s.channel, s.retention_days) then
    notice := case when p_responsible is not null and p_channel is not null and p_retention_days is not null
      then 'privacidade-v1-r' || (s.revision + 1)::text else null end;
  end if;
  update public.settings set open = p_open, responsible = p_responsible, channel = p_channel,
    retention_days = p_retention_days, notice_version = notice, revision = revision + 1, updated_at = clock_timestamp() where singleton;
  insert into public.admin_history(actor_id, action, before_open, after_open, revision)
    values(p_actor, 'settings', s.open, p_open, s.revision + 1);
  return public.clube_settings(p_actor);
end $$;

-- Internal filter helper; Edge validates all keys/enums before calling the public RPC.
-- No string-built SQL and literal substring search (%, _ and backslash are not wildcards).
create function public.clube_filtered(p_filters jsonb) returns setof public.responses
language sql stable security invoker set search_path = '' as $$
  select r.* from public.responses r
  where (not (p_filters ? 'search') or strpos(lower(r.answers->>'q01_nome'), lower(p_filters->>'search')) > 0)
  and (not (p_filters ? 'from') or r.received_at >= ((p_filters->>'from')::date::timestamp at time zone 'America/Sao_Paulo'))
  and (not (p_filters ? 'to') or r.received_at < (((p_filters->>'to')::date + 1)::timestamp at time zone 'America/Sao_Paulo'))
  and (not (p_filters ? 'localizacao') or p_filters->'localizacao' ? (r.answers->>'q02_localizacao'))
  and (not (p_filters ? 'intencao') or p_filters->'intencao' ? (r.answers->>'q10_intencao'))
  and (not (p_filters ? 'modelo') or p_filters->'modelo' ? (r.answers->>'q06_modelo_leitura'))
  and (not (p_filters ? 'frequencia') or p_filters->'frequencia' ? (r.answers->>'q07_frequencia'))
  and (not (p_filters ? 'autorizacao') or p_filters->'autorizacao' ? (r.answers->>'q13_autorizacao'))
  and (not (p_filters ? 'status') or p_filters->'status' ? r.status)
  and (not (p_filters ? 'generos') or (r.answers->'q05_generos') ?| array(select jsonb_array_elements_text(p_filters->'generos')))
  and (not (p_filters ? 'modalidades') or (r.answers->'q08_modalidades') ?| array(select jsonb_array_elements_text(p_filters->'modalidades')))
  and (not (p_filters ? 'slot') or case when p_filters->>'slot' = 'variavel'
    then r.answers->'q09_disponibilidade'->>'mode' = 'variavel'
    else r.answers->'q09_disponibilidade'->>'mode' = 'fixa'
      and r.answers->'q09_disponibilidade'->'slots' @> jsonb_build_array(jsonb_build_object(
        'day', split_part(p_filters->>'slot', ':', 1), 'period', split_part(p_filters->>'slot', ':', 2))) end)
$$;
create function public.clube_list(p_actor uuid, p_filters jsonb default '{}'::jsonb, p_page integer default 1, p_page_size integer default 50) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  perform public.clube_assert_admin(p_actor);
  if p_page is null or p_page < 1 or p_page > 1000000 or p_page_size is null or p_page_size not between 1 and 100
    or p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise sqlstate 'PT400' using message = 'Consulta inválida.'; end if;
  with filtered as materialized (select * from public.clube_filtered(p_filters)),
  page_rows as (select id, protocol, received_at, answers - 'q14_contato' as answers, status, revision
    from filtered order by received_at desc, id desc limit p_page_size offset ((p_page::bigint - 1) * p_page_size))
  select jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(p) order by p.received_at desc, p.id desc) from page_rows p), '[]'::jsonb),
    'total', (select count(*) from filtered), 'page', p_page, 'page_size', p_page_size) into result;
  return result;
end $$;
-- Keyset export, <=500 filtered records/request. Edge builds CSV, never accumulates
-- the base as records. Generation invalidation rejects a concurrent edit/insert/delete
-- rather than returning a subtly incomplete or mixed-snapshot CSV.
create function public.clube_export_page(p_actor uuid, p_filters jsonb default '{}'::jsonb, p_after uuid default null, p_generation bigint default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare generation bigint; result jsonb;
begin
  perform public.clube_assert_admin(p_actor);
  select data_revision into strict generation from public.settings where singleton for share;
  if p_generation is not null and p_generation <> generation then raise sqlstate 'PT409' using message = 'A base mudou durante a exportação. Tente novamente.'; end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise sqlstate 'PT400' using message = 'Filtros inválidos.'; end if;
  with page_rows as (select id, protocol, received_at, answers, status, form_version, privacy_notice_version
    from public.clube_filtered(p_filters) where p_after is null or id > p_after order by id limit 500)
  select jsonb_build_object('generation', generation, 'items', coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)) into result from page_rows p;
  return result;
end $$;

-- Default Postgres grants EXECUTE to PUBLIC: explicitly revoke every created signature.
revoke all on function public.clube_assert_admin(uuid), public.clube_rate(text), public.clube_public_config(),
  public.clube_submit(jsonb,text,uuid,text), public.clube_detail(uuid,uuid), public.clube_update(uuid,uuid,bigint,text,text,boolean),
  public.clube_delete(uuid,uuid,bigint,text), public.clube_settings(uuid), public.clube_settings_update(uuid,bigint,boolean,text,text,integer),
  public.clube_filtered(jsonb), public.clube_list(uuid,jsonb,integer,integer), public.clube_export_page(uuid,jsonb,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.clube_assert_admin(uuid), public.clube_rate(text), public.clube_public_config(),
  public.clube_submit(jsonb,text,uuid,text), public.clube_detail(uuid,uuid), public.clube_update(uuid,uuid,bigint,text,text,boolean),
  public.clube_delete(uuid,uuid,bigint,text), public.clube_settings(uuid), public.clube_settings_update(uuid,bigint,boolean,text,text,integer),
  public.clube_filtered(jsonb), public.clube_list(uuid,jsonb,integer,integer), public.clube_export_page(uuid,jsonb,uuid,bigint)
  to service_role;
commit;
