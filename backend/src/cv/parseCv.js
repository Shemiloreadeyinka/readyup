import { normaliseCv, isCvEmpty } from './schema.js';
import heuristicParseCv from './heuristicParse.js';
import { truncate } from '../utils/text.js';
import logger from '../utils/logger.js';

const MAX_CV_CHARS = 22000;

/** Fills gaps in the primary parse with values from the fallback parse. */
function mergeCvs(primary, fallback) {
  const merged = structuredClone(primary);

  merged.personalInformation = { ...fallback.personalInformation };
  for (const [field, value] of Object.entries(primary.personalInformation ?? {})) {
    if (value) merged.personalInformation[field] = value;
  }

  for (const key of [
    'technicalSkills',
    'workExperience',
    'education',
    'projects',
    'certifications',
    'achievements',
    'languages',
    'additionalSections',
  ]) {
    if (!merged[key]?.length && fallback[key]?.length) merged[key] = fallback[key];
  }

  if (!merged.professionalSummary && fallback.professionalSummary) {
    merged.professionalSummary = fallback.professionalSummary;
  }

  return merged;
}

/**
 * Turns CV text into the canonical structure.
 *
 * The heuristic parser always runs: it costs nothing and it backstops the
 * model for contact details, which matter most and which models drop often.
 *
 * @param {string} text raw CV text
 * @param {import('../ai/AiProvider.js').AiProvider|null} provider
 */
export async function parseCv(text, provider = null) {
  const trimmed = truncate(text, MAX_CV_CHARS);
  const heuristic = heuristicParseCv(trimmed);

  if (!provider) {
    return {
      cv: heuristic,
      method: 'heuristic',
      notes: [
        'Parsed without AI. Section detection is approximate; review the structured CV before tailoring.',
      ],
    };
  }

  try {
    const raw = await provider.analyseCV(trimmed);
    const structured = normaliseCv(raw);

    if (isCvEmpty(structured)) {
      return {
        cv: heuristic,
        method: 'heuristic',
        notes: ['The AI parse came back empty, so the built-in parser was used instead.'],
      };
    }

    return {
      cv: mergeCvs(structured, heuristic),
      method: `ai:${provider.id}`,
      notes: provider.drainWarnings?.() ?? [],
    };
  } catch (error) {
    logger.warn('AI CV parse failed, falling back to the heuristic parser:', error.message);
    return {
      cv: heuristic,
      method: 'heuristic',
      notes: [`AI parsing failed (${error.message}). The built-in parser was used instead.`],
    };
  }
}

export default parseCv;
