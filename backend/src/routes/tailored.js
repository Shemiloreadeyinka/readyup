import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { normaliseCv, SECTION_KEYS } from '../cv/schema.js';
import { COLLECTIONS, readCollection, findById, updateById, removeById } from '../store/jsonStore.js';
import { TEMPLATES } from '../documents/templates.js';
import { notFound } from '../utils/errors.js';

const router = Router();

const toSummary = (record) => ({
  id: record.id,
  jobTitle: record.jobTitle,
  company: record.company,
  jobUrl: record.jobUrl,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  templateId: record.templateId,
  aiProvider: record.aiProvider,
  sourceCvName: record.sourceCvName,
  overallAlignment: record.comparison?.overallAlignment ?? null,
  flaggedCount: record.flaggedForReview?.length ?? 0,
});

/** History list, newest first. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await readCollection(COLLECTIONS.tailored);
    res.json({
      items: items.map(toSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await findById(COLLECTIONS.tailored, req.params.id);
    if (!record) throw notFound('That tailored CV no longer exists.');
    res.json({ tailored: record });
  }),
);

/** Saves user edits. Editing updates this version only; history is unaffected. */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await findById(COLLECTIONS.tailored, req.params.id);
    if (!record) throw notFound('That tailored CV no longer exists.');

    const patch = {};
    if (req.body?.cv) patch.cv = normaliseCv(req.body.cv);
    if (Array.isArray(req.body?.sectionOrder)) {
      patch.sectionOrder = req.body.sectionOrder.filter((key) => SECTION_KEYS.includes(key));
    }
    if (req.body?.templateId && TEMPLATES[req.body.templateId]) {
      patch.templateId = req.body.templateId;
    }
    if (req.body?.customisation && typeof req.body.customisation === 'object') {
      patch.customisation = { ...record.customisation, ...req.body.customisation };
    }
    if (req.body?.jobTitle) patch.jobTitle = String(req.body.jobTitle).slice(0, 200);
    if (req.body?.company !== undefined) {
      patch.company = req.body.company ? String(req.body.company).slice(0, 200) : null;
    }

    const updated = await updateById(COLLECTIONS.tailored, req.params.id, patch);
    res.json({ tailored: updated });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await removeById(COLLECTIONS.tailored, req.params.id);
    if (!deleted) throw notFound('That tailored CV no longer exists.');
    res.json({ deleted: true });
  }),
);

export default router;
