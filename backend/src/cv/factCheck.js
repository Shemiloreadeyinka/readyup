import { cvToPlainText } from './schema.js';
import { normaliseForMatch } from '../utils/text.js';

/**
 * Deterministic truthfulness guard for tailored CVs.
 *
 * Prompting alone is not a guarantee, so every tailored CV is checked against
 * the source before it is shown. Identity-level facts (names, companies,
 * titles, dates) are restored from the source outright; softer risks (new
 * numbers, unseen technologies) are reported for user review.
 */

const NUMBER_RE = /\b\d+(?:[.,]\d+)?\s*(?:%|percent|k\b|m\b|x\b|\+)?/gi;
const YEAR_RE = /^(19|20)\d{2}$/;

const numbersIn = (text) =>
  (String(text ?? '').match(NUMBER_RE) ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => !YEAR_RE.test(value.replace(/\D/g, '')));

const sameText = (a, b) => normaliseForMatch(a) === normaliseForMatch(b);

/** Collects every sentence-level string in a CV with a path label. */
function collectStatements(cv) {
  const statements = [];
  const add = (path, text) => {
    if (typeof text === 'string' && text.trim()) statements.push({ path, text: text.trim() });
  };

  add('professionalSummary', cv.professionalSummary);
  (cv.workExperience ?? []).forEach((role, index) => {
    const label = `${role.jobTitle || 'Role'} at ${role.company || 'Company'}`;
    (role.responsibilities ?? []).forEach((item, i) =>
      add(`workExperience[${index}].responsibilities[${i}] (${label})`, item),
    );
    (role.achievements ?? []).forEach((item, i) =>
      add(`workExperience[${index}].achievements[${i}] (${label})`, item),
    );
  });
  (cv.projects ?? []).forEach((project, index) => {
    add(`projects[${index}].description (${project.name})`, project.description);
    (project.highlights ?? []).forEach((item, i) =>
      add(`projects[${index}].highlights[${i}] (${project.name})`, item),
    );
  });
  (cv.achievements ?? []).forEach((item, i) => add(`achievements[${i}]`, item));

  return statements;
}

/** Every skill token that appears anywhere in the CV. */
function skillTokens(cv) {
  const tokens = new Set();
  for (const group of cv.technicalSkills ?? []) {
    for (const skill of group.skills ?? []) tokens.add(normaliseForMatch(skill));
  }
  for (const role of cv.workExperience ?? []) {
    for (const tech of role.technologies ?? []) tokens.add(normaliseForMatch(tech));
  }
  for (const project of cv.projects ?? []) {
    for (const tech of project.technologies ?? []) tokens.add(normaliseForMatch(tech));
  }
  tokens.delete('');
  return tokens;
}

/**
 * @param {object} sourceCv   the user's original structured CV
 * @param {object} tailoredCv the model's tailored CV
 * @returns {{cv: object, corrections: Array, warnings: Array}}
 */
export function factCheckTailoredCv(sourceCv, tailoredCv) {
  const corrections = [];
  const warnings = [];
  const cv = structuredClone(tailoredCv);
  const sourceText = cvToPlainText(sourceCv);
  const sourceSkills = skillTokens(sourceCv);

  /* --- Contact details are copied from the source, never from the model. -- */
  const sourcePersonal = sourceCv.personalInformation ?? {};
  const tailoredPersonal = cv.personalInformation ?? {};
  for (const [field, originalValue] of Object.entries(sourcePersonal)) {
    const proposed = tailoredPersonal[field];
    if (originalValue && proposed && !sameText(originalValue, proposed)) {
      corrections.push({
        field: `personalInformation.${field}`,
        from: proposed,
        to: originalValue,
        reason: 'Contact details are always restored from the original CV.',
      });
    }
  }
  cv.personalInformation = { ...tailoredPersonal, ...sourcePersonal };

  /* --- Employment identity facts must match a source role exactly. -------- */
  const sourceRoles = sourceCv.workExperience ?? [];
  cv.workExperience = (cv.workExperience ?? []).map((role, index) => {
    const match =
      sourceRoles.find(
        (candidate) =>
          sameText(candidate.company, role.company) && sameText(candidate.jobTitle, role.jobTitle),
      ) ??
      sourceRoles.find((candidate) => sameText(candidate.company, role.company)) ??
      sourceRoles[index];

    if (!match) {
      warnings.push({
        type: 'unverified-role',
        path: `workExperience[${index}]`,
        text: `${role.jobTitle} at ${role.company}`,
        concern: 'This role does not appear in your original CV. Remove it before applying.',
      });
      return role;
    }

    const fixed = { ...role };
    for (const field of ['jobTitle', 'company', 'startDate', 'endDate', 'location']) {
      if (match[field] && !sameText(match[field], role[field])) {
        corrections.push({
          field: `workExperience[${index}].${field}`,
          from: role[field],
          to: match[field],
          reason: 'Employment facts are restored from the original CV.',
        });
        fixed[field] = match[field];
      }
    }
    fixed.current = match.current;
    return fixed;
  });

  /* --- Education and certifications are passed through unchanged. --------- */
  if (sourceCv.education?.length) {
    const sameCount = (cv.education ?? []).length === sourceCv.education.length;
    if (!sameCount) {
      corrections.push({
        field: 'education',
        from: `${(cv.education ?? []).length} entries`,
        to: `${sourceCv.education.length} entries`,
        reason: 'Education is copied from the original CV so nothing is added or lost.',
      });
    }
    cv.education = sourceCv.education;
  }
  if (sourceCv.certifications?.length) {
    cv.certifications = sourceCv.certifications;
  }

  /* --- New metrics are the most common fabrication; flag every one. ------- */
  const sourceNumbers = new Set(numbersIn(sourceText));
  for (const { path, text } of collectStatements(cv)) {
    for (const value of numbersIn(text)) {
      if (!sourceNumbers.has(value)) {
        warnings.push({
          type: 'unverified-metric',
          path,
          text,
          concern: `The figure "${value}" does not appear in your original CV. Confirm it or remove it.`,
        });
      }
    }
  }

  /* --- Skills that the source CV never mentions. -------------------------- */
  for (const group of cv.technicalSkills ?? []) {
    group.skills = (group.skills ?? []).filter((skill) => {
      const token = normaliseForMatch(skill);
      const known = sourceSkills.has(token) || normaliseForMatch(sourceText).includes(token);
      if (!known) {
        corrections.push({
          field: 'technicalSkills',
          from: skill,
          to: null,
          reason: 'Removed: this skill does not appear in your original CV.',
        });
      }
      return known;
    });
  }
  cv.technicalSkills = (cv.technicalSkills ?? []).filter((group) => group.skills.length > 0);

  return { cv, corrections, warnings };
}

export default factCheckTailoredCv;
