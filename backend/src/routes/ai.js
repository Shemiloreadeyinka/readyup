import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getPublicSettings, saveSettings, createProvider, PROVIDER_IDS } from '../ai/index.js';
import { badRequest } from '../utils/errors.js';

const router = Router();

/** Current AI settings. Secrets are never included in the response. */
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(await getPublicSettings());
  }),
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(await saveSettings(req.body ?? {}));
  }),
);

/** Connection test for any provider, optionally with values not yet saved. */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const { provider: providerId, apiKey, model, baseUrl } = req.body ?? {};
    if (providerId && !PROVIDER_IDS.includes(providerId)) {
      throw badRequest(`Unknown provider "${providerId}"`);
    }

    const overrides = {};
    if (apiKey) overrides.apiKey = apiKey;
    if (model) overrides.model = model;
    if (baseUrl) overrides.baseUrl = baseUrl;

    const provider = await createProvider(providerId, overrides);
    const result = await provider.testConnection();
    res.json({ provider: provider.id, model: provider.model, ...result });
  }),
);

/** Lists models the provider can actually serve (used for the Ollama picker). */
router.get(
  '/models',
  asyncHandler(async (req, res) => {
    const providerId = req.query.provider;
    if (providerId && !PROVIDER_IDS.includes(providerId)) {
      throw badRequest(`Unknown provider "${providerId}"`);
    }
    const provider = await createProvider(providerId, req.query.baseUrl ? { baseUrl: req.query.baseUrl } : {});
    res.json({ provider: provider.id, models: await provider.listModels() });
  }),
);

export default router;
