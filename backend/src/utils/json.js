/**
 * Helpers for coaxing valid JSON out of language-model output.
 * Local models in particular like to wrap JSON in prose or code fences.
 */

const stripCodeFences = (text) =>
  text
    .replace(/^\s*```(?:json|JSON)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

/** Returns the substring spanning the first balanced {...} or [...] block. */
const sliceBalanced = (text) => {
  const openers = { '{': '}', '[': ']' };
  let startIndex = -1;
  let opener = '';

  for (let i = 0; i < text.length; i += 1) {
    if (openers[text[i]]) {
      startIndex = i;
      opener = text[i];
      break;
    }
  }
  if (startIndex === -1) return null;

  const closer = openers[opener];
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
};

/** Removes trailing commas, which several models emit. */
const repairCommonMistakes = (text) => text.replace(/,\s*([}\]])/g, '$1');

/**
 * Parses JSON from arbitrary model output.
 * @returns {unknown} the parsed value
 * @throws {Error} when nothing parseable is present
 */
export function parseModelJson(raw) {
  if (raw == null) throw new Error('Model returned an empty response');
  if (typeof raw === 'object') return raw;

  const text = stripCodeFences(String(raw));
  const candidates = [text, sliceBalanced(text)].filter(Boolean);

  for (const candidate of candidates) {
    for (const attempt of [candidate, repairCommonMistakes(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* try the next shape */
      }
    }
  }

  const preview = text.slice(0, 300);
  throw new Error(`Model did not return valid JSON. Received: ${preview}`);
}

export default parseModelJson;
