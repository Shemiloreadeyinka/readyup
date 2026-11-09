import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveProviderForRequest } from '../ai/index.js';
import { analyseJobDescription } from '../pipeline/tailorPipeline.js';
import { cleanJobText, MAX_JOB_CHARS } from '../job/jobText.js';
import { badRequest } from '../utils/errors.js';
import logger from '../utils/logger.js';

const router = Router();

const MIN_JOB_CHARS = 120;

/**
 * Analyses a job description.
 * Accepts text scanned from a page or pasted manually; the pipeline does not
 * care which, so the manual fallback is a first-class path.
 */
router.post(
  '/analyse',
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text ?? '');
    if (text.trim().length < MIN_JOB_CHARS) {
      throw badRequest(
        `The job description is too short to analyse (${text.trim().length} characters). Scan the page again or paste the description manually.`,
      );
    }
    if (text.length > MAX_JOB_CHARS * 4) {
      throw badRequest('That job description is unusually large. Paste only the posting itself.');
    }

    let provider = null;
    try {
      provider = await resolveProviderForRequest({
        provider: req.body?.provider,
        model: req.body?.model,
      });
    } catch (error) {
      // Keyword analysis still works; report why AI was skipped.
      logger.warn('Job analysis without AI:', error.message);
    }

    const meta = {
      jobTitle: req.body?.meta?.jobTitle ?? null,
      company: req.body?.meta?.company ?? null,
      location: req.body?.meta?.location ?? null,
      employmentType: req.body?.meta?.employmentType ?? null,
      url: req.body?.meta?.url ?? null,
      pageTitle: req.body?.meta?.pageTitle ?? null,
    };

    const { analysis, method, warnings } = await analyseJobDescription(provider, text, meta);

    res.json({
      analysis,
      method,
      warnings,
      cleanedText: cleanJobText(text),
      source: meta,
    });
  }),
);

export default router;
