import mammoth from 'mammoth';
import { collapseWhitespace } from '../utils/text.js';
import { badRequest } from '../utils/errors.js';

export const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
]);

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Sniffs the real file type rather than trusting the declared mime type. */
export function detectFileType(buffer, filename = '') {
  const lower = filename.toLowerCase();
  if (buffer.subarray(0, 5).equals(PDF_MAGIC)) return 'pdf';
  if (buffer.subarray(0, 4).equals(ZIP_MAGIC) && lower.endsWith('.docx')) return 'docx';
  if (buffer.subarray(0, 4).equals(ZIP_MAGIC)) return 'docx';
  if (lower.endsWith('.txt')) return 'txt';
  return null;
}

/**
 * Extracts text from a PDF using PDF.js, rebuilding line breaks from the
 * vertical position of each text item so section headings survive.
 */
export async function extractPdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();

      let lastY = null;
      let line = '';
      const lines = [];

      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        const isNewLine = lastY !== null && Math.abs(y - lastY) > 2;

        if (isNewLine) {
          lines.push(line.trim());
          line = '';
        }
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trim());
          line = '';
        }
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());

      pages.push(lines.filter(Boolean).join('\n'));
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  return { text: collapseWhitespace(pages.join('\n\n')), pageCount: pdf.numPages };
}

/** Extracts text from a DOCX using Mammoth, keeping list markers as bullets. */
export async function extractDocxText(buffer) {
  const { value, messages } = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: ['p[style-name=*] => p:fresh'],
    },
  );

  const text = value
    .replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

  return {
    text: collapseWhitespace(text),
    warnings: (messages ?? []).map((message) => message.message).slice(0, 10),
  };
}

/**
 * Extracts plain text from an uploaded CV.
 * @param {Buffer} buffer raw file bytes
 * @param {string} filename original name, used only as a type hint
 */
export async function extractCvText(buffer, filename = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest('The uploaded file is empty.');
  }

  const type = detectFileType(buffer, filename);

  if (type === 'pdf') {
    const { text, pageCount } = await extractPdfText(buffer);
    if (!text || text.length < 50) {
      throw badRequest(
        'No readable text was found in this PDF. It looks like a scanned image; export your CV as a text-based PDF or upload the DOCX version.',
      );
    }
    return { text, fileType: 'pdf', pageCount };
  }

  if (type === 'docx') {
    const { text, warnings } = await extractDocxText(buffer);
    if (!text || text.length < 50) {
      throw badRequest('No readable text was found in this DOCX file.');
    }
    return { text, fileType: 'docx', warnings };
  }

  if (type === 'txt') {
    const text = collapseWhitespace(buffer.toString('utf8'));
    if (!text) throw badRequest('The uploaded text file is empty.');
    return { text, fileType: 'txt' };
  }

  throw badRequest('Unsupported file type. Upload a PDF, DOCX or plain text CV.');
}

export default extractCvText;
