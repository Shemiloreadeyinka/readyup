import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.join(os.tmpdir(), `cv-tailor-cloud-${process.pid}`);
process.env.DATA_DIR = dataDir;

const { OllamaProvider, isCloudOllamaModel, isRemoteOllamaUrl, describeOllamaCloudUse } =
  await import('../src/ai/OllamaProvider.js');
const { saveSettings, getPublicSettings, resolveProviderForRequest, createProvider } = await import(
  '../src/ai/index.js'
);
const { estimateTokens } = await import('../src/utils/text.js');

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
});

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

/* ------------------------ cloud model detection ------------------------- */

test('Ollama Cloud model names are recognised', () => {
  for (const model of [
    'gpt-oss:120b-cloud',
    'qwen3-coder:480b-cloud',
    'deepseek-v3.1:671b-cloud',
    'GPT-OSS:20B-CLOUD',
  ]) {
    assert.equal(isCloudOllamaModel(model), true, `${model} should be cloud`);
  }
});

test('ordinary local model names are not treated as cloud', () => {
  for (const model of ['llama3.1:8b', 'qwen2.5:7b', 'cloudy-llama:7b', 'mistral', '']) {
    assert.equal(isCloudOllamaModel(model), false, `${model} should be local`);
  }
});

test('loopback Ollama URLs are local, everything else is remote', () => {
  for (const url of [
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://127.0.0.5:11434',
    'http://[::1]:11434',
  ]) {
    assert.equal(isRemoteOllamaUrl(url), false, `${url} should be local`);
  }

  for (const url of [
    'https://ollama.example.com',
    'http://192.168.1.50:11434',
    'https://my-tunnel.trycloudflare.com',
  ]) {
    assert.equal(isRemoteOllamaUrl(url), true, `${url} should be remote`);
  }
});

test('the cloud explanation names the actual reason', () => {
  const byModel = describeOllamaCloudUse({
    baseUrl: 'http://localhost:11434',
    model: 'gpt-oss:120b-cloud',
  });
  assert.match(byModel, /ollama\.com/);
  assert.match(byModel, /leaves this machine/);

  const byUrl = describeOllamaCloudUse({
    baseUrl: 'https://ollama.example.com',
    model: 'llama3.1:8b',
  });
  assert.match(byUrl, /not this machine/);

  assert.equal(
    describeOllamaCloudUse({ baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' }),
    null,
  );
});

test('the provider reports itself as cloud when it is', () => {
  const local = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' });
  assert.equal(local.isCloud, false);
  assert.equal(local.label, 'Ollama (local)');
  assert.equal(local.describe().cloudReason, null);

  const cloud = new OllamaProvider({
    baseUrl: 'http://localhost:11434',
    model: 'gpt-oss:120b-cloud',
  });
  assert.equal(cloud.isCloud, true);
  assert.equal(cloud.label, 'Ollama (cloud)');
  assert.match(cloud.describe().cloudReason, /ollama\.com/);

  const remote = new OllamaProvider({ baseUrl: 'https://ollama.example.com', model: 'llama3.1:8b' });
  assert.equal(remote.isCloud, true);
});

/* --------------------------- the consent gate --------------------------- */

test('an Ollama Cloud model is blocked without consent, like any cloud provider', async () => {
  await saveSettings({
    provider: 'ollama',
    cloudConsent: false,
    ollama: { baseUrl: 'http://localhost:11434', model: 'gpt-oss:120b-cloud' },
  });

  await assert.rejects(
    () => resolveProviderForRequest({}),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.code, 'CLOUD_CONSENT_REQUIRED');
      assert.match(error.message, /ollama\.com/);
      assert.match(error.message, /Allow cloud processing/);
      return true;
    },
  );
});

test('a remote Ollama server is blocked without consent', async () => {
  await saveSettings({
    provider: 'ollama',
    cloudConsent: false,
    ollama: { baseUrl: 'https://ollama.example.com', model: 'llama3.1:8b' },
  });

  await assert.rejects(() => resolveProviderForRequest({}), /not this machine/);
});

test('consent unblocks the cloud model, and local models never needed it', async () => {
  await saveSettings({
    provider: 'ollama',
    cloudConsent: true,
    ollama: { baseUrl: 'http://localhost:11434', model: 'gpt-oss:120b-cloud' },
  });
  const consented = await resolveProviderForRequest({});
  assert.equal(consented.isCloud, true);

  await saveSettings({
    cloudConsent: false,
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' },
  });
  const local = await resolveProviderForRequest({});
  assert.equal(local.isCloud, false);
});

test('a per-request cloud model override is gated too', async () => {
  await saveSettings({
    provider: 'ollama',
    cloudConsent: false,
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' },
  });

  await assert.rejects(
    () => resolveProviderForRequest({ model: 'gpt-oss:120b-cloud' }),
    /Allow cloud processing/,
  );
});

