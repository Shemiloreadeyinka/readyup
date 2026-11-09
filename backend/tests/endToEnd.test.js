import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Full-stack test: upload a CV, scan-equivalent job text, tailor, edit,
 * download, and read back the history.
 *
 * The AI is a stub HTTP server that speaks the Ollama wire protocol, so the
 * real provider transport, JSON parsing, normalisation and truthfulness guard
 * all run exactly as they do against a real model.
 */

const dataDir = path.join(os.tmpdir(), `cv-tailor-e2e-${process.pid}`);
process.env.DATA_DIR = dataDir;

let modelServer;
let modelPort;
const modelCalls = [];

/** Canned responses keyed by which pipeline stage the prompt belongs to. */
const stageFor = (prompt) => {
  if (prompt.includes('Analyse the job posting')) return 'job';
  if (prompt.includes('Parse the CV below')) return 'cv';
  if (prompt.includes('Compare the candidate CV')) return 'comparison';
  if (prompt.includes('Produce a tailored version')) return 'tailoring';
  return 'suggestions';
};

const RESPONSES = {
  job: {
    jobTitle: 'Senior Backend Engineer',
    company: 'Example Company',
    location: 'Lagos, Nigeria',
    employmentType: 'Full-time',
    seniority: 'Senior',
    requiredExperienceYears: 5,
    requiredExperience: ['5+ years of backend development'],
    requiredTechnologies: ['Node.js', 'Express', 'PostgreSQL', 'AWS', 'Docker', 'Kubernetes'],
    preferredTechnologies: ['Terraform'],
    responsibilities: ['Design and maintain REST APIs', 'Model data in PostgreSQL'],
    qualifications: ['Strong JavaScript skills'],
    technicalRequirements: ['REST API design'],
    softSkills: ['communication'],
    atsKeywords: ['Node.js', 'PostgreSQL', 'REST', 'AWS'],
    summary: 'Backend role building Node.js services.',
  },

  cv: { personalInformation: { fullName: 'Ada Lovelace' } },

  comparison: {
    overallAlignment: 95,
    scoreRationale: 'Model opinion that the backend recomputes.',
    skillMatches: [
      {
        requirement: 'Node.js',
        status: 'strong',
        evidence: 'Built REST APIs with Node.js and Express.',
        evidenceSource: 'Senior Backend Engineer at Analytical Ltd',
      },
      { requirement: 'Kubernetes', status: 'missing', evidence: null, evidenceSource: null },
    ],
    experienceMatches: [
      {
        requirement: 'Backend development',
        status: 'strong',
        evidence: 'Built REST APIs with Node.js and Express.',
        evidenceSource: 'Analytical Ltd',
      },
    ],
    missingRequirements: ['Kubernetes'],
    underrepresentedStrengths: [{ item: 'Query tuning', why: 'Only mentioned once.' }],
    emphasisSuggestions: ['Lead with API work'],
    recommendedImprovements: ['Move the API bullet to the top'],
  },

  suggestions: {
    skillsToHighlight: ['Node.js', 'PostgreSQL'],
    experienceToEmphasise: ['REST API design'],
    missingRequirements: [
      { requirement: 'Kubernetes', suggestion: 'Mention your Docker experience instead.' },
    ],
    interviewPreparationTopics: ['Database indexing'],
    applicationTips: ['Reference the platform team in your cover letter'],
  },
};

