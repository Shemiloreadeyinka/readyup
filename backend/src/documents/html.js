import { buildDocumentBlocks, resolveTemplate } from './templates.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const linkify = (value) => {
  const text = escapeHtml(value);
  if (/^https?:\/\//i.test(value)) return `<a href="${text}">${text}</a>`;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(value)) return `<a href="mailto:${text}">${text}</a>`;
  return text;
};

const renderBlock = (block) => {
  switch (block.type) {
    case 'name':
      return `<h1 class="cv-name">${escapeHtml(block.text)}</h1>`;
    case 'subtitle':
      return `<p class="cv-subtitle">${escapeHtml(block.text)}</p>`;
    case 'contact':
      return `<p class="cv-contact">${block.items.map(linkify).join('<span class="sep"> | </span>')}</p>`;
    case 'heading':
      return `<h2 class="cv-heading">${escapeHtml(block.text)}</h2>`;
    case 'paragraph':
      return `<p class="cv-paragraph">${escapeHtml(block.text)}</p>`;
    case 'labelled':
      return `<p class="cv-labelled"><strong>${escapeHtml(block.label)}:</strong> ${escapeHtml(block.value)}</p>`;
    case 'bullets':
      return `<ul class="cv-list">${block.items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul>`;
    case 'entry': {
      const header = `<div class="cv-entry-head">
          <div>
            <span class="cv-entry-title">${escapeHtml(block.title)}</span>
            ${block.subtitle ? `<span class="cv-entry-subtitle">${escapeHtml(block.subtitle)}</span>` : ''}
          </div>
          ${block.right ? `<span class="cv-entry-dates">${escapeHtml(block.right)}</span>` : ''}
        </div>`;
      const bullets = block.bullets?.length
        ? `<ul class="cv-list">${block.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '';
      const link = block.link ? `<p class="cv-footnote">${linkify(block.link)}</p>` : '';
      const footnote = block.footnote
        ? `<p class="cv-footnote">${escapeHtml(block.footnote)}</p>`
        : '';
      return `<section class="cv-entry">${header}${bullets}${footnote}${link}</section>`;
    }
    default:
      return '';
  }
};

const styles = (template) => `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #f1f5f9;
    font-family: ${template.font === 'Times-Roman' ? "'Times New Roman', Times, serif" : "'Helvetica Neue', Helvetica, Arial, sans-serif"};
    color: #0f172a;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 16px auto;
    padding: ${template.margins.top}px ${template.margins.right}px ${template.margins.bottom}px ${template.margins.left}px;
    background: #ffffff;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    font-size: ${template.baseFontSize}pt;
    line-height: ${template.lineHeight};
  }
  .cv-name {
    margin: 0;
    font-size: ${template.nameFontSize}pt;
    letter-spacing: ${template.headingCase === 'upper' ? '0.04em' : '0'};
    color: ${template.accent};
  }
  .cv-subtitle { margin: 2px 0 0; font-size: ${template.baseFontSize + 1}pt; color: #334155; }
  .cv-contact { margin: 6px 0 0; font-size: ${template.baseFontSize - 0.5}pt; color: #334155; }
  .cv-contact a { color: inherit; text-decoration: none; }
  .cv-contact .sep { color: #94a3b8; }
  .cv-heading {
    margin: ${template.sectionSpacing}px 0 4px;
    font-size: ${template.headingFontSize}pt;
    letter-spacing: ${template.headingCase === 'upper' ? '0.08em' : '0.01em'};
    color: ${template.accent};
    ${template.headingStyle === 'rule' ? 'border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;' : ''}
  }
  .cv-paragraph, .cv-labelled { margin: 3px 0; }
  .cv-list { margin: 4px 0 0; padding-left: 18px; }
  .cv-list li { margin-bottom: 2px; }
  .cv-entry { margin-top: 8px; }
  .cv-entry-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .cv-entry-title { font-weight: 700; }
  .cv-entry-subtitle { display: block; color: #334155; }
  .cv-entry-dates { white-space: nowrap; color: #475569; font-size: ${template.baseFontSize - 0.5}pt; }
  .cv-footnote { margin: 3px 0 0; font-size: ${template.baseFontSize - 0.5}pt; color: #475569; }
  @media print {
    body { background: #ffffff; }
    .page { margin: 0; box-shadow: none; width: auto; min-height: 0; }
    .cv-entry { break-inside: avoid; }
  }
`;

/**
 * Renders a structured CV as a standalone HTML document.
 * Used for the in-extension preview and for browser "Save as PDF".
 */
export function renderCvHtml(cv, { templateId, customisation, sectionOrder } = {}) {
  const template = resolveTemplate(templateId, customisation);
  const blocks = buildDocumentBlocks(cv, { sectionOrder, template });
  const name = cv.personalInformation?.fullName || 'CV';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>${styles(template)}</style>
</head>
<body>
<main class="page">
${blocks.map(renderBlock).join('\n')}
</main>
</body>
</html>`;
}

export default renderCvHtml;