test('the settings the extension sees say whether the setup is cloud', async () => {
  await saveSettings({
    provider: 'ollama',
    ollama: { baseUrl: 'http://localhost:11434', model: 'gpt-oss:120b-cloud' },
  });

  const cloudView = await getPublicSettings();
  assert.equal(cloudView.activeProvider.isCloud, true);
  assert.equal(cloudView.ollama.isCloud, true);
  assert.match(cloudView.activeProvider.cloudReason, /ollama\.com/);

  await saveSettings({ ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' } });
  const localView = await getPublicSettings();
  assert.equal(localView.activeProvider.isCloud, false);
  assert.equal(localView.ollama.cloudReason, null);
});

/* ------------------------- the context window --------------------------- */

test('the context window is configurable and clamped to a sane range', async () => {
  const saved = await saveSettings({ ollama: { numCtx: 16384 } });
  assert.equal(saved.ollama.numCtx, 16384);
  assert.equal((await createProvider('ollama')).numCtx, 16384);

  assert.equal((await saveSettings({ ollama: { numCtx: 1 } })).ollama.numCtx, 2048);
  assert.equal((await saveSettings({ ollama: { numCtx: 10_000_000 } })).ollama.numCtx, 131072);

  // Unparseable input keeps whatever was already saved rather than resetting.
  await saveSettings({ ollama: { numCtx: 8192 } });
  assert.equal((await saveSettings({ ollama: { numCtx: 'nonsense' } })).ollama.numCtx, 8192);
});

test('an oversized prompt warns instead of being silently truncated', () => {
  const provider = new OllamaProvider({ model: 'llama3.1:8b', numCtx: 8192 });

  const small = provider.checkContextBudget({ system: 'short', prompt: 'also short' });
  assert.equal(small.fits, true);
  assert.deepEqual(provider.drainWarnings(), []);

  // Comfortably past 60% of an 8192-token window.
  const huge = 'x'.repeat(30_000);
  const large = provider.checkContextBudget({ system: '', prompt: huge });

  assert.equal(large.fits, false);
  assert.ok(large.inputTokens > 8192 * 0.6);

  const warnings = provider.drainWarnings();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /truncates silently/);
  assert.match(warnings[0], /8,192/);
  assert.deepEqual(provider.drainWarnings(), [], 'draining clears the list');
});

test('a bigger context window accepts a prompt the smaller one rejected', () => {
  const prompt = 'x'.repeat(30_000);
  assert.equal(
    new OllamaProvider({ model: 'm', numCtx: 8192 }).checkContextBudget({ prompt }).fits,
    false,
  );
  assert.equal(
    new OllamaProvider({ model: 'm', numCtx: 32768 }).checkContextBudget({ prompt }).fits,
    true,
  );
});

test('the same warning is not repeated across stages', () => {
  const provider = new OllamaProvider({ model: 'm', numCtx: 8192 });
  const prompt = 'x'.repeat(30_000);

  provider.checkContextBudget({ prompt });
  provider.checkContextBudget({ prompt });
  provider.checkContextBudget({ prompt });

  assert.equal(provider.drainWarnings().length, 1);
});

test('token estimates are in the right ballpark', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('x'.repeat(3700)) >= 950);
  assert.ok(estimateTokens('x'.repeat(3700)) <= 1050);
});

/* ------------------------- provider error messages ---------------------- */

test('cloud failures explain themselves instead of showing a status code', () => {
  const cloud = new OllamaProvider({ model: 'gpt-oss:120b-cloud' });

  const payment = cloud.explainHttpError(402, '{"error":"quota exceeded"}');
  assert.match(payment, /payment required/i);
  assert.match(payment, /ollama\.com\/settings/);
  assert.match(payment, /gpt-oss:20b-cloud/, 'should suggest a smaller model');
  assert.match(payment, /quota exceeded/, 'should pass through what Ollama said');

  assert.match(cloud.explainHttpError(401), /ollama signin/);
  assert.match(cloud.explainHttpError(429), /rate limit/i);
  assert.match(cloud.explainHttpError(503), /their side/);
  assert.match(cloud.explainHttpError(404), /ollama\.com\/library/);
});

test('local failures keep the local advice', () => {
  const local = new OllamaProvider({ model: 'llama3.1:8b' });

  assert.match(local.explainHttpError(404), /ollama pull llama3\.1:8b/);
  assert.doesNotMatch(local.explainHttpError(404), /cloud/i);
  assert.match(local.explainHttpError(500), /server error/);
});

/* --------------------- Anthropic request compatibility ------------------ */

test('the Anthropic request omits parameters current Claude models reject', async () => {
  const { AnthropicProvider } = await import('../src/ai/AnthropicProvider.js');
  const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-5-5' });

  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const text = await provider.chat({ system: 'sys', prompt: 'hi', json: true, temperature: 0.2 });
    assert.equal(text, '{"ok":true}');
  } finally {
    globalThis.fetch = realFetch;
  }

  // Assistant prefill returns a 400 on the Claude 4.6+ and 5 families.
  assert.equal(captured.body.messages.length, 1);
  assert.equal(captured.body.messages[0].role, 'user');
  assert.ok(
    !captured.body.messages.some((message) => message.role === 'assistant'),
    'must not prefill the assistant turn',
  );

  // A non-default temperature is rejected on Claude Sonnet 5.5.
  assert.equal('temperature' in captured.body, false, 'must not send temperature');

  // Thinking shares the budget, so leave room for a full JSON document.
  assert.ok(captured.body.max_tokens >= 16000);
});

test('Anthropic thinking blocks are ignored and refusals are explained', async () => {
  const { AnthropicProvider } = await import('../src/ai/AnthropicProvider.js');
  const provider = new AnthropicProvider({ apiKey: 'test', model: 'claude-opus-5-5' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '{"a":1}' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    assert.equal(await provider.chat({ prompt: 'x', json: true }), '{"a":1}');
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    await assert.rejects(() => provider.chat({ prompt: 'x', json: true }), /declined this request/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Anthropic errors surface the API response', async () => {
  const { AnthropicProvider } = await import('../src/ai/AnthropicProvider.js');
  const provider = new AnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5' });

  const badRequest = provider.explainHttpError(
    400,
    '{"error":{"message":"temperature: not supported"}}',
  );
  assert.match(badRequest, /HTTP 400/);
  assert.match(badRequest, /temperature: not supported/);
  assert.match(provider.explainHttpError(401), /rejected the API key/);
  assert.match(provider.explainHttpError(429), /rate limit/i);
  assert.match(provider.explainHttpError(503), /their side/);
});