/** The tailored CV the stub returns, including deliberate violations. */
const tailoringResponse = () => ({
  tailoredCv: {
    personalInformation: {
      fullName: 'Ada Lovelace',
      title: 'Senior Backend Engineer',
      // Wrong on purpose: the guard must restore the real address.
      email: 'ada.pro@example.com',
      phone: '+44 20 7946 0000',
      location: 'London, UK',
    },
    professionalSummary:
      'Backend engineer with six years building Node.js and Express services on AWS.',
    technicalSkills: [
      { category: 'Backend', skills: ['Node.js', 'Express', 'PostgreSQL'] },
      // Invented on purpose: the guard must drop it.
      { category: 'Containers', skills: ['Kubernetes'] },
    ],
    workExperience: [
      {
        jobTitle: 'Senior Backend Engineer',
        // Wrong on purpose: the guard must restore the real employer.
        company: 'Analytical Limited',
        location: 'London',
        startDate: 'Jan 2021',
        endDate: 'Present',
        current: true,
        responsibilities: [
          'Designed and shipped REST APIs with Node.js and Express.',
          // Invented metric: must be flagged, not silently kept.
          'Improved throughput by 40% across the platform.',
        ],
        achievements: ['Reduced p95 latency from 800ms to 210ms.'],
        technologies: ['Node.js', 'Express', 'PostgreSQL', 'AWS'],
      },
    ],
    education: [
      { degree: 'BSc Computer Science', institution: 'University of London', endDate: '2016', details: [] },
    ],
    projects: [],
    certifications: [],
    achievements: [],
    languages: ['English', 'French'],
    additionalSections: [],
  },
  sectionOrder: ['professionalSummary', 'technicalSkills', 'workExperience', 'education'],
  changeLog: [{ section: 'professionalSummary', change: 'Rewritten', reason: 'Match the role' }],
  keywordsApplied: ['Node.js', 'PostgreSQL'],
  flaggedForReview: [],
  questionsForUser: ['Do you have a figure for the API throughput you improved?'],
});

const startModelServer = () =>
  new Promise((resolve) => {
    modelServer = http.createServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }));
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        const prompt = payload.messages.at(-1).content;
        const stage = stageFor(prompt);
        modelCalls.push({ stage, prompt, format: payload.format });

        const content =
          stage === 'tailoring' ? tailoringResponse() : (RESPONSES[stage] ?? {});

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { content: JSON.stringify(content) } }));
      });
    });

    modelServer.listen(0, '127.0.0.1', () => {
      modelPort = modelServer.address().port;
      resolve();
    });
  });

let app;
let server;
let baseUrl;

