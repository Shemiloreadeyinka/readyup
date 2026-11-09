import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { scanJobPage } from '../src/scanner/pageScanner.js';
import fixtures from './fixtures.js';

/**
 * Runs the scanner against a fixture in a DOM, the same way
 * chrome.scripting.executeScript runs it in the page.
 */
function scan(fixture) {
  const dom = new JSDOM(fixture.html, { url: fixture.url, pretendToBeVisual: true });
  const previous = { window: global.window, document: global.document, Node: global.Node };

  global.window = dom.window;
  global.document = dom.window.document;
  global.Node = dom.window.Node;

  try {
    return scanJobPage();
  } finally {
    Object.assign(global, previous);
    dom.window.close();
  }
}

const EXPECTED_PHRASES = [
  'Design, build and maintain REST APIs using Node.js and Express',
  '5+ years of professional backend development experience',
  'message queues such as Kafka',
];

const FORBIDDEN_PHRASES = [
  'Skip to main content',
  'We use cookies',
  'People also viewed',
  'Privacy policy',
  'All rights reserved',
  'Software Engineer at Another Co',
];

const PLATFORM_CASES = [
  ['structured data', 'structuredData', 'structured-data'],
  ['LinkedIn', 'linkedin', 'platform:linkedin'],
  ['Indeed', 'indeed', 'platform:indeed'],
  ['Greenhouse', 'greenhouse', 'platform:greenhouse'],
  ['Lever', 'lever', 'platform:lever'],
  ['Jobberman', 'jobberman', null],
  ['a generic career page', 'genericCareerPage', null],
];

for (const [label, key, expectedMethod] of PLATFORM_CASES) {
  test(`extracts the job description from ${label}`, () => {
    const result = scan(fixtures[key]);

    assert.equal(result.ok, true, `extraction failed: ${result.method}`);
    if (expectedMethod) assert.equal(result.method, expectedMethod);

    for (const phrase of EXPECTED_PHRASES) {
      assert.ok(result.description.includes(phrase), `missing "${phrase}" (${result.method})`);
    }
  });

  test(`strips navigation, cookie and footer noise from ${label}`, () => {
    const result = scan(fixtures[key]);
    for (const phrase of FORBIDDEN_PHRASES) {
      assert.ok(!result.description.includes(phrase), `leaked "${phrase}" (${result.method})`);
    }
  });

  test(`identifies the role and company on ${label}`, () => {
    const result = scan(fixtures[key]);
    assert.match(result.jobTitle, /Senior Backend Engineer/);
    assert.match(result.company, /Example Company/);
  });

  test(`rates ${label} as a likely job listing`, () => {
    const result = scan(fixtures[key]);
    assert.ok(result.confidence >= 50, `confidence was ${result.confidence}`);
  });
}

test('structured data supplies location and employment type', () => {
  const result = scan(fixtures.structuredData);
  assert.equal(result.location, 'Lagos, Nigeria');
  assert.equal(result.employmentType, 'FULL_TIME');
  assert.equal(result.method, 'structured-data');
});

test('platform pages report which extractor was used', () => {
  assert.equal(scan(fixtures.linkedin).platform, 'linkedin');
  assert.equal(scan(fixtures.indeed).platform, 'indeed');
  assert.equal(scan(fixtures.genericCareerPage).platform, null);
});

test('list items keep their bullet structure', () => {
  const result = scan(fixtures.greenhouse);
  const bullets = result.description.split('\n').filter((line) => line.startsWith('- '));
  assert.ok(bullets.length >= 8, `expected bullets, got ${bullets.length}`);
});

test('section headings survive extraction', () => {
  const result = scan(fixtures.indeed);
  for (const heading of ['Responsibilities', 'Requirements', 'Nice to have']) {
    assert.ok(result.description.includes(heading), `missing heading ${heading}`);
  }
});

test('hidden elements are not extracted', () => {
  const result = scan(fixtures.hiddenContent);
  assert.ok(!result.description.includes('SECRET TRACKING PIXEL'));
  assert.ok(!result.description.includes('Duplicate hidden navigation'));
  assert.ok(result.description.includes('Responsibilities'));
});

test('a blog post is not reported as a job listing', () => {
  const result = scan(fixtures.blogPost);
  assert.ok(result.confidence < 50, `confidence was ${result.confidence}`);
});

test('an unrendered page shell reports failure with reasons', () => {
  const result = scan(fixtures.emptyShell);
  assert.equal(result.ok, false);
  assert.ok(result.description.length < 200);
  assert.ok(result.reasons.some((reason) => /little description/i.test(reason)));
});

test('the result carries everything the backend needs', () => {
  const result = scan(fixtures.linkedin);
  for (const key of [
    'ok', 'url', 'pageTitle', 'site', 'platform', 'jobTitle', 'company',
    'location', 'description', 'characterCount', 'method', 'confidence',
    'reasons', 'scannedAt',
  ]) {
    assert.ok(key in result, `missing ${key}`);
  }
  assert.equal(result.url, fixtures.linkedin.url);
  assert.equal(result.characterCount, result.description.length);
});

test('the scanner is self-contained and therefore injectable', () => {
  const source = scanJobPage.toString();
  // chrome.scripting.executeScript serialises the function, so a reference to
  // anything in module scope would throw once injected.
  assert.ok(!/\bimport\b/.test(source));
  assert.ok(source.startsWith('function'));
  assert.ok(source.includes('JobPosting'));
});
