import { normaliseCv } from '../src/cv/schema.js';

export const sampleCv = () =>
  normaliseCv({
    personalInformation: {
      fullName: 'Ada Lovelace',
      title: 'Backend Engineer',
      email: 'ada@example.com',
      phone: '+44 20 7946 0000',
      location: 'London, UK',
    },
    professionalSummary: 'Backend engineer with six years building Node.js and Express services.',
    technicalSkills: [
      { category: 'Languages', skills: ['JavaScript', 'TypeScript', 'Python'] },
      { category: 'Backend', skills: ['Node.js', 'Express', 'PostgreSQL'] },
      { category: 'Cloud', skills: ['AWS'] },
    ],
    workExperience: [
      {
        jobTitle: 'Senior Backend Engineer',
        company: 'Analytical Ltd',
        location: 'London',
        startDate: 'Jan 2021',
        endDate: 'Present',
        current: true,
        responsibilities: [
          'Built REST APIs with Node.js and Express.',
          'Designed PostgreSQL schemas for analytics workloads.',
        ],
        achievements: ['Reduced p95 latency from 800ms to 210ms.'],
        technologies: ['Node.js', 'Express', 'PostgreSQL', 'AWS'],
      },
    ],
    education: [
      { degree: 'BSc Computer Science', institution: 'University of London', endDate: '2016' },
    ],
    projects: [
      {
        name: 'Scheduler',
        description: 'Distributed task scheduler',
        technologies: ['Go'],
        highlights: ['Processes 10000 jobs per hour.'],
      },
    ],
    certifications: ['AWS Certified Solutions Architect'],
    achievements: ['Speaker at NodeConf 2023'],
    languages: ['English', 'French'],
  });

export const sampleJobText = `Skip to main content
Accept cookies
Senior Backend Engineer
Example Company - Lagos, Nigeria (Hybrid)
Full-time

About the role
We are looking for a Senior Backend Engineer to join our platform team.

Responsibilities
- Design, build and maintain REST APIs using Node.js and Express.
- Model data in PostgreSQL and optimise query performance.
- Deploy services on AWS using Docker and CI/CD pipelines.
- Mentor junior engineers.

Requirements
- 5+ years of professional backend development experience.
- Strong JavaScript and TypeScript skills.
- Production experience with Node.js, Express and PostgreSQL.
- Experience with AWS and containerisation using Docker.
- Understanding of message queues such as Kafka.
- Excellent communication skills.

Nice to have
- Experience with Kubernetes and Terraform.

Privacy policy | Terms of service
People also viewed
Software Engineer at Another Co`;

export const sampleCvText = `Ada Lovelace
Backend Engineer
ada@example.com | +44 20 7946 0000 | https://github.com/ada

PROFESSIONAL SUMMARY
Backend engineer with six years building Node.js services.

TECHNICAL SKILLS
Languages: JavaScript, TypeScript, Python
Backend: Node.js, Express, PostgreSQL

WORK EXPERIENCE
Senior Backend Engineer Jan 2021 - Present
Analytical Ltd
- Built REST APIs with Node.js and Express.
- Designed PostgreSQL schemas for analytics workloads.
Technologies: Node.js, PostgreSQL

Backend Developer Mar 2018 - Dec 2020
Difference Engines
- Maintained Python services.

EDUCATION
BSc Computer Science 2016
University of London

LANGUAGES
English, French`;
