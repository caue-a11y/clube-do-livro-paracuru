import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const runtime = process.env.PGLITE_MODULE || new URL('./backend-runtime/index.cjs', import.meta.url).pathname;

test('aviso exibido deve corresponder ao snapshot; replay confirmado sobrevive à mudança', {skip:!existsSync(runtime),timeout:120000}, async()=>{
  const {PGlite}=createRequire(import.meta.url)(runtime); const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); grant usage on schema public to anon, authenticated, service_role;');
    for(const name of ['202610280001_clube.sql','202610280002_notice_snapshot.sql']) await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
    await db.exec("begin; update public.settings set open=true,responsible='Responsável sintético',channel='privacidade@example.test',retention_days=1,notice_version='aviso-v1'; set local role service_role;");
    const answers={q01_nome:'Pessoa Teste',q13_autorizacao:'nao'};
    const key=crypto.randomUUID(); const args=[answers,'2026-10-28-v1-proposta',key,'a'.repeat(64)];
    const call=async(version,values=args)=>(await db.query('select public.clube_submit_with_notice($1,$2,$3,$4,$5) as r',[...values,version])).rows[0].r;
    async function fail(version){await db.exec('savepoint check_notice');try{await assert.rejects(call(version),e=>e.code==='PT409');}finally{await db.exec('rollback to check_notice;release check_notice');}}
    await fail('aviso-antigo'); await fail(null);
    const first=await call('aviso-v1');
    await db.exec("update public.settings set notice_version='aviso-v2';");
    assert.deepEqual(await call('aviso-v1'),first);
    assert.equal((await db.query('select count(*)::int as n from public.responses')).rows[0].n,1);
    const next=[...args];next[2]=crypto.randomUUID();
    await db.exec('savepoint new_attempt');
    await assert.rejects(call('aviso-v1',next),e=>e.code==='PT409');
    await db.exec('rollback to new_attempt;release new_attempt');
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as n from public.responses')).rows[0].n,0);
  } finally { await db.close(); }
});
