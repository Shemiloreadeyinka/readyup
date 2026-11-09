import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Point the store at a throwaway directory before anything reads the config.
const dataDir = path.join(os.tmpdir(), `cv-tailor-ai-${process.pid}`);
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { AiProvider } = await import('../src/ai/AiProvider.js');
const { OllamaProvider } = await import('../src/ai/OllamaProvider.js');
const { OpenAiProvider } = await import('../src/ai/OpenAiProvider.js');
const { AnthropicProvider } = await import('../src/ai/AnthropicProvider.js');
const { createProvider, saveSettings, getSettings, getPublicSettings, resolveProviderForRequest } =
  await import('../src/ai/index.js');
const { runTailoringPipeline } = await import('../src/pipeline/tailorPipeline.js');
const { sampleCv, sampleJobText } = await import('./helpers.js');

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
});

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

/** A provider that records calls instead of reaching the network. */
class FakeProvider extends AiProvider {
  constructor(responses = {}) {
    super({ id: 'fake', label: 'Fake', model: 'fake-1', isCloud: false, timeoutMs: 1000 });
    this.responses = responses;
    this.calls = [];
  }

  async chat({ system, prompt, json }) {
    this.calls.push({ system, prompt, json });

    if (prompt.includes('Analyse the job posting')) return this.responses.job ?? '{}';
    if (prompt.includes('Parse the CV below')) return this.responses.cv ?? '{}';
    if (prompt.includes('Compare the candidate CV')) return this.responses.comparison ?? '{}';
    if (prompt.includes('Produce a tailored version')) return this.responses.tailored ?? '{}';
    return this.responses.suggestions ?? '{}';
  }

  async testConnection() {
    return { ok: true, message: 'fake' };
  }
}

test('the abstract provider cannot be instantiated directly', () => {
  assert.throws(() => new AiProvider({ id: 'x', label: 'x', model: 'x' }), /abstract/);
});

test('every provider implements the same interface', () => {
  const providers = [
    new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' }),
    new OpenAiProvider({ apiKey: 'test', model: 'gpt-4o-mini' }),
    new AnthropicProvider({ apiKey: 'test', model: 'claude-sonnet-5-5' }),
  ];

  for (const provider of providers) {
    for (const method of [
      'analyseJob',
      'analyseCV',
      'compareCVWithJob',
      'tailorCV',
      'generateSuggestions',
      'chat',
      'testConnection',
      'listModels',
      'describe',
    ]) {
      assert.equal(typeof provider[method], 'function', `${provider.id} is missing ${method}`);
    }
    assert.equal(typeof provider.describe().isCloud, 'boolean');
  }
});

