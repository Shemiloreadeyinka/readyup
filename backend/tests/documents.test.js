import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCvPdf } from '../src/documents/pdf.js';
import { renderCvDocx } from '../src/documents/docx.js';
import { renderCvHtml } from '../src/documents/html.js';
import { TEMPLATES, buildDocumentBlocks, resolveTemplate } from '../src/documents/templates.js';
import { extractCvText, detectFileType } from '../src/cv/extractText.js';
import { heuristicParseCv } from '../src/cv/heuristicParse.js';
import { sampleCv } from './helpers.js';

const TEMPLATE_IDS = Object.keys(TEMPLATES);

test('every template renders a valid PDF', async () => {
  for (const templateId of TEMPLATE_IDS) {
    const pdf = await renderCvPdf(sampleCv(), { templateId });
    assert.ok(pdf.length > 1000, `${templateId} produced a suspiciously small PDF`);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  }
});

test('every template renders a valid DOCX', async () => {
  for (const templateId of TEMPLATE_IDS) {
    const docx = await renderCvDocx(sampleCv(), { templateId });
    assert.ok(docx.length > 1000, `${templateId} produced a suspiciously small DOCX`);
    assert.equal(detectFileType(docx, 'cv.docx'), 'docx');
  }
});

test('every template renders standalone HTML', () => {
  for (const templateId of TEMPLATE_IDS) {
    const html = renderCvHtml(sampleCv(), { templateId });
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /Ada Lovelace/);
    assert.match(html, /<\/html>$/);
  }
});

test('generated HTML escapes user content', () => {
  const cv = sampleCv();
  cv.professionalSummary = 'Wrote <script>alert(1)</script> & shipped it';
  const html = renderCvHtml(cv, { templateId: 'minimal-ats' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; shipped/);
});

test('a generated PDF extracts back to readable text', async () => {
  const pdf = await renderCvPdf(sampleCv(), { templateId: 'minimal-ats' });
  const { text, fileType } = await extractCvText(pdf, 'cv.pdf');

  assert.equal(fileType, 'pdf');
  for (const expected of [
    'Ada Lovelace',
    'ada@example.com',
    'Senior Backend Engineer',
    'Analytical Ltd',
    'Jan 2021',
    'PostgreSQL',
    'University of London',
  ]) {
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('a generated DOCX extracts back to readable text', async () => {
  const docx = await renderCvDocx(sampleCv(), { templateId: 'modern-professional' });
  const { text, fileType } = await extractCvText(docx, 'cv.docx');

  assert.equal(fileType, 'docx');
  assert.match(text, /Ada Lovelace/);
  assert.match(text, /Analytical Ltd/);
  assert.match(text, /Built REST APIs/);
});

test('a generated PDF survives a full round trip through the parser', async () => {
  const pdf = await renderCvPdf(sampleCv(), { templateId: 'minimal-ats' });
  const { text } = await extractCvText(pdf, 'cv.pdf');
  const reparsed = heuristicParseCv(text);

  assert.equal(reparsed.personalInformation.fullName, 'Ada Lovelace');
  assert.equal(reparsed.personalInformation.email, 'ada@example.com');
  assert.equal(reparsed.workExperience.length, 1);
  assert.equal(reparsed.workExperience[0].jobTitle, 'Senior Backend Engineer');
  assert.equal(reparsed.workExperience[0].startDate, 'Jan 2021');
  assert.equal(reparsed.education[0].endDate, '2016');
});

test('extraction rejects files that contain no readable text', async () => {
  await assert.rejects(() => extractCvText(Buffer.from('not a document'), 'cv.pdf'), /Unsupported file type/);
  await assert.rejects(() => extractCvText(Buffer.alloc(0), 'cv.pdf'), /empty/);
});

test('plain text CVs are accepted', async () => {
  const content = Buffer.from('Ada Lovelace\nada@example.com\n'.padEnd(120, 'x'), 'utf8');
  const { fileType, text } = await extractCvText(content, 'cv.txt');
  assert.equal(fileType, 'txt');
  assert.match(text, /Ada Lovelace/);
});

test('document blocks respect a custom section order', () => {
  const template = resolveTemplate('minimal-ats');
  const blocks = buildDocumentBlocks(sampleCv(), {
    template,
    sectionOrder: ['education', 'professionalSummary', 'workExperience'],
  });
  const headings = blocks.filter((block) => block.type === 'heading').map((block) => block.key);
  assert.equal(headings[0], 'education');
  assert.equal(headings[1], 'professionalSummary');
  assert.equal(headings[2], 'workExperience');
});

test('customisation overrides template typography', () => {
  const template = resolveTemplate('minimal-ats', {
    fontSize: 13,
    sectionSpacing: 30,
    margins: { left: 20 },
  });
  assert.equal(template.baseFontSize, 13);
  assert.equal(template.sectionSpacing, 30);
  assert.equal(template.margins.left, 20);
  assert.equal(template.margins.top, TEMPLATES['minimal-ats'].margins.top);
});

test('empty sections are omitted rather than rendered blank', () => {
  const template = resolveTemplate('minimal-ats');
  const blocks = buildDocumentBlocks(
    { personalInformation: { fullName: 'Nobody' }, professionalSummary: '' },
    { template },
  );
  assert.equal(blocks.filter((block) => block.type === 'heading').length, 0);
});
