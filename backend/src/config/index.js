import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..', '..');

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toList = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const resolveDir = (value, fallback) =>
  path.isAbsolute(value ?? '') ? value : path.resolve(backendRoot, value || fallback);

export const config = {
  backendRoot,
  port: toInt(process.env.PORT, 8787),
  allowedOrigins: toList(process.env.ALLOWED_ORIGINS),
  defaultProvider: process.env.DEFAULT_AI_PROVIDER || 'ollama',

  limits: {
    maxUploadBytes: toInt(process.env.MAX_UPLOAD_MB, 8) * 1024 * 1024,
    maxBodyBytes: toInt(process.env.MAX_BODY_MB, 2) * 1024 * 1024,
    aiTimeoutMs: toInt(process.env.AI_TIMEOUT_MS, 180000),
  },

  paths: {
    dataDir: resolveDir(process.env.DATA_DIR, './data'),
    tmpDir: resolveDir(process.env.TMP_DIR, './tmp'),
  },

  providers: {
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
      numCtx: toInt(process.env.OLLAMA_NUM_CTX, 8192),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
    },
  },
};

/** Providers that need a secret the user has to supply themselves. */
export const CLOUD_PROVIDERS = new Set(['openai', 'anthropic']);

export default config;
