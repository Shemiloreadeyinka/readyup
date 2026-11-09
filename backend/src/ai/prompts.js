/**
 * Prompt library for the CV Tailor analysis pipeline.
 *
 * Every prompt is provider agnostic: it receives plain text and asks for a
 * strict JSON shape. The truthfulness rules are repeated in each stage that can
 * touch CV content, because that constraint is non-negotiable.
 */

export const TRUTHFULNESS_RULES = `ABSOLUTE TRUTHFULNESS RULES (non-negotiable):
- You MUST NOT invent employment history, job titles, company names, employment dates,
  technical skills, qualifications, certifications, projects, metrics, achievements or
  responsibilities.
- You may only rephrase, reorder, sharpen and re-emphasise information that is already
  present in the source CV.
- You MUST NOT add numbers, percentages, team sizes, revenue figures or any metric that
  does not appear in the source CV.
- You MUST NOT claim experience with a technology that the source CV does not mention.
- If a change would improve the CV but requires information you do not have, do not write
  it: add an entry to "questionsForUser" asking the candidate for it instead.
- If you are unsure whether a statement is supported by the source CV, put it in
  "flaggedForReview" rather than asserting it.
Rewriting "Worked on React frontend and integrated APIs." as "Developed React-based
frontend features and integrated REST APIs to support application functionality." is
allowed. Adding "improving performance by 40%" is NOT allowed.`;

const JSON_ONLY = `Respond with a single valid JSON object and nothing else.
No markdown, no code fences, no commentary before or after the JSON.`;

const FENCE = '"""';

export const jobAnalysisPrompt = (jobText, meta = {}) => ({
  system: `You are an expert technical recruiter and ATS analyst. You read job
descriptions and return precise structured data. You never speculate about information
that is not in the text; use null or an empty array when something is absent.
${JSON_ONLY}`,
  prompt: `Analyse the job posting below and return JSON with exactly this shape:

{
  "jobTitle": string|null,
  "company": string|null,
  "location": string|null,
  "employmentType": string|null,
  "seniority": string|null,
  "requiredExperienceYears": number|null,
  "requiredExperience": [string],
  "requiredTechnologies": [string],
  "preferredTechnologies": [string],
  "responsibilities": [string],
  "qualifications": [string],
  "technicalRequirements": [string],
  "softSkills": [string],
  "atsKeywords": [string],
  "summary": string
}

Rules:
- "atsKeywords" holds the 10-25 exact terms an ATS would scan for, as written in the posting.
- Keep technology names exactly as the posting writes them (for example "Node.js", "PostgreSQL").
- Do not merge responsibilities and qualifications.
- "summary" is at most three sentences.
${meta.pageTitle ? `\nPage title: ${meta.pageTitle}` : ''}${meta.url ? `\nSource URL: ${meta.url}` : ''}

JOB POSTING:
${FENCE}
${jobText}
${FENCE}`,
});

export const cvAnalysisPrompt = (cvText) => ({
  system: `You are an expert CV parser. You convert CVs into structured data without
losing information. You copy facts exactly as written; you never invent or embellish.
${JSON_ONLY}`,
  prompt: `${TRUTHFULNESS_RULES}

Parse the CV below into JSON with exactly this shape:

{
  "personalInformation": {
    "fullName": string|null, "title": string|null, "email": string|null,
    "phone": string|null, "location": string|null, "linkedin": string|null,
    "github": string|null, "website": string|null, "portfolio": string|null
  },
  "professionalSummary": string,
  "technicalSkills": [{ "category": string, "skills": [string] }],
  "workExperience": [{
    "jobTitle": string, "company": string, "location": string|null,
    "startDate": string|null, "endDate": string|null, "current": boolean,
    "responsibilities": [string], "achievements": [string], "technologies": [string]
  }],
  "education": [{
    "degree": string, "institution": string, "location": string|null,
    "startDate": string|null, "endDate": string|null, "details": [string]
  }],
  "projects": [{ "name": string, "description": string, "technologies": [string],
                 "link": string|null, "highlights": [string] }],
  "certifications": [{ "name": string, "issuer": string|null, "date": string|null }],
  "achievements": [string],
  "languages": [string],
  "additionalSections": [{ "heading": string, "items": [string] }]
}

Rules:
- Preserve every employment date, job title, company name and qualification exactly.
- Put any content that does not fit the known sections into "additionalSections" rather
  than discarding it.
- Keep bullet points as separate array entries; do not merge them.
- Use null for genuinely absent values and [] for absent lists. Never guess an email,
  a date or a company name.

CV TEXT:
${FENCE}
${cvText}
${FENCE}`,
});

