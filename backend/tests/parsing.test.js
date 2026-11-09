import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson } from '../src/utils/json.js';
import { mentions, collapseWhitespace } from '../src/utils/text.js';
import { heuristicParseCv } from '../src/cv/heuristicParse.js';
import { normaliseCv, cvToPlainText, isCvEmpty } from '../src/cv/schema.js';
import { sampleCvText } from './helpers.js';

test('parseModelJson reads plain JSON', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
});

test('parseModelJson strips markdown code fences', () => {
  assert.deepEqual(parseModelJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
});

test('parseModelJson finds JSON surrounded by prose', () => {
  const raw = 'Sure! Here is the result:\n{"jobTitle":"Engineer"}\nLet me know if that helps.';
  assert.deepEqual(parseModelJson(raw), { jobTitle: 'Engineer' });
});

test('parseModelJson repairs trailing commas', () => {
  assert.deepEqual(parseModelJson('{"a":1,"b":[2,3,],}'), { a: 1, b: [2, 3] });
});

test('parseModelJson handles braces inside strings', () => {
  const raw = 'text {"note":"a } brace and a \\" quote","ok":true} trailing';
  assert.deepEqual(parseModelJson(raw), { note: 'a } brace and a " quote', ok: true });
});

test('parseModelJson throws a useful error on unusable output', () => {
  assert.throws(() => parseModelJson('I cannot do that.'), /did not return valid JSON/);
});

test('mentions matches whole terms only', () => {
  assert.equal(mentions('Built services with Node.js and Express', 'Node.js'), true);
  assert.equal(mentions('Experience with Kafka.', 'Kafka'), true);
  assert.equal(mentions('I know Java', 'JavaScript'), false);
});

test('collapseWhitespace normalises line endings and blank runs', () => {
  assert.equal(collapseWhitespace('a\r\n\n\n\n  b  '), 'a\n\nb');
});

test('heuristic CV parser extracts contact details', () => {
  const cv = heuristicParseCv(sampleCvText);
  assert.equal(cv.personalInformation.fullName, 'Ada Lovelace');
  assert.equal(cv.personalInformation.email, 'ada@example.com');
  assert.equal(cv.personalInformation.phone, '+44 20 7946 0000');
  assert.match(cv.personalInformation.github, /github\.com\/ada/);
});

test('heuristic CV parser preserves roles, dates and employers', () => {
  const cv = heuristicParseCv(sampleCvText);
  assert.equal(cv.workExperience.length, 2);

  const [recent, previous] = cv.workExperience;
  assert.equal(recent.jobTitle, 'Senior Backend Engineer');
  assert.equal(recent.company, 'Analytical Ltd');
  assert.equal(recent.startDate, 'Jan 2021');
  assert.equal(recent.current, true);
  assert.deepEqual(recent.technologies, ['Node.js', 'PostgreSQL']);
  assert.equal(recent.responsibilities.length, 2);

  assert.equal(previous.jobTitle, 'Backend Developer');
  assert.equal(previous.endDate, 'Dec 2020');
  assert.equal(previous.current, false);
});

test('heuristic CV parser groups skills by category', () => {
  const cv = heuristicParseCv(sampleCvText);
  const categories = cv.technicalSkills.map((group) => group.category);
  assert.deepEqual(categories, ['Languages', 'Backend']);
  assert.ok(cv.technicalSkills[0].skills.includes('TypeScript'));
});

test('heuristic CV parser keeps education on one entry', () => {
  const cv = heuristicParseCv(sampleCvText);
  assert.equal(cv.education.length, 1);
  assert.equal(cv.education[0].degree, 'BSc Computer Science');
  assert.equal(cv.education[0].institution, 'University of London');
  assert.equal(cv.education[0].endDate, '2016');
});

test('a content line with a colon is not treated as a section heading', () => {
  const cv = heuristicParseCv(sampleCvText);
  assert.deepEqual(cv.languages, ['English', 'French']);
});

test('normaliseCv accepts flat skill lists and loose field names', () => {
  const cv = normaliseCv({
    personalInfo: { name: 'Grace Hopper', email: 'grace@example.com' },
    summary: 'Compiler pioneer.',
    skills: ['COBOL', 'FORTRAN'],
    experience: [{ title: 'Engineer', employer: 'Navy', bullets: ['Wrote compilers.'] }],
  });

  assert.equal(cv.personalInformation.fullName, 'Grace Hopper');
  assert.equal(cv.professionalSummary, 'Compiler pioneer.');
  assert.deepEqual(cv.technicalSkills, [{ category: 'Skills', skills: ['COBOL', 'FORTRAN'] }]);
  assert.equal(cv.workExperience[0].company, 'Navy');
  assert.deepEqual(cv.workExperience[0].responsibilities, ['Wrote compilers.']);
});

test('normaliseCv never produces empty skill groups', () => {
  assert.deepEqual(normaliseCv({ skills: [] }).technicalSkills, []);
  assert.deepEqual(normaliseCv({}).technicalSkills, []);
});

test('isCvEmpty detects an unusable parse', () => {
  assert.equal(isCvEmpty(normaliseCv({})), true);
  assert.equal(isCvEmpty(heuristicParseCv(sampleCvText)), false);
});

test('cvToPlainText includes every section', () => {
  const text = cvToPlainText(heuristicParseCv(sampleCvText));
  assert.match(text, /Analytical Ltd/);
  assert.match(text, /PostgreSQL/);
  assert.match(text, /University of London/);
});
