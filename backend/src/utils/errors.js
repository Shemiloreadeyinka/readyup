/**
 * Error carrying an HTTP status so the error middleware can answer safely.
 *
 * `expose` marks the message as written for the user. Unexpected errors are
 * never exposed, so internals and secrets cannot leak through a 500.
 */
export class AppError extends Error {
  constructor(message, status = 500, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (message, details) => new AppError(message, 400, details);
export const notFound = (message = 'Not found') => new AppError(message, 404);
export const upstreamError = (message, details) => new AppError(message, 502, details);

export default AppError;
