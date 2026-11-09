/** Normalisers that make model output safe for the rest of the pipeline. */

const str = (value) => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
};

const strList = (value, limit = 40) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) =>
      typeof item === 'string'
        ? item.trim()
        : (str(item?.text ?? item?.name ?? item?.value ?? item?.requirement) ?? ''),
    )
    .filter(Boolean)
    .slice(0, limit);
};

const num = (value) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const STATUSES = new Set(['strong', 'partial', 'missing']);

const normaliseStatus = (value) => {
  const text = String(value ?? '').toLowerCase();
  if (STATUSES.has(text)) return text;
  if (text.includes('strong') || text.includes('full') || text === 'match') return 'strong';
  if (text.includes('partial') || text.includes('some') || text.includes('adjacent')) {
    return 'partial';
  }
  return 'missing';
};

export function normaliseJobAnalysis(raw = {}) {
  return {
    jobTitle: str(raw.jobTitle ?? raw.title),
    company: str(raw.company ?? raw.companyName),
    location: str(raw.location),
    employmentType: str(raw.employmentType ?? raw.jobType),
    seniority: str(raw.seniority ?? raw.level),
    requiredExperienceYears: num(raw.requiredExperienceYears),
    requiredExperience: strList(raw.requiredExperience),
    requiredTechnologies: strList(raw.requiredTechnologies ?? raw.requiredSkills),
    preferredTechnologies: strList(raw.preferredTechnologies ?? raw.preferredSkills),
    responsibilities: strList(raw.responsibilities),
    qualifications: strList(raw.qualifications),
    technicalRequirements: strList(raw.technicalRequirements),
    softSkills: strList(raw.softSkills),
    atsKeywords: strList(raw.atsKeywords, 30),
    summary: str(raw.summary) ?? '',
  };
}

const normaliseMatches = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { requirement: item, status: 'partial', evidence: null, evidenceSource: null };
      }
      if (!item || typeof item !== 'object') return null;
      const requirement = str(item.requirement ?? item.skill ?? item.name ?? item.item);
      if (!requirement) return null;
      const status = normaliseStatus(item.status ?? item.match ?? item.level);
      return {
        requirement,
        status,
        evidence: status === 'missing' ? null : str(item.evidence ?? item.quote),
        evidenceSource: str(item.evidenceSource ?? item.source ?? item.section),
      };
    })
    .filter(Boolean)
    .slice(0, 40);
};

export function normaliseComparison(raw = {}) {
  const skillMatches = normaliseMatches(raw.skillMatches ?? raw.skills);
  const experienceMatches = normaliseMatches(raw.experienceMatches ?? raw.experience);
  const score = num(raw.overallAlignment ?? raw.score ?? raw.matchScore);

  return {
    overallAlignment: score === null ? null : Math.max(0, Math.min(100, Math.round(score))),
    scoreRationale: str(raw.scoreRationale ?? raw.rationale) ?? '',
    skillMatches,
    experienceMatches,
    missingRequirements: strList(raw.missingRequirements),
    underrepresentedStrengths: (Array.isArray(raw.underrepresentedStrengths)
      ? raw.underrepresentedStrengths
      : []
    )
      .map((entry) =>
        typeof entry === 'string'
          ? { item: entry, why: '' }
          : { item: str(entry?.item ?? entry?.strength) ?? '', why: str(entry?.why) ?? '' },
      )
      .filter((entry) => entry.item)
      .slice(0, 20),
    emphasisSuggestions: strList(raw.emphasisSuggestions),
    recommendedImprovements: strList(raw.recommendedImprovements),
  };
}

export function normaliseSuggestions(raw = {}) {
  return {
    skillsToHighlight: strList(raw.skillsToHighlight),
    experienceToEmphasise: strList(raw.experienceToEmphasise ?? raw.experienceToEmphasize),
    missingRequirements: (Array.isArray(raw.missingRequirements) ? raw.missingRequirements : [])
      .map((entry) =>
        typeof entry === 'string'
          ? { requirement: entry, suggestion: '' }
          : {
              requirement: str(entry?.requirement) ?? '',
              suggestion: str(entry?.suggestion) ?? '',
            },
      )
      .filter((entry) => entry.requirement)
      .slice(0, 20),
    interviewPreparationTopics: strList(raw.interviewPreparationTopics),
    applicationTips: strList(raw.applicationTips),
  };
}

export function normaliseTailoring(raw = {}) {
  return {
    tailoredCv: raw.tailoredCv ?? raw.cv ?? raw,
    sectionOrder: strList(raw.sectionOrder, 12),
    changeLog: (Array.isArray(raw.changeLog) ? raw.changeLog : [])
      .map((entry) => ({
        section: str(entry?.section) ?? '',
        change: str(entry?.change) ?? '',
        reason: str(entry?.reason) ?? '',
      }))
      .filter((entry) => entry.change)
      .slice(0, 40),
    keywordsApplied: strList(raw.keywordsApplied, 40),
    flaggedForReview: (Array.isArray(raw.flaggedForReview) ? raw.flaggedForReview : [])
      .map((entry) =>
        typeof entry === 'string'
          ? { text: entry, concern: 'Flagged by the model for review.' }
          : { text: str(entry?.text) ?? '', concern: str(entry?.concern) ?? '' },
      )
      .filter((entry) => entry.text)
      .slice(0, 30),
    questionsForUser: strList(raw.questionsForUser, 15),
  };
}
