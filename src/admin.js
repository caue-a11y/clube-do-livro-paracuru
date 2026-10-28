import { api } from './api.js';
import { API_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { compatible, distribution } from '../shared/analysis.js';

// Private data and both Supabase tokens exist only in this module's memory.
// A serialized request lane plus session/load generations rejects stale results.
const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 24;
const STATUS = [
  ['novo', 'Novo'], ['contatado', 'Contatado'],
  ['convidado_primeiro_encontro', 'Convidado para o primeiro encontro'],
  ['confirmado_primeiro_encontro', 'Confirmado para o primeiro encontro'],
  ['nao_participara', 'Não participará'],
];
const FILTERS = [
  ['localizacao', 'Localização', 'q02_localizacao'],
  ['intencao', 'Intenção', 'q10_intencao'],
  ['generos', 'Gêneros', 'q05_generos'],
  ['modelo', 'Modelo de leitura', 'q06_modelo_leitura'],
  ['frequencia', 'Frequência', 'q07_frequencia'],
  ['modalidades', 'Modalidade', 'q08_modalidades'],
  ['autorizacao', 'Autorização de contato', 'q13_autorizacao'],
  ['status', 'Acompanhamento', null],
];
const state = {
  session: null, epoch: 0, loginBusy: false, refreshPromise: null, refreshTimer: null,
  questionnaire: null, questions: new Map(), ready: false, records: [], total: 0,
  baseTotal: null, filters: {}, loadGeneration: 0, detailGeneration: 0,
  detail: null, detailStale: false, detailBusy: false, page: 1,
  settings: null, settingsBusy: false, settingsStale: false, settingsDirty: false,
  analyzed: false, exportGeneration: 0, exportFilters: null, exportCount: null,
  exportBusy: false, exportController: null, deleteBusy: false,
};
let requestLane = Promise.resolve();
let filterTimer;
const controllers = new Set();
const downloadUrls = new Set();
class Stale extends Error {}
class ClientError extends Error {
  constructor(message) { super(message); this.name = 'ClientError'; }
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function button(text, action, className = 'btn secondary') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function notice(id, text = '', error = false, focus = false) {
  const box = $(id);
  box.replaceChildren();
  box.className = text ? `status notice${error ? ' error' : ''}` : 'status';
  if (text) box.append(element('p', text));
  if (focus && text) { box.tabIndex = -1; box.focus(); }
}
function formError(id, error, fields = {}) {
  const message = describeError(error);
  notice(id, message, true, true);
  if (error?.fields && typeof error.fields === 'object') {
    const ul = element('ul');
    for (const [key, text] of Object.entries(error.fields)) {
      const input = fields[key];
      if (!input) continue;
      input.setAttribute('aria-invalid', 'true');
      const link = element('a', typeof text === 'string' ? text : 'Revise este campo.');
      link.href = `#${input.id}`;
      link.addEventListener('click', (event) => { event.preventDefault(); input.focus(); });
      ul.append(append(element('li'), link));
    }
    if (ul.childElementCount) $(id).append(ul);
  }
}
function clearInvalid(form) {
  form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
}
function describeError(error) {
  if (error instanceof ClientError) return error.message;
  switch (Number(error?.status)) {
    case 400: return 'Há dados inválidos. Revise os campos indicados e tente novamente.';
    case 401: return 'A sessão expirou ou não é válida. Entre novamente para continuar.';
    case 403: return 'Acesso exclusivo do organizador. A autorização administrativa no servidor está pendente ou foi removida. Peça ao responsável técnico para concluir a autorização da conta no Supabase; não compartilhe credenciais.';
    case 409: return 'Os dados foram alterados por outro acesso. Recarregue este detalhe ou configuração antes de salvar novamente; suas alterações não foram sobrescritas.';
    case 429: return 'Muitas solicitações em pouco tempo. Aguarde um momento e tente novamente.';
    case 503: return 'O serviço está indisponível. Nenhuma operação foi confirmada; tente novamente mais tarde.';
    default: return 'Não foi possível concluir a consulta ao servidor. Confira a conexão e tente novamente. Nenhuma alteração foi confirmada.';
  }
}
function guard(epoch = state.epoch) {
  if (!state.session || epoch !== state.epoch) throw new Stale();
}
function queue(work, epoch = state.epoch) {
  const operation = requestLane.catch(() => {}).then(async () => {
    guard(epoch);
    return work(epoch);
  });
  requestLane = operation.catch(() => {});
  return operation;
}
function checkGeneration(generation, epoch) {
  guard(epoch);
  if (generation !== state.loadGeneration) throw new Stale();
}
function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}
function configured() {
  return validEndpoint(SUPABASE_URL) && validEndpoint(API_URL)
    && typeof SUPABASE_PUBLISHABLE_KEY === 'string' && SUPABASE_PUBLISHABLE_KEY.trim().length > 10
    && !/PREENCH|YOUR_|PLACEHOLDER|EXAMPLE|SEU_PROJETO|SEU-PROJETO/i.test(`${SUPABASE_URL} ${API_URL} ${SUPABASE_PUBLISHABLE_KEY}`);
}
async function authRequest(grant, body, signal) {
  const timeoutController = new AbortController();
  const abort = () => timeoutController.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 25000);
  try {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: timeoutController.signal,
  });
  if (!response.ok) {
    const error = new Error('Falha de autenticação'); error.status = response.status; throw error;
  }
  const data = await response.json();
  if (!data.access_token || !data.refresh_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
    throw new ClientError('O provedor de autenticação não retornou uma sessão válida. Tente entrar novamente.');
  }
  return {
    access: data.access_token, refresh: data.refresh_token,
    expires: Date.now() + Number(data.expires_in) * 1000,
  };
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
function armRefresh() {
  clearTimeout(state.refreshTimer);
  if (!state.session) return;
  const epoch = state.epoch;
  const delay = Math.max(1000, state.session.expires - Date.now() - 60000);
  state.refreshTimer = setTimeout(() => {
    queue(() => ensureToken(epoch, true), epoch).catch((error) => {
      if (error instanceof Stale || epoch !== state.epoch) return;
      endSession('Não foi possível renovar a sessão com segurança. Entre novamente.');
    });
  }, Math.min(delay, 2147483647));
}
async function ensureToken(epoch = state.epoch, force = false) {
  guard(epoch);
  if (!force && state.session.expires > Date.now() + 60000) return state.session.access;
  if (!state.refreshPromise) {
    const controller = new AbortController(); controllers.add(controller);
    const refresh = state.session.refresh;
    state.refreshPromise = (async () => {
      try {
        const session = await authRequest('refresh_token', { refresh_token: refresh }, controller.signal);
        guard(epoch);
        state.session = session; armRefresh();
        return session.access;
      } catch (error) {
        if (epoch === state.epoch && !(error instanceof Stale)) endSession('A sessão terminou ou não pôde ser renovada. Entre novamente.');
        throw error;
      } finally { controllers.delete(controller); }
    })();
    const currentPromise = state.refreshPromise;
    currentPromise.finally(() => { if (state.refreshPromise === currentPromise) state.refreshPromise = null; }).catch(() => {});
  }
  const token = await state.refreshPromise;
  guard(epoch);
  return token;
}
async function privateApi(path, options = {}, epoch = state.epoch) {
  const token = await ensureToken(epoch);
  guard(epoch);
  const controller = new AbortController(); controllers.add(controller);
  try {
    const result = await api(path, { ...options, token, signal: controller.signal });
    guard(epoch);
    return result;
  } catch (error) {
    if (epoch !== state.epoch) throw new Stale();
    if ([401, 403].includes(Number(error.status))) endSession(describeError(error));
    throw error;
  } finally { controllers.delete(controller); }
}
function revokeSession(access) {
  if (!access || !validEndpoint(SUPABASE_URL)) return Promise.resolve();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  return fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/logout`, {
    method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${access}` },
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true, signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}
function clearPrivateData() {
  state.epoch++; state.loadGeneration++; state.detailGeneration++; state.exportGeneration++;
  clearTimeout(state.refreshTimer); clearTimeout(filterTimer);
  for (const controller of controllers) controller.abort();
  controllers.clear();
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
  state.session = null; state.refreshPromise = null; state.records = []; state.filters = {};
  state.detail = null; state.settings = null; state.total = 0; state.baseTotal = null;
  state.ready = false; state.page = 1; state.analyzed = false; state.exportFilters = null;
  state.exportCount = null; state.exportController = null; state.detailStale = false; state.settingsStale = false;
  state.detailBusy = false; state.settingsBusy = false; state.settingsDirty = false; state.exportBusy = false; state.deleteBusy = false;
  for (const id of ['response-list', 'metrics', 'evolution', 'distributions', 'detail-content', 'analysis-result', 'collection-state', 'updated-at', 'list-count', 'page-label', 'delete-target']) $(id).replaceChildren();
  for (const id of ['panel-message', 'settings-message', 'detail-message', 'export-message', 'delete-message']) notice(id);
  for (const id of ['export-dialog', 'delete-dialog']) if ($(id).open) $(id).close();
  for (const id of ['filters-form', 'scenario-form', 'settings-form', 'export-form', 'delete-form', 'login-form']) $(id).reset();
  $('export-count').textContent = 'Escolha um conjunto para consultar a quantidade.';
  $('detail-section').hidden = true; $('private-panel').hidden = true;
  $('login-panel').hidden = false; $('logout').hidden = true;
  $('login-password').value = ''; $('login-email').value = '';
  $('response-list').setAttribute('aria-busy', 'false');
  updateFilterSummary({}); syncControls();
}
function endSession(message, revoke = true) {
  const access = state.session?.access;
  clearPrivateData();
  notice('login-message', message, true, true);
  if (revoke) revokeSession(access).catch(() => {});
}
async function login(event) {
  event.preventDefault();
  if (state.loginBusy || !state.questionnaire) return;
  if (!configured()) { notice('login-message', 'Configuração técnica pendente. O responsável técnico precisa informar os endereços do Supabase e da API e a chave pública em config.js. O acesso continua restrito ao organizador.', true, true); return; }
  state.loginBusy = true; $('login-submit').disabled = true; notice('login-message', 'Validando acesso no Supabase…');
  const epoch = state.epoch;
  const controller = new AbortController(); controllers.add(controller);
  try {
    const operation = authRequest('password', { email: $('login-email').value.trim(), password: $('login-password').value }, controller.signal);
    $('login-password').value = '';
    const session = await operation;
    if (epoch !== state.epoch) { revokeSession(session.access).catch(() => {}); throw new Stale(); }
    state.session = session; armRefresh();
    // Authorization must be established by the server before any private UI is shown.
    const settings = await queue((runEpoch) => privateApi('/admin/config', {}, runEpoch), epoch);
    guard(epoch);
    state.settings = settings;
    $('login-form').reset(); $('login-panel').hidden = true; $('private-panel').hidden = false; $('logout').hidden = false;
    notice('login-message'); renderSettings();
    $('panel-title').tabIndex = -1; $('panel-title').focus();
    scheduleLoad(false);
  } catch (error) {
    if (error instanceof Stale || epoch !== state.epoch) return;
    const message = [400, 401, 422].includes(Number(error.status))
      ? 'Não foi possível entrar. Confira suas credenciais de acesso. O painel é exclusivo do organizador autorizado.' : describeError(error);
    endSession(message);
  } finally {
    controllers.delete(controller); state.loginBusy = false;
    $('login-submit').disabled = !state.questionnaire;
  }
}
function question(id) { return state.questions.get(id); }
function label(qid, value) {
  return question(qid)?.options?.find((option) => option.value === value)?.label ?? String(value ?? 'Sem resposta');
}
function answer(record, qid) { return record?.answers?.[qid]; }
function name(record) { return String(answer(record, 'q01_nome') || 'Nome não informado'); }
function statusLabel(value) { return STATUS.find(([key]) => key === value)?.[1] ?? String(value || 'Não informado'); }
function hasAuthorization(record) { return answer(record, 'q13_autorizacao') === 'sim'; }
function countMetric(container, title, value) {
  const card = element('div', null, 'metric');
  append(card, element('strong', value), element('span', title)); container.append(card);
}
function formatInstant(instant) {
  const date = new Date(instant);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Data não informada';
}
function saoPauloDay(instant) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function dayLabel(key) { return key.split('-').reverse().join('/'); }
function choiceOptions(qid) { return question(qid)?.options || []; }
function addSelect(parent, id, title, options, emptyLabel, required = false) {
  const field = element('div', null, 'field');
  const lbl = element('label', title); lbl.htmlFor = id;
  const select = element('select'); select.id = id; select.required = required;
  const empty = element('option', emptyLabel); empty.value = ''; select.append(empty);
  for (const option of options) {
    const node = element('option', option.label); node.value = option.value; select.append(node);
  }
  append(field, lbl, select); parent.append(field); return select;
}
function buildForms() {
  const destination = $('choice-filters'); destination.replaceChildren();
  for (const [key, title, qid] of FILTERS) {
    const details = element('details'); details.dataset.filter = key;
    const summary = element('summary', `${title} · Todas`); summary.dataset.title = title;
    const choices = element('div', null, 'choices');
    choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', title);
    const options = qid ? choiceOptions(qid) : STATUS.map(([value, text]) => ({ value, label: text }));
    for (const option of options) {
      const checkLabel = element('label', null, 'check');
      const input = element('input'); input.type = 'checkbox'; input.name = key; input.value = option.value;
      append(checkLabel, input, element('span', option.label)); choices.append(checkLabel);
    }
    append(details, summary, choices); destination.append(details);
  }
  const availability = question('q09_disponibilidade');
  for (const day of availability.days) for (const period of availability.periods) {
    const option = element('option', `${day.label} · ${period.label}`);
    option.value = `${day.value}:${period.value}`; $('filter-slot').append(option);
  }
  const variable = element('option', 'Disponibilidade variável'); variable.value = 'variavel'; $('filter-slot').append(variable);
  const scenarios = $('scenario-fields'); scenarios.replaceChildren();
  addSelect(scenarios, 'scenario-day', 'Dia da semana', availability.days, 'Escolha o dia', true);
  addSelect(scenarios, 'scenario-period', 'Período', availability.periods, 'Escolha o período', true);
  addSelect(scenarios, 'scenario-modality', 'Modalidade', choiceOptions('q08_modalidades'), 'Escolha a modalidade', true);
  addSelect(scenarios, 'scenario-frequency', 'Frequência exata', choiceOptions('q07_frequencia').filter((option) => ['semanal', 'quinzenal', 'mensal'].includes(option.value)), 'Escolha a frequência', true);
  addSelect(scenarios, 'scenario-genre', 'Gênero (opcional)', choiceOptions('q05_generos'), 'Sem restringir gênero');
  addSelect(scenarios, 'scenario-model', 'Modelo (opcional)', choiceOptions('q06_modelo_leitura'), 'Sem restringir modelo');
}
function readFilters() {
  const filters = {};
  for (const key of ['search', 'from', 'to', 'slot']) {
    const value = $(`filter-${key}`).value.trim(); if (value) filters[key] = value;
  }
  for (const [key] of FILTERS) {
    const values = [...$('filters-form').querySelectorAll(`input[name="${key}"]:checked`)].map((input) => input.value);
    if (values.length) filters[key] = values;
  }
  return filters;
}
function updateFilterSummary(filters) {
  for (const details of $('choice-filters').querySelectorAll('details')) {
    const summary = details.querySelector('summary');
    const count = filters[details.dataset.filter]?.length || 0;
    summary.textContent = `${summary.dataset.title} · ${count ? `${count} selecionada(s)` : 'Todas'}`;
  }
  const descriptions = [];
  if (filters.search) descriptions.push(`Nome contém “${filters.search}”`);
  if (filters.from || filters.to) descriptions.push(`Envio: ${filters.from ? dayLabel(filters.from) : 'início'} até ${filters.to ? dayLabel(filters.to) : 'hoje'}`);
  for (const [key, title, qid] of FILTERS) if (filters[key]?.length) {
    descriptions.push(`${title}: ${filters[key].map((value) => qid ? label(qid, value) : statusLabel(value)).join(' OU ')}`);
  }
  if (filters.slot) descriptions.push(`Disponibilidade: ${$('filter-slot').selectedOptions[0].textContent}`);
  $('filter-summary').textContent = descriptions.length ? `Recorte (E entre grupos): ${descriptions.join(' · E · ')}` : 'Sem filtros ativos: base completa.';
}
function listPath(filters, page = 1, pageSize = 100) {
  const params = new URLSearchParams({ filters: JSON.stringify(filters), page: String(page), page_size: String(pageSize) });
  return `/admin/respostas?${params}`;
}
function validatePage(result) {
  if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0) throw new ClientError('O servidor retornou uma lista inválida. Não foi possível calcular indicadores completos.');
}
async function readAllPages(filters, generation, epoch) {
  const records = []; const ids = new Set();
  let total = null;
  for (let page = 1; total === null || records.length < total; page++) {
    checkGeneration(generation, epoch);
    const result = await privateApi(listPath(filters, page), {}, epoch);
    checkGeneration(generation, epoch); validatePage(result);
    if (total === null) total = result.total;
    if (result.total !== total || (total > records.length && result.items.length === 0)) throw new ClientError('A base mudou durante a consulta. Atualize os dados para obter um recorte completo; nenhum indicador parcial será exibido.');
    for (const record of result.items) {
      if (!record || typeof record.id !== 'string' || !record.answers || ids.has(record.id)) throw new ClientError('A paginação mudou durante a consulta. Atualize os dados novamente; nenhum indicador parcial será exibido.');
      // Defense in depth: list data must not retain contact even if the API regresses.
      const { q14_contato: ignoredContact, ...answers } = record.answers;
      ids.add(record.id); records.push({ id: record.id, protocol: record.protocol, received_at: record.received_at, answers, status: record.status, revision: record.revision });
    }
    if (records.length > total) throw new ClientError('A contagem mudou durante a consulta. Atualize para consultar a base novamente.');
    if (total === 0) break;
  }
  return { records, total: total ?? 0 };
}
function emptyAnalysis(text = 'Aguardando consulta completa do recorte.') {
  for (const id of ['metrics', 'evolution', 'distributions', 'response-list', 'analysis-result']) $(id).replaceChildren();
  $('response-list').append(element('p', text, 'empty'));
  $('list-count').textContent = text; $('page-label').textContent = '';
}
function syncControls() {
  const authorized = Boolean(state.session);
  $('open-export').disabled = !authorized || !state.ready;
  $('analyze').disabled = !authorized || !state.ready;
  $('previous-page').disabled = !state.ready || state.page <= 1;
  $('next-page').disabled = !state.ready || state.page >= Math.ceil(state.records.length / PAGE_SIZE);
  $('save-settings').disabled = !authorized || !state.settings || state.settingsBusy || state.settingsStale;
  $('reload-settings').disabled = !authorized || state.settingsBusy;
  const save = $('save-detail'); if (save) save.disabled = !authorized || state.detailBusy || state.detailStale;
  const remove = $('open-delete'); if (remove) remove.disabled = !authorized || state.detailBusy || state.detailStale;
  const reload = $('reload-detail'); if (reload) reload.disabled = !authorized || state.detailBusy;
  $('export-confirm').disabled = !authorized || state.exportBusy || state.exportCount === null || state.exportCount < 1 || !$('export-ack').checked;
  $('export-cancel').disabled = false;
  $('export-form').querySelectorAll('input').forEach((input) => { input.disabled = state.exportBusy; });
  $('delete-confirm').disabled = !authorized || state.deleteBusy || state.detailStale;
  $('delete-cancel').disabled = state.deleteBusy;
  $('delete-protocol').disabled = state.deleteBusy;
  $('close-detail').disabled = state.detailBusy;
  for (const id of ['detail-status', 'detail-notes', 'detail-confirmed']) if ($(id)) $(id).disabled = state.detailBusy;
  $('settings-form').querySelectorAll('input').forEach((input) => { input.disabled = state.settingsBusy; });
}
function scheduleLoad(includeSettings = false) {
  clearTimeout(filterTimer);
  if (!state.session) return;
  const filters = readFilters(); updateFilterSummary(filters);
  const generation = ++state.loadGeneration; const epoch = state.epoch;
  state.ready = false; state.exportGeneration++;
  if ($('export-dialog').open) cancelExport();
  syncControls();
  if (filters.from && filters.to && filters.from > filters.to) {
    emptyAnalysis('Revise o período selecionado.');
    notice('panel-message', 'A data inicial não pode ser posterior à data final.', true, true); return;
  }
  emptyAnalysis('Consultando todas as páginas do recorte…');
  $('response-list').setAttribute('aria-busy', 'true');
  notice('panel-message', 'Carregando a base autorizada. Os indicadores só aparecem após a consulta completa.');
  queue(async () => {
    checkGeneration(generation, epoch);
    if (includeSettings) {
      const settings = await privateApi('/admin/config', {}, epoch);
      checkGeneration(generation, epoch); state.settings = settings; state.settingsStale = false; renderSettings();
    }
    const data = await readAllPages(filters, generation, epoch);
    let baseTotal = data.total;
    if (Object.keys(filters).length) {
      const base = await privateApi(listPath({}, 1, 1), {}, epoch); validatePage(base); baseTotal = base.total;
    }
    checkGeneration(generation, epoch);
    state.records = data.records; state.total = data.total; state.baseTotal = baseTotal;
    state.filters = filters; state.page = 1; state.ready = true;
    renderSummary(); renderList();
    if (state.analyzed) renderCompatibility();
    $('updated-at').textContent = `Última consulta completa: ${formatInstant(new Date())} · America/Sao_Paulo. Indicadores sobre todas as ${data.total} respostas do recorte.`;
    notice('panel-message', data.total ? 'Dados atualizados. Todas as páginas do recorte foram consideradas.' : (baseTotal ? 'Nenhuma resposta corresponde a este recorte. Limpe ou ajuste os filtros.' : 'A base ainda não tem respostas. Nenhum dado de exemplo foi incluído.'));
  }, epoch).catch((error) => {
    if (error instanceof Stale || epoch !== state.epoch || generation !== state.loadGeneration) return;
    state.ready = false; state.records = []; emptyAnalysis('Consulta não concluída. Use “Atualizar dados” para tentar novamente.');
    notice('panel-message', describeError(error), true, true);
  }).finally(() => {
    if (generation !== state.loadGeneration || epoch !== state.epoch) return;
    $('response-list').setAttribute('aria-busy', 'false'); syncControls();
  });
}
function renderSummary() {
  const records = state.records; const metrics = $('metrics'); metrics.replaceChildren();
  const regular = records.filter((record) => answer(record, 'q10_intencao') === 'regular');
  const authorized = records.filter(hasAuthorization);
  countMetric(metrics, 'Respostas válidas na base inteira', state.baseTotal);
  countMetric(metrics, 'Respostas no recorte / período', records.length);
  countMetric(metrics, 'Interesse regular no recorte', regular.length);
  countMetric(metrics, 'Disponibilidade variável no recorte', records.filter((record) => answer(record, 'q09_disponibilidade')?.mode === 'variavel').length);
  countMetric(metrics, 'Contato autorizado no recorte', authorized.length);
  countMetric(metrics, 'Núcleo regular contatável no recorte', regular.filter(hasAuthorization).length);
  countMetric(metrics, 'Confirmados manualmente no recorte', records.filter((record) => record.status === 'confirmado_primeiro_encontro').length);
  renderEvolution(); renderDistributions();
}
function dataTable(captionText, rows, denominator = null) {
  const table = element('table'); table.append(element('caption', captionText));
  const head = element('thead'); const headRow = element('tr');
  for (const text of ['Alternativa / dia', 'Respostas']) { const th = element('th', text); th.scope = 'col'; headRow.append(th); }
  head.append(headRow); table.append(head);
  const body = element('tbody');
  for (const [text, count] of rows) {
    const row = element('tr'); const th = element('th', text); th.scope = 'row';
    const pct = denominator ? count / denominator * 100 : 0;
    const td = element('td', denominator === null ? String(count) : `${count} · ${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
    const bar = element('div', null, 'bar'); bar.setAttribute('aria-hidden', 'true');
    const fill = element('span'); fill.style.width = `${Math.min(100, Math.max(0, pct))}%`; bar.append(fill);
    if (denominator !== null) td.append(bar);
    append(row, th, td); body.append(row);
  }
  table.append(body); return table;
}
function renderEvolution() {
  const destination = $('evolution'); destination.replaceChildren();
  if (!state.records.length) { destination.append(element('p', 'Sem respostas no recorte.', 'empty')); return; }
  const counts = new Map(); let missing = 0;
  for (const record of state.records) {
    const day = saoPauloDay(record.received_at);
    if (!day) { missing++; continue; }
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  const rows = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => [dayLabel(day), count]);
  destination.append(dataTable('Registros por dia · America/Sao_Paulo', rows, state.records.length));
  destination.append(element('p', `Base: ${state.records.length} registros no recorte. Dias sem registros não aparecem. Sem data válida: ${missing}.`, 'help'));
}
function renderDistributions() {
  const destination = $('distributions'); destination.replaceChildren();
  for (const q of state.questionnaire.questions.filter((item) => ['single_choice', 'multiple_choice'].includes(item.type))) {
    const section = element('section', null, 'distribution');
    const result = distribution(state.records, q.id);
    const counts = result.counts instanceof Map ? Object.fromEntries(result.counts) : (result.counts || {});
    const answered = Number(result.answered) || 0; const missing = Number(result.missing) || 0;
    const rows = choiceOptions(q.id).map((option) => [option.label, Number(counts[option.value]) || 0]);
    for (const [value, count] of Object.entries(counts)) {
      if (!q.options.some((option) => option.value === value)) rows.push([`Alternativa de outra versão: ${value}`, Number(count) || 0]);
    }
    section.append(dataTable(`Q${q.number}. ${q.label}`, rows, answered));
    section.append(element('p', `Denominador: ${answered} responderam. Sem resposta: ${missing}. Base do recorte: ${state.records.length}.${q.type === 'multiple_choice' ? ' Múltiplas escolhas; não some as alternativas como pessoas.' : ''}`));
    destination.append(section);
  }
}
function renderList() {
  const destination = $('response-list'); destination.replaceChildren();
  if (!state.records.length) destination.append(element('p', state.baseTotal ? 'Nenhuma correspondência. Experimente limpar os filtros.' : 'Ainda não há respostas recebidas.', 'empty'));
  const start = (state.page - 1) * PAGE_SIZE;
  for (const record of state.records.slice(start, start + PAGE_SIZE)) {
    const card = element('article', null, 'response-card');
    append(card, element('span', statusLabel(record.status), 'badge'), element('h3', name(record)));
    const list = element('dl');
    const rows = [
      ['Recebida', `${formatInstant(record.received_at)} · Brasília`],
      ['Localização', label('q02_localizacao', answer(record, 'q02_localizacao'))],
      ['Intenção', label('q10_intencao', answer(record, 'q10_intencao'))],
      ['Modalidades', (Array.isArray(answer(record, 'q08_modalidades')) ? answer(record, 'q08_modalidades') : []).map((value) => label('q08_modalidades', value)).join(' / ') || 'Sem resposta'],
      ['Frequência', label('q07_frequencia', answer(record, 'q07_frequencia'))],
      ['Contato autorizado', hasAuthorization(record) ? 'Sim · veja o contato no detalhe' : 'Não'],
    ];
    for (const [title, value] of rows) append(list, element('dt', title), element('dd', value));
    const action = button('Ver resposta e acompanhamento', () => openDetail(record.id));
    action.setAttribute('aria-label', `Ver resposta de ${name(record)}`);
    append(card, list, action); destination.append(card);
  }
  const end = Math.min(start + PAGE_SIZE, state.records.length);
  $('list-count').textContent = state.records.length ? `Exibindo ${start + 1}–${end} de ${state.records.length} respostas filtradas. Contato completo somente no detalhe.` : '0 respostas no recorte.';
  $('page-label').textContent = state.records.length ? `Página ${state.page} de ${Math.ceil(state.records.length / PAGE_SIZE)}` : 'Sem páginas';
  syncControls();
}
function readableAnswer(record, q) {
  const value = answer(record, q.id);
  if (q.type === 'contact') {
    if (!hasAuthorization(record)) return 'Contato não autorizado; nenhum contato deve ser armazenado.';
    if (!value || typeof value !== 'object') return 'Contato não informado no detalhe. Não presuma que seja possível contatar.';
    const channel = q.channels.find((item) => item.value === value.channel)?.label || 'Canal não informado';
    return `${channel}: ${String(value.value || 'Não informado')}`;
  }
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return 'Sem resposta';
  if (q.type === 'availability') {
    if (value.mode === 'variavel') return q.variable_option.label;
    if (!Array.isArray(value.slots)) return 'Sem resposta';
    return value.slots.map((slot) => `${q.days.find((day) => day.value === slot.day)?.label || slot.day} · ${q.periods.find((period) => period.value === slot.period)?.label || slot.period}`).join('\n');
  }
  let text = Array.isArray(value) ? value.map((option) => label(q.id, option)).join('\n') : label(q.id, value);
  const other = answer(record, `${q.id}_outro_texto`);
  if (Array.isArray(value) && value.includes('outro') && typeof other === 'string') text += `\nComplemento: ${other}`;
  return text;
}
function closeDetail() {
  state.detailGeneration++; state.detail = null; state.detailStale = false; state.detailBusy = false;
  $('detail-content').replaceChildren(); notice('detail-message'); $('detail-section').hidden = true;
}
function openDetail(id) {
  if (!state.session || state.detailBusy) return;
  const generation = ++state.detailGeneration; const epoch = state.epoch;
  state.detail = null; state.detailStale = false; state.detailBusy = true;
  $('detail-section').hidden = false; $('detail-content').replaceChildren();
  notice('detail-message', 'Consultando a resposta completa no servidor…'); $('detail-title').focus();
  queue(async () => {
    if (generation !== state.detailGeneration) throw new Stale();
    const record = await privateApi(`/admin/respostas/${encodeURIComponent(id)}`, {}, epoch);
    if (generation !== state.detailGeneration) throw new Stale();
    if (!record?.answers || record.id !== id) throw new ClientError('O servidor não retornou o detalhe solicitado. Tente consultar novamente.');
    state.detail = record; renderDetail(); notice('detail-message');
  }, epoch).catch((error) => {
    if (error instanceof Stale || epoch !== state.epoch || generation !== state.detailGeneration) return;
    notice('detail-message', describeError(error), true, true);
    $('detail-content').append(button('Tentar consultar novamente', () => openDetail(id)));
  }).finally(() => {
    if (epoch !== state.epoch || generation !== state.detailGeneration) return;
    state.detailBusy = false; syncControls();
  });
}
function renderDetail() {
  const record = state.detail; if (!record) return;
  const destination = $('detail-content'); destination.replaceChildren();
  destination.append(element('h3', name(record)));
  const metadata = element('div', null, 'metadata');
  for (const text of [`Protocolo: ${record.protocol || 'Não informado'}`, `Recebida: ${formatInstant(record.received_at)} · Brasília`, `Versão do formulário: ${record.form_version || 'Não informada'}`, `Revisão administrativa: ${record.revision ?? 'Não informada'}`]) metadata.append(element('span', text));
  if (record.updated_at) metadata.append(element('span', `Atualizada: ${formatInstant(record.updated_at)}`));
  destination.append(metadata);
  const layout = element('div', null, 'detail-layout');
  const original = element('section'); original.append(element('h3', 'Respostas originais · somente leitura'));
  const answers = element('dl', null, 'answer-list');
  for (const q of state.questionnaire.questions) append(answers, element('dt', `Q${q.number}. ${q.label}`), element('dd', readableAnswer(record, q)));
  original.append(answers); layout.append(original);
  const controls = element('section', null, 'detail-controls'); controls.append(element('h3', 'Acompanhamento manual'));
  controls.append(element('p', 'Status não envia mensagens. Registre apenas ações que você realizou. Todos os estados além de “Novo” exigem autorização de contato.', 'help'));
  const form = element('form', null, 'stack'); form.id = 'detail-form';
  const select = addSelect(form, 'detail-status', 'Status do primeiro encontro', STATUS.map(([value, text]) => ({ value, label: text })), 'Escolha o status', true);
  select.value = record.status;
  for (const option of select.options) if (option.value && option.value !== 'novo' && !hasAuthorization(record)) option.disabled = true;
  const notesField = element('div', null, 'field');
  const notesLabel = element('label', 'Observações internas'); notesLabel.htmlFor = 'detail-notes';
  const notes = element('textarea'); notes.id = 'detail-notes'; notes.maxLength = 1000; notes.rows = 5; notes.value = typeof record.notes === 'string' ? record.notes : '';
  append(notesField, notesLabel, notes, element('p', 'Até 1.000 caracteres. Evite dados sensíveis ou informações desnecessárias.', 'help')); form.append(notesField);
  const confirmedLabel = element('label', null, 'check'); confirmedLabel.id = 'confirmation-label';
  const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.id = 'detail-confirmed';
  append(confirmedLabel, checkbox, element('span', 'Confirmo que houve retorno real do interessado sobre sua participação no primeiro encontro.'));
  const toggle = () => {
    const confirmed = select.value === 'confirmado_primeiro_encontro';
    confirmedLabel.hidden = !confirmed; checkbox.required = confirmed; checkbox.checked = false;
  };
  select.addEventListener('change', toggle); toggle(); form.append(confirmedLabel);
  const actions = element('div', null, 'actions');
  const save = element('button', 'Salvar acompanhamento', 'btn'); save.id = 'save-detail'; save.type = 'submit';
  const reload = button('Recarregar detalhe', () => {
    if (!state.detail) return;
    if (!window.confirm('Recarregar descarta alterações não salvas deste detalhe. Continuar?')) return;
    openDetail(state.detail.id);
  }); reload.id = 'reload-detail';
  append(actions, save, reload); form.append(actions); form.addEventListener('submit', saveDetail);
  controls.append(form);
  const remove = button('Excluir resposta…', openDelete, 'btn danger'); remove.id = 'open-delete'; remove.style.marginTop = '24px'; controls.append(remove);
  controls.append(element('h3', 'Histórico administrativo', null)); controls.lastElementChild.style.marginTop = '26px';
  controls.append(element('p', 'Alterações e autoria são auditadas no servidor. Os registros abaixo não representam ações automáticas.', 'help'));
  const history = element('ol', null, 'history-list');
  if (Array.isArray(record.history) && record.history.length) {
    for (const item of record.history) {
      const action = ['status_update', 'update', 'status_notes'].includes(item.action) ? 'Atualização de acompanhamento' : String(item.action || 'Alteração administrativa');
      const before = item.before_status ?? item.old_status ?? item.before?.status;
      const after = item.after_status ?? item.new_status ?? item.after?.status;
      const date = item.occurred_at ?? item.created_at ?? item.at ?? item.changed_at;
      let text = `${formatInstant(date)} · ${action}`;
      if (before || after) text += ` · ${statusLabel(before)} → ${statusLabel(after)}`;
      if (item.actor_label) text += ` · ${String(item.actor_label)}`;
      else text += ' · Autoria administrativa registrada no servidor';
      if (item.confirmation_asserted === true) text += ' · Retorno real declarado pelo organizador';
      // Never copy history payloads, emails or user identifiers into the UI.
      history.append(element('li', text));
    }
    controls.append(history);
  } else controls.append(element('p', 'Nenhuma alteração administrativa foi retornada pelo servidor.', 'help'));
  layout.append(controls); destination.append(layout); syncControls();
}
async function saveDetail(event) {
  event.preventDefault();
  if (!state.detail || state.detailBusy || state.detailStale) return;
  const record = state.detail; const epoch = state.epoch; const generation = state.detailGeneration;
  const status = $('detail-status').value; const notes = $('detail-notes').value; const confirmed = $('detail-confirmed').checked;
  if (status !== 'novo' && !hasAuthorization(record)) { notice('detail-message', 'Este estado exige autorização de contato. As respostas originais não serão alteradas.', true, true); return; }
  if (status === 'confirmado_primeiro_encontro' && !confirmed) { notice('detail-message', 'Confirme explicitamente que houve retorno real do interessado.', true, true); $('detail-confirmed').focus(); return; }
  state.detailBusy = true; syncControls(); clearInvalid($('detail-form'));
  notice('detail-message', 'Salvando no servidor com controle de revisão…');
  try {
    const updated = await queue(() => privateApi(`/admin/respostas/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: { revision: record.revision, status, notes, confirmed } }, epoch), epoch);
    if (generation !== state.detailGeneration) return;
    if (!updated?.answers || updated.id !== record.id) throw new ClientError('O servidor não confirmou o detalhe atualizado. Recarregue antes de tentar salvar novamente.');
    state.detail = updated; renderDetail(); notice('detail-message', 'Acompanhamento salvo e confirmado pelo servidor. Nenhuma mensagem foi enviada.'); scheduleLoad();
  } catch (error) {
    if (error instanceof Stale || epoch !== state.epoch || generation !== state.detailGeneration) return;
    // Unknown network outcome also requires a fresh revision before retrying.
    if (Number(error.status) === 409 || !error.status || Number(error.status) >= 500) state.detailStale = true;
    formError('detail-message', error, { status: $('detail-status'), notes: $('detail-notes'), confirmed: $('detail-confirmed') });
  } finally {
    if (epoch === state.epoch && generation === state.detailGeneration) { state.detailBusy = false; syncControls(); }
  }
}
function openDelete() {
  if (!state.detail || state.detailBusy || state.detailStale) return;
  $('delete-form').reset(); notice('delete-message');
  $('delete-target').textContent = `${name(state.detail)} · Protocolo: ${state.detail.protocol || 'Não informado'}`;
  if (!state.detail.protocol) { notice('detail-message', 'Protocolo não disponível. Recarregue o detalhe antes de excluir.', true, true); return; }
  $('delete-dialog').showModal(); $('delete-protocol').focus();
}
async function deleteRecord(event) {
  event.preventDefault();
  if (!state.detail || state.deleteBusy || state.detailStale) return;
  const record = state.detail; const generation = state.detailGeneration; const epoch = state.epoch;
  const confirmProtocol = $('delete-protocol').value.trim();
  if (confirmProtocol !== record.protocol) { notice('delete-message', 'O protocolo digitado não corresponde à resposta. Confira e digite o protocolo completo.', true, true); $('delete-protocol').focus(); return; }
  state.deleteBusy = true; state.detailBusy = true; $('delete-confirm').disabled = true; $('delete-cancel').disabled = true; syncControls();
  try {
    const result = await queue(() => privateApi(`/admin/respostas/${encodeURIComponent(record.id)}`, { method: 'DELETE', body: { revision: record.revision, confirm_protocol: confirmProtocol } }, epoch), epoch);
    if (generation !== state.detailGeneration) return;
    if (result?.deleted !== true) throw new ClientError('O servidor não confirmou a exclusão. Recarregue os dados antes de tentar novamente.');
    $('delete-dialog').close(); $('delete-form').reset(); $('delete-target').replaceChildren(); closeDetail(); scheduleLoad();
    notice('panel-message', 'Exclusão confirmada pelo servidor. Atualizando a lista e os indicadores.');
  } catch (error) {
    if (error instanceof Stale || epoch !== state.epoch || generation !== state.detailGeneration) return;
    if (Number(error.status) === 409 || !error.status || Number(error.status) >= 500) {
      state.detailStale = true;
      notice('detail-message', 'Recarregue o detalhe antes de outra alteração. A exclusão não foi confirmada nesta página.', true);
    }
    notice('delete-message', describeError(error), true, true);
  } finally {
    if (epoch === state.epoch) {
      state.deleteBusy = false; state.detailBusy = false; $('delete-confirm').disabled = state.detailStale; $('delete-cancel').disabled = false; syncControls();
    }
  }
}
function scenario() {
  return Object.fromEntries(['day', 'period', 'modality', 'frequency', 'genre', 'model'].map((key) => [key, $(`scenario-${key}`).value]));
}
function namesSection(title, records) {
  const details = element('details'); const list = Array.isArray(records) ? records : [];
  details.append(element('summary', `${title} · ${list.length}`));
  if (!list.length) details.append(element('p', 'Nenhuma resposta neste grupo.', 'choices'));
  else {
    const ul = element('ul', null, 'names');
    for (const record of list) ul.append(element('li', name(record)));
    details.append(ul);
  }
  return details;
}
function renderCompatibility() {
  const destination = $('analysis-result'); destination.replaceChildren();
  if (!state.ready) return;
  const selected = scenario();
  if (!selected.day || !selected.period || !selected.modality || !selected.frequency) return;
  try {
    const result = compatible(state.records, selected);
    if (!Array.isArray(result.items) || !Array.isArray(result.variable)) throw new ClientError('A análise não retornou listas completas. Atualize o painel antes de tentar novamente.');
    const regular = Array.isArray(result.regular) ? result.regular : result.items.filter((record) => answer(record, 'q10_intencao') === 'regular');
    const contactable = Array.isArray(result.contactable) ? result.contactable : regular.filter(hasAuthorization);
    const stats = element('div', null, 'metrics');
    countMetric(stats, 'Compatíveis com horário fixo', result.items.length);
    countMetric(stats, 'Destes, interesse regular', regular.length);
    countMetric(stats, 'Destes, regulares contatáveis', contactable.length);
    countMetric(stats, 'Horário variável · a combinar', result.variable.length);
    destination.append(element('p', `Cenário aplicado a todas as ${state.records.length} respostas do recorte. Gênero: ${selected.genre ? label('q05_generos', selected.genre) : 'sem restrição'}. Modelo: ${selected.model ? label('q06_modelo_leitura', selected.model) : 'sem restrição'}.`, 'help'));
    append(destination, stats, namesSection('Compatíveis com horário fixo', result.items), namesSection('Compatíveis e com interesse regular', regular), namesSection('Núcleo regular contatável com horário fixo', contactable), namesSection('Disponibilidade a combinar (não incluída no horário fixo)', result.variable));
  } catch (error) {
    destination.append(element('p', error instanceof ClientError ? error.message : 'Não foi possível calcular a compatibilidade. Atualize os dados e tente novamente.', 'notice error'));
  }
}
function privacySettings(config) {
  return {
    responsible: config?.privacy?.responsible ?? config?.responsible ?? '',
    channel: config?.privacy?.channel ?? config?.channel ?? '',
    retention_days: config?.privacy?.retention_days ?? config?.retention_days ?? '',
  };
}
function renderSettings() {
  const config = state.settings; if (!config) return;
  const privacy = privacySettings(config);
  $('privacy-responsible').value = privacy.responsible;
  $('privacy-channel').value = privacy.channel;
  $('privacy-retention').value = privacy.retention_days;
  $('collection-open').checked = config.open === true; $('privacy-real').checked = false;
  state.settingsDirty = false;
  $('collection-state').textContent = config.open === true
    ? 'Coleta aberta no servidor. As respostas permanecem privadas. A abertura não confirma nenhum encontro.'
    : 'Coleta encerrada no servidor. Não são aceitas novas respostas; o painel privado continua disponível.';
  clearInvalid($('settings-form')); syncControls();
}
function realPrivacy(privacy) {
  const placeholder = /^(pendente|a definir|definir|teste|test|exemplo|example|respons[aá]vel|nome|n\/?a|seu nome|seu e-?mail|seu contato|[.\-_]+)$/i;
  return typeof privacy.responsible === 'string' && typeof privacy.channel === 'string'
    && privacy.responsible.trim().length > 1 && privacy.channel.trim().length > 2
    && !placeholder.test(privacy.responsible.trim()) && !placeholder.test(privacy.channel.trim())
    && !/example\.(com|org)|exemplo\.(com|org)|localhost|preencher|substituir/i.test(`${privacy.responsible} ${privacy.channel}`)
    && Number.isSafeInteger(privacy.retention_days) && privacy.retention_days > 0;
}
async function saveSettings(event) {
  event.preventDefault();
  if (!state.settings || state.settingsBusy || state.settingsStale) return;
  const open = $('collection-open').checked;
  const privacy = {
    responsible: $('privacy-responsible').value.trim() || null,
    channel: $('privacy-channel').value.trim() || null,
    retention_days: $('privacy-retention').value === '' ? null : Number($('privacy-retention').value),
  };
  if (open && (!realPrivacy(privacy) || !$('privacy-real').checked)) {
    notice('settings-message', 'Abertura bloqueada: informe responsável, canal de privacidade e retenção reais, e confirme que esses dados e o procedimento de exclusão foram definidos. Não use dados de demonstração.', true, true); return;
  }
  const epoch = state.epoch;
  const body = { ...privacy, open, revision: state.settings.revision };
  state.settingsBusy = true; syncControls(); clearInvalid($('settings-form'));
  notice('settings-message', 'Salvando configuração e revisão no servidor…');
  try {
    const updated = await queue(() => privateApi('/admin/config', { method: 'PATCH', body }, epoch), epoch);
    if (!updated || typeof updated.open !== 'boolean') throw new ClientError('O servidor não confirmou a configuração. Recarregue antes de tentar salvar novamente.');
    state.settings = updated; renderSettings();
    notice('settings-message', updated.open ? 'Configuração salva. O servidor confirmou a coleta aberta.' : 'Configuração salva. O servidor confirmou a coleta encerrada.');
  } catch (error) {
    if (error instanceof Stale || epoch !== state.epoch) return;
    if (Number(error.status) === 409 || !error.status || Number(error.status) >= 500) state.settingsStale = true;
    formError('settings-message', error, { responsible: $('privacy-responsible'), channel: $('privacy-channel'), retention_days: $('privacy-retention'), open: $('collection-open') });
  } finally { if (epoch === state.epoch) { state.settingsBusy = false; syncControls(); } }
}
function reloadSettings() {
  if (state.settingsBusy || !state.session) return;
  if (!window.confirm('Recarregar descarta alterações não salvas da configuração. Continuar?')) return;
  const epoch = state.epoch; state.settingsBusy = true; syncControls();
  queue(async () => {
    const settings = await privateApi('/admin/config', {}, epoch);
    state.settings = settings; state.settingsStale = false; renderSettings(); notice('settings-message', 'Configuração atual recarregada do servidor.');
  }, epoch).catch((error) => {
    if (!(error instanceof Stale) && epoch === state.epoch) notice('settings-message', describeError(error), true, true);
  }).finally(() => { if (epoch === state.epoch) { state.settingsBusy = false; syncControls(); } });
}
function openExport() {
  if (!state.ready || !state.session) return;
  state.exportGeneration++; state.exportCount = null; state.exportFilters = null;
  $('export-form').reset(); $('export-count').textContent = 'Escolha um conjunto para consultar a quantidade.'; notice('export-message');
  syncControls(); $('export-dialog').showModal();
}
function selectExportScope() {
  if (state.exportBusy || !state.session || !state.ready) return;
  const selected = $('export-form').querySelector('input[name="export_scope"]:checked')?.value;
  const generation = ++state.exportGeneration; const epoch = state.epoch;
  state.exportCount = null; state.exportFilters = null; notice('export-message'); syncControls();
  if (!selected) return;
  $('export-count').textContent = 'Consultando a quantidade antes da exportação…';
  const filters = selected === 'filtered' ? JSON.parse(JSON.stringify(state.filters)) : {};
  queue(async () => {
    if (generation !== state.exportGeneration || !$('export-dialog').open) throw new Stale();
    const result = await privateApi(listPath(filters, 1, 1), {}, epoch); validatePage(result);
    if (generation !== state.exportGeneration || !$('export-dialog').open) throw new Stale();
    state.exportCount = result.total; state.exportFilters = filters;
    $('export-count').textContent = `${selected === 'filtered' ? 'Seleção filtrada' : 'Base completa'}: ${result.total} respostas na consulta de ${formatInstant(new Date())}. A base pode mudar se houver novos envios ou exclusões. O CSV inclui todo o conjunto, não só a página visível.`;
    syncControls();
  }, epoch).catch((error) => {
    if (error instanceof Stale || epoch !== state.epoch || generation !== state.exportGeneration) return;
    notice('export-message', describeError(error), true, true);
  });
}
async function exportCsv(event) {
  event.preventDefault();
  if (!state.session || state.exportBusy || state.exportCount === null || state.exportCount < 1 || !state.exportFilters || !$('export-ack').checked) return;
  const epoch = state.epoch; const generation = state.exportGeneration;
  const filters = state.exportFilters; const full = Object.keys(filters).length === 0;
  state.exportBusy = true;
  $('export-form').querySelectorAll('input').forEach((input) => { input.disabled = true; }); syncControls();
  notice('export-message', 'Preparando arquivo no servidor. Aguarde a confirmação do download.');
  const controller = new AbortController(); controllers.add(controller); state.exportController = controller;
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    await queue(async () => {
      if (generation !== state.exportGeneration) throw new Stale();
      const token = await ensureToken(epoch);
      // api() is JSON-only; CSV uses the same official public-key and bearer headers.
      const response = await fetch(`${API_URL.replace(/\/$/, '')}/admin/exportacao?${new URLSearchParams({ filters: JSON.stringify(filters) })}`, {
        method: 'GET', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, Accept: 'text/csv' },
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      guard(epoch);
      if (generation !== state.exportGeneration) throw new Stale();
      if (!response.ok) {
        const error = new Error('Falha na exportação'); error.status = response.status;
        if ([401, 403].includes(response.status)) endSession(describeError(error));
        throw error;
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/csv')) throw new ClientError('O servidor não retornou um arquivo CSV. Nenhum download foi criado.');
      let csv = await response.text(); guard(epoch);
      if (generation !== state.exportGeneration) throw new Stale();
      if (!csv) throw new ClientError('O servidor retornou um arquivo vazio. Nenhum download foi criado.');
      if (!csv.startsWith('\uFEFF')) csv = `\uFEFF${csv}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); csv = '';
      downloadUrls.add(url);
      const anchor = element('a'); anchor.href = url; anchor.download = `clube-do-livro-${full ? 'base-completa' : 'filtrada'}-${saoPauloDay(new Date())}.csv`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 30000);
      notice('export-message', 'Arquivo recebido do servidor; o download foi solicitado ao navegador. Proteja a cópia no seu dispositivo.');
    }, epoch);
  } catch (error) {
    if (!(error instanceof Stale) && epoch === state.epoch) notice('export-message', describeError(error), true, true);
  } finally {
    controllers.delete(controller); clearTimeout(timeout);
    if (epoch === state.epoch && generation === state.exportGeneration) {
      state.exportController = null; state.exportBusy = false; $('export-cancel').disabled = false;
      $('export-form').querySelectorAll('input').forEach((input) => { input.disabled = false; }); syncControls();
    }
  }
}
function cancelExport() {
  const wasBusy = state.exportBusy;
  state.exportGeneration++; state.exportController?.abort();
  state.exportController = null; state.exportBusy = false; state.exportCount = null; state.exportFilters = null;
  if ($('export-dialog').open) $('export-dialog').close();
  $('export-form').reset(); $('export-count').textContent = 'Escolha um conjunto para consultar a quantidade.';
  notice('export-message'); syncControls();
  if (wasBusy && state.session) notice('panel-message', 'Exportação cancelada nesta página. Nenhum novo download foi confirmado.');
}
function bindEvents() {
  $('login-form').addEventListener('submit', login);
  $('logout').addEventListener('click', async () => {
    const access = state.session?.access;
    clearPrivateData();
    notice('login-message', 'Dados desta página e sessão em memória apagados. Encerrando a sessão no provedor…');
    $('login-submit').disabled = true;
    try {
      const result = await revokeSession(access);
      notice('login-message', result?.ok ? 'Sessão encerrada no Supabase. Os dados foram limpos desta página.' : 'Os dados foram limpos desta página. O provedor não confirmou a revogação; entre novamente apenas em um dispositivo seguro.', !result?.ok);
    } catch { notice('login-message', 'Os dados e tokens foram apagados desta página. Não foi possível confirmar a revogação no provedor por falha de conexão.', true); }
    finally { $('login-submit').disabled = !state.questionnaire; $('login-email').focus(); }
  });
  $('refresh').addEventListener('click', () => {
    if (state.settingsDirty && !window.confirm('Atualizar também recarrega a configuração e descarta suas alterações de privacidade não salvas. Continuar?')) return;
    scheduleLoad(true);
  });
  $('filters-form').addEventListener('submit', (event) => { event.preventDefault(); scheduleLoad(); });
  const changedFilter = (delay) => {
    clearTimeout(filterTimer);
    // Invalidate immediately, not after debounce: an older fetch cannot re-enable export.
    state.loadGeneration++; state.ready = false; syncControls();
    filterTimer = setTimeout(() => scheduleLoad(), delay);
  };
  $('filters-form').addEventListener('change', () => changedFilter(220));
  $('filter-search').addEventListener('input', () => changedFilter(400));
  $('clear-filters').addEventListener('click', () => { $('filters-form').reset(); scheduleLoad(); });
  $('previous-page').addEventListener('click', () => { if (state.ready && state.page > 1) { state.page--; renderList(); $('responses-title').tabIndex = -1; $('responses-title').focus(); } });
  $('next-page').addEventListener('click', () => { if (state.ready && state.page < Math.ceil(state.records.length / PAGE_SIZE)) { state.page++; renderList(); $('responses-title').tabIndex = -1; $('responses-title').focus(); } });
  $('close-detail').addEventListener('click', () => { if (!state.detailBusy) { closeDetail(); $('responses-title').tabIndex = -1; $('responses-title').focus(); } });
  $('scenario-form').addEventListener('submit', (event) => { event.preventDefault(); if (!state.ready) return; state.analyzed = true; renderCompatibility(); });
  $('scenario-form').addEventListener('change', () => { $('analysis-result').replaceChildren(element('p', 'Cenário alterado. Use “Ver compatibilidade” para recalcular.', 'help')); state.analyzed = false; });
  $('settings-form').addEventListener('submit', saveSettings);
  $('reload-settings').addEventListener('click', reloadSettings);
  $('settings-form').addEventListener('input', (event) => {
    state.settingsDirty = true;
    if (['privacy-responsible', 'privacy-channel', 'privacy-retention'].includes(event.target.id)) $('privacy-real').checked = false;
  });
  $('open-export').addEventListener('click', openExport);
  $('export-form').addEventListener('change', (event) => { if (event.target.name === 'export_scope') selectExportScope(); else syncControls(); });
  $('export-form').addEventListener('submit', exportCsv);
  $('export-cancel').addEventListener('click', cancelExport);
  $('export-dialog').addEventListener('cancel', (event) => { event.preventDefault(); cancelExport(); });
  $('delete-form').addEventListener('submit', deleteRecord);
  $('delete-cancel').addEventListener('click', () => { if (!state.deleteBusy) $('delete-dialog').close(); });
  $('delete-dialog').addEventListener('cancel', (event) => { if (state.deleteBusy) event.preventDefault(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session) {
      const epoch = state.epoch;
      queue(() => ensureToken(epoch), epoch).catch((error) => { if (!(error instanceof Stale) && epoch === state.epoch) endSession('A sessão não pôde ser renovada. Entre novamente.'); });
    }
  });
  // Remove data before a page can be preserved in the back-forward cache.
  window.addEventListener('pagehide', () => { const token = state.session?.access; clearPrivateData(); revokeSession(token).catch(() => {}); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { clearPrivateData(); notice('login-message', 'A página foi reaberta sem sessão. Entre novamente.'); } });
}
async function init() {
  bindEvents(); syncControls();
  try {
    const response = await fetch(new URL('../shared/questionario.json', import.meta.url), { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Questionário indisponível');
    const questionnaire = await response.json();
    if (!Array.isArray(questionnaire.questions)) throw new Error('Questionário inválido');
    state.questionnaire = questionnaire; state.questions = new Map(questionnaire.questions.map((q) => [q.id, q]));
    buildForms(); $('login-submit').disabled = false;
    if (!configured()) notice('login-message', 'Configuração técnica pendente. O acesso é exclusivo do organizador: configure o serviço Supabase, a API e a autorização administrativa no servidor antes de entrar.', true);
  } catch {
    notice('login-message', 'Não foi possível carregar o questionário original. Recarregue a página ou peça ao responsável técnico para verificar os arquivos. O acesso aos dados não foi iniciado.', true);
    $('login-submit').disabled = true;
  }
}
init();
