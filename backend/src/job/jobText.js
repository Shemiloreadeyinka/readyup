import { collapseWhitespace, truncate } from '../utils/text.js';

/**
 * Server-side hygiene and heuristics for job description text.
 *
 * The extension's content script does the DOM work; this module is the second
 * line of defence. It strips boilerplate that survived DOM extraction and can
 * produce a usable structure even when no model is available.
 */

export const MAX_JOB_CHARS = 18000;

const NOISE_LINE_PATTERNS = [
  /^(accept|manage)\s+cookies/i,
  /^we use cookies/i,
  /^this (site|website) uses cookies/i,
  /^(sign|log)\s?in\b/i,
  /^(sign|register)\s?up\b/i,
  /^create (an )?account/i,
  /^(skip to|jump to) (main )?content/i,
  /^(share|save|report) (this )?job\b/i,
  /^(apply now|easy apply|quick apply)$/i,
  /^(back to|view all|see all|browse) (jobs|results|search)/i,
  /^(people also viewed|similar jobs|recommended for you|more jobs at)/i,
  /^(follow|connect|message)\b.{0,20}$/i,
  /^\d+\s+(applicants?|views?)$/i,
  /^(privacy policy|terms (of|and) (use|service|conditions)|cookie policy|all rights reserved)/i,
  /^(©|copyright)\s/i,
  /^(home|about|contact|careers|blog|pricing|login)$/i,
  /^(facebook|twitter|linkedin|instagram|youtube|tiktok)$/i,
  /^advertisement$/i,
  /^loading\b/i,
  /^enable javascript/i,
];

const isNoise = (line) => {
  const text = line.trim();
  if (!text) return true;
  if (text.length <= 2) return true;
  return NOISE_LINE_PATTERNS.some((pattern) => pattern.test(text));
};

/** Removes navigation, cookie and footer noise, and repeated lines. */
export function cleanJobText(raw) {
  const text = collapseWhitespace(raw);
  const seen = new Map();
  const kept = [];

  for (const line of text.split('\n')) {
    if (isNoise(line)) continue;
    const key = line.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    // Repeated short lines are almost always chrome (menus, buttons).
    if (count > 1 && line.length < 80) continue;
    kept.push(line);
  }

  return truncate(kept.join('\n'), MAX_JOB_CHARS);
}

