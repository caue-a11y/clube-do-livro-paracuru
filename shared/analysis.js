// Mesma resposta, mesma interseção. Marcar mais horários/gêneros não cria novas respostas.
export function uniqueRecords(records) {
  const seen = new Set();
  return records.filter((row) => {
    if (!row.id) return true;
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export function compatible(records, { day, period, modality, frequency, genre = '', model = '' }) {
  if (!['presencial', 'online', 'alternado'].includes(modality)
      || !['semanal', 'quinzenal', 'mensal'].includes(frequency)) {
    return { items: [], regular: [], contactable: [], variable: [] };
  }
  const eligible = uniqueRecords(records).filter(({ answers: a = {} }) => {
    const modes = a.q08_modalidades || [];
    const canTravel = ['sim', 'nao_posso_ir'].includes(a.q02_localizacao);
    const modeOK = modality === 'presencial' ? canTravel && (modes.includes('presencial') || modes.includes('alternado'))
      : modality === 'online' ? modes.includes('online') || modes.includes('alternado')
      : canTravel && modes.includes('alternado');
    return modeOK && a.q07_frequencia === frequency
      && (!genre || (a.q05_generos || []).includes(genre))
      && (!model || a.q06_modelo_leitura === model);
  });
  const variable = eligible.filter((r) => r.answers.q09_disponibilidade?.mode === 'variavel');
  const items = eligible.filter((r) => r.answers.q09_disponibilidade?.mode === 'fixa'
    && (r.answers.q09_disponibilidade.slots || []).some((s) => s.day === day && s.period === period));
  const regular = items.filter((r) => r.answers.q10_intencao === 'regular');
  // A API já valida e normaliza contato; a lista privada omite o valor do contato.
  const contactable = regular.filter((r) => r.answers.q13_autorizacao === 'sim');
  return { items, regular, contactable, variable };
}

export function distribution(records, questionId) {
  const rows = uniqueRecords(records);
  const counts = {};
  let answered = 0;
  for (const row of rows) {
    const value = row.answers?.[questionId];
    const options = Array.isArray(value) ? [...new Set(value)]
      : typeof value === 'string' && value.trim() ? [value] : [];
    if (!options.length) continue;
    answered += 1;
    for (const option of options) counts[option] = (counts[option] || 0) + 1;
  }
  return { counts, answered, missing: rows.length - answered };
}

export function scenarios(records, { modality, frequency, genre = '', model = '' }) {
  const days = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const periods = ['manha', 'tarde', 'noite'];
  return days.flatMap((day) => periods.map((period) => ({
    day, period, ...compatible(records, { day, period, modality, frequency, genre, model }),
  }))).sort((a, b) => b.contactable.length - a.contactable.length);
}

export function dailyEvolution(records) {
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const counts = {};
  for (const row of uniqueRecords(records)) {
    const date = new Date(row.received_at);
    if (Number.isNaN(date.valueOf())) continue;
    const day = format.format(date);
    counts[day] = (counts[day] || 0) + 1;
  }
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));
}
