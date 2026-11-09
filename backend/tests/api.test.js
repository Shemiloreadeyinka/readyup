import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.join(os.tmpdir(), `cv-tailor-api-${process.pid}`);
process.env.DATA_DIR = dataDir;

const { createApp } = await import('../src/app.js');
const { renderCvPdf } = await import('../src/documents/pdf.js');
const { renderCvDocx } = await import('../src/documents/docx.js');
const { sampleCv, sampleJobText } = await import('./helpers.js');

let server;
let baseUrl;

/** Requests carry a chrome-extension Origin, as the real extension does. */
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

const api = (pathname, options = {}) =>
  fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Origin: EXTENSION_ORIGIN, ...(options.headers ?? {}) },
  });

const postJson = (pathname, body) =>
  api(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

const uploadSampleCv = async (name = 'Test CV') => {
  const pdf = await renderCvPdf(sampleCv(), { templateId: 'minimal-ats' });
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'cv.pdf');
  form.append('name', name);

  const response = await api('/api/cvs', { method: 'POST', body: form });
  assert.equal(response.status, 201);
  return (await response.json()).cv;
};

test('health check reports the service state', async () => {
  const response = await api('/api/health');
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'cv-tailor-backend');
});

test('requests from a chrome extension origin are allowed', async () => {
  const response = await api('/api/health');
  assert.equal(response.headers.get('access-control-allow-origin'), EXTENSION_ORIGIN);
});

test('requests from an unrelated website origin are refused', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://evil.example.com' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('an unknown route returns a JSON 404', async () => {
  const response = await api('/api/nope');
  assert.equal(response.status, 404);
  assert.match((await response.json()).error.message, /No route/);
});

test('uploading a CV extracts and structures it', async () => {
  const record = await uploadSampleCv('Ada CV');

  assert.equal(record.name, 'Ada CV');
  assert.equal(record.fileType, 'pdf');
  assert.equal(record.isDefault, true, 'the first CV becomes the default');
  assert.equal(record.cv.personalInformation.fullName, 'Ada Lovelace');
  assert.ok(record.cv.workExperience.length >= 1);
  assert.ok(record.rawText.includes('Analytical Ltd'));
});

test('uploading a non-CV file is rejected with a readable message', async () => {
  const form = new FormData();
  form.append('file', new Blob(['not a cv'], { type: 'application/pdf' }), 'cv.pdf');

  const response = await api('/api/cvs', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /Unsupported file type/);
});

test('uploading an unsupported extension is rejected', async () => {
  const form = new FormData();
  form.append('file', new Blob(['payload']), 'resume.exe');

  const response = await api('/api/cvs', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /PDF, DOCX and TXT/);
});

test('uploading with no file is rejected', async () => {
  const response = await api('/api/cvs', { method: 'POST', body: new FormData() });
  assert.equal(response.status, 400);
});

test('DOCX uploads are supported', async () => {
  const docx = await renderCvDocx(sampleCv(), { templateId: 'minimal-ats' });
  const form = new FormData();
  form.append(
    'file',
    new Blob([docx], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    'cv.docx',
  );

  const response = await api('/api/cvs', { method: 'POST', body: form });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).cv.fileType, 'docx');
});

