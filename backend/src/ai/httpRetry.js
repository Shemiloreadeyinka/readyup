import logger from '../utils/logger.js';

/**
 * Retrying fetch for AI providers.
 *
 * Free and low tier API plans meter tokens per minute, and this pipeline
 * sends four large requests back to back, so hitting a rate limit is normal
 * operation rather than an error. The provider waits for the window the
 * server names and tries again instead of failing the whole run.
 */

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_WAIT_MS = 75_000;

/** Parses "36.877s", "2m30s" or a plain seconds value into milliseconds. */
export function parseDuration(value) {
  if (!value) return null;
  const text = String(value).trim();

  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);

  const match = text.match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/i);
  if (!match || !match.slice(1).some(Boolean)) return null;

  const [, minutes, seconds, millis] = match;
  return Math.round(
    (Number(minutes ?? 0) * 60 + Number(seconds ?? 0)) * 1000 + Number(millis ?? 0),
  );
}

/** Works out how long to wait before the next attempt. */
export function retryDelayMs(response, attempt) {
  const header = (name) => response?.headers?.get?.(name);

  // Retry-After is seconds or an HTTP date.
  const retryAfter = header('retry-after');
  if (retryAfter) {
    const seconds = parseDuration(retryAfter);
    if (seconds !== null) return Math.min(seconds, MAX_WAIT_MS);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_WAIT_MS);
  }

  // Providers meter several dimensions at once and reset them on different
  // clocks. Wait for the one that is actually exhausted: a token budget that
  // refills in 40s should not be delayed by a daily request window.
  const count = (name) => {
    const raw = header(name);
    const value = raw === null ? null : Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const dimensions = [
    { reset: parseDuration(header('x-ratelimit-reset-tokens')), remaining: count('x-ratelimit-remaining-tokens') },
    { reset: parseDuration(header('x-ratelimit-reset-requests')), remaining: count('x-ratelimit-remaining-requests') },
  ].filter((dimension) => dimension.reset !== null);

  const exhausted = dimensions.filter(
    (dimension) => dimension.remaining === null || dimension.remaining <= 0,
  );

  // Prefer the exhausted dimensions; otherwise the soonest window. Waiting
  // too little is self-correcting because the next attempt retries again.
  const candidates = (exhausted.length ? exhausted : dimensions).map((d) => d.reset);
  if (candidates.length) return Math.min(Math.min(...candidates) + 500, MAX_WAIT_MS);

  // Nothing to go on: exponential backoff with a little jitter.
  return Math.min(1000 * 2 ** attempt + Math.random() * 500, MAX_WAIT_MS);
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });

/**
 * fetch that retries rate limits and transient server errors.
 *
 * @param {string} url
 * @param {RequestInit} options
 * @param {object} config
 * @param {number} [config.retries]     attempts after the first (default 3)
 * @param {AbortSignal} [config.signal] cancels waiting as well as requests
 * @param {(info: {attempt: number, waitMs: number, status: number}) => void} [config.onRetry]
 * @param {string} [config.label]       provider name, for log messages
 */
export async function fetchWithRetry(url, options = {}, config = {}) {
  const { retries = 3, signal, onRetry, label = 'provider' } = config;

  let lastResponse = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, { ...options, signal });

    if (response.ok || !RETRYABLE_STATUSES.has(response.status)) return response;

    lastResponse = response;

    if (attempt === retries) break;

    const waitMs = retryDelayMs(response, attempt);
    logger.warn(
      `${label} returned ${response.status}; waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${retries}`,
    );
    onRetry?.({ attempt: attempt + 1, waitMs, status: response.status });

    // Drain the body so the connection can be reused.
    await response.text().catch(() => '');
    await sleep(waitMs, signal);
  }

  return lastResponse;
}

export default fetchWithRetry;
