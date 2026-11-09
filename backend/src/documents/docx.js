import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,

  BorderStyle,
  TabStopType,
  convertInchesToTwip,
} from 'docx';
import { buildDocumentBlocks, resolveTemplate } from './templates.js';

/**
 * DOCX generation.
 *
 * Single column, built from real paragraph styles and list bullets. No text
 * boxes, no tables, no columns: those are exactly what ATS parsers mangle.
 */

const FONT_MAP = {
  Helvetica: 'Calibri',
  'Times-Roman': 'Times New Roman',
  Courier: 'Courier New',
};

const pt = (value) => Math.round(value * 2); // docx sizes are half-points
const pxToTwip = (px) => Math.round((px / 72) * 1440);

const paragraph = (runs, options = {}) => new Paragraph({ children: runs, ...options });

function blockToParagraphs(block, template, font) {
  const size = pt(template.baseFontSize);
  const accent = template.accent.replace('#', '');

  switch (block.type) {
    case 'name':
      return [
        paragraph([new TextRun({ text: block.text, bold: true, size: pt(template.nameFontSize), color: accent })], {
          spacing: { after: 40 },
        }),
      ];

    case 'subtitle':
      return [
        paragraph([new TextRun({ text: block.text, size: pt(template.baseFontSize + 1), color: '334155' })], {
          spacing: { after: 40 },
        }),
      ];

    case 'contact':
      return [
        paragraph([new TextRun({ text: block.items.join('  |  '), size: pt(template.baseFontSize - 0.5), color: '334155' })], {
          spacing: { after: 160 },
        }),
      ];

    case 'heading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: pxToTwip(template.sectionSpacing), after: 60 },
          border:
            template.headingStyle === 'rule'
              ? { bottom: { color: 'CBD5E1', style: BorderStyle.SINGLE, size: 6, space: 2 } }
              : undefined,
          children: [
            new TextRun({
              text: block.text,
              bold: true,
              size: pt(template.headingFontSize),
              color: accent,
            }),
          ],
        }),
      ];

    case 'paragraph':
      return [paragraph([new TextRun({ text: block.text, size })], { spacing: { after: 60 } })];

    case 'labelled':
      return [
        paragraph(
          [
            new TextRun({ text: `${block.label}: `, bold: true, size }),
            new TextRun({ text: block.value, size }),
          ],
          { spacing: { after: 40 } },
        ),
      ];

    case 'bullets':
      return block.items.map((item) =>
        paragraph([new TextRun({ text: item, size })], {
          bullet: { level: 0 },
          spacing: { after: 20 },
        }),
      );

    case 'entry': {
      const paragraphs = [];

      paragraphs.push(
        new Paragraph({
          spacing: { before: 120, after: 0 },
          tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(6.5) }],
          children: [
            new TextRun({ text: block.title ?? '', bold: true, size }),
            ...(block.right
              ? [
                  new TextRun({ text: '\t' }),
                  new TextRun({ text: block.right, size: pt(template.baseFontSize - 0.5), color: '475569' }),
                ]
              : []),
          ],
        }),
      );

      if (block.subtitle) {
        paragraphs.push(
          paragraph([new TextRun({ text: block.subtitle, italics: true, size, color: '334155' })], {
            spacing: { after: 40 },
          }),
        );
      }

      for (const bullet of block.bullets ?? []) {
        paragraphs.push(
          paragraph([new TextRun({ text: bullet, size })], {
            bullet: { level: 0 },
            spacing: { after: 20 },
          }),
        );
      }

      for (const note of [block.footnote, block.link].filter(Boolean)) {
        paragraphs.push(
          paragraph([new TextRun({ text: note, size: pt(template.baseFontSize - 0.5), color: '475569' })], {
            spacing: { after: 40 },
          }),
        );
      }

      return paragraphs;
    }

    default:
      return [];
  }
}

/**
 * Renders a structured CV to a DOCX buffer.
 * @returns {Promise<Buffer>}
 */
export async function renderCvDocx(cv, { templateId, customisation, sectionOrder } = {}) {
  const template = resolveTemplate(templateId, customisation);
  const font = FONT_MAP[template.font] ?? 'Calibri';
  const blocks = buildDocumentBlocks(cv, { sectionOrder, template });

  const children = blocks.flatMap((block) => blockToParagraphs(block, template, font));

  const document = new Document({
    creator: 'CV Tailor',
    title: `${cv.personalInformation?.fullName ?? 'CV'} - CV`,
    styles: {
      default: {
        document: {
          run: { font, size: pt(template.baseFontSize), color: '0F172A' },
          paragraph: { spacing: { line: Math.round(240 * template.lineHeight) } },
        },
        heading2: { run: { font }, paragraph: { spacing: { line: 240 } } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: pxToTwip(template.margins.top),
              right: pxToTwip(template.margins.right),
              bottom: pxToTwip(template.margins.bottom),
              left: pxToTwip(template.margins.left),
            },
          },
        },
        children: children.length ? children : [new Paragraph({ text: '' })],
      },
    ],
  });

  return Packer.toBuffer(document);
}

export default renderCvDocx;
