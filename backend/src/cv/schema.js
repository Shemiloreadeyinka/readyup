/**
 * Canonical structured-CV shape plus a normaliser.
 *
 * Both the AI parser and the heuristic fallback produce slightly different
 * shapes; everything downstream (comparison, tailoring, rendering) consumes
 * the normalised form only.
 */

export const SECTION_KEYS = [
  'professionalSummary',
  'technicalSkills',
  'workExperience',
  'projects',
  'education',
  'certifications',
  'achievements',
  'languages',
  'additionalSections',
];

export const SECTION_LABELS = {
  professionalSummary: 'Professional Summary',
  technicalSkills: 'Technical Skills',
  workExperience: 'Work Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  achievements: 'Achievements',
  languages: 'Languages',
  additionalSections: 'Additional',
};

const str = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

const strList = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return str(item.text ?? item.value ?? item.name ?? item.description) ?? '';
      }
      return '';
    })
    .filter(Boolean);
};

const objList = (value) => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object');
};

export function emptyCv() {
  return {
    personalInformation: {
      fullName: null,
      title: null,
      email: null,
      phone: null,
      location: null,
      linkedin: null,
      github: null,
      website: null,
      portfolio: null,
    },
    professionalSummary: '',
    technicalSkills: [],
    workExperience: [],
    education: [],
    projects: [],
    certifications: [],
    achievements: [],
    languages: [],
    additionalSections: [],
  };
}

/** Accepts skills either as flat strings or as {category, skills} groups. */
const normaliseSkills = (value) => {
  if (!value) return [];
  if (Array.isArray(value) && !value.length) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    const skills = strList(value);
    return skills.length ? [{ category: 'Skills', skills }] : [];
  }
  return objList(value)
    .map((group) => ({
      category: str(group.category ?? group.name ?? group.heading) ?? 'Skills',
      skills: strList(group.skills ?? group.items ?? group.values),
    }))
    .filter((group) => group.skills.length > 0);
};

const normaliseExperience = (value) =>
  objList(value).map((role) => ({
    jobTitle: str(role.jobTitle ?? role.title ?? role.position) ?? '',
    company: str(role.company ?? role.employer ?? role.organisation) ?? '',
    location: str(role.location),
    startDate: str(role.startDate ?? role.start),
    endDate: str(role.endDate ?? role.end),
    current: Boolean(role.current) || /present|current/i.test(String(role.endDate ?? '')),
    responsibilities: strList(role.responsibilities ?? role.bullets ?? role.description),
    achievements: strList(role.achievements),
    technologies: strList(role.technologies ?? role.stack ?? role.tools),
  }));

const normaliseEducation = (value) =>
  objList(value).map((entry) => ({
    degree: str(entry.degree ?? entry.qualification ?? entry.course) ?? '',
    institution: str(entry.institution ?? entry.school ?? entry.university) ?? '',
    location: str(entry.location),
    startDate: str(entry.startDate ?? entry.start),
    endDate: str(entry.endDate ?? entry.end ?? entry.year),
    details: strList(entry.details ?? entry.notes ?? entry.description),
  }));

const normaliseProjects = (value) =>
  objList(value).map((project) => ({
    name: str(project.name ?? project.title) ?? '',
    description: str(project.description ?? project.summary) ?? '',
    technologies: strList(project.technologies ?? project.stack),
    link: str(project.link ?? project.url),
    highlights: strList(project.highlights ?? project.bullets),
  }));

const normaliseCertifications = (value) => {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.filter(Boolean).map((name) => ({ name: name.trim(), issuer: null, date: null }));
  }
  return objList(value).map((entry) => ({
    name: str(entry.name ?? entry.title) ?? '',
    issuer: str(entry.issuer ?? entry.organisation ?? entry.authority),
    date: str(entry.date ?? entry.year),
  }));
};

const normaliseAdditional = (value) =>
  objList(value)
    .map((section) => ({
      heading: str(section.heading ?? section.title ?? section.name) ?? 'Additional',
      items: strList(section.items ?? section.content ?? section.bullets),
    }))
    .filter((section) => section.items.length > 0);

/** Coerces arbitrary parser output into the canonical CV shape. */
export function normaliseCv(input = {}) {
  const source = input && typeof input === 'object' ? input : {};

  const personal = source.personalInformation ?? source.personalInfo ?? source.contact ?? {};

  return {
    personalInformation: {
      fullName: str(personal.fullName ?? personal.name),
      title: str(personal.title ?? personal.headline),
      email: str(personal.email),
      phone: str(personal.phone ?? personal.phoneNumber),
      location: str(personal.location ?? personal.address),
      linkedin: str(personal.linkedin ?? personal.linkedIn),
      github: str(personal.github),
      website: str(personal.website ?? personal.site),
      portfolio: str(personal.portfolio),
    },
    professionalSummary: str(source.professionalSummary ?? source.summary ?? source.profile) ?? '',
    technicalSkills: normaliseSkills(source.technicalSkills ?? source.skills),
    workExperience: normaliseExperience(source.workExperience ?? source.experience),
    education: normaliseEducation(source.education),
    projects: normaliseProjects(source.projects),
    certifications: normaliseCertifications(source.certifications),
    achievements: strList(source.achievements),
    languages: strList(source.languages),
    additionalSections: normaliseAdditional(source.additionalSections ?? source.other),
  };
}

/** True when the parse produced too little to be usable. */
export function isCvEmpty(cv) {
  return (
    !cv ||
    (!cv.professionalSummary &&
      cv.workExperience.length === 0 &&
      cv.education.length === 0 &&
      cv.technicalSkills.length === 0 &&
      cv.projects.length === 0)
  );
}

/** Flattens a CV to plain text, used for keyword and evidence checks. */
export function cvToPlainText(cv) {
  if (!cv) return '';
  const parts = [];
  const personal = cv.personalInformation ?? {};
  parts.push(Object.values(personal).filter(Boolean).join(' '));
  parts.push(cv.professionalSummary ?? '');

  for (const group of cv.technicalSkills ?? []) {
    parts.push(`${group.category}: ${group.skills.join(', ')}`);
  }
  for (const role of cv.workExperience ?? []) {
    parts.push(
      [role.jobTitle, role.company, role.location, role.startDate, role.endDate]
        .filter(Boolean)
        .join(' '),
    );
    parts.push(...(role.responsibilities ?? []), ...(role.achievements ?? []));
    parts.push((role.technologies ?? []).join(', '));
  }
  for (const project of cv.projects ?? []) {
    parts.push(project.name, project.description, (project.technologies ?? []).join(', '));
    parts.push(...(project.highlights ?? []));
  }
  for (const entry of cv.education ?? []) {
    parts.push([entry.degree, entry.institution, entry.endDate].filter(Boolean).join(' '));
    parts.push(...(entry.details ?? []));
  }
  for (const cert of cv.certifications ?? []) {
    parts.push([cert.name, cert.issuer, cert.date].filter(Boolean).join(' '));
  }
  parts.push(...(cv.achievements ?? []), ...(cv.languages ?? []));
  for (const section of cv.additionalSections ?? []) {
    parts.push(section.heading, ...(section.items ?? []));
  }

  return parts.filter(Boolean).join('\n');
}