test('cloud providers are flagged as cloud, local ones are not', () => {
  assert.equal(new OllamaProvider({ model: 'llama3.1:8b' }).isCloud, false);
  assert.equal(new OpenAiProvider({ apiKey: 'k', model: 'gpt-4o-mini' }).isCloud, true);
  assert.equal(new AnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5' }).isCloud, true);
});

test('the shared interface parses model JSON for every stage', async () => {
  const provider = new FakeProvider({
    job: '```json\n{"jobTitle":"Backend Engineer"}\n```',
    cv: '{"personalInformation":{"fullName":"Ada"}}',
    comparison: 'Here you go: {"overallAlignment":70}',
    tailored: '{"tailoredCv":{"professionalSummary":"Summary"}}',
    suggestions: '{"skillsToHighlight":["Node.js"]}',
  });

  assert.equal((await provider.analyseJob('text')).jobTitle, 'Backend Engineer');
  assert.equal((await provider.analyseCV('text')).personalInformation.fullName, 'Ada');
  assert.equal((await provider.compareCVWithJob({}, {})).overallAlignment, 70);
  assert.equal((await provider.tailorCV({}, {}, {})).tailoredCv.professionalSummary, 'Summary');
  assert.deepEqual((await provider.generateSuggestions({}, {})).skillsToHighlight, ['Node.js']);

  assert.equal(provider.calls.length, 5);
  assert.ok(provider.calls.every((call) => call.json === true));
});

test('every stage prompt carries the truthfulness rules where it matters', async () => {
  const provider = new FakeProvider();
  await provider.analyseCV('text');
  await provider.tailorCV({}, {}, {});

  for (const call of provider.calls) {
    assert.match(call.prompt, /MUST NOT invent/);
  }
});

test('API keys never appear in the settings exposed to the extension', async () => {
  await saveSettings({ openai: { apiKey: 'sk-secret-value', model: 'gpt-4o-mini' } });

  const stored = await getSettings();
  assert.equal(stored.openai.apiKey, 'sk-secret-value');

  const publicSettings = await getPublicSettings();
  assert.equal(JSON.stringify(publicSettings).includes('sk-secret-value'), false);
  assert.equal(publicSettings.openai.hasApiKey, true);
  assert.equal(publicSettings.openai.keySource, 'saved');
});

test('switching provider changes only the transport', async () => {
  await saveSettings({ provider: 'ollama' });
  assert.ok((await createProvider()) instanceof OllamaProvider);

  await saveSettings({ provider: 'openai' });
  assert.ok((await createProvider()) instanceof OpenAiProvider);

  await saveSettings({ provider: 'anthropic' });
  assert.ok((await createProvider()) instanceof AnthropicProvider);

  // An explicit request wins over the saved default.
  assert.ok((await createProvider('ollama')) instanceof OllamaProvider);
});

test('an unknown provider id is rejected', async () => {
  await assert.rejects(() => createProvider('definitely-not-a-provider'), /Unknown AI provider/);
  await assert.rejects(() => saveSettings({ provider: 'nope' }), /Unknown provider/);
});

test('an invalid Ollama URL is rejected', async () => {
  await assert.rejects(() => saveSettings({ ollama: { baseUrl: 'not a url' } }), /not a valid/);
});

test('cloud providers are blocked until the user consents', async () => {
  await saveSettings({ provider: 'openai', cloudConsent: false });
  await assert.rejects(() => resolveProviderForRequest({}), /Enable "Allow cloud processing"/);

  await saveSettings({ cloudConsent: true });
  const provider = await resolveProviderForRequest({});
  assert.equal(provider.id, 'openai');

  // Local providers never require consent.
  await saveSettings({ cloudConsent: false });
  assert.equal((await resolveProviderForRequest({ provider: 'ollama' })).id, 'ollama');
});

test('the pipeline runs end to end against any provider', async () => {
  const provider = new FakeProvider({
    job: JSON.stringify({
      jobTitle: 'Senior Backend Engineer',
      company: 'Example Company',
      requiredTechnologies: ['Node.js', 'PostgreSQL', 'Kubernetes'],
      responsibilities: ['Build APIs'],
    }),
    comparison: JSON.stringify({
      overallAlignment: 99,
      skillMatches: [
        { requirement: 'Node.js', status: 'strong', evidence: 'Built REST APIs with Node.js' },
      ],
    }),
    tailored: JSON.stringify({
      tailoredCv: { ...sampleCv(), professionalSummary: 'Backend engineer focused on Node.js APIs.' },
      sectionOrder: ['professionalSummary', 'technicalSkills', 'workExperience'],
      changeLog: [{ section: 'summary', change: 'Rewritten', reason: 'Role focus' }],
      keywordsApplied: ['Node.js'],
    }),
    suggestions: JSON.stringify({ skillsToHighlight: ['Node.js'] }),
  });

  const stages = [];
  const result = await runTailoringPipeline({
    provider,
    jobText: sampleJobText,
    jobMeta: { jobTitle: 'Senior Backend Engineer', company: 'Example Company' },
    cv: sampleCv(),
    onProgress: (stage) => stages.push(stage),
  });

  assert.deepEqual(stages, ['job-analysis', 'comparison', 'tailoring', 'recommendations', 'done']);
  assert.equal(result.jobAnalysis.jobTitle, 'Senior Backend Engineer');

  // The score is recomputed from evidence, not taken from the model.
  assert.notEqual(result.comparison.overallAlignment, 99);
  assert.ok(result.comparison.scoreExplanation.length > 0);

  // Requirements the model skipped are still covered.
  const covered = result.comparison.skillMatches.map((match) => match.requirement);
  assert.ok(covered.includes('Kubernetes'));

  assert.equal(result.tailored.cv.personalInformation.fullName, 'Ada Lovelace');
  assert.equal(result.tailored.sectionOrder[0], 'professionalSummary');
  assert.deepEqual(result.suggestions.skillsToHighlight, ['Node.js']);
});

test('the pipeline degrades gracefully when stages fail', async () => {
  class FlakyProvider extends FakeProvider {
    async chat(args) {
      if (args.prompt.includes('Analyse the job posting')) throw new Error('model offline');
      if (args.prompt.includes('Compare the candidate CV')) throw new Error('model offline');
      if (args.prompt.includes('Produce a tailored version')) {
        return JSON.stringify({ tailoredCv: sampleCv() });
      }
      throw new Error('model offline');
    }
  }

  const result = await runTailoringPipeline({
    provider: new FlakyProvider(),
    jobText: sampleJobText,
    jobMeta: {},
    cv: sampleCv(),
  });

  assert.equal(result.meta.jobAnalysisMethod, 'heuristic');
  assert.equal(result.meta.comparisonMethod, 'deterministic');
  assert.ok(result.comparison.skillMatches.length > 0);
  assert.equal(result.suggestions, null);
  assert.ok(result.meta.warnings.some((warning) => warning.includes('model offline')));
});

test('tailoring without a provider fails with a clear message', async () => {
  await assert.rejects(
    () =>
      runTailoringPipeline({
        provider: null,
        jobText: sampleJobText,
        jobMeta: {},
        cv: sampleCv(),
      }),
    /needs an AI provider/,
  );
});

test('the truthfulness guard applies no matter which provider produced the CV', async () => {
  const fabricated = sampleCv();
  fabricated.workExperience[0].company = 'Fictional Systems';
  fabricated.technicalSkills.push({ category: 'Extra', skills: ['Kubernetes'] });

  const provider = new FakeProvider({ tailored: JSON.stringify({ tailoredCv: fabricated }) });

  const result = await runTailoringPipeline({
    provider,
    jobText: sampleJobText,
    jobMeta: {},
    cv: sampleCv(),
  });

  assert.equal(result.tailored.cv.workExperience[0].company, 'Analytical Ltd');
  assert.ok(!result.tailored.cv.technicalSkills.flatMap((group) => group.skills).includes('Kubernetes'));
  assert.ok(result.tailored.factCheck.corrections.length > 0);
});
