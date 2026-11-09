import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanJobText,
  splitJobSections,
  findTechnologies,
  findExperienceYears,
  findSeniority,
  findEmploymentType,
  heuristicJobAnalysis,
} from '../src/job/jobText.js';
import { sampleJobText } from './helpers.js';

test('cleanJobText removes cookie, navigation and footer noise', () => {
  const cleaned = cleanJobText(sampleJobText);
  assert.doesNotMatch(cleaned, /Accept cookies/);
  assert.doesNotMatch(cleaned, /Skip to main content/);
  assert.doesNotMatch(cleaned, /Privacy policy/);
  assert.doesNotMatch(cleaned, /People also viewed/);
  assert.match(cleaned, /Senior Backend Engineer/);
  assert.match(cleaned, /PostgreSQL/);
});

test('cleanJobText drops repeated short lines', () => {
  const noisy = 'Apply\nApply\nApply\nReal job content that should survive the cleaner.';
  const cleaned = cleanJobText(noisy);
  assert.equal(cleaned.split('\n').filter((line) => line === 'Apply').length, 1);
});

test('splitJobSections separates responsibilities from requirements', () => {
  const sections = splitJobSections(cleanJobText(sampleJobText));
  assert.ok(sections.responsibilities.join(' ').includes('REST APIs'));
  assert.ok(sections.qualifications.join(' ').includes('5+ years'));
  assert.ok(sections.preferred.join(' ').includes('Kubernetes'));
});

test('findTechnologies matches terms that end a sentence', () => {
  const found = findTechnologies('Understanding of message queues such as Kafka.');
  assert.deepEqual(found, ['Kafka']);
});

test('findTechnologies does not match a prefix of a longer token', () => {
  const found = findTechnologies('We use Node.js on the server.');
  assert.ok(found.includes('Node.js'));
  assert.ok(!found.includes('Go'));
});

test('findExperienceYears reads both common phrasings', () => {
  assert.equal(findExperienceYears('5+ years of professional backend development experience.'), 5);
  assert.equal(findExperienceYears('Experience of at least 3 years in a similar role'), 3);
  assert.equal(findExperienceYears('No stated requirement.'), null);
});

test('seniority comes from the job title, not stray body mentions', () => {
  assert.equal(findSeniority('You will mentor junior engineers.', 'Senior Backend Engineer'), 'Senior');
  assert.equal(findSeniority('Graduate scheme for new developers.'), 'Entry level');
});

test('findEmploymentType detects the posted contract type', () => {
  assert.equal(findEmploymentType('This is a Full-time position'), 'Full-time');
  assert.equal(findEmploymentType('6 month contract'), 'Contract');
});

test('heuristicJobAnalysis produces a usable structure without AI', () => {
  const analysis = heuristicJobAnalysis(sampleJobText, {
    jobTitle: 'Senior Backend Engineer',
    company: 'Example Company',
  });

  assert.equal(analysis.jobTitle, 'Senior Backend Engineer');
  assert.equal(analysis.company, 'Example Company');
  assert.equal(analysis.seniority, 'Senior');
  assert.equal(analysis.employmentType, 'Full-time');
  assert.equal(analysis.requiredExperienceYears, 5);

  for (const tech of ['JavaScript', 'TypeScript', 'Node.js', 'PostgreSQL', 'AWS', 'Docker', 'Kafka']) {
    assert.ok(analysis.requiredTechnologies.includes(tech), `missing ${tech}`);
  }
  assert.ok(analysis.preferredTechnologies.includes('Kubernetes'));
  assert.ok(analysis.preferredTechnologies.includes('Terraform'));

  // A preferred technology must not also be reported as required.
  for (const tech of analysis.preferredTechnologies) {
    assert.ok(!analysis.requiredTechnologies.includes(tech));
  }

  assert.ok(analysis.responsibilities.length >= 3);
  assert.ok(analysis.atsKeywords.length >= 8);
  assert.ok(analysis.softSkills.includes('communication'));
});

test('heuristicJobAnalysis survives a page with no recognisable structure', () => {
  const analysis = heuristicJobAnalysis('We want someone who can write software. Apply today.');
  assert.equal(analysis.requiredTechnologies.length, 0);
  assert.deepEqual(analysis.atsKeywords, []);
  assert.equal(typeof analysis.summary, 'string');
});
