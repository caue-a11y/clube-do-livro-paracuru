import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.js';

const originalFetch = globalThis.fetch;

test('API só devolve confirmação retornada pelo serviço e não usa cookies', async () => {
  let options;
  globalThis.fetch = async (_url, init) => { options = init; return new Response(JSON.stringify({ protocol: 'teste-sintetico' }), { status: 200 }); };
  try {
    const result = await api('/respostas', { method: 'POST', body: { answers: {} } });
    assert.equal(result.protocol, 'teste-sintetico');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
test('erro de validação preserva status e campos para orientar usuário', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Revise os campos.', fields: { q01_nome: 'Obrigatório.' } }), { status: 400 });
  try { await assert.rejects(api('/respostas'), (e) => e.status === 400 && e.fields.q01_nome === 'Obrigatório.'); }
  finally { globalThis.fetch = originalFetch; }
});
test('falha de rede não vira sucesso nem inclui corpo pessoal na mensagem', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try { await assert.rejects(api('/respostas', { method: 'POST', body: { answers: { q01_nome: 'Pessoa Teste' } } }), (e) => e.status === 0 && !e.message.includes('Pessoa Teste')); }
  finally { globalThis.fetch = originalFetch; }
});
test('resposta inválida do serviço não produz protocolo inventado', async () => {
  globalThis.fetch = async () => new Response('<html>falha</html>', { status: 200 });
  try { await assert.rejects(api('/respostas'), /inesperada/); }
  finally { globalThis.fetch = originalFetch; }
});
test('admin token vai só no header Authorization', async () => {
  let target, options;
  globalThis.fetch = async (url, init) => { target = url; options = init; return new Response('{}', { status: 200 }); };
  try {
    await api('/admin/respostas', { token: 'token-sintetico' });
    assert.equal(options.headers.Authorization, 'Bearer token-sintetico');
    assert.ok(!target.includes('token-sintetico'));
  } finally { globalThis.fetch = originalFetch; }
});
