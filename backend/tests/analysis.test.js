import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRequirementsAgainstCv, deterministicComparison, computeMatchScore } from '../src/pipeline/matchScore.js';
import { factCheckTailoredCv } from '../src/cv/factCheck.js';
import { normaliseComparison, normaliseJobAnalysis, normaliseTailoring } from '../src/pipeline/normalise.js';
import { heuristicJobAnalysis } from '../src/job/jobText.js';
import { sampleCv, sampleJobText } from './helpers.js';

test('requirement matching cites evidence from the CV', () => {
  const matches = matchRequirementsAgainstCv(['Node.js', 'PostgreSQL', 'Kubernetes'], sampleCv());
  const byName = Object.fromEntries(matches.map((match) => [match.requirement, match]));

  assert.equal(byName['Node.js'].status, 'strong');
  assert.match(byName['Node.js'].evidence, /Node\.js/);
  assert.match(byName['Node.js'].evidenceSource, /Analytical Ltd/);

  assert.equal(byName.PostgreSQL.status, 'strong');

  assert.equal(byName.Kubernetes.status, 'missing');
  assert.equal(byName.Kubernetes.evidence, null);
});

test('a skill listed but never used is a partial match', () => {
  const cv = sampleCv();
  const [match] = matchRequirementsAgainstCv(['Python'], cv);
  assert.equal(match.status, 'partial');
  assert.equal(match.evidenceSource, 'Skills section');
});

test('the deterministic comparison covers required and preferred technologies', () => {
  const job = heuristicJobAnalysis(sampleJobText, { jobTitle: 'Senior Backend Engineer' });
  const comparison = deterministicComparison(job, sampleCv());
  const covered = comparison.skillMatches.map((match) => match.requirement);

  for (const tech of job.requiredTechnologies) assert.ok(covered.includes(tech));
  assert.ok(comparison.missingRequirements.includes('Kubernetes'));
});

test('the match score is reproducible and explainable', () => {
  const job = heuristicJobAnalysis(sampleJobText, { jobTitle: 'Senior Backend Engineer' });
  const comparison = deterministicComparison(job, sampleCv());

  const first = computeMatchScore(comparison, job);
  const second = computeMatchScore(comparison, job);

  assert.equal(first.overallAlignment, second.overallAlignment);
  assert.ok(first.overallAlignment > 0 && first.overallAlignment < 100);
  assert.equal(
    first.breakdown.strong + first.breakdown.partial + first.breakdown.missing,
    comparison.skillMatches.length + comparison.experienceMatches.length,
  );
  assert.match(first.explanation, /not your chance of being hired/);
});

test('a CV matching nothing scores zero, a CV matching everything scores 100', () => {
  const job = { requiredTechnologies: ['Rust', 'Elixir'], requiredExperience: [], responsibilities: [] };
  const empty = computeMatchScore(deterministicComparison(job, sampleCv()), job);
  assert.equal(empty.overallAlignment, 0);

  const matchingJob = {
    requiredTechnologies: ['Node.js', 'PostgreSQL'],
    requiredExperience: [],
    responsibilities: [],
  };
  const full = computeMatchScore(deterministicComparison(matchingJob, sampleCv()), matchingJob);
  assert.equal(full.overallAlignment, 100);
});

test('the score reports nothing when the posting lists no requirements', () => {
  const job = { requiredTechnologies: [], requiredExperience: [], responsibilities: [] };
  const result = computeMatchScore(deterministicComparison(job, sampleCv()), job);
  assert.equal(result.overallAlignment, null);
});

/* ------------------------- truthfulness guard --------------------------- */

test('fact check restores employment facts the model altered', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.workExperience[0].company = 'Analytical Limited International';
  tailored.workExperience[0].startDate = 'Jan 2019';

  const { cv, corrections } = factCheckTailoredCv(source, tailored);

  assert.equal(cv.workExperience[0].company, 'Analytical Ltd');
  assert.equal(cv.workExperience[0].startDate, 'Jan 2021');
  assert.equal(corrections.length, 2);
});

test('fact check restores contact details', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.personalInformation.email = 'ada.lovelace.pro@example.com';

  const { cv, corrections } = factCheckTailoredCv(source, tailored);
  assert.equal(cv.personalInformation.email, 'ada@example.com');
  assert.ok(corrections.some((entry) => entry.field === 'personalInformation.email'));
});

