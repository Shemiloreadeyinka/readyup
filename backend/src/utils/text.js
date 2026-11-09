/** Shared text hygiene used by both the job and CV pipelines. */

export const collapseWhitespace = (text) =>
  String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

/** Truncates to a character budget on a sentence or line boundary when possible. */
export const truncate = (text, maxChars) => {
  const value = String(text ?? '');
  if (value.length <= maxChars) return value;
  const cut = value.slice(0, maxChars);
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return `${boundary > maxChars * 0.6 ? cut.slice(0, boundary) : cut}\n...[truncated]`;
};

export const normaliseForMatch = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Rough token count for context-budget checks.
 *
 * Deliberately a heuristic: loading a real tokeniser for every provider would
 * cost more than the estimate is worth. English prose and JSON both land near
 * 3.7 characters per token, and the callers only need the order of magnitude.
 */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 3.7);

/** Word-boundary aware containment check, safe for terms like "C++" or "Node.js". */
/** Drops sentence-ending dots so "Kafka." matches, while "Node.js" survives. */
const dropTrailingDots = (text) => text.replace(/\.(?=\s|$)/g, '');

export const mentions = (haystack, term) => {
  const needle = dropTrailingDots(normaliseForMatch(term));
  if (!needle) return false;
  const hay = dropTrailingDots(normaliseForMatch(haystack));
  if (!hay) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(hay) || hay.includes(` ${needle} `)
  );
};