export const comparisonPrompt = (jobAnalysis, cvAnalysis) => ({
  system: `You are a careful CV reviewer. Every claim you make must cite evidence taken
verbatim from the CV. You never credit the candidate with a skill the CV does not show.
${JSON_ONLY}`,
  prompt: `Compare the candidate CV against the job requirements and return JSON with
exactly this shape:

{
  "overallAlignment": number,
  "scoreRationale": string,
  "skillMatches": [{
    "requirement": string,
    "status": "strong" | "partial" | "missing",
    "evidence": string|null,
    "evidenceSource": string|null
  }],
  "experienceMatches": [{
    "requirement": string,
    "status": "strong" | "partial" | "missing",
    "evidence": string|null,
    "evidenceSource": string|null
  }],
  "missingRequirements": [string],
  "underrepresentedStrengths": [{ "item": string, "why": string }],
  "emphasisSuggestions": [string],
  "recommendedImprovements": [string]
}

Rules:
- "overallAlignment" is 0-100 and describes evidence-based alignment with the posting.
  It is NOT a probability of being hired. Explain how you arrived at it in
  "scoreRationale".
- status "strong" requires direct evidence; "partial" means adjacent or indirect
  evidence; "missing" means the CV shows nothing relevant.
- "evidence" must be a short quote copied from the CV. Use null only when status is
  "missing". "evidenceSource" names the CV section or role the quote came from.
- Cover every required technology and every major responsibility from the job.

JOB REQUIREMENTS (JSON):
${JSON.stringify(jobAnalysis, null, 2)}

CANDIDATE CV (JSON):
${JSON.stringify(cvAnalysis, null, 2)}`,
});

export const tailoringPrompt = (jobAnalysis, cvAnalysis, comparison) => ({
  system: `You are an expert CV writer specialising in ATS-friendly, factually faithful
CVs. You rewrite for clarity and relevance, never for invention.
${JSON_ONLY}`,
  prompt: `${TRUTHFULNESS_RULES}

Produce a tailored version of the CV for this specific job. Return JSON with exactly
this shape:

{
  "tailoredCv": {
    "personalInformation": { "...unchanged from the source CV..." },
    "professionalSummary": string,
    "technicalSkills": [{ "category": string, "skills": [string] }],
    "workExperience": [{
      "jobTitle": string, "company": string, "location": string|null,
      "startDate": string|null, "endDate": string|null, "current": boolean,
      "responsibilities": [string], "achievements": [string], "technologies": [string]
    }],
    "education": [],
    "projects": [],
    "certifications": [],
    "achievements": [string],
    "languages": [string],
    "additionalSections": [{ "heading": string, "items": [string] }]
  },
  "sectionOrder": [string],
  "changeLog": [{ "section": string, "change": string, "reason": string }],
  "keywordsApplied": [string],
  "flaggedForReview": [{ "text": string, "concern": string }],
  "questionsForUser": [string]
}

Rules:
- personalInformation, company names, job titles and all dates must be copied from the
  source CV character for character.
- education, projects and certifications keep the same object shape as the source CV.
- Rewrite the professional summary so it speaks to this role, using only facts already
  in the CV.
- Reorder and reword skills and bullets so the most relevant come first. Place ATS
  keywords only where the CV genuinely supports them.
- Leave bullets that are already strong and relevant unchanged, and do not list them in
  the changeLog.
- "sectionOrder" lists section keys in the order they should be rendered, drawn from:
  professionalSummary, technicalSkills, workExperience, projects, education,
  certifications, achievements, languages, additionalSections.
- "keywordsApplied" lists job keywords you were able to support honestly.
- "flaggedForReview" holds any statement the candidate should confirm before sending.
- "questionsForUser" holds the metrics or details that would strengthen the CV but that
  you must not invent.

JOB ANALYSIS (JSON):
${JSON.stringify(jobAnalysis, null, 2)}

COMPARISON (JSON):
${JSON.stringify(comparison, null, 2)}

SOURCE CV (JSON) - the only permitted source of facts:
${JSON.stringify(cvAnalysis, null, 2)}`,
});

export const suggestionsPrompt = (jobAnalysis, comparison) => ({
  system: `You are a career coach giving concrete, honest preparation advice.
${JSON_ONLY}`,
  prompt: `Based on the job analysis and the CV comparison, return JSON with exactly
this shape:

{
  "skillsToHighlight": [string],
  "experienceToEmphasise": [string],
  "missingRequirements": [{ "requirement": string, "suggestion": string }],
  "interviewPreparationTopics": [string],
  "applicationTips": [string]
}

Rules:
- Be specific to this posting; avoid generic advice.
- For missing requirements, suggest an honest way to address the gap (learn it, point to
  adjacent experience, acknowledge it in a cover letter). Never suggest claiming the
  skill.

JOB ANALYSIS (JSON):
${JSON.stringify(jobAnalysis, null, 2)}

COMPARISON (JSON):
${JSON.stringify(comparison, null, 2)}`,
});
