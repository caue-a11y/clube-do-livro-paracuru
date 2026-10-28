import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../supabase/functions/clube-api/app.mjs';
const schema=JSON.parse(await readFile(new URL('../shared/questionario.json',import.meta.url)));
const actor='11111111-1111-4111-8111-111111111111';
const id='33333333-3333-4333-8333-333333333333';
const protocol='CL-'+'a'.repeat(32);
const basic=()=>({q01_nome:'Leitora',q02_localizacao:'sim',q06_modelo_leitura:'alternar',q07_frequencia:'quinzenal',q08_modalidades:['online'],q09_disponibilidade:{mode:'variavel',slots:[]},q10_intencao:'regular',q13_autorizacao:'nao'});
const submission=()=>({answers:basic(),form_version:schema.form_version,privacy_notice_version:'aviso-teste',idempotency_key:crypto.randomUUID(),website:''});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function setup({auth=200,allowed=true,rpc=()=>({}),transportError=false}={}) {
  const calls=[],logs=[];
  const handler=createHandler({schema,parsePhoneNumber:()=>{throw new Error('not used');},supabaseURL:'https://project.example.test',serviceRoleKey:'test-only-not-a-real-key',log:x=>logs.push(x),fetchImpl:async(url,opts)=>{
    calls.push({url,opts}); if(transportError)throw new Error('do not log body');
    if(url.endsWith('/auth/v1/user'))return json(auth===200?{id:actor}:{error:'denied'},auth);
    if(url.includes('/admin_users?'))return json(allowed?[{user_id:actor}]:[]);
    const method=url.split('/rpc/')[1]; return rpc(method,JSON.parse(opts.body),calls);
  }});
  const request=(path,method='GET',body,token,origin='https://caue-a11y.github.io')=>{
    const headers={}; if(origin!==null)headers.Origin=origin; if(token)headers.Authorization=`Bearer ${token}`;
    if(body!==undefined)headers['Content-Type']='application/json';
    return new Request(`https://project.example.test/functions/v1/clube-api${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  };
  return {handler,calls,logs,request};
}
test('all admin routes (including exports/config) require verified token and server allowlist',async()=>{
  const routes=[['/admin/respostas','GET'],[`/admin/respostas/${id}`,'GET'],[`/admin/respostas/${id}`,'PATCH'],[`/admin/respostas/${id}`,'DELETE'],['/admin/exportacao','GET'],['/admin/config','GET'],['/admin/config','PATCH']];
  for(const [path,method]of routes){
    const s=setup(); const r=await s.handler(s.request(path,method,method==='GET'?undefined:{}));assert.equal(r.status,401,path);assert.equal(s.calls.length,0);
    for(const [auth,allowed,expected]of [[401,true,401],[403,true,401],[500,true,503],[200,false,403]]){
      const x=setup({auth,allowed});const res=await x.handler(x.request(path,method,method==='GET'?undefined:{},'bad-or-good'));
      assert.equal(res.status,expected,path);assert.ok(x.calls.every(c=>!c.url.includes('/rpc/')));
    }
  }
});
test('every authorized admin request checks Auth user and allowlist afresh',async()=>{
  const s=setup({rpc:(name)=>json(name==='clube_settings'?{revision:1}:{items:[],total:0,page:1,page_size:50})});
  for(const path of ['/admin/config','/admin/respostas'])assert.equal((await s.handler(s.request(path,'GET',undefined,'access'))).status,200);
  assert.equal(s.calls.filter(c=>c.url.endsWith('/auth/v1/user')).length,2);
  assert.equal(s.calls.filter(c=>c.url.includes('/admin_users?')).length,2);
  const userCall=s.calls[0];assert.equal(userCall.opts.headers.Authorization,'Bearer access');
  assert.equal(s.calls[1].opts.headers.Authorization,'Bearer test-only-not-a-real-key');
});
test('POST returns only a persisted upstream protocol, canonical hash, and discards Q14',async()=>{
  const s=setup({rpc:(name,args)=>{
    assert.equal(name,'clube_submit_with_notice');assert.equal(args.p_notice_version,'aviso-teste');assert.equal(args.p_answers.q14_contato,undefined);assert.match(args.p_payload_hash,/^[a-f0-9]{64}$/);
    return json({protocol,received_at:'2026-10-28T12:00:00Z',sensitive:'not-to-return'});
  }});
  const body=submission();body.answers.q14_contato={channel:'instagram',value:'not-authorized'};
  const res=await s.handler(s.request('/respostas','POST',body));assert.equal(res.status,200);assert.deepEqual(await res.json(),{protocol,received_at:'2026-10-28T12:00:00Z'});
  assert.equal(res.headers.get('cache-control'),'no-store');
});
test('honeypot, invalid payload and no-Origin submission are explicit errors with no write',async()=>{
  for(const body of [{...submission(),website:'bot'}, {...submission(),answers:{}}, {...submission(),form_version:'old'}]){
    const s=setup();const r=await s.handler(s.request('/respostas','POST',body));assert.equal(r.status,400);assert.equal(s.calls.length,0);assert.ok((await r.json()).error);
  }
  const s=setup();assert.equal((await s.handler(s.request('/respostas','POST',submission(),undefined,null))).status,403);assert.equal(s.calls.length,0);
});
test('transport/database failures never simulate success or log personal content',async()=>{
  for(const options of [{transportError:true},{rpc:()=>json({message:'SQL text and secret'},500)},{rpc:()=>json({code:'XX000',message:'participant name'},400)},{rpc:()=>json({})}]){
    const s=setup(options);const res=await s.handler(s.request('/respostas','POST',submission()));assert.equal(res.status,503);const out=await res.json();assert.ok(out.error);assert.equal(out.protocol,undefined);
    assert.ok(s.logs.every(x=>!x.includes('Leitora')&&!x.includes('secret')&&!x.includes('SQL')));
  }
});
test('PT conflicts/rate errors propagate and unknown upstream details do not',async()=>{
  for(const [code,status]of [['PT409',409],['PT429',429],['PT400',400]]){
    const s=setup({rpc:()=>json({code,message:'Mensagem SQL estática.'},400)});const r=await s.handler(s.request('/respostas','POST',submission()));assert.equal(r.status,status);if(status===429)assert.equal(r.headers.get('retry-after'),'60');
  }
});
test('list filters/pagination go to SQL and do not expose service credentials',async()=>{
  const filters={localizacao:['sim','nao_posso_ir'],generos:['ciencia'],from:'2026-10-01',to:'2026-10-28'};
  const s=setup({rpc:(name,args)=>{assert.equal(name,'clube_list');assert.deepEqual(args,{p_actor:actor,p_filters:filters,p_page:2,p_page_size:100});return json({items:[],total:0,page:2,page_size:100});}});
  const r=await s.handler(s.request(`/admin/respostas?filters=${encodeURIComponent(JSON.stringify(filters))}&page=2&page_size=100`,'GET',undefined,'access'));
  assert.equal(r.status,200);assert.ok(!(await r.text()).includes('test-only-not-a-real-key'));
  for(const query of ['?page=0','?page_size=101','?filters=%7Bbad'])assert.equal((await s.handler(s.request('/admin/respostas'+query,'GET',undefined,'access'))).status,400);
});
test('admin GET/PATCH/DELETE/config route contracts, including no-Origin verified admin',async()=>{
  const seen=[];const s=setup({rpc:(name,args)=>{seen.push([name,args]);return json(name==='clube_delete'?{deleted:true}:{revision:2});}});
  assert.equal((await s.handler(s.request(`/admin/respostas/${id}`,'GET',undefined,'access',null))).status,200);
  const patch={revision:1,status:'contatado',notes:'note',confirmed:false};
  assert.equal((await s.handler(s.request(`/admin/respostas/${id}`,'PATCH',patch,'access',null))).status,200);
  assert.deepEqual(seen.at(-1),['clube_update',{p_actor:actor,p_id:id,p_revision:1,p_status:'contatado',p_notes:'note',p_confirmed:false}]);
  assert.equal((await s.handler(s.request(`/admin/respostas/${id}`,'DELETE',{revision:1,confirm_protocol:protocol},'access'))).status,200);
  assert.equal((await s.handler(s.request('/admin/config','PATCH',{revision:1,open:false,responsible:null,channel:null,retention_days:null},'access'))).status,200);
  assert.equal(seen.at(-1)[0],'clube_settings_update');
});
test('CSV fetches complete filtered recorte beyond 1000 and excludes notes/contact without consent',async()=>{
  const seen=[]; const row=i=>({id:`${i.toString().padStart(8,'0')}-3333-4333-8333-333333333333`,protocol:`ROW-${i}`,received_at:'2026-10-28',status:'novo',form_version:schema.form_version,answers:{...basic(),q01_nome:i===1?'\t=1+1':'Leitora',q14_contato:{channel:'instagram',value:'hidden-secret'}},notes:'hidden-notes'});
  const s=setup({rpc:(name,args)=>{
    assert.equal(name,'clube_export_page');assert.deepEqual(args.p_filters,{status:['novo']});seen.push(args);
    const start=args.p_after?Number(args.p_after.slice(0,8))+1:1; const items=[];
    for(let i=start;i<=Math.min(start+499,1003);i++)items.push(row(i));
    return json({generation:4,items});
  }});
  const res=await s.handler(s.request('/admin/exportacao?filters='+encodeURIComponent('{"status":["novo"]}'),'GET',undefined,'access'));
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/^text\/csv/);
  const csv=Buffer.from(await res.arrayBuffer());assert.equal(csv.subarray(0,3).toString('hex'),'efbbbf');const str=csv.toString();
  assert.equal((str.match(/ROW-/g)||[]).length,1003);assert.ok(str.includes('ROW-1003'));assert.ok(!str.includes('hidden-secret'));assert.ok(!str.includes('hidden-notes'));assert.ok(str.includes('"\'\t=1+1"'));
  assert.equal(seen.length,3);assert.equal(seen[1].p_generation,4);assert.equal(seen[1].p_after,row(500).id);
});
test('CSV failure on later page returns JSON error, never a partial 200 download',async()=>{
  let count=0;const row={id,protocol,received_at:'now',answers:basic(),status:'novo'};
  const s=setup({rpc:()=>++count===1?json({generation:1,items:Array(500).fill(row)}):json({code:'PT409',message:'A base mudou durante a exportação.'},409)});
  const res=await s.handler(s.request('/admin/exportacao','GET',undefined,'access'));assert.equal(res.status,409);assert.match(res.headers.get('content-type'),/application\/json/);assert.equal(res.headers.get('content-disposition'),null);
});
test('CORS preflight exact Origin, no-store on errors and config failures',async()=>{
  const s=setup({rpc:()=>json({open:false,privacy:{responsible:null,channel:null,retention_days:null,notice_version:null},form_version:schema.form_version})});
  const opt=await s.handler(s.request('/respostas','OPTIONS'));assert.equal(opt.status,204);assert.equal(opt.headers.get('access-control-allow-origin'),'https://caue-a11y.github.io');
  const bad=await s.handler(s.request('/config','GET',undefined,undefined,'https://evil.test'));assert.equal(bad.status,403);assert.equal(bad.headers.get('access-control-allow-origin'),null);assert.equal(bad.headers.get('cache-control'),'no-store');
  const config=await s.handler(s.request('/config'));assert.equal(config.status,200);assert.equal((await config.json()).open,false);
});
