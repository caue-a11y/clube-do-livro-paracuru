import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateAnswers, validateSubmission, ApiError, normalizeInstagram, normalizeWhatsApp,
  canonicalJSON, payloadHash, validateFilters, validateUpdate, validateSettings, csvCell,
  csvHeader, csvRow, checkOrigin, readJSON, positiveInt
} from '../supabase/functions/clube-api/domain.mjs';

export const schema = JSON.parse(await readFile(new URL('../supabase/functions/clube-api/questionario.json', import.meta.url)));
export const basic = () => ({
  q01_nome: '  Leitora  ', q02_localizacao: 'sim', q06_modelo_leitura: 'alternar',
  q07_frequencia: 'quinzenal', q08_modalidades: ['online'],
  q09_disponibilidade: { mode: 'fixa', slots: [{ day: 'sab', period: 'manha' }] },
  q10_intencao: 'regular', q13_autorizacao: 'nao'
});
const validate = a => validateAnswers(a, schema, () => { throw new Error('Pure validation tests never substitute a phone success.'); });
const invalid = (a, field) => assert.throws(() => validate(a), e => e instanceof ApiError && e.status === 400 && Boolean(!field || e.fields?.[field]));

test('deployment questionnaire is byte-identical to the shared source', async () => {
  const source = await readFile(new URL('../shared/questionario.json', import.meta.url), 'utf8');
  const snapshot = await readFile(new URL('../supabase/functions/clube-api/questionario.json', import.meta.url), 'utf8');
  assert.equal(snapshot, source); assert.equal(schema.questions.length, 14);
});
test('required fields, trim, optional omissions and no preselected options', () => {
  const out = validate(basic()); assert.equal(out.q01_nome, 'Leitora'); assert.equal('q03_livros_ano' in out, false);
  for (const q of schema.questions.filter(q => q.required)) {
    const a = basic(); delete a[q.id]; invalid(a, q.id);
  }
  invalid({ ...basic(), q01_nome: '  ' }, 'q01_nome');
  invalid({ ...basic(), q01_nome: 'x'.repeat(81) }, 'q01_nome');
  assert.equal(validate({ ...basic(), q01_nome: '😀'.repeat(80) }).q01_nome.length, 160);
});
test('every single-choice option accepts its exact JSON ID; invalid types/enums reject', () => {
  for (const q of schema.questions.filter(q => q.type === 'single_choice')) {
    for (const option of q.options) {
      const a = { ...basic(), [q.id]: option.value };
      if (q.id === 'q13_autorizacao' && option.value === 'sim') a.q14_contato = { channel: 'instagram', value: '@livro' };
      assert.equal(validate(a)[q.id], option.value);
    }
    invalid({ ...basic(), [q.id]: 'not-an-option' }, q.id);
    invalid({ ...basic(), [q.id]: [] }, q.id);
    invalid({ ...basic(), [q.id]: null }, q.id);
  }
});
test('Q5 maximum, Other complements, Q11 exclusivity and hidden clearing', () => {
  invalid({ ...basic(), q05_generos: ['ciencia','fantasia_fc','biografias','suspense'] }, 'q05_generos');
  invalid({ ...basic(), q05_generos: ['outro'] }, 'q05_generos_outro_texto');
  invalid({ ...basic(), q05_generos: ['ciencia','ciencia'] }, 'q05_generos');
  invalid({ ...basic(), q05_generos: 'ciencia' }, 'q05_generos');
  invalid({ ...basic(), q11_barreiras: ['nenhuma','horarios'] }, 'q11_barreiras');
  invalid({ ...basic(), q11_barreiras: ['outro'], q11_barreiras_outro_texto: 'x'.repeat(201) }, 'q11_barreiras_outro_texto');
  const a = validate({ ...basic(), q05_generos: ['outro'], q05_generos_outro_texto: '  ensaios ', q11_barreiras_outro_texto: '<private>' });
  assert.equal(a.q05_generos_outro_texto, 'ensaios'); assert.equal('q11_barreiras_outro_texto' in a, false);
});
test('Q8 location cross-rule and exact modalities', () => {
  invalid({ ...basic(), q08_modalidades: [] }, 'q08_modalidades');
  invalid({ ...basic(), q08_modalidades: ['hibrido'] }, 'q08_modalidades');
  for (const modality of ['presencial', 'alternado']) invalid({ ...basic(), q02_localizacao: 'nao_apenas_online', q08_modalidades: ['online', modality] }, 'q08_modalidades');
  assert.deepEqual(validate({ ...basic(), q02_localizacao: 'nao_apenas_online' }).q08_modalidades, ['online']);
});
test('Q9 exclusive modes, valid pairs, dedup and deterministic normalization', () => {
  const duplicate = { day: 'sab', period: 'manha' };
  assert.deepEqual(validate({ ...basic(), q09_disponibilidade: { mode: 'fixa', slots: [duplicate, duplicate] } }).q09_disponibilidade.slots, [duplicate]);
  for (const v of [null, {mode:'fixa',slots:[]}, {mode:'variavel',slots:[duplicate]}, {mode:'outro',slots:[]}, {mode:'fixa',slots:[{day:'feriado',period:'noite'}]}, {mode:'fixa',slots:[{day:'sab',period:'madrugada'}]}, {mode:'variavel',slots:[],unknown:true}]) invalid({ ...basic(), q09_disponibilidade: v }, 'q09_disponibilidade');
  assert.deepEqual(validate({ ...basic(), q09_disponibilidade: { mode:'variavel',slots:[] } }).q09_disponibilidade, {mode:'variavel',slots:[]});
});
test('Q12 bounds and free text remains inert data', () => {
  invalid({ ...basic(), q12_sugestoes: 'x'.repeat(1001) }, 'q12_sugestoes');
  const hostile = '<script>alert(1)</script>\n=SUM(1,2)';
  assert.equal(validate({ ...basic(), q12_sugestoes: hostile }).q12_sugestoes, hostile);
  invalid({ ...basic(), q01_nome: 'a\u0000b' }, 'q01_nome');
});
test('Q14 unauthorized is discarded regardless of type; authorized contact is mandatory', () => {
  for (const value of [{ channel:'whatsapp', value:'sensitive' }, 'malformed', null, ['extra']]) assert.equal('q14_contato' in validate({ ...basic(), q14_contato: value }), false);
  invalid({ ...basic(), q13_autorizacao:'sim' }, 'q14_contato');
  invalid({ ...basic(), q13_autorizacao:'sim', q14_contato:{channel:'email',value:'a@b.com'} }, 'q14_contato');
  invalid({ ...basic(), q13_autorizacao:'sim', q14_contato:{channel:'instagram',value:'x'.repeat(101)} }, 'q14_contato');
});
test('Instagram strict direct-profile normalization resists URL and path confusion', () => {
  for (const v of ['@Livro_1', 'Livro_1', 'https://www.instagram.com/Livro_1/', 'instagram.com/Livro_1']) assert.equal(normalizeInstagram(v), 'livro_1');
  for (const v of ['https://evil.test/livro','https://instagram.com.evil.test/livro','https://instagram.com@evil.test/livro','https://instagram.com/p/abc','https://instagram.com/a/../livro','https://instagram.com/%6civro','https://instagram.com/livro?x=y','https://instagram.com/livro#bio','https://instagram.com/livro extra','@a..b','@.livro','@livro.','@a/b','https://instagram.com:443/livro','javascript:alert(1)']) assert.throws(() => normalizeInstagram(v), undefined, v);
});
test('WhatsApp wrapper never guesses an outside country or parses text/extensions', () => {
  let calls = 0;
  const parse = (value, options) => { calls++; assert.equal(options.extract, false); return { number: '+5585999999999', country:'BR', isValid:()=>true }; };
  assert.equal(normalizeWhatsApp('(85) 99999-9999', parse), '+5585999999999'); assert.equal(calls, 1);
  for (const v of ['call 85999999999','99999-9999','5585999999999','123 x 45','(85) 99999-9999 ramal 1']) assert.throws(() => normalizeWhatsApp(v, parse));
  assert.throws(() => normalizeWhatsApp('85999999999', () => ({country:'BR', number:'+1', isValid:()=>false})));
});
test('canonical hashing ignores object order and normalized choice/slot order', async () => {
  assert.equal(canonicalJSON({b:2,a:{d:4,c:3}}), canonicalJSON({a:{c:3,d:4},b:2}));
  const a = validate({ ...basic(), q05_generos:['suspense','ciencia'] });
  const b = validate({ ...basic(), q05_generos:['ciencia','suspense'] });
  assert.equal(await payloadHash(a), await payloadHash(b)); assert.equal((await payloadHash(a)).length, 64);
  assert.notEqual(await payloadHash(a), await payloadHash({...a,q01_nome:'Outra'}));
});
test('submission rejects unknown keys, bad version, malformed idempotency and honeypot', () => {
  const b = { answers:basic(), form_version:schema.form_version, privacy_notice_version:'aviso-teste', idempotency_key:'12345678-1234-4123-8123-123456789abc',website:'' };
  assert.equal(validateSubmission(b,schema,()=>{}).answers.q01_nome, 'Leitora');
  for (const change of [{website:'bot'},{website:null},{form_version:'old'},{idempotency_key:'abc'},{secret:'x'},{privacy_notice_version:null},{privacy_notice_version:''},{privacy_notice_version:undefined}]) assert.throws(()=>validateSubmission({...b,...change},schema,()=>{}),ApiError);
  assert.throws(()=>validate({...basic(),unknown:'x'}),ApiError);
});
test('filters validate exact options, real dates, AND/OR contract inputs and bounds', () => {
  const f={search:'  Ana% ',from:'2026-10-01',to:'2026-10-28',status:['novo'],generos:['ciencia','suspense'],slot:'sab:manha',modalidades:[]};
  const { modalidades, ...expected } = f;
  assert.deepEqual(validateFilters(JSON.stringify(f),schema), {...expected,search:'Ana%'});
});
test('invalid filters and paging reject, never silently return an unfiltered base', () => {
  for (const raw of ['{', 'null','[]',JSON.stringify({from:'2026-02-30'}),JSON.stringify({to:'2026-2-1'}),JSON.stringify({from:'2026-10-29',to:'2026-10-28'}),JSON.stringify({status:['bogus']}),JSON.stringify({localizacao:'sim'}),JSON.stringify({slot:'sab:qualquer'}),JSON.stringify({q14_contato:'private'})]) assert.throws(()=>validateFilters(raw,schema),ApiError);
  assert.equal(positiveInt(null,50,100),50);
  for(const x of ['0','-1','1.5','101','1x']) assert.throws(()=>positiveInt(x,50,100),ApiError);
});
test('settings privacy remains null/closed until complete; CAS and explicit status confirmation', () => {
  const s={revision:1,open:false,responsible:null,channel:null,retention_days:null}; assert.deepEqual(validateSettings(s),s);
  assert.throws(()=>validateSettings({...s,open:true}), e=>Boolean(e.fields.responsible && e.fields.channel && e.fields.retention_days));
  for(const n of [0,1.5,3651,undefined]) assert.throws(()=>validateSettings({...s,retention_days:n}),ApiError);
  const u={revision:1,status:'confirmado_primeiro_encontro',notes:'Retorno real',confirmed:false};
  assert.throws(()=>validateUpdate(u),ApiError); assert.equal(validateUpdate({...u,confirmed:true}).status,u.status);
  assert.throws(()=>validateUpdate({...u,confirmed:true,notes:'x'.repeat(1001)}),ApiError);
});
test('CSV protects formulas after whitespace/control, quotes, UTF8 BOM and contact authorization', () => {
  for(const x of ['=1',' +1','\t-1','\u0001 @evil','\u200b=1','\n=1']) assert.ok(csvCell(x).startsWith('"\''),JSON.stringify(x));
  assert.equal(csvCell('a"b\nc'), '"a""b\nc"');
  assert.ok(csvHeader(schema).startsWith('\ufeff'));
  const r={protocol:'CL-123',received_at:'now',status:'novo',notes:'not-exported',answers:{...basic(),q14_contato:{channel:'instagram',value:'secret'}}};
  const row=csvRow(r,schema); assert.ok(!row.includes('secret')); assert.ok(!row.includes('not-exported'));
  assert.ok(csvRow({...r,answers:{...r.answers,q13_autorizacao:'sim'}},schema).includes('secret'));
});
test('CORS exact origins and unauthenticated no-Origin mutation reject', () => {
  assert.doesNotThrow(()=>checkOrigin('https://caue-a11y.github.io',true,false));
  assert.doesNotThrow(()=>checkOrigin(null,true,true)); assert.doesNotThrow(()=>checkOrigin(null,false,false));
  for(const origin of ['https://caue-a11y.github.io.evil.test','null','http://localhost:3000']) assert.throws(()=>checkOrigin(origin,false,true),ApiError);
  assert.throws(()=>checkOrigin(null,true,false),ApiError);
});
test('streamed body limit, JSON-only, invalid UTF8 and malformed JSON enforced', async () => {
  const req=(body,headers={'Content-Type':'application/json'})=>new Request('http://local',{method:'POST',body,headers});
  assert.deepEqual(await readJSON(req('{"ok":true}')),{ok:true});
  await assert.rejects(()=>readJSON(req('x')),ApiError);
  await assert.rejects(()=>readJSON(req('{}',{'Content-Type':'text/plain'})),ApiError);
  await assert.rejects(()=>readJSON(req('x'.repeat(100)),10),ApiError);
  await assert.rejects(()=>readJSON(req(new Uint8Array([255]))),ApiError);
});
