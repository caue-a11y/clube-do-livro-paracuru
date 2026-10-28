import { API_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_URL}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || 'Não foi possível concluir. Tente novamente.');
      error.status = response.status;
      error.fields = payload?.fields || {};
      throw error;
    }
    if (!payload) throw new Error('O serviço respondeu de forma inesperada. Tente novamente.');
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('A confirmação demorou para chegar. Suas respostas continuam aqui. Tente enviar novamente; o mesmo envio não será duplicado.');
      timeoutError.status = 0;
      throw timeoutError;
    }
    if (error instanceof TypeError) {
      const networkError = new Error('Não foi possível acessar o serviço. Confira sua conexão e tente novamente.');
      networkError.status = 0;
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
