// Real PostgreSQL 17 semantics in optional PGlite WASM runtime, never a hosted base.
// Download instructions: supabase/README.md. No fixtures are sent to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { payloadHash } from '../supabase/functions/clube-api/domain.mjs';
const runtime = process.env.PGLITE_MODULE || new URL('./backend-runtime/index.cjs', import.meta.url).pathname;
const actor = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const sample = (name='Ana', authorized=false) => ({q01_nome:name,q02_localizacao:'sim',q03_livros_ano:'1_3',q06_modelo_leitura:'alternar',q07_frequencia:'quinzenal',q08_modalidades:['online','alternado'],q05_generos:['ciencia','suspense'],q09_disponibilidade:{mode:'fixa',slots:[{day:'sab',period:'manha'},{day:'dom',period:'noite'}]},q10_intencao:'regular',q13_autorizacao:authorized?'sim':'nao',...(authorized?{q14_contato:{channel:'instagram',value:'leitora'}}:{})});

test('migration and transactional RPCs on actual PostgreSQL (PGlite)', { skip: !existsSync(runtime), timeout: 120000 }, async t => {
  const { PGlite } = createRequire(import.meta.url)(runtime);
  const db = new PGlite();
  const query = async (sql, params=[]) => (await db.query(sql,params)).rows;
  const call = async (name,args=[]) => (await query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as result`,args))[0].result;
  const sqlError = async (fn,code) => {
    await db.exec('savepoint expected_failure');
    try { await assert.rejects(fn,e=>e.code===code); }
    finally { await db.exec('rollback to expected_failure; release expected_failure'); }
  };
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema public to anon, authenticated, service_role;');
    await db.exec(readFileSync(new URL('../supabase/migrations/202610280001_clube.sql', import.meta.url),'utf8'));
    await db.exec(`begin; insert into auth.users(id) values('${actor}'),('${stranger}'); insert into public.admin_users(user_id) values('${actor}'); set local role service_role;`);
    await t.test('closed initial state, null privacy, empty real base',async()=>{
      const config=await call('clube_public_config'); assert.equal(config.open,false); assert.deepEqual(config.privacy,{responsible:null,channel:null,retention_days:null,notice_version:null});
      assert.equal((await query('select count(*)::int as n from public.responses'))[0].n,0);
    });
    await t.test('RLS and EXECUTE deny public/anon/authenticated, service only',async()=>{
      const grants=await query(`select p.proname, has_function_privilege('anon',p.oid,'execute') as anon, has_function_privilege('authenticated',p.oid,'execute') as authenticated from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'clube_%'`);
      assert.equal(grants.length,12); assert.ok(grants.every(r=>!r.anon&&!r.authenticated));
      for(const role of ['anon','authenticated']) {
        await sqlError(async()=>{await db.exec(`set local role ${role}`);await query('select * from public.responses');},'42501');
        await sqlError(async()=>{await db.exec(`set local role ${role}`);await call('clube_public_config');},'42501');
      }
      const policies=await query("select count(*)::int as n from pg_policies where schemaname='public'"); assert.equal(policies[0].n,0);
    });
    await t.test('SQL allowlist + privacy prerequisite + revision CAS',async()=>{
      await sqlError(()=>call('clube_settings',[stranger]),'PT403');
      await sqlError(()=>call('clube_settings_update',[actor,1,true,null,null,null]),'PT400');
      const config=await call('clube_settings_update',[actor,1,true,'Responsável de teste','privacidade@example.test',30]);
      assert.equal(config.open,true); assert.equal(config.revision,2); assert.equal(config.notice_version,'privacidade-v1-r2');
      await sqlError(()=>call('clube_settings_update',[actor,1,false,null,null,null]),'PT409');
    });
    const key1=crypto.randomUUID(), key2=crypto.randomUUID(); const answers1=sample('Ana');
    const hash1=await payloadHash(answers1); let first, second;
    await t.test('atomic insert, server date/protocol, consent stripping, same-key idempotency',async()=>{
      first=await call('clube_submit',[{...answers1,q14_contato:{channel:'instagram',value:'must-be-discarded'}},'2026-10-28-v1-proposta',key1,hash1]);
      assert.match(first.protocol,/^CL-[a-f0-9]{32}$/); assert.ok(first.received_at);
      const replay=await call('clube_submit',[answers1,'2026-10-28-v1-proposta',key1,hash1]); assert.deepEqual(replay,first);
      assert.equal((await query('select count(*)::int as n from public.responses'))[0].n,1);
      assert.equal((await query('select answers from public.responses'))[0].answers.q14_contato,undefined);
      await sqlError(()=>call('clube_submit',[sample('Outra'),'2026-10-28-v1-proposta',key1,'f'.repeat(64)]),'PT409');
    });
    await t.test('closed collection preserves existing replay, blocks new attempts',async()=>{
      await call('clube_settings_update',[actor,2,false,'Responsável de teste','privacidade@example.test',30]);
      assert.deepEqual(await call('clube_submit',[answers1,'2026-10-28-v1-proposta',key1,hash1]),first);
      await sqlError(()=>call('clube_submit',[sample('Nova'),'2026-10-28-v1-proposta',crypto.randomUUID(),'0'.repeat(64)]),'PT409');
      await call('clube_settings_update',[actor,3,true,'Responsável de teste','privacidade@example.test',30]);
    });
    const one=async()=> (await query('select id from public.responses where idempotency_key=$1',[key1]))[0].id;
    await t.test('status CAS, contact authorization, explicit confirmation, history without notes text',async()=>{
      const id=await one();
      await sqlError(()=>call('clube_update',[actor,id,1,'contatado','',false]),'PT400');
      const answers2=sample('Bruna',true); second=await call('clube_submit',[answers2,'2026-10-28-v1-proposta',key2,await payloadHash(answers2)]);
      const id2=(await query('select id from public.responses where idempotency_key=$1',[key2]))[0].id;
      await sqlError(()=>call('clube_update',[actor,id2,1,'confirmado_primeiro_encontro','private notes',false]),'PT400');
      const updated=await call('clube_update',[actor,id2,1,'confirmado_primeiro_encontro','private notes',true]);
      assert.equal(updated.revision,2); assert.equal(updated.history.length,1); assert.equal(updated.history[0].confirmation_asserted,true);
      assert.ok(!JSON.stringify(updated.history).includes('private notes'));
      await sqlError(()=>call('clube_update',[actor,id2,1,'contatado','overwrite',false]),'PT409');
      const corrected=await call('clube_update',[actor,id2,2,'novo','corrected',false]); assert.equal(corrected.history.length,2);
    });
    await t.test('SQL recortes AND across/OR within, timezone edges and sanitized list',async()=>{
      // Synthetic instants are modified ONLY inside this transaction/ephemeral test DB.
      await query("update public.responses set received_at='2026-10-28T02:59:59Z' where idempotency_key=$1",[key1]);
      await query("update public.responses set received_at='2026-10-28T03:00:00Z' where idempotency_key=$1",[key2]);
      const all=await call('clube_list',[actor,{},1,1]); assert.equal(all.total,2); assert.equal(all.items.length,1); assert.equal(all.items[0].answers.q14_contato,undefined);
      const next=await call('clube_list',[actor,{},2,1]); assert.notEqual(next.items[0].id,all.items[0].id);
      const date=await call('clube_list',[actor,{from:'2026-10-28',to:'2026-10-28'},1,100]); assert.equal(date.total,1); assert.equal(date.items[0].protocol,second.protocol);
      const filters={generos:['suspense','biografias'],modalidades:['online'],localizacao:['sim','nao_posso_ir'],slot:'sab:manha',search:'bruna',autorizacao:['sim']};
      const filtered=await call('clube_list',[actor,filters,1,50]); assert.equal(filtered.total,1); assert.equal(filtered.items[0].protocol,second.protocol);
      assert.equal((await call('clube_list',[actor,{...filters,frequencia:['mensal']},1,50])).total,0);
      assert.equal((await call('clube_list',[actor,{search:'%'},1,50])).total,0);
      assert.equal((await call('clube_list',[actor,{slot:'variavel'},1,50])).total,0);
      const empty=await call('clube_list',[actor,{},3,1]); assert.equal(empty.total,2); assert.deepEqual(empty.items,[]);
    });
    await t.test('integral keyset export >1000 records and generation conflict',async()=>{
      // Synthetic isolated fixture in rollback; no external service or real collection.
      await query(`insert into public.responses(idempotency_key,payload_hash,form_version,privacy_notice_version,privacy_snapshot,answers)
        select gen_random_uuid(), repeat('a',64),'2026-10-28-v1-proposta','test','{}'::jsonb,$1::jsonb from generate_series(1,1003)`,[sample('Export')]);
      let after=null,generation=null; const ids=[];
      while(true) { const p=await call('clube_export_page',[actor,{},after,generation]);generation=p.generation; ids.push(...p.items.map(x=>x.id)); if(p.items.length<500)break;after=p.items.at(-1).id; }
      assert.equal(ids.length,1005); assert.equal(new Set(ids).size,1005);
      const initial=await call('clube_export_page',[actor,{},null,null]);
      await call('clube_update',[actor,await one(),1,'novo','changed',false]);
      await sqlError(()=>call('clube_export_page',[actor,{},initial.items.at(-1).id,initial.generation]),'PT409');
    });
    await t.test('delete checks protocol/revision, removes contact and history, tombstone blocks replay',async()=>{
      const id2=(await query('select id from public.responses where idempotency_key=$1',[key2]))[0].id;
      await sqlError(()=>call('clube_delete',[actor,id2,1,second.protocol]),'PT409');
      await sqlError(()=>call('clube_delete',[actor,id2,3,'wrong']),'PT400');
      assert.deepEqual(await call('clube_delete',[actor,id2,3,second.protocol]),{deleted:true});
      assert.equal((await query('select count(*)::int as n from public.admin_history where response_id=$1',[id2]))[0].n,0);
      await sqlError(()=>call('clube_detail',[actor,id2]),'PT404');
      await sqlError(()=>call('clube_submit',[sample('Bruna',true),'2026-10-28-v1-proposta',key2,'a'.repeat(64)]),'PT409');
      const tomb=(await query('select * from public.deletion_log where response_id=$1',[id2]))[0];
      assert.deepEqual(Object.keys(tomb).sort(),['actor_id','deleted_at','idempotency_key','response_id']);
    });
    await t.test('global aggregate abuse bound with no IP/fingerprint fields',async()=>{
      await query("delete from public.abuse_windows where scope='new_submission'");
      for(let i=0;i<60;i++) await call('clube_rate',['new_submission']);
      await sqlError(()=>call('clube_rate',['new_submission']),'PT429');
      assert.equal((await query("select attempts from public.abuse_windows where scope='new_submission'"))[0].attempts,60);
    });
    await db.exec('rollback');
    assert.equal((await query('select count(*)::int as n from public.responses'))[0].n,0);
  } finally { await db.close(); }
});
