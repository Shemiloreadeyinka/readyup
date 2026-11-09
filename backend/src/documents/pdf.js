import PDFDocument from 'pdfkit';
import { buildDocumentBlocks, resolveTemplate } from './templates.js';

/**
 * PDF generation.
 *
 * Built with PDFKit rather than a headless browser: the text is real,
 * selectable, single-column text with no images or tables, which is what ATS
 * parsers need, and it keeps the project installable with a plain `npm
 * install` (no Chromium download). The HTML renderer remains available for
 * on-screen preview and for the browser's own "Save as PDF".
 */

const SAFE_FONTS = {
  Helvetica: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
  'Times-Roman': { regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic' },
  Courier: { regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique' },
};

export const AVAILABLE_FONTS = Object.keys(SAFE_FONTS);

const fontsFor = (template) => SAFE_FONTS[template.font] ?? SAFE_FONTS.Helvetica;

/** Starts a new page when the next block would not fit. */
const ensureRoom = (doc, template, needed) => {
  const bottom = doc.page.height - template.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
};

function drawBlock(doc, block, template, fonts) {
  const width = doc.page.width - template.margins.left - template.margins.right;
  const size = template.baseFontSize;
  const gap = size * (template.lineHeight - 1);

  switch (block.type) {
    case 'name':
      doc.font(fonts.bold).fontSize(template.nameFontSize).fillColor(template.accent);
      doc.text(block.text, { width });
      doc.fillColor('#000000');
      break;

    case 'subtitle':
      doc.font(fonts.regular).fontSize(size + 1).fillColor('#334155');
      doc.text(block.text, { width });
      doc.fillColor('#000000');
      break;

    case 'contact':
      doc.font(fonts.regular).fontSize(size - 0.5).fillColor('#334155');
      doc.text(block.items.join('  |  '), { width });
      doc.fillColor('#000000');
      doc.moveDown(0.3);
      break;

    case 'heading': {
      ensureRoom(doc, template, template.sectionSpacing + size * 3);
      doc.moveDown(template.sectionSpacing / size / 2);
      doc.font(fonts.bold).fontSize(template.headingFontSize).fillColor(template.accent);
      doc.text(block.text, { width, characterSpacing: template.headingCase === 'upper' ? 0.6 : 0 });
      if (template.headingStyle === 'rule') {
        const y = doc.y + 2;
        doc
          .moveTo(template.margins.left, y)
          .lineTo(doc.page.width - template.margins.right, y)
          .lineWidth(0.6)
          .strokeColor('#cbd5e1')
          .stroke();
        doc.y = y + 4;
      }
      doc.fillColor('#000000');
      break;
    }

    case 'paragraph':
      doc.font(fonts.regular).fontSize(size);
      doc.text(block.text, { width, align: 'left', lineGap: gap });
      break;

    case 'labelled': {
      doc.font(fonts.regular).fontSize(size);
      const labelWidth = doc.font(fonts.bold).widthOfString(`${block.label}: `);
      const startY = doc.y;
      doc.font(fonts.bold).text(`${block.label}: `, template.margins.left, startY, {
        continued: false,
        width: labelWidth,
      });
      doc.font(fonts.regular).text(block.value, template.margins.left + labelWidth, startY, {
        width: width - labelWidth,
        lineGap: gap,
      });
      doc.x = template.margins.left;
      break;
    }

    case 'bullets':
      doc.font(fonts.regular).fontSize(size);
      for (const item of block.items) {
        ensureRoom(doc, template, size * 2);
        doc.text(`• ${item}`, template.margins.left + 8, doc.y, {
          width: width - 8,
          lineGap: gap,
        });
      }
      doc.x = template.margins.left;
      break;

    case 'entry': {
      ensureRoom(doc, template, size * 4);
      const startY = doc.y;
      const dateWidth = block.right
        ? doc.font(fonts.regular).fontSize(size - 0.5).widthOfString(block.right) + 6
        : 0;

      doc.font(fonts.bold).fontSize(size);
      doc.text(block.title ?? '', template.margins.left, startY, { width: width - dateWidth });

      if (block.right) {
        doc.font(fonts.regular).fontSize(size - 0.5).fillColor('#475569');
        doc.text(block.right, doc.page.width - template.margins.right - dateWidth, startY, {
          width: dateWidth,
          align: 'right',
        });
        doc.fillColor('#000000');
        doc.y = Math.max(doc.y, startY + size * template.lineHeight);
      }

      doc.x = template.margins.left;
      if (block.subtitle) {
        doc.font(fonts.italic).fontSize(size).fillColor('#334155');
        doc.text(block.subtitle, template.margins.left, doc.y, { width });
        doc.fillColor('#000000');
      }

      if (block.bullets?.length) {
        doc.font(fonts.regular).fontSize(size);
        for (const bullet of block.bullets) {
          ensureRoom(doc, template, size * 2);
          doc.text(`• ${bullet}`, template.margins.left + 8, doc.y, {
            width: width - 8,
            lineGap: gap,
          });
        }
      }

      for (const note of [block.footnote, block.link].filter(Boolean)) {
        doc.font(fonts.regular).fontSize(size - 0.5).fillColor('#475569');
        doc.text(note, template.margins.left, doc.y, { width });
        doc.fillColor('#000000');
      }

      doc.x = template.margins.left;
      doc.moveDown(0.4);
      break;
    }

    default:
      break;
  }
}

/**
 * Renders a structured CV to a PDF buffer.
 * @returns {Promise<Buffer>}
 */
export function renderCvPdf(cv, { templateId, customisation, sectionOrder } = {}) {
  const template = resolveTemplate(templateId, customisation);
  const fonts = fontsFor(template);
  const blocks = buildDocumentBlocks(cv, { sectionOrder, template });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: template.margins,
      info: {
        Title: `${cv.personalInformation?.fullName ?? 'CV'} - CV`,
        Author: cv.personalInformation?.fullName ?? '',
        Creator: 'CV Tailor',
      },
      autoFirstPage: true,
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      doc.x = template.margins.left;
      for (const block of blocks) drawBlock(doc, block, template, fonts);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export default renderCvPdf;