before(async () => {
  await fs.mkdir(dataDir, { recursive: true });
  await startModelServer();

  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${modelPort}`;

  const { createApp } = await import('../src/app.js');
  app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Point the saved settings at the stub.
  const { saveSettings } = await import('../src/ai/index.js');
  await saveSettings({
    provider: 'ollama',
    ollama: { baseUrl: `http://127.0.0.1:${modelPort}`, model: 'llama3.1:8b' },
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => modelServer.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

const postJson = (pathname, body) =>
  fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('the whole flow works end to end against a model', async (t) => {
  const { renderCvPdf } = await import('../src/documents/pdf.js');
  const { sampleCv, sampleJobText } = await import('./helpers.js');

  /* 1. Connection test reaches the model server. */
  const connection = await (await postJson('/api/ai/test', { provider: 'ollama' })).json();
  assert.equal(connection.ok, true, connection.message);

  /* 2. Upload a CV. */
  const pdf = await renderCvPdf(sampleCv(), { templateId: 'minimal-ats' });
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ada.pdf');

  const uploaded = await (await fetch(`${baseUrl}/api/cvs`, { method: 'POST', body: form })).json();
  assert.equal(uploaded.cv.cv.personalInformation.fullName, 'Ada Lovelace');

  /* 3. Analyse the job description. */
  const analysed = await (
    await postJson('/api/job/analyse', {
      text: sampleJobText,
      meta: { jobTitle: 'Senior Backend Engineer', company: 'Example Company' },
    })
  ).json();

  assert.equal(analysed.method, 'ai:ollama');
  assert.ok(analysed.analysis.requiredTechnologies.includes('Kubernetes'));

  /* 4. Tailor, reusing the analysis. */
  const response = await postJson('/api/tailor', {
    cvId: uploaded.cv.id,
    jobText: sampleJobText,
    jobMeta: { jobTitle: 'Senior Backend Engineer', company: 'Example Company', url: 'https://example.com/j/1' },
    jobAnalysis: analysed.analysis,
    templateId: 'technical',
  });

  assert.equal(response.status, 201);
  const { tailored } = await response.json();

  await t.test('the tailored CV is stored with its analysis', () => {
    assert.equal(tailored.jobTitle, 'Senior Backend Engineer');
    assert.equal(tailored.company, 'Example Company');
    assert.equal(tailored.templateId, 'technical');
    assert.equal(tailored.aiProvider.id, 'ollama');
    assert.equal(tailored.sourceCvId, uploaded.cv.id);
  });

  await t.test('the score is recomputed from evidence, not copied from the model', () => {
    assert.notEqual(tailored.comparison.overallAlignment, 95);
    assert.ok(typeof tailored.comparison.overallAlignment === 'number');
    assert.match(tailored.comparison.scoreExplanation, /not your chance of being hired/);
  });

  await t.test('fabricated facts are corrected or flagged', () => {
    assert.equal(tailored.cv.personalInformation.email, 'ada@example.com');
    assert.equal(tailored.cv.workExperience[0].company, 'Analytical Ltd');

    const skills = tailored.cv.technicalSkills.flatMap((group) => group.skills);
    assert.ok(!skills.includes('Kubernetes'));
    assert.ok(skills.includes('Node.js'));

    const flagged = JSON.stringify(tailored.flaggedForReview);
    assert.match(flagged, /40%/);
  });

  await t.test('questions are asked instead of metrics being invented', () => {
    assert.ok(tailored.questionsForUser.some((question) => /throughput/i.test(question)));
  });

  await t.test('the stage 1 analysis was not repeated', () => {
    const jobCalls = modelCalls.filter((call) => call.stage === 'job');
    assert.equal(jobCalls.length, 1, 'job analysis should run once, not once per endpoint');
  });

  await t.test('every model call requested JSON output', () => {
    assert.ok(modelCalls.every((call) => call.format === 'json'));
  });

  /* 5. Edit the tailored CV. */
  const edited = structuredClone(tailored.cv);
  edited.professionalSummary = 'Edited by the user.';

  const updated = await (
    await fetch(`${baseUrl}/api/tailored/${tailored.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: edited, templateId: 'minimal-ats' }),
    })
  ).json();

  assert.equal(updated.tailored.cv.professionalSummary, 'Edited by the user.');
  assert.equal(updated.tailored.templateId, 'minimal-ats');

  /* 6. Download both formats. */
  for (const format of ['pdf', 'docx']) {
    const download = await postJson('/api/documents/download', {
      tailoredId: tailored.id,
      format,
    });
    assert.equal(download.status, 200, `${format} download failed`);
    const buffer = Buffer.from(await download.arrayBuffer());
    assert.ok(buffer.length > 1000);
    if (format === 'pdf') assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  }

  /* 7. The run appears in history, and the source CV is untouched. */
  const history = await (await fetch(`${baseUrl}/api/tailored`)).json();
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].id, tailored.id);

  const sourceCv = await (await fetch(`${baseUrl}/api/cvs/${uploaded.cv.id}`)).json();
  assert.equal(
    sourceCv.cv.cv.professionalSummary,
    uploaded.cv.cv.professionalSummary,
    'tailoring must never modify the original CV',
  );

  /* 8. A second run creates a new record rather than overwriting the first. */
  const second = await postJson('/api/tailor', {
    cvId: uploaded.cv.id,
    jobText: sampleJobText,
    jobMeta: { jobTitle: 'Backend Engineer II', company: 'Another Company' },
  });
  assert.equal(second.status, 201);

  const history2 = await (await fetch(`${baseUrl}/api/tailored`)).json();
  assert.equal(history2.items.length, 2);
  assert.ok(history2.items.some((item) => item.id === tailored.id));
});
