import config, { CLOUD_PROVIDERS } from '../config/index.js';
import { readDocument, writeDocument } from '../store/jsonStore.js';
import { badRequest } from '../utils/errors.js';
import OllamaProvider, { describeOllamaCloudUse } from './OllamaProvider.js';
import OpenAiProvider from './OpenAiProvider.js';
import AnthropicProvider from './AnthropicProvider.js';

const SETTINGS_DOC = 'ai-settings';

export const PROVIDER_IDS = ['ollama', 'openai', 'anthropic'];

const defaultSettings = () => ({
  provider: PROVIDER_IDS.includes(config.defaultProvider) ? config.defaultProvider : 'ollama',
  cloudConsent: false,
  ollama: {
    baseUrl: config.providers.ollama.baseUrl,
    model: config.providers.ollama.model,
    numCtx: config.providers.ollama.numCtx,
  },
  openai: { apiKey: '', model: config.providers.openai.model },
  anthropic: { apiKey: '', model: config.providers.anthropic.model },
});

/**
 * Settings precedence: a value saved by the user wins, otherwise the backend
 * .env value is used. Keys are only ever stored and read server side.
 */
export async function getSettings() {
  const stored = await readDocument(SETTINGS_DOC, {});
  const defaults = defaultSettings();
  return {
    provider: stored.provider ?? defaults.provider,
    cloudConsent: Boolean(stored.cloudConsent),
    ollama: { ...defaults.ollama, ...(stored.ollama ?? {}) },
    openai: { ...defaults.openai, ...(stored.openai ?? {}) },
    anthropic: { ...defaults.anthropic, ...(stored.anthropic ?? {}) },
  };
}

/** Settings as the extension may see them: never includes secrets. */
export async function getPublicSettings() {
  const settings = await getSettings();

  // The UI needs to know whether the *current* configuration sends data off
  // the machine, which for Ollama depends on the model and the server URL.
  const ollamaCloudReason = describeOllamaCloudUse(settings.ollama);
  const activeIsCloud =
    settings.provider === 'ollama' ? Boolean(ollamaCloudReason) : CLOUD_PROVIDERS.has(settings.provider);

  return {
    provider: settings.provider,
    cloudConsent: settings.cloudConsent,
    activeProvider: {
      id: settings.provider,
      isCloud: activeIsCloud,
      cloudReason: settings.provider === 'ollama' ? ollamaCloudReason : null,
      model:
        settings.provider === 'ollama'
          ? settings.ollama.model
          : settings[settings.provider].model,
    },
    ollama: { ...settings.ollama, isCloud: Boolean(ollamaCloudReason), cloudReason: ollamaCloudReason },
    openai: {
      model: settings.openai.model,
      hasApiKey: Boolean(settings.openai.apiKey || config.providers.openai.apiKey),
      keySource: settings.openai.apiKey ? 'saved' : config.providers.openai.apiKey ? 'env' : 'none',
    },
    anthropic: {
      model: settings.anthropic.model,
      hasApiKey: Boolean(settings.anthropic.apiKey || config.providers.anthropic.apiKey),
      keySource: settings.anthropic.apiKey
        ? 'saved'
        : config.providers.anthropic.apiKey
          ? 'env'
          : 'none',
    },
    availableProviders: PROVIDER_IDS,
  };
}

const sanitiseUrl = (value, fallback) => {
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw badRequest(`"${value}" is not a valid http(s) URL`);
  }
};

export async function saveSettings(patch = {}) {
  const current = await getSettings();
  const next = { ...current };

  if (patch.provider !== undefined) {
    if (!PROVIDER_IDS.includes(patch.provider)) {
      throw badRequest(`Unknown provider "${patch.provider}"`);
    }
    next.provider = patch.provider;
  }

  if (patch.cloudConsent !== undefined) next.cloudConsent = Boolean(patch.cloudConsent);

  if (patch.ollama) {
    // The context window costs RAM, so it is clamped to a range that cannot
    // wedge a small machine or be set uselessly low.
    const requestedCtx = Number(patch.ollama.numCtx ?? current.ollama.numCtx);
    const numCtx = Number.isFinite(requestedCtx)
      ? Math.min(131072, Math.max(2048, Math.round(requestedCtx)))
      : current.ollama.numCtx;

    next.ollama = {
      baseUrl: sanitiseUrl(patch.ollama.baseUrl, current.ollama.baseUrl),
      model: String(patch.ollama.model ?? current.ollama.model).slice(0, 120),
      numCtx,
    };
  }

  for (const id of ['openai', 'anthropic']) {
    if (!patch[id]) continue;
    const incoming = patch[id];
    next[id] = {
      // An empty string clears the key; undefined leaves it untouched.
      apiKey:
        incoming.apiKey === undefined ? current[id].apiKey : String(incoming.apiKey).trim(),
      model: String(incoming.model ?? current[id].model).slice(0, 120),
    };
  }

  await writeDocument(SETTINGS_DOC, next);
  return getPublicSettings();
}

/** Builds a provider instance for the given id using current settings. */
export async function createProvider(providerId, overrides = {}) {
  const settings = await getSettings();
  const id = providerId ?? settings.provider;
  const timeoutMs = config.limits.aiTimeoutMs;

  if (id === 'ollama') {
    return new OllamaProvider({
      baseUrl: overrides.baseUrl ?? settings.ollama.baseUrl,
      model: overrides.model ?? settings.ollama.model,
      numCtx: overrides.numCtx ?? settings.ollama.numCtx,
      timeoutMs,
    });
  }

  if (id === 'openai') {
    return new OpenAiProvider({
      apiKey: overrides.apiKey ?? settings.openai.apiKey ?? config.providers.openai.apiKey,
      model: overrides.model ?? settings.openai.model,
      baseUrl: config.providers.openai.baseUrl,
      timeoutMs,
    });
  }

  if (id === 'anthropic') {
    return new AnthropicProvider({
      apiKey: overrides.apiKey ?? settings.anthropic.apiKey ?? config.providers.anthropic.apiKey,
      model: overrides.model ?? settings.anthropic.model,
      baseUrl: config.providers.anthropic.baseUrl,
      timeoutMs,
    });
  }

  throw badRequest(`Unknown AI provider "${id}"`);
}

/**
 * Resolves the provider for a request and enforces cloud consent.
 *
 * The decision is made on the built provider, not on its name: Ollama is
 * usually local, but a "-cloud" model or a remote server URL sends CV content
 * off the machine just as surely as OpenAI does, and must be gated the same
 * way.
 */
export async function resolveProviderForRequest({ provider, model } = {}) {
  const settings = await getSettings();
  const id = provider ?? settings.provider;
  const instance = await createProvider(id, model ? { model } : {});

  if (instance.isCloud && !settings.cloudConsent) {
    throw badRequest(
      instance.cloudReason
        ? `${instance.cloudReason} Enable "Allow cloud processing" in AI Settings, or choose a model that runs locally.`
        : `${instance.label} is a cloud provider. Enable "Allow cloud processing" in AI Settings before sending CV data off this machine.`,
      { code: 'CLOUD_CONSENT_REQUIRED', provider: id, reason: instance.cloudReason ?? null },
    );
  }

  return instance;
}

export { AiProvider } from './AiProvider.js';
