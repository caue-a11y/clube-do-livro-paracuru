-- Somente execução transacional de dados sintéticos; nunca abre coleta visível ao público.
begin;
do $test$
declare
  key uuid := gen_random_uuid();
  a jsonb := '{"q01_nome":"Pessoa Teste Transacional","q02_localizacao":"sim","q06_modelo_leitura":"mesmo_livro","q07_frequencia":"quinzenal","q08_modalidades":["presencial"],"q09_disponibilidade":{"mode":"fixa","slots":[{"day":"sab","period":"manha"}]},"q10_intencao":"regular","q13_autorizacao":"nao"}'::jsonb;
  first_result jsonb; replay_result jsonb;
  before_count bigint;
begin
  select count(*) into before_count from public.responses;
  update public.settings set open = true, responsible = 'Responsável sintético do teste', channel = 'privacidade@example.test', retention_days = 1, notice_version = 'teste-transacional' where singleton;
  first_result := public.clube_submit(a, '2026-10-28-v1-proposta', key, repeat('a',64));
  assert (select count(*) from public.responses) = before_count + 1, 'Registro não foi persistido na transação';
  assert first_result->>'protocol' like 'CL-%', 'Protocolo não retornado';
  update public.settings set open = false where singleton;
  replay_result := public.clube_submit(a, '2026-10-28-v1-proposta', key, repeat('a',64));
  assert first_result = replay_result, 'Replay diferente após fechamento';
  assert (select count(*) from public.responses) = before_count + 1, 'Replay duplicou resposta';
end $test$;
select true as insercao_transacional_validada, true as replay_apos_fechamento_validado;
rollback;
