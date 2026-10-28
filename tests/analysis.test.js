import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatible, distribution, scenarios, dailyEvolution } from '../shared/analysis.js';

const rows = [];
for (const id of 'ABCDEFGH') {
  const answers = {
    q01_nome: `Pessoa Teste ${id}`, q02_localizacao: id === 'C' ? 'nao_apenas_online' : id === 'D' ? 'nao_posso_ir' : 'sim',
    q05_generos: ['historia_sociedade'], q06_modelo_leitura: 'mesmo_livro',
    q07_frequencia: id === 'G' ? 'mensal' : 'quinzenal',
    q08_modalidades: id === 'B' ? ['alternado'] : id === 'C' ? ['online'] : ['presencial'],
    q09_disponibilidade: id === 'E' ? { mode: 'variavel', slots: [] } : { mode: 'fixa', slots: [{ day: id === 'H' ? 'dom' : 'sab', period: id === 'H' ? 'tarde' : 'manha' }] },
    q10_intencao: id === 'D' ? 'experimentar' : 'regular', q13_autorizacao: id === 'F' ? 'nao' : 'sim',
  };
  if ('AB'.includes(id)) answers.q05_generos.push('ciencia');
  if (id === 'A') answers.q09_disponibilidade.slots.push({ day: 'dom', period: 'tarde' });
  if (id === 'H') delete answers.q05_generos;
  rows.push({ id, answers, received_at: '2026-10-28T01:00:00Z', status: 'novo' });
}
const ids = (items) => items.map((r) => r.id).join('');
const scenario = { day: 'sab', period: 'manha', modality: 'presencial', frequency: 'quinzenal' };
test('fixture presencial: A/B/D/F; regulares A/B/F; contatáveis A/B; variável E', () => {
  const got = compatible(rows, scenario);
  assert.equal(ids(got.items), 'ABDF');
  assert.equal(ids(got.regular), 'ABF');
  assert.equal(ids(got.contactable), 'AB');
  assert.equal(ids(got.variable), 'E');
});
test('online: B/C; alternado: apenas B', () => {
  assert.equal(ids(compatible(rows, { ...scenario, modality: 'online' }).items), 'BC');
  assert.equal(ids(compatible(rows, { ...scenario, modality: 'alternado' }).items), 'B');
});
test('presencial e online marcados separadamente não implicam agenda alternada', () => {
  const row = structuredClone(rows[0]); row.answers.q08_modalidades = ['presencial', 'online'];
  assert.equal(compatible([row], { ...scenario, modality: 'alternado' }).items.length, 0);
});
test('opcionais gênero/modelo são interseções; frequência mensal não aceita quinzenal implicitamente', () => {
  assert.equal(ids(compatible(rows, { ...scenario, genre: 'ciencia' }).items), 'AB');
  assert.equal(compatible(rows, { ...scenario, model: 'mesmo_tema' }).items.length, 0);
  assert.equal(ids(compatible(rows, { ...scenario, frequency: 'mensal' }).items), 'G');
});
test('denominador gêneros é 7 respondentes e não 9 marcações; H sem resposta', () => {
  const got = distribution(rows, 'q05_generos');
  assert.equal(got.answered, 7); assert.equal(got.missing, 1);
  assert.deepEqual(got.counts, { historia_sociedade: 7, ciencia: 2 });
});
test('escolhas e IDs repetidos não inflam as contagens', () => {
  const repeated = structuredClone(rows); repeated[0].answers.q05_generos.push('ciencia');
  assert.deepEqual(distribution([...repeated, repeated[0]], 'q05_generos'), distribution(rows, 'q05_generos'));
  assert.equal(compatible([...rows, rows[0]], scenario).items.length, 4);
});
test('todos os 21 cenários preservam empates', () => {
  const got = scenarios(rows, { modality: 'presencial', frequency: 'quinzenal' });
  assert.equal(got.length, 21); assert.equal(got[0].contactable.length, 2);
  assert.equal(got.filter((r) => r.contactable.length === 2).length, 2);
});
test('datas de evolução respeitam America/Sao_Paulo', () => {
  assert.deepEqual(dailyEvolution(rows), [{ day: '2026-10-27', count: 8 }]);
});
test('sem respostas e cenários inválidos geram conjuntos vazios', () => {
  assert.deepEqual(distribution([], 'q05_generos'), { counts: {}, answered: 0, missing: 0 });
  assert.equal(compatible(rows, { ...scenario, modality: 'invalida' }).items.length, 0);
});
