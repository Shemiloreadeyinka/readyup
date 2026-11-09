import { cvToPlainText } from '../cv/schema.js';
import { mentions, normaliseForMatch } from '../utils/text.js';

/**
 * Evidence-based match scoring.
 *
 * The score shown to the user is always recomputed here from the individual
 * match statuses rather than taken from the model, so it is reproducible and
 * every point is traceable to a requirement. It describes alignment with the
 * posting, not a probability of being hired.
 */

const WEIGHTS = { strong: 1, partial: 0.5, missing: 0 };

/** Deterministic skill matching used as a fallback and as a cross-check. */
export function matchRequirementsAgainstCv(requirements, cv) {
  const cvText = cvToPlainText(cv);
  const skillSet = new Set();
  for (const group of cv.technicalSkills ?? []) {
    for (const skill of group.skills ?? []) skillSet.add(normaliseForMatch(skill));
  }

  return requirements.map((requirement) => {
    const token = normaliseForMatch(requirement);
    const listed = skillSet.has(token);
    const used = mentions(cvText, requirement);

    if (listed || used) {
      const role = (cv.workExperience ?? []).find((entry) =>
        mentions(
          [
            ...(entry.responsibilities ?? []),
            ...(entry.achievements ?? []),
            ...(entry.technologies ?? []),
          ].join(' '),
          requirement,
        ),
      );
      const evidenceLine =
        [...(role?.responsibilities ?? []), ...(role?.achievements ?? [])].find((line) =>
          mentions(line, requirement),
        ) ?? null;

      return {
        requirement,
        status: role ? 'strong' : 'partial',
        evidence: evidenceLine ?? (listed ? `Listed under skills: ${requirement}` : null),
        evidenceSource: role ? `${role.jobTitle} at ${role.company}` : 'Skills section',
      };
    }

    return { requirement, status: 'missing', evidence: null, evidenceSource: null };
  });
}

/** Builds a complete comparison without a model. */
export function deterministicComparison(jobAnalysis, cv) {
  const required = jobAnalysis.requiredTechnologies ?? [];
  const preferred = jobAnalysis.preferredTechnologies ?? [];
  const skillMatches = [
    ...matchRequirementsAgainstCv(required, cv),
    ...matchRequirementsAgainstCv(preferred, cv),
  ];

  const experienceRequirements = [
    ...(jobAnalysis.requiredExperience ?? []),
    ...(jobAnalysis.responsibilities ?? []).slice(0, 8),
  ];
  const experienceMatches = matchRequirementsAgainstCv(experienceRequirements, cv);

  return {
    overallAlignment: null,
    scoreRationale:
      'Computed from the proportion of required and preferred items with supporting evidence in your CV.',
    skillMatches,
    experienceMatches,
    missingRequirements: skillMatches
      .filter((match) => match.status === 'missing')
      .map((match) => match.requirement),
    underrepresentedStrengths: [],
    emphasisSuggestions: [],
    recommendedImprovements: [],
  };
}

/**
 * Recomputes the overall alignment from the match statuses.
 * Required items carry twice the weight of preferred and experience items.
 */
export function computeMatchScore(comparison, jobAnalysis) {
  const requiredSet = new Set(
    (jobAnalysis.requiredTechnologies ?? []).map((item) => normaliseForMatch(item)),
  );

  let earned = 0;
  let possible = 0;
  const breakdown = { strong: 0, partial: 0, missing: 0 };

  const score = (match, baseWeight) => {
    const isRequired = requiredSet.has(normaliseForMatch(match.requirement));
    const weight = baseWeight * (isRequired ? 2 : 1);
    earned += WEIGHTS[match.status] * weight;
    possible += weight;
    breakdown[match.status] += 1;
  };

  for (const match of comparison.skillMatches ?? []) score(match, 1);
  for (const match of comparison.experienceMatches ?? []) score(match, 0.8);

  if (possible === 0) {
    return { overallAlignment: null, breakdown, explanation: 'No comparable requirements were found in the posting.' };
  }

  const overallAlignment = Math.round((earned / possible) * 100);
  const total = breakdown.strong + breakdown.partial + breakdown.missing;

  return {
    overallAlignment,
    breakdown,
    explanation:
      `${breakdown.strong} of ${total} requirements have direct evidence in your CV, ` +
      `${breakdown.partial} have partial evidence and ${breakdown.missing} are not demonstrated. ` +
      'Required technologies count double. This measures evidence of alignment with the posting, ' +
      'not your chance of being hired.',
  };
}
