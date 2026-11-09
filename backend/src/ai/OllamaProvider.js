import AiProvider from './AiProvider.js';
import { upstreamError } from '../utils/errors.js';
import { estimateTokens } from '../utils/text.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** True when the Ollama daemon is somewhere other than this machine. */
export function isRemoteOllamaUrl(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    return !(LOOPBACK_HOSTS.has(hostname) || hostname.startsWith('127.'));
  } catch {
    return false;
  }
}

/**
 * True for Ollama Cloud models. The daemon runs these on ollama.com and only
 * proxies the request, so a localhost URL does not mean local inference.
 */
export function isCloudOllamaModel(model) {
  return /[-:]cloud$/i.test(String(model ?? '').trim());
}

/**
 * Explains why an Ollama configuration counts as cloud, or returns null when
 * inference genuinely happens on this machine.
 */
export function describeOllamaCloudUse({ baseUrl, model }) {
  if (isCloudOllamaModel(model)) {
    return `"${model}" is an Ollama Cloud model: the local daemon forwards the request to ollama.com, so your CV leaves this machine.`;
  }
  if (isRemoteOllamaUrl(baseUrl)) {
    return `Ollama is configured at ${baseUrl}, which is not this machine, so your CV is sent over the network.`;
  }
  return null;
}

/**
 * AI provider backed by Ollama.
 *
 * Usually local, but not always: a "-cloud" model or a non-loopback server
 * URL means the request leaves the machine. The provider reports that through
 * isCloud so the consent gate and the UI stay honest.
 */
export class OllamaProvider extends AiProvider {
  constructor({ baseUrl, model, timeoutMs, numCtx }) {
    const resolvedUrl = String(baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    const cloudReason = describeOllamaCloudUse({ baseUrl: resolvedUrl, model });

    super({
      id: 'ollama',
      label: cloudReason ? 'Ollama (cloud)' : 'Ollama (local)',
      model,
      isCloud: Boolean(cloudReason),
      timeoutMs,
    });

    this.baseUrl = resolvedUrl;
    this.cloudReason = cloudReason;
    this.numCtx = Number(numCtx) > 0 ? Number(numCtx) : 8192;
  }

  /**
   * Ollama silently truncates anything past num_ctx, which corrupts a parse
   * without failing, so warn before that happens rather than after.
   */
  checkContextBudget({ system, prompt }) {
    const inputTokens = estimateTokens(`${system ?? ''}\n${prompt ?? ''}`);

    // Leave at least 40% of the window for the model's own output: these
    // stages emit whole JSON documents, not short answers.
    if (inputTokens > this.numCtx * 0.6) {
      this.warn(
        `This request is about ${inputTokens.toLocaleString()} tokens but the Ollama context window is set to ${this.numCtx.toLocaleString()}. ` +
          'Ollama truncates silently, so the result may be incomplete. Raise the context window in AI Settings (needs more RAM) or shorten the CV.',
      );
      return { fits: false, inputTokens };
    }
    return { fits: true, inputTokens };
  }

  /**
   * Turns an Ollama HTTP status into something the user can act on.
   *
   * Cloud models fail in ways a local daemon never does — billing, quota and
   * sign-in — and the raw status code gives no hint which one happened.
   */
  explainHttpError(status, body = '') {
    const detail = body.trim().slice(0, 200);
    const suffix = detail ? ` Ollama said: ${detail}` : '';

    if (status === 404) {
      return this.isCloud
        ? `Ollama does not recognise the cloud model "${this.model}". Check the name at ollama.com/library, then run: ollama pull ${this.model}${suffix}`
        : `Ollama does not have the model "${this.model}". Pull it first: ollama pull ${this.model}`;
    }

    if (status === 401 || status === 403) {
      return this.isCloud
        ? `Ollama Cloud rejected your credentials for "${this.model}". Run "ollama signin" in a terminal, then try again.${suffix}`
        : `Ollama refused the request (${status}).${suffix}`;
    }

    if (status === 402) {
      return (
        `Ollama Cloud will not run "${this.model}" on your current plan (HTTP 402, payment required). ` +
        'Either your free-tier quota is used up, or this model needs a paid plan: the largest cloud models are the first to be gated. ' +
        'Check ollama.com/settings for your usage, try a smaller cloud model such as gpt-oss:20b-cloud, ' +
        'switch to a model that runs on this machine, or use another provider in AI Settings.' +
        suffix
      );
    }

    if (status === 429) {
      return this.isCloud
        ? `Ollama Cloud rate limit reached for "${this.model}". Wait for your quota window to reset, or switch to a local model.${suffix}`
        : `Ollama is rate limiting requests.${suffix}`;
    }

    if (status >= 500) {
      return this.isCloud
        ? `Ollama Cloud had a server error (${status}). This is on their side; try again shortly.${suffix}`
        : `Ollama returned a server error (${status}).${suffix}`;
    }

    return `Ollama returned ${status}.${suffix}`;
  }

  async chat({ system, prompt, json, temperature, signal }) {
    this.checkContextBudget({ system, prompt });

    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: json ? 'json' : undefined,
          options: { temperature, num_ctx: this.numCtx },
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: prompt },
          ],
        }),
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw upstreamError(
          `Ollama did not respond within ${Math.round(this.timeoutMs / 1000)}s. Local models can be slow on large CVs; try a smaller model or raise AI_TIMEOUT_MS.`,
        );
      }
      throw upstreamError(
        `Could not reach Ollama at ${this.baseUrl}. Is it running? Start it with "ollama serve".`,
        { cause: error.message },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw upstreamError(this.explainHttpError(response.status, body), {
        status: response.status,
        body: body.slice(0, 400),
      });
    }

    const data = await response.json();
    const content = data?.message?.content;
    if (!content) throw upstreamError('Ollama returned an empty response');
    return content;
  }

  async listModels() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) return [];
      const data = await response.json();
      return (data?.models ?? []).map((entry) => entry.name).filter(Boolean);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) {
        return { ok: false, message: `Ollama responded with ${response.status}` };
      }
      const data = await response.json();
      const models = (data?.models ?? []).map((entry) => entry.name).filter(Boolean);
      if (!models.length) {
        return {
          ok: false,
          message: 'Ollama is running but has no models. Run: ollama pull llama3.1:8b',
          models,
        };
      }
      const hasModel = models.includes(this.model);
      return {
        ok: hasModel,
        message: hasModel
          ? `Connected to Ollama. Using ${this.model}.`
          : `Ollama is running but "${this.model}" is not installed. Run: ollama pull ${this.model}`,
        models,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error.name === 'AbortError'
            ? `Ollama at ${this.baseUrl} timed out.`
            : `Could not reach Ollama at ${this.baseUrl}. Start it with "ollama serve".`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export default OllamaProvider;
