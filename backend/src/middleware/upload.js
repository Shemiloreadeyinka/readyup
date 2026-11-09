import multer from 'multer';
import config from '../config/index.js';

const ALLOWED_EXTENSIONS = /\.(pdf|docx|txt)$/i;

/**
 * In-memory upload handling: CV bytes are parsed and discarded immediately,
 * so nothing unencrypted is written to a temporary file.
 */
export const uploadCv = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.limits.maxUploadBytes,
    files: 1,
    fields: 10,
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_EXTENSIONS.test(file.originalname)) {
      callback(new Error('Only PDF, DOCX and TXT files are accepted.'));
      return;
    }
    callback(null, true);
  },
}).single('file');

/** Turns Multer failures into clean 400 responses. */
export const handleUpload = (req, res, next) => {
  uploadCv(req, res, (error) => {
    if (!error) return next();
    const megabytes = Math.round(config.limits.maxUploadBytes / 1024 / 1024);
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `That file is larger than the ${megabytes}MB limit.`
        : error.message || 'Upload failed.';
    return res.status(400).json({ error: { message } });
  });
};
