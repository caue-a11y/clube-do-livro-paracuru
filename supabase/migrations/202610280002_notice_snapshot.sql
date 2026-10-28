-- Vincula o aviso exibido pela interface ao snapshot salvo, sem invalidar replay confirmado.
begin;
create function public.clube_submit_with_notice(p_answers jsonb, p_form_version text, p_idempotency_key uuid, p_payload_hash text, p_notice_version text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s public.settings;
begin
  if p_idempotency_key is null then raise sqlstate 'PT400' using message = 'Tentativa inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  if exists(select 1 from public.responses where idempotency_key = p_idempotency_key) then
    return public.clube_submit(p_answers, p_form_version, p_idempotency_key, p_payload_hash);
  end if;
  select * into strict s from public.settings where singleton for update;
  if not s.open then return public.clube_submit(p_answers, p_form_version, p_idempotency_key, p_payload_hash); end if;
  if p_notice_version is distinct from s.notice_version or p_notice_version is null then
    raise sqlstate 'PT409' using message = 'O aviso de privacidade mudou. Confira a versão atual antes de enviar.';
  end if;
  return public.clube_submit(p_answers, p_form_version, p_idempotency_key, p_payload_hash);
end $$;
revoke all on function public.clube_submit_with_notice(jsonb,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.clube_submit_with_notice(jsonb,text,uuid,text,text) to service_role;
commit;
