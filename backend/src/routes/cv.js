import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { handleUpload } from '../middleware/upload.js';
import { extractCvText } from '../cv/extractText.js';
import parseCv from '../cv/parseCv.js';
import { normaliseCv } from '../cv/schema.js';
import { resolveProviderForRequest } from '../ai/index.js';
import {
  COLLECTIONS,
  readCollection,
  findById,
  insert,
  updateById,
  removeById,
  mutateCollection,
} from '../store/jsonStore.js';
import { newId, nowIso } from '../utils/ids.js';
import { badRequest, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';

const router = Router();

/** Summary view: the full text and structure are only sent on request. */
const toSummary = (record) => ({
  id: record.id,
  name: record.name,
  fileName: record.fileName,
  fileType: record.fileType,
  isDefault: Boolean(record.isDefault),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  parseMethod: record.parseMethod,
  notes: record.notes ?? [],
  personalInformation: record.cv?.personalInformation ?? {},
  counts: {
    workExperience: record.cv?.workExperience?.length ?? 0,
    education: record.cv?.education?.length ?? 0,
    projects: record.cv?.projects?.length ?? 0,
    skills: (record.cv?.technicalSkills ?? []).reduce(
      (total, group) => total + group.skills.length,
      0,
    ),
  },
});

/** Upload and parse a CV. The uploaded bytes are never persisted. */
router.post(
  '/',
  handleUpload,
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No file was uploaded. Use the "file" form field.');

    const { text, fileType, pageCount, warnings } = await extractCvText(
      req.file.buffer,
      req.file.originalname,
    );

    // Parsing is best-effort: if no provider is reachable the heuristic parser
    // still produces a usable structure.
    let provider = null;
    try {
      provider = await resolveProviderForRequest({ provider: req.body?.provider });
    } catch (error) {
      logger.warn('CV upload is proceeding without AI:', error.message);
    }

    const { cv, method, notes } = await parseCv(text, provider);
    const existing = await readCollection(COLLECTIONS.cvs);

    const record = {
      id: newId('cv'),
      name: (req.body?.name || req.file.originalname.replace(/\.[^.]+$/, '')).slice(0, 120),
      fileName: req.file.originalname,
      fileType,
      pageCount: pageCount ?? null,
      rawText: text,
      cv,
      parseMethod: method,
      notes: [...(notes ?? []), ...(warnings ?? [])],
      isDefault: existing.length === 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await insert(COLLECTIONS.cvs, record);
    res.status(201).json({ cv: record, summary: toSummary(record) });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await readCollection(COLLECTIONS.cvs);
    res.json({
      items: items.map(toSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await findById(COLLECTIONS.cvs, req.params.id);
    if (!record) throw notFound('That CV no longer exists.');
    res.json({ cv: record });
  }),
);

/**
 * Rename, set as default, or correct the parsed structure.
 * The original extracted text is preserved so re-parsing is always possible.
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await findById(COLLECTIONS.cvs, req.params.id);
    if (!record) throw notFound('That CV no longer exists.');

    const patch = {};
    if (req.body?.name) patch.name = String(req.body.name).slice(0, 120);
    if (req.body?.cv) patch.cv = normaliseCv(req.body.cv);

    if (req.body?.isDefault === true) {
      await mutateCollection(COLLECTIONS.cvs, (items) =>
        items.map((item) => ({ ...item, isDefault: item.id === req.params.id })),
      );
      patch.isDefault = true;
    }

    const updated = await updateById(COLLECTIONS.cvs, req.params.id, patch);
    res.json({ cv: updated, summary: toSummary(updated) });
  }),
);

/** Re-runs parsing on the stored text, for example after switching provider. */
router.post(
  '/:id/reparse',
  asyncHandler(async (req, res) => {
    const record = await findById(COLLECTIONS.cvs, req.params.id);
    if (!record) throw notFound('That CV no longer exists.');

    const provider = await resolveProviderForRequest({ provider: req.body?.provider });
    const { cv, method, notes } = await parseCv(record.rawText, provider);
    const updated = await updateById(COLLECTIONS.cvs, req.params.id, {
      cv,
      parseMethod: method,
      notes,
    });
    res.json({ cv: updated, summary: toSummary(updated) });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const record = await findById(COLLECTIONS.cvs, req.params.id);
    if (!record) throw notFound('That CV no longer exists.');

    await removeById(COLLECTIONS.cvs, req.params.id);

    // Promote another CV so there is always a default while any CV exists.
    if (record.isDefault) {
      await mutateCollection(COLLECTIONS.cvs, (items) =>
        items.map((item, index) => ({ ...item, isDefault: index === 0 })),
      );
    }
    res.json({ deleted: true });
  }),
);

export default router;
