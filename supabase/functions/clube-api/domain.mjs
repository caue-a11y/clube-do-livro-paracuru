// Pure server rules. No IO, credentials or browser storage. Shared by Deno and node --test.
export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
export const STATUSES = ['novo', 'contatado', 'convidado_primeiro_encontro', 'confirmado_primeiro_encontro', 'nao_participara'];
export const ORIGINS = ['https://caue-a11y.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173'];
export const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const length = x => [...x].length;
const forbidden = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
export function keysOnly(value, allowed) {
  if (!isObject(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new ApiError(400, 'Campos desconhecidos ou objeto inválido.');
}
export function text(value, max, required = false, multiline = false) {
  if (typeof value !== 'string') throw new Error('Informe um texto válido.');
  const v = value.trim();
  if ((required && !v) || length(v) > max || forbidden.test(v) || (!multiline && /[\r\n\t]/u.test(v))) throw new Error(`Informe ${required ? 'de 1 a' : 'até'} ${max} caracteres válidos.`);
  return v;
}
export function normalizeInstagram(raw) {
  let value = text(raw, 100, true);
  if (/^(?:https?:\/\/|(?:www\.)?instagram\.com\/)/i.test(value)) {
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    if (!/^https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+\/?$/i.test(value)) throw new Error('Use somente o link direto de um perfil, sem conteúdo extra.');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash || /[\\\s%]/u.test(value)) throw new Error('Use somente o link do perfil do Instagram, sem parâmetros.');
    const match = url.pathname.match(/^\/([a-zA-Z0-9._]+)\/?$/u);
    if (!match) throw new Error('Use o link de um perfil, não de publicação.');
    value = match[1];
  } else value = value.replace(/^@/, '');
  if (!/^[a-zA-Z0-9_](?:[a-zA-Z0-9._]{0,28}[a-zA-Z0-9_])?$/u.test(value) || value.includes('..') || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal'].includes(value.toLowerCase())) throw new Error('Informe um identificador válido do Instagram (até 30 caracteres).');
  return value.toLowerCase();
}
// BR is the explicitly documented context of this Paracuru questionnaire, not a global fallback.
// International numbers MUST carry +country; bare non-BR numbers are never guessed.
export function normalizeWhatsApp(raw, parsePhoneNumber) {
  const value = text(raw, 100, true);
  if (!/^\+?[0-9(). \-]+$/u.test(value)) throw new Error('Use somente o número com DDD; para outro país, inclua + e o código do país.');
  const digits = value.replace(/\D/g, '');
  let phone;
  try {
    if (value.startsWith('+')) phone = parsePhoneNumber(value, { extract: false });
    else {
      if (![10, 11].includes(digits.length)) throw new Error('DDD obrigatório');
      phone = parsePhoneNumber(value, { defaultCountry: 'BR', extract: false });
      if (phone?.country !== 'BR') throw new Error('País ambíguo');
    }
  } catch { throw new Error('Informe um telefone válido com DDD, ou +país e número.'); }
  if (!phone || !phone.isValid() || phone.ext) throw new Error('Informe um telefone válido com DDD, ou +país e número.');
  return phone.number;
}
export function validateAnswers(input, schema, parsePhoneNumber) {
  if (!isObject(input)) throw new ApiError(400, 'Respostas inválidas.', { answers: 'Informe um objeto de respostas.' });
  const extra = schema.questions.filter(q => q.other_field).map(q => `${q.id}_outro_texto`);
  keysOnly(input, [...schema.questions.map(q => q.id), ...extra]);
  const out = {}, fields = {};
  for (const q of schema.questions) {
    const v = input[q.id];
    try {
      if (q.type === 'contact') {
        // Explicitly discard even malformed/oversized Q14 content when not authorized.
        if (input.q13_autorizacao !== 'sim') continue;
        keysOnly(v, ['channel', 'value']);
        if (!q.channels.some(c => c.value === v.channel)) throw new Error('Escolha Instagram ou WhatsApp.');
        text(v.value, q.max_length, true);
        out[q.id] = { channel: v.channel, value: v.channel === 'instagram' ? normalizeInstagram(v.value) : normalizeWhatsApp(v.value, parsePhoneNumber) };
      } else if (q.type === 'availability') {
        keysOnly(v, ['mode', 'slots']);
        if (!['fixa', 'variavel'].includes(v.mode) || !Array.isArray(v.slots) || v.slots.length > 21) throw new Error('Informe horários válidos ou disponibilidade variável.');
        const slots = [], seen = new Set();
        for (const slot of v.slots) {
          keysOnly(slot, ['day', 'period']);
          if (!q.days.some(d => d.value === slot.day) || !q.periods.some(p => p.value === slot.period)) throw new Error('Dia ou período inválido.');
          const key = `${slot.day}:${slot.period}`;
          if (!seen.has(key)) { slots.push({ day: slot.day, period: slot.period }); seen.add(key); }
        }
        if ((v.mode === 'fixa' && !slots.length) || (v.mode === 'variavel' && slots.length)) throw new Error('Horário variável não pode ser combinado com horários fixos.');
        slots.sort((a, b) => `${a.day}:${a.period}`.localeCompare(`${b.day}:${b.period}`));
        out[q.id] = { mode: v.mode, slots };
      } else if (q.type === 'multiple_choice') {
        if (v === undefined) { if (q.required) throw new Error('Selecione ao menos uma opção.'); continue; }
        if (!Array.isArray(v) || v.length > q.options.length || v.some(x => typeof x !== 'string' || !q.options.some(o => o.value === x))) throw new Error('Seleção inválida.');
        if (new Set(v).size !== v.length) throw new Error('Não repita alternativas.');
        if (v.length < (q.min_selections || 0) || v.length > (q.max_selections || q.options.length)) throw new Error(`Selecione entre ${q.min_selections || 0} e ${q.max_selections || q.options.length} opções.`);
        if (q.exclusive_options?.some(x => v.includes(x)) && v.length > 1) throw new Error('“Nada específico” não pode ser combinado com outras opções.');
        if (v.length) out[q.id] = [...v].sort();
        if (q.other_field && v.includes(q.other_field.when_selected)) {
          const key = `${q.id}_outro_texto`;
          try { out[key] = text(input[key], q.other_field.max_length, true); }
          catch (e) { fields[key] = e.message; }
        }
      } else if (q.type === 'single_choice') {
        if (v === undefined || v === '') { if (q.required) throw new Error('Escolha uma opção.'); continue; }
        if (typeof v !== 'string' || !q.options.some(o => o.value === v)) throw new Error('Escolha uma opção válida.');
        out[q.id] = v;
      } else {
        if (v === undefined && !q.required) continue;
        const normalized = text(v, q.max_length, q.required, q.type === 'long_text');
        if (normalized) out[q.id] = normalized;
      }
    } catch (e) { fields[q.id] = e instanceof ApiError ? 'Preencha este campo no formato indicado.' : e.message; }
  }
  for (const rule of schema.cross_validation || []) {
    if (out[rule.if.question_id] === rule.if.equals && Array.isArray(out[rule.question_id]) && out[rule.question_id].some(x => !rule.allowed_values.includes(x))) fields[rule.question_id] = rule.message;
  }
  if (Object.keys(fields).length) throw new ApiError(400, 'Revise os campos indicados.', fields);
  return out;
}
export function validateSubmission(body, schema, parsePhoneNumber) {
  keysOnly(body, ['answers', 'form_version', 'idempotency_key', 'website', 'privacy_notice_version']);
  if (typeof body.website !== 'string' || body.website !== '') throw new ApiError(400, 'Envio não aceito.');
  if (body.form_version !== schema.form_version) throw new ApiError(400, 'Versão do formulário desatualizada. Recarregue antes de responder.', { form_version: 'Versão não aceita.' });
  if (!isUUID(body.idempotency_key)) throw new ApiError(400, 'Chave de idempotência inválida.');
  if (typeof body.privacy_notice_version !== 'string' || !body.privacy_notice_version.trim() || body.privacy_notice_version.length > 100) throw new ApiError(400, 'Versão do aviso inválida.');
  return { answers: validateAnswers(body.answers, schema, parsePhoneNumber), form_version: body.form_version, idempotency_key: body.idempotency_key.toLowerCase(), privacy_notice_version: body.privacy_notice_version };
}
export const isUUID = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export const canonicalJSON = value => JSON.stringify(canonicalValue(value));
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return value;
}
export async function payloadHash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJSON(value)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApiError(400, 'Revisão inválida.');
  return value;
}
export function validateUpdate(body) {
  keysOnly(body, ['revision', 'status', 'notes', 'confirmed']);
  revision(body.revision);
  if (!STATUSES.includes(body.status) || typeof body.confirmed !== 'boolean') throw new ApiError(400, 'Status ou confirmação inválidos.');
  let notes;
  try { notes = text(body.notes, 1000, false, true); } catch (e) { throw new ApiError(400, e.message, { notes: e.message }); }
  if (body.status === 'confirmado_primeiro_encontro' && body.confirmed !== true) throw new ApiError(400, 'Confirme que houve retorno real do interessado.', { confirmed: 'Confirmação explícita obrigatória.' });
  return { ...body, notes };
}
export function validateSettings(body) {
  keysOnly(body, ['revision', 'open', 'responsible', 'channel', 'retention_days']);
  revision(body.revision);
  if (typeof body.open !== 'boolean') throw new ApiError(400, 'Informe se a coleta está aberta.');
  const fields = {}, out = { revision: body.revision, open: body.open };
  for (const key of ['responsible', 'channel']) {
    try { out[key] = body[key] === null ? null : text(body[key], key === 'channel' ? 300 : 200); }
    catch (e) { fields[key] = e.message; }
  }
  if (body.retention_days !== null && (!Number.isSafeInteger(body.retention_days) || body.retention_days < 1 || body.retention_days > 3650)) fields.retention_days = 'Informe um número inteiro de 1 a 3650 dias.';
  out.retention_days = body.retention_days;
  if (body.open) {
    for (const key of ['responsible', 'channel', 'retention_days']) if (!out[key]) fields[key] = 'Defina este dado de privacidade antes de abrir a coleta.';
  }
  if (Object.keys(fields).length) throw new ApiError(400, 'Revise a configuração.', fields);
  return out;
}
export function validateFilters(raw, schema) {
  if (raw && raw.length > 5000) throw new ApiError(400, 'Filtros excedem o tamanho permitido.');
  let f;
  try { f = raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, 'Filtros não são JSON válido.'); }
  const mapping = { localizacao: 'q02_localizacao', intencao: 'q10_intencao', generos: 'q05_generos', modelo: 'q06_modelo_leitura', frequencia: 'q07_frequencia', modalidades: 'q08_modalidades', autorizacao: 'q13_autorizacao' };
  keysOnly(f, ['search', 'from', 'to', 'slot', 'status', ...Object.keys(mapping)]);
  const out = {};
  for (const [key, value] of Object.entries(f)) {
    if (key === 'search') {
      try { out.search = text(value, 80); } catch { throw new ApiError(400, 'Busca inválida.'); }
    } else if (key === 'from' || key === 'to') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new ApiError(400, 'Data inválida; use YYYY-MM-DD.');
      out[key] = value;
    } else if (key === 'slot') {
      const q = schema.questions.find(q => q.id === 'q09_disponibilidade');
      if (value !== 'variavel' && (typeof value !== 'string' || !q.days.some(d => q.periods.some(p => `${d.value}:${p.value}` === value)))) throw new ApiError(400, 'Disponibilidade inválida.');
      out.slot = value;
    } else {
      const options = key === 'status' ? STATUSES : schema.questions.find(q => q.id === mapping[key]).options.map(o => o.value);
      if (!Array.isArray(value) || value.length > options.length || value.some(x => !options.includes(x)) || new Set(value).size !== value.length) throw new ApiError(400, `Filtro ${key} inválido.`);
      if (value.length) out[key] = value;
    }
  }
  if (out.from && out.to && out.from > out.to) throw new ApiError(400, 'Data inicial deve ser anterior à final.');
  return out;
}
export function positiveInt(raw, fallback, max) {
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) throw new ApiError(400, 'Paginação inválida.');
  return Number(raw);
}
export function csvCell(value) {
  let s = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Normalize controls (preserve line breaks for RFC4180), then neutralize even after whitespace/controls.
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (/^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function csvColumns(schema) {
  return [
    ['Protocolo', r => r.protocol], ['Recebido em (UTC)', r => r.received_at],
    ['Versão do formulário', r => r.form_version], ['Versão do aviso', r => r.privacy_notice_version],
    ['Status manual', r => r.status],
    ...schema.questions.flatMap(q => {
      if (q.type === 'contact') return [ ['Canal de contato autorizado', r => r.answers.q13_autorizacao === 'sim' ? r.answers.q14_contato?.channel : ''], ['Contato autorizado', r => r.answers.q13_autorizacao === 'sim' ? r.answers.q14_contato?.value : ''] ];
      const cols = [[q.label, r => {
        const v = r.answers[q.id];
        if (q.options) { const label = x => q.options.find(o => o.value === x)?.label || x; return Array.isArray(v) ? v.map(label).join(' | ') : v ? label(v) : ''; }
        if (q.type === 'availability' && v) return v.mode === 'variavel' ? 'Disponibilidade a combinar' : v.slots.map(s => `${s.day}:${s.period}`).join(' | ');
        return v;
      }]];
      if (q.other_field) cols.push([`${q.label} — outro`, r => r.answers[`${q.id}_outro_texto`]]);
      return cols;
    })
  ];
}
export function csvHeader(schema) { return '\ufeff' + csvColumns(schema).map(c => csvCell(c[0])).join(',') + '\r\n'; }
export function csvRow(record, schema) { return csvColumns(schema).map(c => csvCell(c[1](record))).join(',') + '\r\n'; }
export function checkOrigin(origin, mutating, authenticated) {
  if (origin !== null && !ORIGINS.includes(origin)) throw new ApiError(403, 'Origem não permitida.');
  // Public form mutations require Origin; CLI/testing without Origin is allowed ONLY for verified admins.
  if (mutating && origin === null && !authenticated) throw new ApiError(403, 'Origem obrigatória para enviar respostas.');
}
export async function readJSON(request, maxBytes = 24576) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new ApiError(400, 'Envie JSON.');
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) throw new ApiError(400, 'Corpo excede o tamanho permitido.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Corpo obrigatório.');
  let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiError(400, 'Corpo excede o tamanho permitido.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ApiError(400, 'JSON inválido.'); }
}
