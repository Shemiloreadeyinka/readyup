import { SECTION_LABELS, SECTION_KEYS } from '../cv/schema.js';

/**
 * CV templates.
 *
 * All three are single column and free of graphics, tables and progress bars,
 * because anything else degrades ATS parsing. They differ in typography,
 * spacing and heading treatment only.
 */

export const TEMPLATES = {
  'modern-professional': {
    id: 'modern-professional',
    name: 'Modern Professional',
    description: 'Serif headings, generous spacing. Suits most corporate roles.',
    font: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    baseFontSize: 10.5,
    nameFontSize: 22,
    headingFontSize: 12,
    lineHeight: 1.4,
    margins: { top: 54, right: 54, bottom: 54, left: 54 },
    sectionSpacing: 14,
    headingStyle: 'rule',
    headingCase: 'title',
    accent: '#1e293b',
  },
  'minimal-ats': {
    id: 'minimal-ats',
    name: 'Minimal ATS',
    description: 'Plainest possible layout. Highest parser compatibility.',
    font: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    baseFontSize: 11,
    nameFontSize: 18,
    headingFontSize: 11.5,
    lineHeight: 1.35,
    margins: { top: 50, right: 50, bottom: 50, left: 50 },
    sectionSpacing: 11,
    headingStyle: 'plain',
    headingCase: 'upper',
    accent: '#000000',
  },
  technical: {
    id: 'technical',
    name: 'Technical / Software Engineer',
    description: 'Compact, skills-forward ordering for engineering roles.',
    font: 'Helvetica',
    headingFont: 'Helvetica-Bold',
    baseFontSize: 10,
    nameFontSize: 19,
    headingFontSize: 11,
    lineHeight: 1.32,
    margins: { top: 46, right: 46, bottom: 46, left: 46 },
    sectionSpacing: 10,
    headingStyle: 'rule',
    headingCase: 'upper',
    accent: '#312e81',
    defaultSectionOrder: [
      'professionalSummary',
      'technicalSkills',
      'workExperience',
      'projects',
      'education',
      'certifications',
      'achievements',
      'languages',
      'additionalSections',
    ],
  },
};

export const DEFAULT_TEMPLATE_ID = 'modern-professional';

export const listTemplates = () =>
  Object.values(TEMPLATES).map(({ id, name, description }) => ({ id, name, description }));

/** Merges a template with per-document user customisation. */
export function resolveTemplate(templateId, customisation = {}) {
  const base = TEMPLATES[templateId] ?? TEMPLATES[DEFAULT_TEMPLATE_ID];
  const margins = { ...base.margins, ...(customisation.margins ?? {}) };

  return {
    ...base,
    ...(customisation.font ? { font: customisation.font, headingFont: `${customisation.font}-Bold` } : {}),
    baseFontSize: Number(customisation.fontSize) || base.baseFontSize,
    lineHeight: Number(customisation.lineHeight) || base.lineHeight,
    sectionSpacing: Number(customisation.sectionSpacing) || base.sectionSpacing,
    margins,
  };
}

const formatDateRange = (start, end, current) => {
  const to = current ? 'Present' : end;
  if (start && to) return `${start} - ${to}`;
  return start || to || '';
};

const heading = (template, key) => {
  const label = SECTION_LABELS[key] ?? key;
  return template.headingCase === 'upper' ? label.toUpperCase() : label;
};

/**
 * Converts a structured CV into renderer-agnostic blocks.
 * Every renderer (HTML, PDF, DOCX) consumes this same list, so the three
 * outputs cannot drift apart.
 */
export function buildDocumentBlocks(cv, { sectionOrder, template } = {}) {
  const order = (sectionOrder?.length ? sectionOrder : template?.defaultSectionOrder ?? SECTION_KEYS)
    .filter((key) => SECTION_KEYS.includes(key));
  const blocks = [];
  const personal = cv.personalInformation ?? {};

  blocks.push({ type: 'name', text: personal.fullName || 'Your Name' });
  if (personal.title) blocks.push({ type: 'subtitle', text: personal.title });

  const contact = [
    personal.email,
    personal.phone,
    personal.location,
    personal.linkedin,
    personal.github,
    personal.website || personal.portfolio,
  ].filter(Boolean);
  if (contact.length) blocks.push({ type: 'contact', items: contact });

  const pushSection = (key, content) => {
    if (!content.length) return;
    blocks.push({ type: 'heading', text: heading(template ?? TEMPLATES[DEFAULT_TEMPLATE_ID], key), key });
    blocks.push(...content);
  };

  for (const key of order) {
    if (key === 'professionalSummary' && cv.professionalSummary) {
      pushSection(key, [{ type: 'paragraph', text: cv.professionalSummary }]);
    }

    if (key === 'technicalSkills' && cv.technicalSkills?.length) {
      pushSection(
        key,
        cv.technicalSkills.map((group) => ({
          type: 'labelled',
          label: group.category,
          value: group.skills.join(', '),
        })),
      );
    }

    if (key === 'workExperience' && cv.workExperience?.length) {
      pushSection(
        key,
        cv.workExperience.map((role) => ({
          type: 'entry',
          title: role.jobTitle,
          subtitle: [role.company, role.location].filter(Boolean).join(' - '),
          right: formatDateRange(role.startDate, role.endDate, role.current),
          bullets: [...(role.responsibilities ?? []), ...(role.achievements ?? [])],
          footnote: role.technologies?.length ? `Technologies: ${role.technologies.join(', ')}` : null,
        })),
      );
    }

    if (key === 'projects' && cv.projects?.length) {
      pushSection(
        key,
        cv.projects.map((project) => ({
          type: 'entry',
          title: project.name,
          subtitle: project.description,
          right: '',
          bullets: project.highlights ?? [],
          footnote: project.technologies?.length
            ? `Technologies: ${project.technologies.join(', ')}`
            : null,
          link: project.link ?? null,
        })),
      );
    }

    if (key === 'education' && cv.education?.length) {
      pushSection(
        key,
        cv.education.map((entry) => ({
          type: 'entry',
          title: entry.degree,
          subtitle: [entry.institution, entry.location].filter(Boolean).join(' - '),
          right: formatDateRange(entry.startDate, entry.endDate, false),
          bullets: entry.details ?? [],
          footnote: null,
        })),
      );
    }

    if (key === 'certifications' && cv.certifications?.length) {
      pushSection(key, [
        {
          type: 'bullets',
          items: cv.certifications.map((cert) =>
            [cert.name, cert.issuer, cert.date].filter(Boolean).join(' - '),
          ),
        },
      ]);
    }

    if (key === 'achievements' && cv.achievements?.length) {
      pushSection(key, [{ type: 'bullets', items: cv.achievements }]);
    }

    if (key === 'languages' && cv.languages?.length) {
      pushSection(key, [{ type: 'paragraph', text: cv.languages.join(', ') }]);
    }

    if (key === 'additionalSections' && cv.additionalSections?.length) {
      for (const section of cv.additionalSections) {
        blocks.push({
          type: 'heading',
          text:
            (template ?? TEMPLATES[DEFAULT_TEMPLATE_ID]).headingCase === 'upper'
              ? section.heading.toUpperCase()
              : section.heading,
          key: 'additionalSections',
        });
        blocks.push({ type: 'bullets', items: section.items });
      }
    }
  }

  return blocks;
}
