import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { normaliseCv } from '../cv/schema.js';
import { renderCvHtml } from '../documents/html.js';
import { renderCvPdf, AVAILABLE_FONTS } from '../documents/pdf.js';
import { renderCvDocx } from '../documents/docx.js';
import { listTemplates, TEMPLATES, DEFAULT_TEMPLATE_ID } from '../documents/templates.js';
import { COLLECTIONS, findById } from '../store/jsonStore.js';
import { badRequest, notFound } from '../utils/errors.js';

const router = Router();

/** Available templates and the customisation options they accept. */
router.get('/templates', (req, res) => {
  res.json({
    templates: listTemplates(),
    defaultTemplateId: DEFAULT_TEMPLATE_ID,
    fonts: AVAILABLE_FONTS,
    customisable: ['font', 'fontSize', 'lineHeight', 'sectionSpacing', 'margins'],
  });
});

/**
 * Resolves the CV to render: either a stored tailored CV (by id) or a CV
 * supplied inline, so unsaved editor changes can be previewed and downloaded.
 */
async function resolveRenderTarget(body = {}) {
  if (body.tailoredId) {
    const record = await findById(COLLECTIONS.tailored, body.tailoredId);
    if (!record) throw notFound('That tailored CV no longer exists.');
    return {
      cv: normaliseCv(body.cv ?? record.cv),
      templateId: body.templateId ?? record.templateId,
      customisation: { ...record.customisation, ...(body.customisation ?? {}) },
      sectionOrder: body.sectionOrder ?? record.sectionOrder,
      name: record.cv?.personalInformation?.fullName ?? 'CV',
      jobTitle: record.jobTitle,
      company: record.company,
    };
  }

  if (body.cvId) {
    const record = await findById(COLLECTIONS.cvs, body.cvId);
    if (!record) throw notFound('That CV no longer exists.');
    return {
      cv: normaliseCv(body.cv ?? record.cv),
      templateId: body.templateId ?? DEFAULT_TEMPLATE_ID,
      customisation: body.customisation ?? {},
      sectionOrder: body.sectionOrder,
      name: record.cv?.personalInformation?.fullName ?? record.name,
      jobTitle: null,
      company: null,
    };
  }

  if (body.cv) {
    return {
      cv: normaliseCv(body.cv),
      templateId: body.templateId ?? DEFAULT_TEMPLATE_ID,
      customisation: body.customisation ?? {},
      sectionOrder: body.sectionOrder,
      name: body.cv?.personalInformation?.fullName ?? 'CV',
      jobTitle: null,
      company: null,
    };
  }

  throw badRequest('Provide a tailoredId, a cvId or an inline cv to render.');
}

const safeFileName = (parts) =>
  parts
    .filter(Boolean)
    .join(' - ')
    .replace(/[^\w\-. ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'CV';

/** HTML preview. Also printable to PDF directly from the browser. */
router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const target = await resolveRenderTarget(req.body);
    const html = renderCvHtml(target.cv, {
      templateId: target.templateId,
      customisation: target.customisation,
      sectionOrder: target.sectionOrder,
    });
    res.json({ html, templateId: target.templateId ?? DEFAULT_TEMPLATE_ID });
  }),
);

/** Binary download as PDF or DOCX. */
router.post(
  '/download',
  asyncHandler(async (req, res) => {
    const format = String(req.body?.format ?? 'pdf').toLowerCase();
    if (!['pdf', 'docx'].includes(format)) {
      throw badRequest('Format must be "pdf" or "docx".');
    }

    const target = await resolveRenderTarget(req.body);
    if (target.templateId && !TEMPLATES[target.templateId]) {
      throw badRequest(`Unknown template "${target.templateId}".`);
    }

    const options = {
      templateId: target.templateId,
      customisation: target.customisation,
      sectionOrder: target.sectionOrder,
    };

    const buffer =
      format === 'pdf' ? await renderCvPdf(target.cv, options) : await renderCvDocx(target.cv, options);

    const fileName = `${safeFileName([target.name, target.jobTitle, target.company])}.${format}`;

    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }),
);

export default router;