const SECTION_HEADINGS = {
  responsibilities:
    /^(responsibilities|what you(?:'| wi)ll do|the role|your role|duties|key responsibilities|about the role|day to day|in this role)\b/i,
  qualifications:
    /^(qualifications|requirements|what we(?:'| a)re looking for|who you are|you (?:have|should have)|minimum (?:qualifications|requirements)|basic qualifications|must have|essential)\b/i,
  preferred:
    /^(preferred|nice to have|bonus|plus(?:es)?|desirable|preferred qualifications|good to have)\b/i,
  benefits: /^(benefits|perks|what we offer|compensation|we offer)\b/i,
};

/** Splits cleaned text into the common job-posting sections. */
export function splitJobSections(text) {
  const sections = { intro: [] };
  let current = 'intro';

  for (const line of text.split('\n')) {
    const heading = line.replace(/[:\s]+$/, '').trim();
    const matched =
      heading.length < 60
        ? Object.entries(SECTION_HEADINGS).find(([, pattern]) => pattern.test(heading))
        : null;

    if (matched) {
      current = matched[0];
      sections[current] ??= [];
      continue;
    }
    sections[current] ??= [];
    sections[current].push(line);
  }

  return sections;
}

const bulletsOf = (lines = []) =>
  lines
    .map((line) => line.replace(/^[-•●▪*‣◦·]\s*/, '').trim())
    .filter((line) => line.length > 12 && line.length < 400);

/**
 * A pragmatic technology vocabulary. It exists so the fallback analyser can
 * name concrete requirements; the AI path is not limited to this list.
 */
const TECH_VOCABULARY = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Golang', 'Rust', 'Ruby', 'PHP', 'C#',
  'C++', 'Kotlin', 'Swift', 'Scala', 'Elixir', 'Dart',
  'React', 'React Native', 'Next.js', 'Vue', 'Nuxt', 'Angular', 'Svelte', 'Redux', 'jQuery',
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot',
  'Rails', 'Laravel', '.NET', 'ASP.NET', 'GraphQL', 'REST', 'gRPC', 'WebSocket',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'DynamoDB', 'Cassandra',
  'Elasticsearch', 'Firebase', 'Supabase', 'Prisma', 'SQL', 'NoSQL',
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Ansible',
  'Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'CI/CD', 'Linux', 'Nginx',
  'Kafka', 'RabbitMQ', 'Airflow', 'Spark', 'Hadoop', 'Snowflake', 'dbt',
  'Git', 'Jira', 'Agile', 'Scrum', 'Kanban', 'TDD', 'Microservices', 'Serverless',
  'HTML', 'CSS', 'Tailwind', 'Sass', 'Bootstrap', 'Figma', 'Webpack', 'Vite',
  'Jest', 'Cypress', 'Playwright', 'Selenium', 'PyTest', 'Mocha',
  'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'scikit-learn', 'LLM', 'Machine Learning',
];

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds technology mentions, preserving the vocabulary's canonical spelling.
 *
 * The lookarounds let a term end a sentence ("...such as Kafka.") while still
 * refusing to match a prefix of a longer token, so "Node" does not match
 * inside "Node.js".
 */
export function findTechnologies(text) {
  const found = new Map();
  for (const term of TECH_VOCABULARY) {
    const pattern = new RegExp(`(?<![\\w+#.])${escapeRe(term)}(?![\\w+#]|\\.\\w)`, 'i');
    if (pattern.test(text)) found.set(term.toLowerCase(), term);
  }
  // Drop the generic alias when the specific one is present.
  if (found.has('golang')) found.delete('go');
  if (found.has('google cloud')) found.delete('gcp');
  return [...found.values()];
}

const SOFT_SKILLS = [
  'communication', 'collaboration', 'teamwork', 'problem solving', 'ownership',
  'leadership', 'mentoring', 'attention to detail', 'adaptability', 'self-starter',
  'time management', 'stakeholder management', 'analytical',
];

export function findSoftSkills(text) {
  const lower = text.toLowerCase();
  return SOFT_SKILLS.filter((skill) => lower.includes(skill));
}

/** Pulls "N+ years" style experience requirements. */
export function findExperienceYears(text) {
  const match =
    text.match(/(\d+)\s*(?:\+|plus)?\s*(?:-\s*\d+\s*)?years?(?:[^.\n]{0,70})experience/i) ??
    text.match(/experience[^.\n]{0,40}?(\d+)\s*(?:\+|plus)?\s*years?/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

const EMPLOYMENT_TYPES = [
  ['Full-time', /full[\s-]?time/i],
  ['Part-time', /part[\s-]?time/i],
  ['Contract', /\bcontract(or)?\b/i],
  ['Internship', /\bintern(ship)?\b/i],
  ['Temporary', /\btemporary\b/i],
];

export function findEmploymentType(text) {
  return EMPLOYMENT_TYPES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

const SENIORITY = [
  ['Principal', /\bprincipal\b/i],
  ['Staff', /\bstaff engineer\b/i],
  ['Senior', /\bsenior\b|\bsr\.?\b/i],
  ['Lead', /\b(lead engineer|tech lead|team lead|head of)\b/i],
  ['Mid level', /\bmid[\s-]?level\b|\bintermediate\b/i],
  ['Entry level', /\b(entry[\s-]?level|junior|graduate|trainee)\b/i],
  ['Internship', /\bintern(ship)?\b/i],
];

/**
 * Seniority is read from the job title when there is one: body text mentions
 * other levels ("mentor junior engineers") that would otherwise mislead.
 */
export function findSeniority(text, jobTitle = null) {
  if (jobTitle) {
    const fromTitle = SENIORITY.find(([, pattern]) => pattern.test(jobTitle))?.[0];
    if (fromTitle) return fromTitle;
  }
  return SENIORITY.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/**
 * Structured job analysis without a model.
 * Used when no AI provider is reachable, and to backfill AI output.
 */
export function heuristicJobAnalysis(text, meta = {}) {
  const cleaned = cleanJobText(text);
  const sections = splitJobSections(cleaned);
  const responsibilities = bulletsOf(sections.responsibilities);
  const qualifications = bulletsOf(sections.qualifications);
  const preferredText = (sections.preferred ?? []).join('\n');
  const requiredText = [sections.intro, sections.responsibilities, sections.qualifications]
    .filter(Boolean)
    .map((lines) => lines.join('\n'))
    .join('\n');

  const requiredTechnologies = findTechnologies(requiredText);
  const preferredTechnologies = findTechnologies(preferredText).filter(
    (tech) => !requiredTechnologies.includes(tech),
  );

  return {
    jobTitle: meta.jobTitle ?? null,
    company: meta.company ?? null,
    location: meta.location ?? null,
    employmentType: meta.employmentType ?? findEmploymentType(cleaned),
    seniority: findSeniority(cleaned, meta.jobTitle),
    requiredExperienceYears: findExperienceYears(cleaned),
    requiredExperience: qualifications.filter((item) => /experience|year/i.test(item)),
    requiredTechnologies,
    preferredTechnologies,
    responsibilities: responsibilities.slice(0, 20),
    qualifications: qualifications.slice(0, 20),
    technicalRequirements: qualifications.filter((item) =>
      requiredTechnologies.some((tech) => item.toLowerCase().includes(tech.toLowerCase())),
    ),
    softSkills: findSoftSkills(cleaned),
    atsKeywords: [...new Set([...requiredTechnologies, ...preferredTechnologies])].slice(0, 25),
    summary: (sections.intro ?? []).join(' ').slice(0, 400),
  };
}
