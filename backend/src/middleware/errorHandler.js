import logger from '../utils/logger.js';

/** Wraps an async route handler so rejections reach the error middleware. */
export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
}

/** Final error middleware: never leaks stack traces or secrets to the client. */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = error.status ?? error.statusCode ?? 500;
  // Messages we wrote are safe to show; anything else is summarised.
  const safeToShow = error.expose === true || status < 500;
  const message = safeToShow
    ? error.message || 'Request failed'
    : 'Something went wrong on the local backend. Check the backend terminal for details.';

  if (status >= 500) logger.error(req.method, req.path, '-', error.message, error.stack);
  else logger.warn(req.method, req.path, '-', error.message);

  res.status(status).json({
    error: {
      message,
      ...(error.details ? { details: error.details } : {}),
      ...(status >= 500 && process.env.DEBUG ? { debug: error.message } : {}),
    },
  });
}
