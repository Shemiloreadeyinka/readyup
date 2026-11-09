import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveProviderForRequest } from '../ai/index.js';
import { runTailoringPipeline } from '../pipeline/tailorPipeline.js';
import { normaliseCv } from '../cv/schema.js';
import { COLLECTIONS, findById, insert } from '../store/jsonStore.js';
import { DEFAULT_TEMPLATE_ID, TEMPLATES } from '../documents/templates.js';
import { newId, nowIso } from '../utils/ids.js';
import { badRequest, notFound } from '../utils/errors.js';
import { MAX_JOB_CHARS } from '../job/jobText.js';

const router = Router();

/**
 * Runs the full five-stage pipeline and stores the result in history.
 *
 * A new record is always created: previous tailored CVs are never overwritten.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      cvId,
      jobText,
      jobMeta = {},
      jobAnalysis,
      templateId,
      provider: providerId,
      model,
    } = req.body ?? {};

    if (!cvId) throw badRequest('Choose which CV to tailor.');
    const text = String(jobText ?? '');
    if (text.trim().length < 120) {
      throw badRequest('The job description is too short to tailor against.');
    }
    if (text.length > MAX_JOB_CHARS * 4) {
      throw badRequest('That job description is unusually large. Paste only the posting itself.');
    }

    const cvRecord = await findById(COLLECTIONS.cvs, cvId);
    if (!cvRecord) throw notFound('That CV no longer exists. Upload it again or pick another.');

    // Throws with CLOUD_CONSENT_REQUIRED if a cloud provider is selected
    // without the user having opted in.
    const provider = await resolveProviderForRequest({ provider: providerId, model });

    const result = await runTailoringPipeline({
      provider,
      jobText: text,
      jobMeta,
      jobAnalysis: jobAnalysis && typeof jobAnalysis === 'object' ? jobAnalysis : undefined,
      cv: normaliseCv(cvRecord.cv),
    });

    const template = TEMPLATES[templateId] ? templateId : DEFAULT_TEMPLATE_ID;

    const record = {
      id: newId('tcv'),
      sourceCvId: cvRecord.id,
      sourceCvName: cvRecord.name,
      jobTitle: result.jobAnalysis.jobTitle ?? jobMeta.jobTitle ?? 'Untitled role',
      company: result.jobAnalysis.company ?? jobMeta.company ?? null,
      jobUrl: jobMeta.url ?? null,
      jobText: text,
      jobAnalysis: result.jobAnalysis,
      comparison: result.comparison,
      cv: result.tailored.cv,
      sectionOrder: result.tailored.sectionOrder,
      changeLog: result.tailored.changeLog,
      keywordsApplied: result.tailored.keywordsApplied,
      flaggedForReview: result.tailored.flaggedForReview,
      questionsForUser: result.tailored.questionsForUser,
      factCheck: result.tailored.factCheck,
      suggestions: result.suggestions,
      templateId: template,
      customisation: {},
      aiProvider: provider.describe(),
      warnings: result.meta.warnings,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await insert(COLLECTIONS.tailored, record);
    res.status(201).json({ tailored: record });
  }),
);

export default router;
