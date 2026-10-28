/* Static ES module. Questionnaire content is data, never HTML. Drafts live only here. */
const $ = (id) => document.getElementById(id);
const state = {
  schema: null, config: null, configState: 'loading', answers: {}, errors: {},
  step: 0, furthest: 0, started: false, preview: false, dirty: false,
  attempt: null, sending: false, success: false, sendMessage: '', sendError: false,
};
const questionNodes = new Map();
const extraKey = (q) => `${q.id}_${q.other_field.key}`;
const questionForKey = (key) => state.schema.questions.find((q) => q.id === key || (q.other_field && extraKey(q) === key));
const visible = (q) => !q.visible_when || state.answers[q.visible_when.question_id] === q.visible_when.equals;
const textLength = (value) => Array.from(value).length;
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function callApi(path, options) {
  // Dynamic import keeps the questionnaire readable even when configuration is unavailable.
  const { api } = await import('./api.js');
  return api(path, options);
}
async function withTimeout(promise, ms = 25000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Tempo de espera esgotado.')), ms);
    })]);
  } finally { clearTimeout(timer); }
}
function validPrivacy(privacy) {
  return privacy && typeof privacy.responsible === 'string' && privacy.responsible.trim()
    && typeof privacy.channel === 'string' && privacy.channel.trim()
    && Number.isInteger(privacy.retention_days) && privacy.retention_days > 0
    && typeof privacy.notice_version === 'string' && privacy.notice_version.trim();
}
function configCanCollect() {
  return state.configState === 'ready' && state.config?.open === true && validPrivacy(state.config.privacy)
    && state.schema?.form_version === state.config.form_version;
}
function renderStatus() {
  const box = $('config-message');
  let title, message;
  $('collection-status').setAttribute('aria-busy', String(state.configState === 'loading'));
  if (state.configState === 'loading') {
    title = 'Verificando a situação da coleta…';
    message = 'O envio só estará disponível depois dessa confirmação.';
  } else if (state.configState === 'error') {
    title = 'Não foi possível verificar a coleta.';
    message = 'O serviço está indisponível ou ainda não foi configurado. O envio está bloqueado por segurança. Isso não significa que a coleta foi encerrada.';
  } else if (!state.config.open) {
    title = 'A coleta de respostas ainda não está aberta.';
    message = 'Você pode visualizar o questionário e revisar suas escolhas, mas não enviar respostas.';
  } else if (!configCanCollect()) {
    title = 'O envio está temporariamente indisponível.';
    message = 'Não foi possível confirmar a versão do questionário ou as informações de privacidade. Tente verificar novamente antes de responder.';
  } else {
    title = 'Pesquisa de interesse aberta.';
    message = 'Por enquanto, estamos pesquisando o interesse. Não há data ou local de encontro definidos.';
  }
  box.replaceChildren(el('strong', { text: title }), el('p', { text: message }));
  $('retry-config').hidden = state.configState === 'loading' || (state.configState === 'ready' && (!state.config.open || configCanCollect()));
  const start = $('start-button');
  start.disabled = !state.schema;
  start.textContent = !state.schema ? 'Carregando questionário…' : state.success ? 'Ver confirmação' : state.started ? 'Voltar ao questionário' : configCanCollect() ? 'Responder ao formulário' : 'Visualizar questionário';
  if (state.started && !state.success) {
    const preview = $('preview-notice');
    preview.hidden = !state.preview && configCanCollect();
    if (!preview.hidden) {
      preview.replaceChildren(el('strong', { text: state.preview ? 'Somente visualização — sem envio.' : 'Envio indisponível no momento.' }), el('p', {
        text: state.preview ? 'Você pode conhecer as perguntas, fazer escolhas e revisá-las. Nada será enviado neste modo. Para responder quando a coleta estiver aberta, recarregue a página.' : 'Suas respostas continuam nesta página. Não feche nem recarregue se quiser mantê-las.',
      }));
    }
  }
  renderPrivacy();
  updateReviewControls();
}
async function loadConfig() {
  state.configState = 'loading';
  renderStatus();
  try {
    const config = await withTimeout(callApi('/config'));
    if (!config || typeof config.open !== 'boolean' || typeof config.form_version !== 'string' || !config.form_version.trim()) throw new Error('Configuração incompleta.');
    state.config = config;
    state.configState = 'ready';
  } catch {
    state.config = null;
    state.configState = 'error';
  }
  renderStatus();
}
async function loadQuestionnaire() {
  $('retry-schema').disabled = true;
  $('schema-error').hidden = true;
  try {
    const response = await fetch(new URL('../shared/questionario.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('Questionário indisponível.');
    const schema = await response.json();
    if (!Array.isArray(schema.questions) || schema.questions.length !== 14 || !Array.isArray(schema.steps) || schema.steps.length !== 3 || !schema.form_version) throw new Error('Questionário inválido.');
    const ids = new Set(schema.questions.map((q) => q.id));
    if (ids.size !== 14 || schema.steps.some((step) => !Array.isArray(step.questions) || step.questions.some((id) => !ids.has(id)))) throw new Error('Estrutura inválida.');
    state.schema = schema;
    $('hero-title').textContent = schema.title;
    // Restore the quieter second line without interpreting any source content as HTML.
    const divider = schema.title.indexOf(':');
    if (divider !== -1) $('hero-title').replaceChildren(document.createTextNode(schema.title.slice(0, divider + 1)), el('br'), el('span', { text: schema.title.slice(divider + 1).trim() }));
    $('hero-intro').replaceChildren(...schema.intro.map((text) => el('p', { text })));
    $('draft-notice').textContent = schema.draft_notice;
    buildForm();
  } catch {
    $('schema-error').hidden = false;
  } finally {
    $('retry-schema').disabled = false;
    renderStatus();
  }
}
function description(q) { return `${q.id}-help ${q.id}-error`; }
function control(q, tag, attrs = {}) {
  return el(tag, { 'data-question': q.id, 'aria-describedby': description(q), ...attrs });
}
function makeOption(q, option, type) {
  const input = control(q, 'input', { type, id: `${q.id}-${option.value}`, name: q.id, value: option.value, 'data-kind': 'choice' });
  if (type === 'radio' && q.required) input.required = true;
  return el('label', { class: 'option', for: input.id }, [input, el('span', { text: option.label })]);
}
function buildQuestion(q) {
  const group = el('fieldset', { class: 'question', id: `group-${q.id}`, 'data-question-group': q.id });
  const label = el('span', {}, [q.label, el('span', { class: 'question-status', text: q.required || q.required_when_visible ? 'Obrigatória' : 'Opcional' })]);
  group.append(el('legend', { class: 'question-legend' }, [el('span', { class: 'question-number', 'aria-hidden': 'true', text: String(q.number).padStart(2, '0') }), label]));
  group.append(el('p', { class: 'question-help', id: `${q.id}-help`, hidden: !q.help, text: q.help || '' }));
  if (q.type === 'short_text' || q.type === 'long_text') {
    group.append(el('label', { for: q.id, class: 'sr-only', text: q.label }));
    const input = control(q, q.type === 'long_text' ? 'textarea' : 'input', {
      id: q.id, name: q.id, type: q.type === 'short_text' ? 'text' : undefined,
      maxlength: q.max_length, 'data-kind': 'text', required: q.required,
      autocomplete: q.id === 'q01_nome' ? 'nickname' : 'off', rows: q.type === 'long_text' ? 5 : undefined,
    });
    group.append(input);
    if (q.type === 'long_text') group.append(el('p', { class: 'text-small muted mt-1', text: `Até ${q.max_length.toLocaleString('pt-BR')} caracteres.` }));
  } else if (q.type === 'single_choice' || q.type === 'multiple_choice') {
    group.append(el('div', { class: 'option-list' }, q.options.map((option) => makeOption(q, option, q.type === 'single_choice' ? 'radio' : 'checkbox'))));
    if (q.other_field) {
      const key = extraKey(q);
      const other = el('div', { class: 'field other-field', id: `${q.id}-other`, hidden: true }, [
        el('label', { for: key, text: q.id === 'q05_generos' ? 'Quais outros tipos de leitura?' : 'Qual outra dificuldade?' }),
        control(q, 'input', { type: 'text', name: key, id: key, maxlength: q.other_field.max_length, 'data-kind': 'other', 'aria-describedby': `${key}-error`, disabled: true }),
        el('p', { class: 'field-error', id: `${key}-error`, hidden: true }),
      ]);
      group.append(other);
    }
  } else if (q.type === 'availability') {
    const grid = el('div', { class: 'availability-grid' });
    for (const day of q.days) {
      const periods = el('div', { class: 'day-periods' });
      for (const period of q.periods) {
        const id = `${q.id}-${day.value}-${period.value}`;
        periods.append(el('label', { class: 'period-option', for: id }, [
          control(q, 'input', { type: 'checkbox', id, name: q.id, 'data-kind': 'slot', 'data-day': day.value, 'data-period': period.value, 'aria-label': `${day.label}, ${period.label}` }),
          el('span', { text: period.label }),
        ]));
      }
      grid.append(el('fieldset', { class: 'day-card' }, [el('legend', { text: day.label }), periods]));
    }
    const variable = control(q, 'input', { type: 'checkbox', id: `${q.id}-variavel`, name: q.id, 'data-kind': 'variable', value: q.variable_option.value });
    group.append(grid, el('label', { class: 'option', for: variable.id }, [variable, el('span', { text: q.variable_option.label })]), el('p', { class: 'text-small muted mt-1', text: 'A disponibilidade variável substitui as combinações de dias e períodos.' }));
  } else if (q.type === 'contact') {
    const channels = el('div', { class: 'contact-channels' });
    for (const channel of q.channels) {
      const input = control(q, 'input', { type: 'radio', id: `${q.id}-${channel.value}`, name: `${q.id}-channel`, value: channel.value, 'data-kind': 'channel', required: true });
      channels.append(el('label', { class: 'option', for: input.id }, [input, el('span', { text: channel.label })]));
    }
    group.append(channels, el('div', { class: 'field contact-field' }, [
      el('label', { id: `${q.id}-value-label`, for: `${q.id}-value`, text: 'Seu contato' }),
      control(q, 'input', { type: 'text', id: `${q.id}-value`, name: `${q.id}-value`, maxlength: q.max_length, 'data-kind': 'contact', disabled: true, autocomplete: 'off', spellcheck: 'false', placeholder: 'Escolha um canal acima' }),
    ]));
  }
  if (q.note_ref && state.schema[q.note_ref]) group.append(el('p', { class: 'question-note', text: state.schema[q.note_ref] }));
  group.append(el('p', { class: 'field-error', id: `${q.id}-error`, hidden: true }));
  questionNodes.set(q.id, group);
  return group;
}
function buildForm() {
  questionNodes.clear();
  const panels = $('step-panels');
  panels.replaceChildren();
  const steps = state.schema.steps;
  for (const [index, step] of steps.entries()) {
    const panel = el('section', { id: `step-${index}`, 'aria-labelledby': `step-title-${index}`, hidden: index !== 0 });
    const heading = el('div', { class: 'step-heading' }, [el('p', { class: 'eyebrow', text: `Etapa ${index + 1} de 3` }), el('h2', { id: `step-title-${index}`, tabindex: '-1', text: step.title })]);
    panel.append(heading);
    for (const id of step.questions) panel.append(buildQuestion(state.schema.questions.find((q) => q.id === id)));
    const back = el('button', { type: 'button', class: 'button button-secondary', text: 'Voltar', 'data-back': index, hidden: index === 0 });
    const next = el('button', { type: 'button', class: 'button button-primary', text: index === steps.length - 1 ? 'Revisar respostas' : 'Continuar', 'data-next': index });
    panel.append(el('div', { class: 'form-actions' }, [back, next]));
    panels.append(panel);
  }
  const navigation = $('step-navigation');
  navigation.replaceChildren(...[...steps.map((step) => step.title), 'Revisão'].map((title, index) => el('li', {}, el('button', { type: 'button', class: 'step-button', 'data-step': index, disabled: index > 0 }, [el('span', { class: 'step-number', 'aria-hidden': 'true', text: String(index + 1) }), el('span', { text: title })]))));
  syncConditional();
  renderNavigation();
}
function syncConditional() {
  for (const q of state.schema.questions) {
    const group = questionNodes.get(q.id);
    if (!group) continue;
    const isVisible = visible(q);
    group.hidden = !isVisible;
    group.disabled = !isVisible;
    if (!isVisible) {
      delete state.answers[q.id];
      delete state.errors[q.id];
      group.querySelectorAll('input').forEach((input) => { input.checked = false; if (input.type !== 'radio' && input.type !== 'checkbox') input.value = ''; });
    }
    if (q.other_field) {
      const key = extraKey(q);
      const showOther = (state.answers[q.id] || []).includes(q.other_field.when_selected);
      $(`${q.id}-other`).hidden = !showOther;
      $(key).disabled = !showOther;
      if (!showOther) { delete state.answers[key]; delete state.errors[key]; $(key).value = ''; }
    }
    if (q.type === 'contact') {
      const channel = state.answers[q.id]?.channel;
      const input = $(`${q.id}-value`);
      input.disabled = !isVisible || !channel;
      input.inputMode = channel === 'whatsapp' ? 'tel' : 'text';
      input.autocomplete = channel === 'whatsapp' ? 'tel' : 'off';
      input.required = Boolean(isVisible && channel);
      input.placeholder = channel === 'instagram' ? '@seuperfil ou link do perfil' : channel === 'whatsapp' ? 'DDD + número' : 'Escolha um canal acima';
      $(`${q.id}-value-label`).textContent = channel === 'instagram' ? 'Seu perfil no Instagram' : channel === 'whatsapp' ? 'Seu WhatsApp com DDD' : 'Seu contato';
    }
  }
}
function inputChanged(event) {
  if (state.attempt || state.success) return;
  const input = event.target;
  const q = state.schema?.questions.find((item) => item.id === input.dataset.question);
  if (!q) return;
  const group = questionNodes.get(q.id);
  const kind = input.dataset.kind;
  state.dirty = true;
  if (kind === 'text') state.answers[q.id] = input.value;
  if (kind === 'other') state.answers[extraKey(q)] = input.value;
  if (kind === 'choice') {
    if (q.type === 'single_choice') state.answers[q.id] = input.value;
    else {
      const exclusive = q.exclusive_options || [];
      if (input.checked && exclusive.includes(input.value)) {
        group.querySelectorAll('[data-kind="choice"]').forEach((other) => { if (other !== input) other.checked = false; });
      } else if (input.checked) {
        group.querySelectorAll('[data-kind="choice"]').forEach((other) => { if (exclusive.includes(other.value)) other.checked = false; });
      }
      state.answers[q.id] = Array.from(group.querySelectorAll('[data-kind="choice"]:checked'), (node) => node.value);
    }
  }
  if (kind === 'variable') {
    if (input.checked) {
      group.querySelectorAll('[data-kind="slot"]').forEach((slot) => { slot.checked = false; });
      state.answers[q.id] = { mode: 'variavel', slots: [] };
    } else delete state.answers[q.id];
  }
  if (kind === 'slot') {
    $(`${q.id}-variavel`).checked = false;
    const slots = Array.from(group.querySelectorAll('[data-kind="slot"]:checked'), (node) => ({ day: node.dataset.day, period: node.dataset.period }));
    if (slots.length) state.answers[q.id] = { mode: 'fixa', slots };
    else delete state.answers[q.id];
  }
  if (kind === 'channel') {
    // A different channel is a different contact; never reuse the old value implicitly.
    state.answers[q.id] = { channel: input.value, value: '' };
    $(`${q.id}-value`).value = '';
  }
  if (kind === 'contact') state.answers[q.id] = { ...state.answers[q.id], value: input.value };
  syncConditional();
  const existingError = state.errors[q.id] || (q.other_field && state.errors[extraKey(q)]);
  if (existingError || (q.max_selections && (state.answers[q.id]?.length || 0) > q.max_selections)) {
    delete state.errors[q.id];
    if (q.other_field) delete state.errors[extraKey(q)];
    Object.assign(state.errors, validate([q.id]));
  }
  paintErrors(false);
}
function normalizeContact(contact) {
  if (!contact || !['instagram', 'whatsapp'].includes(contact.channel)) throw new Error('Escolha Instagram ou WhatsApp para informar um contato.');
  const value = String(contact.value || '').trim();
  if (!value) throw new Error('Informe seu contato no canal escolhido.');
  if (textLength(value) > 100) throw new Error('Use até 100 caracteres para o contato.');
  if (contact.channel === 'instagram') {
    let username = value;
    if (/^(https?:\/\/|(?:www\.)?instagram\.com\/)/i.test(value)) {
      let url;
      try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { throw new Error('Informe um @ ou um link válido de perfil do Instagram.'); }
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash || !/^\/[A-Za-z0-9._]{1,30}\/?$/.test(url.pathname)) throw new Error('Use apenas um link de perfil do Instagram, sem outros caminhos ou conteúdo.');
      username = url.pathname.replace(/^\/|\/$/g, '');
    } else username = username.replace(/^@/, '');
    if (!/^[A-Za-z0-9_](?:[A-Za-z0-9._]{0,28}[A-Za-z0-9_])?$/.test(username) || username.includes('..') || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal'].includes(username.toLowerCase())) throw new Error('Informe apenas seu @ ou o link do seu perfil no Instagram.');
    return { channel: 'instagram', value: username.toLowerCase() };
  }
  // A lightweight client check, not a claim of ownership or delivery. The server validates the number authoritatively.
  if (!/^\+?[\d\s().-]+$/.test(value)) throw new Error('Informe um número de WhatsApp com DDD. Use + e o código do país para números de fora do Brasil.');
  let digits = value.replace(/\D/g, '');
  if (!value.startsWith('+')) {
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    else if (!/^55\d{10,11}$/.test(digits)) throw new Error('Inclua o DDD. Para números de fora do Brasil, use + e o código do país.');
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Confira o código do país, o DDD e o número informado.');
  if (digits.startsWith('55') && !/^55[1-9]\d(?:[2-9]\d{7}|9\d{8})$/.test(digits)) throw new Error('Confira o DDD e o número de WhatsApp informado.');
  return { channel: 'whatsapp', value: `+${digits}` };
}
function validate(ids = state.schema.questions.map((q) => q.id)) {
  const errors = {};
  for (const id of ids) {
    const q = state.schema.questions.find((item) => item.id === id);
    if (!q || !visible(q)) continue;
    const answer = state.answers[id];
    if (q.type === 'short_text' || q.type === 'long_text') {
      const value = typeof answer === 'string' ? answer.trim() : '';
      if (q.required && textLength(value) < (q.min_length || 1)) errors[id] = 'Preencha este campo para continuar.';
      else if (textLength(value) > q.max_length) errors[id] = `Use até ${q.max_length} caracteres.`;
    } else if (q.type === 'single_choice') {
      if (!answer && q.required) errors[id] = 'Escolha uma opção para continuar.';
      else if (answer && !q.options.some((option) => option.value === answer)) errors[id] = 'Escolha uma das opções apresentadas.';
    } else if (q.type === 'multiple_choice') {
      const selected = Array.isArray(answer) ? answer : [];
      if ((q.required || q.min_selections) && selected.length < (q.min_selections || 1)) errors[id] = 'Marque pelo menos uma opção para continuar.';
      else if (q.max_selections && selected.length > q.max_selections) errors[id] = `Marque no máximo ${q.max_selections} opções.`;
      else if (selected.some((value) => !q.options.some((option) => option.value === value))) errors[id] = 'Escolha somente as opções apresentadas.';
      else if (selected.length > 1 && selected.some((value) => (q.exclusive_options || []).includes(value))) errors[id] = 'A opção “Nada específico” não pode ser combinada com outras dificuldades.';
      if (q.other_field && selected.includes(q.other_field.when_selected)) {
        const other = (state.answers[extraKey(q)] || '').trim();
        if (!other && q.other_field.required_when_visible) errors[extraKey(q)] = 'Descreva a opção “Outro” para continuar.';
        else if (textLength(other) > q.other_field.max_length) errors[extraKey(q)] = `Use até ${q.other_field.max_length} caracteres.`;
      }
    } else if (q.type === 'availability') {
      if (!answer || !['fixa', 'variavel'].includes(answer.mode) || !Array.isArray(answer.slots) || (answer.mode === 'fixa' && !answer.slots.length)) errors[id] = 'Marque ao menos um dia e período ou escolha disponibilidade variável.';
      else if ((answer.mode === 'variavel' && answer.slots.length) || answer.slots.some((slot) => !q.days.some((day) => day.value === slot.day) || !q.periods.some((period) => period.value === slot.period))) errors[id] = 'Revise as combinações de dias e períodos.';
    } else if (q.type === 'contact') {
      try { normalizeContact(answer); } catch (error) { errors[id] = error.message; }
    }
  }
  for (const rule of state.schema.cross_validation || []) {
    if (ids.includes(rule.question_id) && state.answers[rule.if.question_id] === rule.if.equals && (state.answers[rule.question_id] || []).some((value) => !rule.allowed_values.includes(value))) errors[rule.question_id] = rule.message;
  }
  return errors;
}
function fieldTarget(key) {
  if ($(key) && !$(key).disabled && $(key).tagName !== 'FIELDSET') return $(key);
  const group = questionNodes.get(questionForKey(key)?.id);
  if (key === 'q14_contato' && state.answers.q14_contato?.channel) return $('q14_contato-value');
  return group?.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)');
}
function paintErrors(focus = false) {
  if (!state.schema) return;
  for (const q of state.schema.questions) {
    const keys = [q.id, ...(q.other_field ? [extraKey(q)] : [])];
    for (const key of keys) {
      const error = $(`${key}-error`);
      if (error) { error.hidden = !state.errors[key]; error.textContent = state.errors[key] || ''; }
    }
    const group = questionNodes.get(q.id);
    group?.querySelectorAll('input, textarea, select').forEach((input) => {
      const key = input.dataset.kind === 'other' ? extraKey(q) : q.id;
      if (state.errors[key]) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  }
  const summary = $('error-summary');
  const entries = Object.entries(state.errors);
  summary.hidden = !entries.length;
  if (entries.length) {
    summary.replaceChildren(el('strong', { text: 'Há respostas para revisar antes de continuar.' }), el('ul', {}, entries.map(([key, message]) => {
      const q = questionForKey(key);
      const target = fieldTarget(key);
      return el('li', {}, el('a', { href: `#${target?.id || `group-${q?.id}`}`, 'data-error-key': key, text: `${q ? `Pergunta ${q.number}: ` : ''}${message}` }));
    })));
    if (focus) requestAnimationFrame(() => fieldTarget(entries[0][0])?.focus());
  } else summary.replaceChildren();
}
function renderNavigation() {
  $('step-navigation').querySelectorAll('[data-step]').forEach((button) => {
    const index = Number(button.dataset.step);
    button.disabled = index > state.furthest || Boolean(state.attempt) || state.success;
    button.classList.toggle('step-done', index < state.furthest);
    if (index === state.step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
}
function goToStep(index, { focus = true, clearErrors = true } = {}) {
  if (state.attempt || state.success) return;
  state.step = index;
  state.furthest = Math.max(state.furthest, index);
  if (clearErrors) state.errors = {};
  for (let i = 0; i < 3; i += 1) $(`step-${i}`).hidden = i !== index;
  $('review-panel').hidden = index !== 3;
  if (index === 3) renderReview();
  renderNavigation();
  paintErrors(false);
  if (focus) requestAnimationFrame(() => $(index === 3 ? 'review-title' : `step-title-${index}`).focus());
}
function validateAndNavigate(index) {
  const ids = index === 3 ? undefined : state.schema.steps[state.step].questions;
  state.errors = validate(ids);
  if (Object.keys(state.errors).length) {
    const q = questionForKey(Object.keys(state.errors)[0]);
    const step = state.schema.steps.findIndex((item) => item.questions.includes(q?.id));
    goToStep(step < 0 ? state.step : step, { focus: false, clearErrors: false });
    paintErrors(true);
    return false;
  }
  goToStep(index);
  return true;
}
function preparedAnswers() {
  const output = {};
  for (const q of state.schema.questions) {
    if (!visible(q)) continue;
    const answer = state.answers[q.id];
    if (answer === undefined || answer === null) continue;
    if (q.type === 'contact') output[q.id] = normalizeContact(answer);
    else if (typeof answer === 'string') { if (answer.trim()) output[q.id] = answer.trim(); }
    else if (Array.isArray(answer)) { if (answer.length) output[q.id] = [...answer]; }
    else output[q.id] = JSON.parse(JSON.stringify(answer));
    if (q.other_field && (answer || []).includes(q.other_field.when_selected)) output[extraKey(q)] = (state.answers[extraKey(q)] || '').trim();
  }
  // Defense in depth: removing authorization always removes the entire contact from the payload.
  if (output.q13_autorizacao !== 'sim') delete output.q14_contato;
  return output;
}
function answerView(q, answers) {
  const answer = answers[q.id];
  if (q.type === 'contact' && !visible(q)) return el('span', { class: 'muted', text: 'Não solicitado — contato não autorizado.' });
  if (answer === undefined || answer === '' || (Array.isArray(answer) && !answer.length)) return el('span', { class: 'muted', text: 'Não respondida.' });
  if (q.type === 'single_choice') return el('span', { text: q.options.find((option) => option.value === answer)?.label || answer });
  if (q.type === 'multiple_choice') {
    const list = el('ul', {}, answer.map((value) => el('li', { text: q.options.find((option) => option.value === value)?.label || value })));
    if (q.other_field && answers[extraKey(q)]) list.append(el('li', { text: `Complemento: ${answers[extraKey(q)]}` }));
    return list;
  }
  if (q.type === 'availability') {
    if (answer.mode === 'variavel') return el('span', { text: q.variable_option.label });
    return el('ul', {}, answer.slots.map((slot) => el('li', { text: `${q.days.find((day) => day.value === slot.day)?.label} · ${q.periods.find((period) => period.value === slot.period)?.label}` })));
  }
  if (q.type === 'contact') return el('span', { text: `${q.channels.find((channel) => channel.value === answer.channel)?.label}: ${answer.channel === 'instagram' ? '@' : ''}${answer.value}` });
  return el('span', { text: answer });
}
function renderReview() {
  const answers = state.attempt?.body.answers || preparedAnswers();
  $('review-content').replaceChildren(...state.schema.steps.map((step, index) => {
    const heading = el('div', { class: 'review-heading' }, [el('h3', { text: step.title }), el('button', { class: 'button button-text', type: 'button', 'data-edit': index, 'aria-label': `Editar ${step.title}`, disabled: Boolean(state.attempt), text: 'Editar' })]);
    const entries = step.questions.map((id) => {
      const q = state.schema.questions.find((question) => question.id === id);
      return el('div', {}, [el('dt', { text: `${q.number}. ${q.label}` }), el('dd', {}, answerView(q, answers))]);
    });
    return el('section', { class: 'review-group', 'aria-label': step.title }, [heading, el('dl', { class: 'review-answers' }, entries)]);
  }));
  renderPrivacy();
  updateReviewControls();
}
function renderPrivacy() {
  const section = $('privacy-notice');
  const privacy = state.config?.privacy;
  section.hidden = !validPrivacy(privacy);
  if (section.hidden) { section.replaceChildren(); return; }
  section.replaceChildren(
    el('h3', { id: 'privacy-title', text: 'Sobre suas informações' }),
    el('p', { text: 'Suas respostas serão usadas para avaliar o interesse e organizar uma proposta de clube do livro: preferências de leitura, formatos e disponibilidade. Receberemos seu nome de preferência e as respostas que você preencher. O contato só será recebido se você o autorizar.' }),
    el('p', {}, [el('strong', { text: 'Responsável: ' }), privacy.responsible]),
    el('p', {}, [el('strong', { text: 'Privacidade e exclusão: ' }), `para pedir a exclusão de sua resposta ou esclarecer o uso dos dados, entre em contato por ${privacy.channel}.`]),
    el('p', {}, [el('strong', { text: 'Prazo de retenção: ' }), `${privacy.retention_days} dias.`]),
    el('p', { class: 'text-small muted', text: `Versão do aviso: ${privacy.notice_version}. A autorização para contato é uma escolha separada, na pergunta 13.` }),
  );
}
function updateReviewControls() {
  const send = $('send-button');
  const locked = Boolean(state.attempt);
  send.disabled = state.sending || state.success || (!locked && (state.preview || !configCanCollect()));
  send.textContent = state.sending ? 'Aguardando confirmação…' : locked ? 'Tentar confirmar envio' : 'Enviar respostas';
  $('review-back').disabled = locked || state.sending;
  $('review-content').querySelectorAll('[data-edit]').forEach((button) => { button.disabled = locked || state.sending; });
  $('survey-form').setAttribute('aria-busy', String(state.sending));
  const status = $('send-status');
  status.hidden = !state.sendMessage;
  status.classList.toggle('notice-error', state.sendError);
  status.setAttribute('role', state.sendError ? 'alert' : 'status');
  status.textContent = state.sendMessage;
  $('send-help').textContent = state.preview ? 'Modo de visualização: o envio não está disponível e nenhuma resposta será recebida.' : locked ? 'Para evitar duplicações, este envio e sua chave foram mantidos. As respostas ficam bloqueadas até o servidor confirmar ou recusar a tentativa. Não recarregue a página.' : !configCanCollect() ? 'O envio depende da confirmação da coleta aberta e das informações de privacidade.' : 'Ao enviar, suas respostas serão recebidas pelo responsável indicado acima. A confirmação só aparece depois do retorno do servidor.';
  renderNavigation();
}
function confirmed(result, attempt) {
  if (state.attempt !== attempt || !result || typeof result.protocol !== 'string' || !result.protocol.trim()) return false;
  state.success = true;
  state.dirty = false;
  state.sending = false;
  state.attempt = null;
  state.answers = {};
  state.errors = {};
  $('survey-form').hidden = true;
  $('success-panel').hidden = false;
  $('success-message').textContent = state.schema.success_message;
  $('success-protocol').textContent = result.protocol;
  const received = new Date(result.received_at);
  $('success-date').textContent = Number.isNaN(received.getTime()) ? '' : `Recebido em ${received.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (horário de Brasília).`;
  // Remove contact and all other draft data from hidden inputs/review after confirmed receipt.
  $('step-panels').replaceChildren();
  $('review-content').replaceChildren();
  questionNodes.clear();
  $('preview-notice').hidden = true;
  $('start-button').textContent = 'Ver confirmação';
  renderNavigation();
  requestAnimationFrame(() => $('success-title').focus());
  return true;
}
async function submitAnswers(event) {
  event.preventDefault();
  if (state.sending || state.success) return;
  // Enter in a field advances the current step; it never skips review or submits implicitly.
  if (state.step < 3) { validateAndNavigate(state.step + 1); return; }
  if (state.preview) return;
  if (!state.attempt) {
    if (!configCanCollect()) { renderStatus(); return; }
    if (!validateAndNavigate(3)) return;
    try {
      const key = uuid();
      // The body is constructed once and frozen with its UUID. No re-read from form on retry.
      state.attempt = freeze({ key, body: { answers: preparedAnswers(), form_version: state.config.form_version, privacy_notice_version: state.config.privacy.notice_version, idempotency_key: key, website: '' } });
    } catch {
      state.sendMessage = 'Não foi possível preparar o envio com segurança. Use um navegador atualizado em uma conexão HTTPS. Nenhuma resposta foi enviada.';
      state.sendError = true;
      updateReviewControls();
      return;
    }
  }
  const attempt = state.attempt;
  state.sending = true;
  state.sendError = false;
  state.sendMessage = 'Enviando suas respostas. Aguarde a confirmação do servidor antes de fechar esta página.';
  updateReviewControls();
  try {
    // A late valid response still resolves this same locked attempt, even after a UI timeout.
    const pending = callApi('/respostas', { method: 'POST', body: attempt.body }).then((result) => {
      if (!confirmed(result, attempt) && state.attempt === attempt) throw new Error('O servidor não retornou um protocolo.');
      return result;
    });
    await withTimeout(pending);
  } catch (error) {
    if (state.success || state.attempt !== attempt) return;
    state.sending = false;
    const status = Number(error.status);
    // These explicit server rejections resolve the logical attempt without saving a response.
    if ([400, 403, 409, 413, 422].includes(status)) {
      state.attempt = null;
      if (status === 400 || status === 422) {
        const fields = error.fields && typeof error.fields === 'object' ? error.fields : {};
        state.errors = Object.fromEntries(Object.entries(fields).filter(([key, value]) => questionForKey(key) && typeof value === 'string'));
        if (Object.keys(state.errors).length) {
          const q = questionForKey(Object.keys(state.errors)[0]);
          const step = state.schema.steps.findIndex((item) => item.questions.includes(q.id));
          goToStep(step, { focus: false, clearErrors: false });
          paintErrors(true);
        }
        state.sendMessage = 'O servidor não aceitou as respostas. Revise os campos indicados e tente novamente. Nenhuma confirmação de recebimento foi emitida.';
        if (!Object.keys(state.errors).length) state.sendMessage = 'O servidor não aceitou as respostas. Revise o questionário e o contato, se informado, antes de tentar novamente.';
      } else if (status === 403 || status === 409) {
        state.sendMessage = status === 409
          ? 'O servidor recusou esta tentativa por conflito ou encerramento da coleta. Suas respostas continuam aqui para revisão. Vamos verificar a situação antes de um novo envio.'
          : 'O servidor recusou o envio. Vamos verificar se a coleta continua aberta. Suas respostas permanecem nesta página.';
        void loadConfig();
      } else state.sendMessage = 'As respostas ultrapassaram o tamanho aceito pelo servidor. Reduza os campos de texto antes de tentar novamente.';
    } else {
      state.sendMessage = status === 429
        ? 'O servidor limitou as tentativas. Aguarde um pouco e tente confirmar novamente. Mantivemos o mesmo envio para evitar duplicação.'
        : 'Não foi possível confirmar o recebimento. A resposta pode ter chegado ao servidor. Tente confirmar novamente: a mesma chave e as mesmas respostas serão reutilizadas, sem criar outro envio.';
    }
    state.sendError = true;
    updateReviewControls();
    if (!state.attempt && state.step !== 3) {
      // Keep server-level rejection actionable even when field errors move the person to an earlier step.
      const summary = $('error-summary');
      summary.hidden = false;
      summary.prepend(el('p', { text: state.sendMessage }));
    }
  } finally {
    if (!state.success && state.attempt === attempt) {
      state.sending = false;
      updateReviewControls();
    }
  }
}
$('start-button').addEventListener('click', () => {
  if (!state.schema) return;
  if (state.success) { $('success-title').focus(); return; }
  if (!state.started) {
    state.started = true;
    // A closed/unverified preview never silently becomes a live collection form.
    state.preview = !configCanCollect();
    $('questionnaire').hidden = false;
    goToStep(0);
  } else $(state.step === 3 ? 'review-title' : `step-title-${state.step}`).focus();
  renderStatus();
});
$('retry-config').addEventListener('click', loadConfig);
$('retry-schema').addEventListener('click', loadQuestionnaire);
$('survey-form').addEventListener('input', inputChanged);
$('survey-form').addEventListener('submit', submitAnswers);
$('review-back').addEventListener('click', () => goToStep(2));
$('questionnaire').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled || state.attempt || state.success) return;
  if (button.dataset.next !== undefined) validateAndNavigate(Number(button.dataset.next) + 1);
  if (button.dataset.back !== undefined) goToStep(Number(button.dataset.back) - 1);
  if (button.dataset.edit !== undefined) goToStep(Number(button.dataset.edit));
  if (button.dataset.step !== undefined) {
    const next = Number(button.dataset.step);
    if (next === 3) validateAndNavigate(3);
    else if (next <= state.furthest) goToStep(next);
  }
});
$('error-summary').addEventListener('click', (event) => {
  const link = event.target.closest('[data-error-key]');
  if (!link) return;
  event.preventDefault();
  const q = questionForKey(link.dataset.errorKey);
  const step = state.schema.steps.findIndex((item) => item.questions.includes(q?.id));
  if (step >= 0 && step !== state.step) goToStep(step, { focus: false, clearErrors: false });
  fieldTarget(link.dataset.errorKey)?.focus();
});
window.addEventListener('beforeunload', (event) => {
  if (state.dirty && !state.success) { event.preventDefault(); event.returnValue = ''; }
});
void loadQuestionnaire();
void loadConfig();