test('CVs can be listed, edited, defaulted and deleted without losing the others', async () => {
  const first = await uploadSampleCv('First');
  const second = await uploadSampleCv('Second');

  const list = await (await api('/api/cvs')).json();
  const ids = list.items.map((item) => item.id);
  assert.ok(ids.includes(first.id) && ids.includes(second.id));

  const renamed = await (
    await api(`/api/cvs/${second.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed', isDefault: true }),
    })
  ).json();
  assert.equal(renamed.cv.name, 'Renamed');
  assert.equal(renamed.cv.isDefault, true);

  const afterDefault = await (await api('/api/cvs')).json();
  const defaults = afterDefault.items.filter((item) => item.isDefault);
  assert.equal(defaults.length, 1, 'exactly one CV is the default');
  assert.equal(defaults[0].id, second.id);

  const deleted = await api(`/api/cvs/${first.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await api(`/api/cvs/${first.id}`)).status, 404);
  assert.equal((await api(`/api/cvs/${second.id}`)).status, 200);
});

test('editing a CV keeps the original extracted text intact', async () => {
  const record = await uploadSampleCv();
  const edited = structuredClone(record.cv);
  edited.professionalSummary = 'Edited summary.';

  const response = await api(`/api/cvs/${record.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cv: edited }),
  });

  const body = await response.json();
  assert.equal(body.cv.cv.professionalSummary, 'Edited summary.');
  assert.equal(body.cv.rawText, record.rawText, 'the original text is never overwritten');
});

test('job analysis works from pasted text with no AI provider running', async () => {
  const response = await postJson('/api/job/analyse', {
    text: sampleJobText,
    meta: { jobTitle: 'Senior Backend Engineer', company: 'Example Company' },
  });

  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.analysis.jobTitle, 'Senior Backend Engineer');
  assert.ok(body.analysis.requiredTechnologies.includes('Node.js'));
  assert.doesNotMatch(body.cleanedText, /Accept cookies/);
});

test('job analysis refuses text that is too short to be a posting', async () => {
  const response = await postJson('/api/job/analyse', { text: 'Backend engineer wanted.' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /too short/);
});

test('tailoring refuses an unknown CV id', async () => {
  const response = await postJson('/api/tailor', {
    cvId: 'cv_does-not-exist',
    jobText: sampleJobText,
  });
  assert.equal(response.status, 404);
});

test('tailoring requires a CV to be chosen', async () => {
  const response = await postJson('/api/tailor', { jobText: sampleJobText });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /Choose which CV/);
});

test('templates are advertised with their customisation options', async () => {
  const body = await (await api('/api/documents/templates')).json();
  const ids = body.templates.map((template) => template.id);

  assert.deepEqual(ids.sort(), ['minimal-ats', 'modern-professional', 'technical']);
  assert.ok(body.fonts.includes('Helvetica'));
  assert.ok(body.customisable.includes('margins'));
});

test('a stored CV can be previewed as HTML', async () => {
  const record = await uploadSampleCv();
  const body = await (await postJson('/api/documents/preview', { cvId: record.id })).json();

  assert.match(body.html, /^<!doctype html>/i);
  assert.match(body.html, /Ada Lovelace/);
});

test('a stored CV downloads as a PDF and as a DOCX', async () => {
  const record = await uploadSampleCv();

  const pdf = await postJson('/api/documents/download', { cvId: record.id, format: 'pdf' });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename=".*\.pdf"/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  const docx = await postJson('/api/documents/download', { cvId: record.id, format: 'docx' });
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get('content-type'), /wordprocessingml/);
  assert.ok((await docx.arrayBuffer()).byteLength > 1000);
});

test('unsaved editor changes can be downloaded directly', async () => {
  const cv = sampleCv();
  cv.personalInformation.fullName = 'Unsaved Draft';

  const response = await postJson('/api/documents/download', { cv, format: 'pdf' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /Unsaved_Draft/);
});

test('an unknown download format is rejected', async () => {
  const record = await uploadSampleCv();
  const response = await postJson('/api/documents/download', { cvId: record.id, format: 'rtf' });
  assert.equal(response.status, 400);
});

test('rendering requires something to render', async () => {
  const response = await postJson('/api/documents/preview', {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /tailoredId, a cvId or an inline cv/);
});

test('AI settings round trip without exposing secrets', async () => {
  const saved = await (
    await api('/api/ai/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'ollama',
        ollama: { baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
        anthropic: { apiKey: 'sk-ant-secret', model: 'claude-sonnet-5-5' },
      }),
    })
  ).json();

  assert.equal(saved.ollama.model, 'qwen2.5:7b');
  assert.equal(saved.anthropic.hasApiKey, true);
  assert.equal(JSON.stringify(saved).includes('sk-ant-secret'), false);

  const fetched = await (await api('/api/ai/settings')).json();
  assert.equal(fetched.ollama.model, 'qwen2.5:7b');
  assert.equal(JSON.stringify(fetched).includes('sk-ant-secret'), false);
});

test('a connection test reports failure without throwing', async () => {
  const response = await postJson('/api/ai/test', {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:1',
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /Ollama/);
});

test('oversized JSON bodies are refused', async () => {
  const response = await postJson('/api/job/analyse', { text: 'x'.repeat(3 * 1024 * 1024) });
  assert.ok([400, 413].includes(response.status));
});

test('tailored CV history starts empty and rejects unknown ids', async () => {
  const list = await (await api('/api/tailored')).json();
  assert.ok(Array.isArray(list.items));
  assert.equal((await api('/api/tailored/tcv_missing')).status, 404);
  assert.equal((await api('/api/tailored/tcv_missing', { method: 'DELETE' })).status, 404);
});