test('fact check flags invented metrics', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.workExperience[0].responsibilities[0] =
    'Built REST APIs with Node.js and Express, improving throughput by 40%.';

  const { warnings } = factCheckTailoredCv(source, tailored);
  const metric = warnings.find((warning) => warning.type === 'unverified-metric');

  assert.ok(metric, 'expected the invented metric to be flagged');
  assert.match(metric.concern, /40%/);
});

test('fact check accepts metrics that are already in the source CV', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.workExperience[0].achievements[0] = 'Cut p95 latency from 800ms to 210ms.';

  const { warnings } = factCheckTailoredCv(source, tailored);
  assert.equal(warnings.filter((warning) => warning.type === 'unverified-metric').length, 0);
});

test('fact check removes skills the source CV never mentions', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.technicalSkills.push({ category: 'Containers', skills: ['Kubernetes', 'Docker'] });

  const { cv, corrections } = factCheckTailoredCv(source, tailored);
  const allSkills = cv.technicalSkills.flatMap((group) => group.skills);

  assert.ok(!allSkills.includes('Kubernetes'));
  assert.ok(!allSkills.includes('Docker'));
  assert.ok(corrections.some((entry) => entry.from === 'Kubernetes'));
  assert.ok(allSkills.includes('Node.js'), 'genuine skills must survive');
});

test('fact check flags a role that is not in the source CV', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.workExperience.push({
    jobTitle: 'CTO',
    company: 'Imaginary Corp',
    location: null,
    startDate: '2015',
    endDate: '2017',
    current: false,
    responsibilities: ['Led engineering.'],
    achievements: [],
    technologies: [],
  });

  const { warnings } = factCheckTailoredCv(source, tailored);
  assert.ok(warnings.some((warning) => warning.type === 'unverified-role'));
});

test('fact check copies education straight from the source', () => {
  const source = sampleCv();
  const tailored = structuredClone(source);
  tailored.education[0].degree = 'MSc Computer Science';

  const { cv } = factCheckTailoredCv(source, tailored);
  assert.equal(cv.education[0].degree, 'BSc Computer Science');
});

/* ------------------------ model output handling ------------------------- */

test('normalisers coerce loose model output into the expected shape', () => {
  const comparison = normaliseComparison({
    overallAlignment: '87.6',
    skillMatches: [
      { skill: 'Node.js', match: 'Strong match', quote: 'Built REST APIs' },
      'TypeScript',
      { requirement: 'Kubernetes', status: 'none', evidence: 'should be dropped' },
    ],
  });

  assert.equal(comparison.overallAlignment, 88);
  assert.equal(comparison.skillMatches[0].status, 'strong');
  assert.equal(comparison.skillMatches[1].requirement, 'TypeScript');
  assert.equal(comparison.skillMatches[2].status, 'missing');
  assert.equal(comparison.skillMatches[2].evidence, null, 'missing matches cannot carry evidence');
});

test('normalisers clamp out-of-range scores and tolerate junk', () => {
  assert.equal(normaliseComparison({ overallAlignment: 400 }).overallAlignment, 100);
  assert.equal(normaliseComparison({ overallAlignment: -5 }).overallAlignment, 0);
  assert.equal(normaliseComparison({}).overallAlignment, null);
  assert.deepEqual(normaliseComparison({ skillMatches: 'nonsense' }).skillMatches, []);
});

test('job analysis normaliser keeps only usable values', () => {
  const analysis = normaliseJobAnalysis({
    title: 'Backend Engineer',
    requiredSkills: ['Node.js', '', null, { name: 'PostgreSQL' }],
    requiredExperienceYears: '5',
  });

  assert.equal(analysis.jobTitle, 'Backend Engineer');
  assert.deepEqual(analysis.requiredTechnologies, ['Node.js', 'PostgreSQL']);
  assert.equal(analysis.requiredExperienceYears, 5);
});

test('tailoring normaliser accepts a bare CV object', () => {
  const result = normaliseTailoring({ personalInformation: { fullName: 'Ada' } });
  assert.equal(result.tailoredCv.personalInformation.fullName, 'Ada');
  assert.deepEqual(result.changeLog, []);
});
