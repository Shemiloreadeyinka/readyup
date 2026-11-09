import AiProvider from './AiProvider.js';
import { upstreamError, badRequest } from '../utils/errors.js';
import { fetchWithRetry } from './httpRetry.js';

/**
 * Provider for the OpenAI Chat Completions API and anything that speaks it.
 *
 * OPENAI_BASE_URL can point at Groq, Together, OpenRouter, a Gemini
 * compatibility endpoint or a local gateway, so error messages name the host
 * actually being called rather than assuming OpenAI.
 */
export class OpenAiProvider extends AiProvider {
  constructor({ apiKey, model, baseUrl, timeoutMs }) {
    super({ id: 'openai', label: 'OpenAI', model, isCloud: true, timeoutMs });
    this.apiKey = apiKey || '';
    this.baseUrl = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  requireKey() {
    if (!this.apiKey) {
      throw badRequest(
        'No OpenAI API key is configured. Add OPENAI_API_KEY to the backend .env file or save a key in AI Settings.',
      );
    }
  }

  /** The host actually being called, which may not be OpenAI. */
  endpointHost() {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return 'the API';
    }
  }

  /** Explains a failure in terms of the endpoint in use. */
  explainHttpError(status, body = '', response = null) {
    const host = this.endpointHost();
    const detail = body.trim().slice(0, 200);
    const suffix = detail ? ` Response: ${detail}` : '';

    if (status === 401 || status === 403) {
      return `${host} rejected the API key. Check the key in AI Settings matches the endpoint: a key from one provider will not work against another.${suffix}`;
    }

    if (status === 404) {
      return `${host} does not have a model called "${this.model}". Check the model id for this provider.${suffix}`;
    }

    if (status === 429) {
      const perMinute = response?.headers?.get?.('x-ratelimit-limit-tokens');
      const budget = perMinute
        ? ` This endpoint allows ${Number(perMinute).toLocaleString()} tokens per minute, and one tailoring run needs roughly 11,000.`
        : '';
      return (
        `${host} is rate limiting this account and the retries did not clear it.${budget} ` +
        'Wait for the quota window to reset, raise AI_TIMEOUT_MS so retries have longer, or switch to a provider with a larger per-minute allowance.' +
        suffix
      );
    }

    if (status >= 500) {
      return `${host} had a server error (${status}). This is on their side; try again shortly.${suffix}`;
    }

    return `${host} returned ${status}.${suffix}`;
  }

  async chat({ system, prompt, json, temperature, signal }) {
    this.requireKey();

    let response;
    try {
      response = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            temperature,
            response_format: json ? { type: 'json_object' } : undefined,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: prompt },
            ],
          }),
        },
        {
          signal,
          label: this.endpointHost(),
          onRetry: ({ waitMs, status }) =>
            this.warn(
              status === 429
                ? `${this.endpointHost()} rate limited this run; waiting ${Math.round(waitMs / 1000)}s for the quota window and retrying. Tailoring will take longer than usual.`
                : `${this.endpointHost()} returned ${status}; retrying after ${Math.round(waitMs / 1000)}s.`,
            ),
        },
      );
    } catch (error) {
      if (error.name === 'AbortError') {
        throw upstreamError(
          `The request to ${this.endpointHost()} timed out after ${Math.round(this.timeoutMs / 1000)}s. If you are on a rate limited free tier, raise AI_TIMEOUT_MS so retries have time to complete.`,
        );
      }
      throw upstreamError(`Could not reach ${this.endpointHost()}.`, { cause: error.message });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw upstreamError(this.explainHttpError(response.status, body, response), {
        status: response.status,
        body: body.slice(0, 400),
      });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw upstreamError('OpenAI returned an empty response');
    return content;
  }

  async listModels() {
    if (!this.apiKey) return [];
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data?.data ?? [])
        .map((entry) => entry.id)
        .filter((id) => typeof id === 'string' && id.startsWith('gpt'))
        .sort();
    } catch {
      return [];
    }
  }

  async testConnection() {
    if (!this.apiKey) {
      return { ok: false, message: 'No OpenAI API key configured.' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (response.status === 401) return { ok: false, message: 'API key rejected by OpenAI.' };
      if (!response.ok) return { ok: false, message: `OpenAI responded with ${response.status}.` };
      const data = await response.json();
      const models = (data?.data ?? []).map((entry) => entry.id).filter(Boolean);
      return {
        ok: true,
        message: `Connected to OpenAI. Using ${this.model}.`,
        models: models.filter((id) => id.startsWith('gpt')).sort(),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error.name === 'AbortError'
            ? 'OpenAI connection test timed out.'
            : 'Could not reach the OpenAI API.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export default OpenAiProvider;
