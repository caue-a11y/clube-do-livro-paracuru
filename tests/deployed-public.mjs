// Probes públicos no projeto dedicado. Nunca abre a coleta nem usa uma sessão administrativa.
// Depois da abertura, não executa POSTs para evitar introduzir dados de teste na base real.
import { API_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/config.js';
import { writeFile } from 'node:fs/promises';
const results=[];
const headers={apikey:SUPABASE_PUBLISHABLE_KEY,Origin:'https://caue-a11y.github.io'};
async function probe(label,url,options,expected){
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
  const body=await res.json().catch(()=>null);
  const ok=expected.includes(res.status);
  results.push({label,status:res.status,expected,ok,body});
  if(!ok) process.exitCode=1;
  console.log(`${ok?'PASS':'FAIL'} ${label}: ${res.status}`);
  return body;
}
try {
  const config = await probe('Configuração pública da coleta',`${API_URL}/config`,{headers},[200]);
  for(const path of ['/admin/respostas','/admin/respostas/11111111-1111-4111-8111-111111111111','/admin/config','/admin/exportacao']){
    await probe(`Sem sessão: ${path}`,`${API_URL}${path}`,{headers},[401]);
  }
  await probe('Tabela de respostas não pode ser lida com chave pública',`${SUPABASE_URL}/rest/v1/responses?select=id`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY}},[401,403]);
  if (config?.open === false) {
    const answers={q01_nome:'Pessoa Teste de Integração',q02_localizacao:'sim',q06_modelo_leitura:'mesmo_livro',q07_frequencia:'quinzenal',q08_modalidades:['presencial'],q09_disponibilidade:{mode:'fixa',slots:[{day:'sab',period:'manha'}]},q10_intencao:'regular',q13_autorizacao:'nao'};
    // Aviso deliberadamente inválido também impede gravação se a coleta abrir entre GET e POST.
    const envelope={form_version:config.form_version,privacy_notice_version:'probe-fechado-nao-usar-em-producao',idempotency_key:crypto.randomUUID(),website:''};
    await probe('Coleta fechada bloqueia novo envio',`${API_URL}/respostas`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({answers,...envelope})},[409]);
    await probe('Servidor rejeita campos obrigatórios ausentes',`${API_URL}/respostas`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({answers:{},...envelope,idempotency_key:crypto.randomUUID()})},[400]);
  } else {
    results.push({label:'Probes POST',skipped:true,reason:'Coleta aberta: verificação automática não envia respostas.'});
    console.log('SKIP Probes POST: coleta aberta; nenhum dado de teste será enviado.');
  }
  await probe('Origem diferente é recusada',`${API_URL}/config`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Origin:'https://example.test'}},[403]);
} catch(error) { process.exitCode=1; results.push({ok:false,error:error.message}); console.error('Falha no probe:',error.message); }
await writeFile(new URL('../docs/probes-publicos.json',import.meta.url),JSON.stringify({tested_at:new Date().toISOString(),results},null,2));
