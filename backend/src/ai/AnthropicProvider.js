import AiProvider from './AiProvider.js';
import { upstreamError, badRequest } from '../utils/errors.js';

const ANTHROPIC_VERSION = '2023-06-01';

/** Cloud provider backed by the Anthropic Messages API. */
export class AnthropicProvider extends AiProvider {
  constructor({ apiKey, model, baseUrl, timeoutMs }) {
    super({ id: 'anthropic', label: 'Anthropic Claude', model, isCloud: true, timeoutMs });
    this.apiKey = apiKey || '';
    this.baseUrl = String(baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  }

  requireKey() {
    if (!this.apiKey) {
      throw badRequest(
        'No Anthropic API key is configured. Add ANTHROPIC_API_KEY to the backend .env file or save a key in AI Settings.',
      );
    }
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  /** Explains a failure, surfacing what the API actually said. */
  explainHttpError(status, body = '') {
    const detail = body.trim().slice(0, 300);
    const suffix = detail ? ` Response: ${detail}` : '';

    if (status === 401 || status === 403) {
      return `Anthropic rejected the API key. Check it in AI Settings.${suffix}`;
    }
    if (status === 404) {
      return `Anthropic has no model called "${this.model}" for this account.${suffix}`;
    }
    if (status === 400) {
      return (
        `Anthropic rejected the request for "${this.model}" (HTTP 400). ` +
        'This usually means the model does not accept one of the request parameters.' +
        suffix
      );
    }
    if (status === 429) {
      return `Anthropic rate limit reached for "${this.model}". Wait a moment and try again.${suffix}`;
    }
    if (status >= 500) {
      return `Anthropic had a server error (${status}). This is on their side; try again shortly.${suffix}`;
    }
    return `Anthropic returned ${status}.${suffix}`;
  }

  /**
   * Sends a Messages API request.
   *
   * Two parameters that work on most providers are rejected by current Claude
   * models, so they are deliberately not sent:
   *
   *   - Assistant prefill (seeding the reply with "{" to force JSON) returns a
   *     400 on the Claude 4.6+ and 5 families. The prompts ask for JSON only
   *     and parseModelJson strips any preamble, which covers the same ground.
   *   - A non-default `temperature` returns a 400 on Claude Sonnet 5.5 and is
   *     removed outright on several others, so it is dropped here. Determinism
   *     comes from the prompts instead.
   */
  async chat({ system, prompt, json, signal }) {
    this.requireKey();

    let response;
    try {
      response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        signal,
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          // Thinking is on by default on current models and draws from the same
          // budget, so leave room for a full JSON document underneath it.
          max_tokens: 16000,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (error) {
      if (error.name === 'AbortError') throw upstreamError('Anthropic request timed out.');
      throw upstreamError('Could not reach the Anthropic API.', { cause: error.message });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw upstreamError(this.explainHttpError(response.status, body), {
        status: response.status,
        body: body.slice(0, 400),
      });
    }

    const data = await response.json();

    // Current models return thinking blocks alongside text; only text carries
    // the answer.
    const text = (data?.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text) {
      throw upstreamError(
        data?.stop_reason === 'refusal'
          ? 'Claude declined this request. If the CV or job description contains unusual content, edit it and try again.'
          : 'Anthropic returned an empty response',
      );
    }
    return text;
  }

  async listModels() {
    if (!this.apiKey) return [];
    try {
      const response = await fetch(`${this.baseUrl}/models?limit=50`, { headers: this.headers() });
      if (!response.ok) return [];
      const data = await response.json();
      return (data?.data ?? []).map((entry) => entry.id).filter(Boolean);
    } catch {
      return [];
    }
  }

  async testConnection() {
    if (!this.apiKey) {
      return { ok: false, message: 'No Anthropic API key configured.' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${this.baseUrl}/models?limit=50`, {
        signal: controller.signal,
        headers: this.headers(),
      });
      if (response.status === 401) {
        return { ok: false, message: 'API key rejected by Anthropic.' };
      }
      if (!response.ok) {
        return { ok: false, message: `Anthropic responded with ${response.status}.` };
      }
      const data = await response.json();
      return {
        ok: true,
        message: `Connected to Anthropic. Using ${this.model}.`,
        models: (data?.data ?? []).map((entry) => entry.id).filter(Boolean),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error.name === 'AbortError'
            ? 'Anthropic connection test timed out.'
            : 'Could not reach the Anthropic API.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export default AnthropicProvider;
