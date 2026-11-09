import { heuristicJobAnalysis, cleanJobText } from '../job/jobText.js';
import { normaliseCv } from '../cv/schema.js';
import factCheckTailoredCv from '../cv/factCheck.js';
import {
  normaliseJobAnalysis,
  normaliseComparison,
  normaliseSuggestions,
  normaliseTailoring,
} from './normalise.js';
import { deterministicComparison, computeMatchScore } from './matchScore.js';
import { SECTION_KEYS } from '../cv/schema.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * The five-stage CV tailoring pipeline.
 *
 * Each stage is independently useful and independently recoverable: job and
 * comparison stages fall back to deterministic analysis when the model fails,
 * so the user always gets something real rather than a spinner.
 */

/** Stage 1: job description analysis. */
export async function analyseJobDescription(provider, jobText, meta = {}) {
  const cleaned = cleanJobText(jobText);
  const heuristic = heuristicJobAnalysis(cleaned, meta);

  if (!provider) {
    return { analysis: heuristic, method: 'heuristic', warnings: ['Analysed without AI.'] };
  }

  try {
    const raw = await provider.analyseJob(cleaned, meta);
    const analysis = normaliseJobAnalysis(raw);

    // Backfill anything the model left empty with the deterministic pass.
    for (const key of Object.keys(heuristic)) {
      const value = analysis[key];
      const isEmpty = value === null || value === '' || (Array.isArray(value) && !value.length);
      if (isEmpty && heuristic[key]) analysis[key] = heuristic[key];
    }
    // Page metadata is more trustworthy than a model guess for these fields.
    if (meta.jobTitle) analysis.jobTitle = meta.jobTitle;
    if (meta.company) analysis.company = meta.company;

    return { analysis, method: `ai:${provider.id}`, warnings: [] };
  } catch (error) {
    logger.warn('Job analysis via AI failed:', error.message);
    return {
      analysis: heuristic,
      method: 'heuristic',
      warnings: [`AI job analysis failed (${error.message}). Keyword analysis was used instead.`],
    };
  }
}

/** Stage 3: comparison, always finished with a deterministic score. */
export async function compareCvWithJob(provider, jobAnalysis, cv) {
  const fallback = deterministicComparison(jobAnalysis, cv);
  let comparison = fallback;
  let method = 'deterministic';
  const warnings = [];

  if (provider) {
    try {
      comparison = normaliseComparison(await provider.compareCVWithJob(jobAnalysis, cv));
      method = `ai:${provider.id}`;

      // Guarantee coverage of every required technology.
      const covered = new Set(
        comparison.skillMatches.map((match) => match.requirement.toLowerCase()),
      );
      for (const match of fallback.skillMatches) {
        if (!covered.has(match.requirement.toLowerCase())) comparison.skillMatches.push(match);
      }
      if (!comparison.experienceMatches.length) {
        comparison.experienceMatches = fallback.experienceMatches;
      }
    } catch (error) {
      logger.warn('AI comparison failed:', error.message);
      warnings.push(`AI comparison failed (${error.message}). Keyword matching was used instead.`);
    }
  }

  const { overallAlignment, breakdown, explanation } = computeMatchScore(comparison, jobAnalysis);
  comparison.overallAlignment = overallAlignment;
  comparison.scoreBreakdown = breakdown;
  comparison.scoreExplanation = explanation;
  comparison.missingRequirements = [
    ...new Set([
      ...comparison.missingRequirements,
      ...comparison.skillMatches
        .filter((match) => match.status === 'missing')
        .map((match) => match.requirement),
    ]),
  ];

  return { comparison, method, warnings };
}

const orderSections = (order) => {
  const valid = (order ?? []).filter((key) => SECTION_KEYS.includes(key));
  return [...new Set([...valid, ...SECTION_KEYS])];
};

