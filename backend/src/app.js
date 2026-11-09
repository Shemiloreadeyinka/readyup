import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import aiRoutes from './routes/ai.js';
import cvRoutes from './routes/cv.js';
import jobRoutes from './routes/job.js';
import tailorRoutes from './routes/tailor.js';
import tailoredRoutes from './routes/tailored.js';
import documentRoutes from './routes/documents.js';

/**
 * CORS policy.
 *
 * The backend binds to localhost only, and it accepts Chrome extension
 * origins plus any origin explicitly listed in ALLOWED_ORIGINS. Setting
 * ALLOWED_EXTENSION_IDS narrows extension access to specific ids.
 */
const allowedExtensionIds = String(process.env.ALLOWED_EXTENSION_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  // Same-origin requests and non-browser clients send no Origin header.
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;

  if (origin.startsWith('chrome-extension://')) {
    if (!allowedExtensionIds.length) return true;
    return allowedExtensionIds.includes(origin.replace('chrome-extension://', ''));
  }
  return false;
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(
    cors({
      origin: (origin, callback) =>
        isAllowedOrigin(origin)
          ? callback(null, true)
          : callback(new Error(`Origin ${origin} is not allowed`)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: config.limits.maxBodyBytes }));
  app.use(express.urlencoded({ extended: false, limit: config.limits.maxBodyBytes }));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'cv-tailor-backend',
      version: '1.0.0',
      defaultProvider: config.defaultProvider,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/ai', aiRoutes);
  app.use('/api/cvs', cvRoutes);
  app.use('/api/job', jobRoutes);
  app.use('/api/tailor', tailorRoutes);
  app.use('/api/tailored', tailoredRoutes);
  app.use('/api/documents', documentRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
