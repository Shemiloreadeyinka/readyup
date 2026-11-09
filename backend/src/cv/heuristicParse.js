import { normaliseCv } from './schema.js';

/**
 * Non-AI CV parser.
 *
 * Used as a fallback when no model is reachable, and as a safety net that is
 * merged with the model output so contact details are never lost. It is
 * deliberately conservative: it only reports what it can see in the text.
 */

const SECTION_PATTERNS = [
  { key: 'professionalSummary', re: /^(professional\s+summary|summary|profile|about\s+me|objective)\b/i },
  { key: 'technicalSkills', re: /^(technical\s+skills|skills|core\s+competencies|technologies|tech\s+stack)\b/i },
  { key: 'workExperience', re: /^(work\s+experience|professional\s+experience|experience|employment(\s+history)?|career\s+history)\b/i },
  { key: 'projects', re: /^(projects|personal\s+projects|selected\s+projects|portfolio)\b/i },
  { key: 'education', re: /^(education|academic\s+background|qualifications)\b/i },
  { key: 'certifications', re: /^(certifications?|licenses?|courses)\b/i },
  { key: 'achievements', re: /^(achievements?|awards?|honou?rs|accomplishments)\b/i },
  { key: 'languages', re: /^(languages)\b/i },
  { key: 'interests', re: /^(interests|hobbies|volunteering|references)\b/i },
];

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const LINKEDIN_RE = /((?:https?:\/\/)?(?:www\.)?linkedin\.com\/[\w\-/%.]+)/i;
const GITHUB_RE = /((?:https?:\/\/)?(?:www\.)?github\.com\/[\w\-/%.]+)/i;
const URL_RE = /((?:https?:\/\/)[\w.-]+\.[a-z]{2,}(?:\/[\w\-./%?=&#]*)?)/i;
const DATE_RANGE_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|–|—|to)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{1,2}\/\d{4}|\d{4}|present|current|now)/i;

const isBullet = (line) => /^[-•●▪*‣◦·]\s*/.test(line);
const stripBullet = (line) => line.replace(/^[-•●▪*‣◦·]\s*/, '').trim();

/**
 * A heading is a short standalone line that matches a known section name.
 * Lines like "Languages: English, French" are content, not headings, so a
 * colon followed by text, or any comma, disqualifies the line.
 */
const matchSection = (line) => {
  const cleaned = line.replace(/[:\s]+$/, '').trim();
  if (cleaned.length > 42 || cleaned.split(/\s+/).length > 5) return null;
  if (cleaned.includes(',') || /:\s*\S/.test(cleaned)) return null;
  if (isBullet(cleaned)) return null;
  for (const { key, re } of SECTION_PATTERNS) {
    if (re.test(cleaned)) return key;
  }
  return null;
};

function splitIntoSections(lines) {
  const sections = { header: [] };
  let current = 'header';

  for (const line of lines) {
    const key = matchSection(line);
    if (key) {
      current = key;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }
  return sections;
}

function parsePersonalInformation(headerLines, fullText) {
  const header = headerLines.join('\n');
  const emailMatch = fullText.match(EMAIL_RE);
  const phoneMatch = header.match(PHONE_RE) ?? fullText.match(PHONE_RE);
  const linkedinMatch = fullText.match(LINKEDIN_RE);
  const githubMatch = fullText.match(GITHUB_RE);

  const websiteMatch = fullText
    .match(new RegExp(URL_RE, 'gi'))
    ?.find((url) => !/linkedin\.com|github\.com/i.test(url));

  // The name is normally the first non-contact line of the document.
  const nameLine = headerLines.find(
    (line) =>
      line.length > 2 &&
      line.length < 60 &&
      !EMAIL_RE.test(line) &&
      !PHONE_RE.test(line) &&
      !URL_RE.test(line) &&
      !/@|\d{4}/.test(line) &&
      /^[A-Za-zÀ-ÿ'’.\- ]+$/.test(line),
  );

  const titleLine = headerLines.find(
    (line) =>
      line !== nameLine &&
      line.length < 70 &&
      /engineer|developer|designer|manager|analyst|scientist|architect|consultant|lead|specialist|administrator/i.test(
        line,
      ),
  );

  return {
    fullName: nameLine ?? null,
    title: titleLine ?? null,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    location: null,
    linkedin: linkedinMatch ? linkedinMatch[0] : null,
    github: githubMatch ? githubMatch[0] : null,
    website: websiteMatch ?? null,
    portfolio: null,
  };
}

function parseSkills(lines) {
  const groups = [];
  const loose = [];

  for (const line of lines) {
    const text = stripBullet(line);
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon > 0 && colon < 40) {
      const category = text.slice(0, colon).trim();
      const skills = text
        .slice(colon + 1)
        .split(/[,|;•]/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (skills.length) {
        groups.push({ category, skills });
        continue;
      }
    }
    loose.push(
      ...text
        .split(/[,|;•]/)
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  if (loose.length) groups.push({ category: 'Skills', skills: loose });
  return groups;
}

/**
 * Splits an employer line into company and location.
 * Only separators padded with spaces count, so "Hewlett-Packard" survives.
 */
function splitCompanyAndLocation(text) {
  const parts = text.split(/\s+[-–—|·]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return [text, null];
  return [parts[0], parts.slice(1).join(', ')];
}

/**
 * Work experience blocks are detected by date ranges: the line carrying the
 * range (or the line above it) holds the title and company.
 */
function parseExperience(lines) {
  const roles = [];
  let current = null;

  const pushCurrent = () => {
    if (current && (current.jobTitle || current.company)) roles.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const dateMatch = line.match(DATE_RANGE_RE);

    if (dateMatch && !isBullet(line)) {
      pushCurrent();
      const withoutDates = line.replace(DATE_RANGE_RE, '').replace(/[|·–—-]\s*$/, '').trim();
      const headline = withoutDates || lines[i - 1] || '';
      const [first, second] = headline
        .split(/\s+(?:at|@|\||·|–|—|-)\s+/)
        .map((part) => part.trim());

      current = {
        jobTitle: first || '',
        company: second || '',
        location: null,
        startDate: dateMatch[1],
        endDate: dateMatch[2],
        current: /present|current|now/i.test(dateMatch[2]),
        responsibilities: [],
        achievements: [],
        technologies: [],
      };
      continue;
    }

    if (!current) continue;

    const text = stripBullet(line);
    if (!text) continue;

    const techLine = text.match(/^(?:technologies|tech stack|stack|tools)\s*:\s*(.+)$/i);
    if (techLine) {
      current.technologies = techLine[1]
        .split(/[,;|]/)
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (isBullet(line) || text.length > 40) {
      current.responsibilities.push(text);
    } else if (!current.company) {
      // CVs commonly write "Company - City" on the employer line.
      const [company, location] = splitCompanyAndLocation(text);
      current.company = company;
      if (location && !current.location) current.location = location;
    }
  }

  pushCurrent();
  return roles;
}

function parseEducation(lines) {
  const entries = [];
  for (const line of lines) {
    const text = stripBullet(line);
    if (!text) continue;

    const range = text.match(DATE_RANGE_RE);
    const singleYear = range ? null : text.match(/\b(?:19|20)\d{2}\b/);
    const withoutDates = text
      .replace(DATE_RANGE_RE, '')
      .replace(/\b(?:19|20)\d{2}\b/g, '')
      .trim();

    const previous = entries[entries.length - 1];

    // Bullets and lines without any date belong to the entry above: CV
    // layouts routinely put the institution on its own line.
    if (!range && !singleYear) {
      if (!previous) continue;
      if (isBullet(line)) previous.details.push(text);
      else if (!previous.institution) previous.institution = text;
      else previous.details.push(text);
      continue;
    }

    const [degree, institution] = withoutDates
      .split(/\s+(?:at|,|\||·|–|—|-)\s+/)
      .map((part) => part.replace(/^[,\-|]+|[,\-|]+$/g, '').trim());

    if (!degree) {
      if (previous && !previous.endDate) previous.endDate = singleYear?.[0] ?? range?.[2] ?? null;
      continue;
    }

    entries.push({
      degree,
      institution: institution ?? '',
      location: null,
      startDate: range?.[1] ?? null,
      endDate: range?.[2] ?? singleYear?.[0] ?? null,
      details: [],
    });
  }
  return entries;
}

function parseProjects(lines) {
  const projects = [];
  let current = null;

  for (const line of lines) {
    const text = stripBullet(line);
    if (!text) continue;

    const techLine = text.match(/^(?:technologies|tech stack|stack|tools)\s*:\s*(.+)$/i);
    if (techLine && current) {
      current.technologies = techLine[1]
        .split(/[,;|]/)
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    if (isBullet(line)) {
      if (current) current.highlights.push(text);
      continue;
    }

    // A non-bullet line directly under a project title is its description.
    if (current && !current.description && text.length < 160) {
      current.description = text;
      continue;
    }

    if (text.length < 80) {
      if (current) projects.push(current);
      const [name, description] = text.split(/\s+[-–—|:]\s+/);
      current = {
        name: name.trim(),
        description: (description ?? '').trim(),
        technologies: [],
        link: text.match(URL_RE)?.[0] ?? null,
        highlights: [],
      };
      continue;
    }

    if (current) current.highlights.push(text);
  }
  if (current) projects.push(current);
  return projects;
}

const listOf = (lines) => lines.map(stripBullet).filter(Boolean);

/**
 * Parses raw CV text into the canonical structure without using a model.
 * @param {string} text
 */
export function heuristicParseCv(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = splitIntoSections(lines);
  const headerLines = sections.header ?? [];

  const certifications = listOf(sections.certifications ?? []).map((name) => ({
    name,
    issuer: null,
    date: null,
  }));

  const additionalSections = [];
  if (sections.interests?.length) {
    additionalSections.push({ heading: 'Additional', items: listOf(sections.interests) });
  }

  return normaliseCv({
    personalInformation: parsePersonalInformation(headerLines, text),
    professionalSummary: (sections.professionalSummary ?? []).join(' ').trim(),
    technicalSkills: parseSkills(sections.technicalSkills ?? []),
    workExperience: parseExperience(sections.workExperience ?? []),
    education: parseEducation(sections.education ?? []),
    projects: parseProjects(sections.projects ?? []),
    certifications,
    achievements: listOf(sections.achievements ?? []),
    languages: listOf(sections.languages ?? []).flatMap((line) =>
      line.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
    ),
    additionalSections,
  });
}

export default heuristicParseCv;