/** Stage 4: tailoring, with the deterministic truthfulness guard applied. */
export async function tailorCv(provider, jobAnalysis, cv, comparison) {
  if (!provider) {
    throw new AppError(
      'CV tailoring needs an AI provider. Start Ollama locally, or configure a cloud provider in AI Settings.',
      503,
    );
  }

  const raw = normaliseTailoring(await provider.tailorCV(jobAnalysis, cv, comparison));
  const tailoredCv = normaliseCv(raw.tailoredCv);
  const { cv: verifiedCv, corrections, warnings } = factCheckTailoredCv(cv, tailoredCv);

  return {
    cv: verifiedCv,
    sectionOrder: orderSections(raw.sectionOrder),
    changeLog: raw.changeLog,
    keywordsApplied: raw.keywordsApplied,
    flaggedForReview: [...raw.flaggedForReview, ...warnings.map((w) => ({ text: w.text, concern: w.concern }))],
    questionsForUser: raw.questionsForUser,
    factCheck: { corrections, warnings },
  };
}

/** Stage 5: recommendations. Non-fatal: the CV is still useful without them. */
export async function generateRecommendations(provider, jobAnalysis, comparison) {
  if (!provider) return { suggestions: null, warnings: [] };
  try {
    return {
      suggestions: normaliseSuggestions(await provider.generateSuggestions(jobAnalysis, comparison)),
      warnings: [],
    };
  } catch (error) {
    logger.warn('Suggestion generation failed:', error.message);
    return { suggestions: null, warnings: [`Recommendations unavailable (${error.message}).`] };
  }
}

/**
 * Runs the whole pipeline.
 * @param {object} options
 * @param {import('../ai/AiProvider.js').AiProvider} options.provider
 * @param {string} options.jobText raw job description
 * @param {object} options.jobMeta { jobTitle, company, url, pageTitle }
 * @param {object} options.cv structured source CV
 * @param {object} [options.jobAnalysis] a stage 1 result the caller already has
 * @param {(stage: string, message: string) => void} [options.onProgress]
 */
export async function runTailoringPipeline({
  provider,
  jobText,
  jobMeta = {},
  cv,
  jobAnalysis,
  onProgress,
}) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {};
  const warnings = [];

  // Per-stage timing: without it, a slow run is indistinguishable from a hung
  // one, and there is no way to tell which stage to blame.
  const timings = {};
  const runStage = async (name, task) => {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      timings[name] = Date.now() - startedAt;
      logger.info(`pipeline stage "${name}" took ${(timings[name] / 1000).toFixed(1)}s`);
    }
  };

  // Reusing the caller's analysis avoids paying for stage 1 twice when the
  // extension has already previewed the job.
  progress('job-analysis', 'Analysing the job description');
  const job = jobAnalysis
    ? { analysis: normaliseJobAnalysis(jobAnalysis), method: 'reused', warnings: [] }
    : await runStage('job-analysis', () => analyseJobDescription(provider, jobText, jobMeta));
  warnings.push(...job.warnings);

  progress('comparison', 'Comparing your CV against the requirements');
  const compared = await runStage('comparison', () => compareCvWithJob(provider, job.analysis, cv));
  warnings.push(...compared.warnings);

  progress('tailoring', 'Tailoring your CV');
  const tailored = await runStage('tailoring', () => tailorCv(provider, job.analysis, cv, compared.comparison));

  progress('recommendations', 'Preparing recommendations');
  const recommended = await runStage('recommendations', () =>
    generateRecommendations(provider, job.analysis, compared.comparison),
  );
  warnings.push(...recommended.warnings);

  progress('done', 'Finished');

  // Non-fatal problems the provider noticed, such as a prompt that overflowed
  // the context window. These would otherwise only reach the server log.
  warnings.push(...(provider?.drainWarnings?.() ?? []));

  return {
    jobAnalysis: job.analysis,
    comparison: compared.comparison,
    tailored,
    suggestions: recommended.suggestions,
    meta: {
      provider: provider?.describe() ?? null,
      jobAnalysisMethod: job.method,
      comparisonMethod: compared.method,
      warnings,
      timings,
      totalMs: Object.values(timings).reduce((total, value) => total + value, 0),
      generatedAt: new Date().toISOString(),
    },
  };
}
