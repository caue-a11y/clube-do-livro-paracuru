import {
  ApiError, ORIGINS, checkOrigin, readJSON, validateSubmission, payloadHash,
  validateFilters, positiveInt, isUUID, validateUpdate, validateSettings, revision,
  keysOnly, csvHeader, csvRow
} from './domain.mjs';

// Factory isolates transport from pure rules and permits real Node HTTP-contract tests
// with injected upstreams. Production never substitutes a fake persistence success.
export function createHandler({ schema, parsePhoneNumber, supabaseURL, serviceRoleKey, fetchImpl = fetch, log = console.error }) {
  let invalidWindow = 0, invalidCount = 0;
  const denyInvalidBurst = () => {
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== invalidWindow) { invalidWindow = minute; invalidCount = 0; }
    if (++invalidCount > 120) throw new ApiError(429, 'Muitas tentativas inválidas. Aguarde um minuto.');
  };
  const serviceHeaders = () => ({ apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' });
  async function upstream(path, options) {
    if (!supabaseURL || !serviceRoleKey) throw new ApiError(503, 'Serviço temporariamente indisponível.');
    try { return await fetchImpl(`${supabaseURL.replace(/\/$/, '')}${path}`, { ...options, cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw new ApiError(503, 'Não foi possível acessar o serviço. Tente novamente com a mesma tentativa de envio.'); }
  }
  async function jsonData(response) {
    try { return await response.json(); } catch { throw new ApiError(503, 'Resposta inválida do serviço.'); }
  }
  async function rpc(name, params = {}) {
    const response = await upstream(`/rest/v1/rpc/${name}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify(params) });
    const data = await jsonData(response);
    if (!response.ok) {
      const safeMessages = new Map([
        ['PT400', [400, 'Dados inválidos para esta operação.']],
        ['PT403', [403, 'Administrador não autorizado.']],
        ['PT404', [404, 'Resposta não encontrada.']],
        ['PT409', [409, 'Conflito: recarregue os dados e confira a situação da coleta.']],
        ['PT429', [429, 'Muitas tentativas. Aguarde um minuto.']],
        ['PT503', [503, 'Serviço temporariamente indisponível.']]
      ]);
      const known = safeMessages.get(data?.code);
      if (known) {
        // PT codes originate only in our static SQL RAISE messages, never SQL text/payload.
        throw new ApiError(known[0], typeof data.message === 'string' && data.message.length < 250 ? data.message : known[1]);
      }
      throw new ApiError(503, 'Não foi possível concluir a operação. Nenhum sucesso foi confirmado.');
    }
    return data;
  }
  async function authorize(request) {
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization) || authorization.length > 8192) throw new ApiError(401, 'Entre novamente para acessar o painel.');
    const response = await upstream('/auth/v1/user', { method: 'GET', headers: { apikey: serviceRoleKey, Authorization: authorization } });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Sessão inválida ou expirada. Entre novamente.');
      throw new ApiError(503, 'Não foi possível verificar a sessão.');
    }
    const user = await jsonData(response);
    if (!isUUID(user?.id)) throw new ApiError(401, 'Sessão inválida.');
    // Verification is ALWAYS server-side, for every admin request (including CSV/config).
    const allowed = await upstream(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, { method: 'GET', headers: serviceHeaders() });
    if (!allowed.ok) throw new ApiError(503, 'Não foi possível verificar a autorização.');
    const rows = await jsonData(allowed);
    if (!Array.isArray(rows)) throw new ApiError(503, 'Não foi possível verificar a autorização.');
    if (rows.length !== 1 || rows[0].user_id !== user.id) throw new ApiError(403, 'Sua conta não está autorizada neste painel.');
    return user.id;
  }
  const decodePath = url => {
    const full = new URL(url).pathname;
    // Works both at /functions/v1/clube-api and at the local /clube-api endpoint.
    const match = full.match(/^(?:\/functions\/v1)?\/clube-api(\/.*)?$/);
    if (!match) return null;
    return match[1] || '/';
  };
  return async function handler(request) {
    const origin = request.headers.get('origin');
    const headers = new Headers({
      'Cache-Control': 'no-store', 'Pragma': 'no-cache',
      'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Expose-Headers': 'Content-Disposition, Retry-After'
    });
    if (ORIGINS.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
    const json = (value, status = 200) => { headers.set('Content-Type', 'application/json; charset=utf-8'); return new Response(JSON.stringify(value), { status, headers }); };
    const correlation = crypto.randomUUID();
    try {
      checkOrigin(origin, false, false);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const path = decodePath(request.url), url = new URL(request.url);
      if (!path) throw new ApiError(404, 'Rota não encontrada.');
      const admin = path === '/admin' || path.startsWith('/admin/');
      const actor = admin ? await authorize(request) : null;
      const mutating = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method);
      checkOrigin(origin, mutating, actor !== null);
      if (path === '/config' && request.method === 'GET') return json(await rpc('clube_public_config'));
      if (path === '/respostas' && request.method === 'POST') {
        let submission;
        try { submission = validateSubmission(await readJSON(request), schema, parsePhoneNumber); }
        catch (error) { denyInvalidBurst(); throw error; }
        const hash = await payloadHash({ answers: submission.answers, form_version: submission.form_version });
        const result = await rpc('clube_submit_with_notice', {
          p_answers: submission.answers, p_form_version: submission.form_version,
          p_idempotency_key: submission.idempotency_key, p_payload_hash: hash,
          p_notice_version: submission.privacy_notice_version
        });
        if (typeof result?.protocol !== 'string' || !result?.received_at) throw new ApiError(503, 'O recebimento não pôde ser confirmado. Tente novamente com a mesma tentativa.');
        return json({ protocol: result.protocol, received_at: result.received_at });
      }
      if (path === '/admin/config') {
        if (request.method === 'GET') return json(await rpc('clube_settings', { p_actor: actor }));
        if (request.method === 'PATCH') {
          const body = validateSettings(await readJSON(request));
          return json(await rpc('clube_settings_update', {
            p_actor: actor, p_revision: body.revision, p_open: body.open,
            p_responsible: body.responsible, p_channel: body.channel, p_retention_days: body.retention_days
          }));
        }
      }
      if (path === '/admin/respostas' && request.method === 'GET') {
        const filters = validateFilters(url.searchParams.get('filters'), schema);
        const page = positiveInt(url.searchParams.get('page'), 1, 1000000);
        const pageSize = positiveInt(url.searchParams.get('page_size'), 50, 100);
        return json(await rpc('clube_list', { p_actor: actor, p_filters: filters, p_page: page, p_page_size: pageSize }));
      }
      const detail = path.match(/^\/admin\/respostas\/([^/]+)$/);
      if (detail) {
        const id = detail[1];
        if (!isUUID(id)) throw new ApiError(400, 'Identificador de resposta inválido.');
        if (request.method === 'GET') return json(await rpc('clube_detail', { p_actor: actor, p_id: id }));
        if (request.method === 'PATCH') {
          const body = validateUpdate(await readJSON(request));
          return json(await rpc('clube_update', { p_actor: actor, p_id: id, p_revision: body.revision, p_status: body.status, p_notes: body.notes, p_confirmed: body.confirmed }));
        }
        if (request.method === 'DELETE') {
          const body = await readJSON(request); keysOnly(body, ['revision', 'confirm_protocol']); revision(body.revision);
          if (typeof body.confirm_protocol !== 'string' || !/^CL-[a-f0-9]{32}$/.test(body.confirm_protocol)) throw new ApiError(400, 'Digite o protocolo completo para confirmar a exclusão.');
          return json(await rpc('clube_delete', { p_actor: actor, p_id: id, p_revision: body.revision, p_confirm_protocol: body.confirm_protocol }));
        }
      }
      if (path === '/admin/exportacao' && request.method === 'GET') {
        const filters = validateFilters(url.searchParams.get('filters'), schema);
        let after = null, generation = null;
        // Chunks contain CSV only. DB filters + keyset pagination avoid loading the base
        // as JS objects and are not subject to PostgREST's default 1,000-row truncation.
        // Do NOT return a Response until every page succeeded: failures cannot yield a
        // success-status half-download. A generation change aborts with HTTP 409.
        const chunks = [csvHeader(schema)];
        while (true) {
          const data = await rpc('clube_export_page', { p_actor: actor, p_filters: filters, p_after: after, p_generation: generation });
          if (!Array.isArray(data?.items) || !Number.isSafeInteger(data?.generation)) throw new ApiError(503, 'Exportação indisponível.');
          generation = data.generation;
          for (const item of data.items) chunks.push(csvRow(item, schema));
          if (data.items.length < 500) break;
          const next = data.items.at(-1)?.id;
          if (!isUUID(next) || next === after) throw new ApiError(503, 'Paginação de exportação inválida.');
          after = next;
        }
        headers.set('Content-Type', 'text/csv; charset=utf-8');
        headers.set('Content-Disposition', 'attachment; filename="clube-do-livro.csv"');
        return new Response(new Blob(chunks, { type: 'text/csv;charset=utf-8' }), { status: 200, headers });
      }
      throw new ApiError(404, 'Rota ou método não encontrado.');
    } catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 503;
      // Never log request URL/query/body, token, raw exceptions or upstream responses.
      if (status >= 500) log(JSON.stringify({ event: 'clube_api_error', status, correlation_id: correlation }));
      if (status === 429) headers.set('Retry-After', '60');
      return json({ error: known ? error.message : 'Serviço temporariamente indisponível. Nenhum sucesso foi confirmado.', ...(known && error.fields ? { fields: error.fields } : {}) }, status);
    }
  };
}
