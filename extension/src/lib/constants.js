/** Shared constants for the popup and the background worker. */

export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787';

export const STORAGE_KEYS = {
  backendUrl: 'cvTailor.backendUrl',
  selectedCvId: 'cvTailor.selectedCvId',
  selectedTemplate: 'cvTailor.selectedTemplate',
  tailorState: 'cvTailor.tailorState',
  lastScan: 'cvTailor.lastScan',
};

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

export const MATCH_STATUS = {
  strong: { label: 'Strong match', tone: 'success' },
  partial: { label: 'Partial match', tone: 'warning' },
  missing: { label: 'Not demonstrated', tone: 'error' },
};
