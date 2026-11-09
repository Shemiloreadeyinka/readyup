/**
 * Page fixtures mirroring the DOM shapes of the job boards the scanner
 * targets. They are hand-built from each platform's published markup
 * conventions so the extractor can be tested without scraping live sites.
 */

const RESPONSIBILITIES = [
  'Design, build and maintain REST APIs using Node.js and Express.',
  'Model data in PostgreSQL and optimise query performance.',
  'Deploy and operate services on AWS using Docker and CI/CD pipelines.',
  'Collaborate with product managers and mentor junior engineers.',
];

const REQUIREMENTS = [
  '5+ years of professional backend development experience.',
  'Strong JavaScript and TypeScript skills.',
  'Production experience with Node.js, Express and PostgreSQL.',
  'Experience with AWS and containerisation using Docker.',
  'Understanding of distributed systems and message queues such as Kafka.',
  'Excellent communication and collaboration skills.',
];

const list = (items) => items.map((item) => `<li>${item}</li>`).join('');

export const DESCRIPTION_HTML = `
  <h2>About the role</h2>
  <p>We are looking for a Senior Backend Engineer to join our platform team.
     You will build and operate the services that power our product.</p>
  <h2>Responsibilities</h2>
  <ul>${list(RESPONSIBILITIES)}</ul>
  <h2>Requirements</h2>
  <ul>${list(REQUIREMENTS)}</ul>
  <h2>Nice to have</h2>
  <ul><li>Experience with Kubernetes and Terraform.</li><li>Exposure to GraphQL.</li></ul>
  <h2>Benefits</h2>
  <ul><li>Health insurance</li><li>Learning budget</li></ul>
`;

/** Chrome that must never end up in the extracted description. */
const NOISE_HEADER = `
  <a href="#main">Skip to main content</a>
  <div class="cookie-banner">We use cookies to improve your experience. Accept cookies</div>
  <nav><a href="/">Home</a><a href="/jobs">Jobs</a><a href="/about">About</a><a href="/login">Sign in</a></nav>
`;

const NOISE_FOOTER = `
  <aside class="similar-jobs">
    <h3>People also viewed</h3>
    <ul>
      <li><a href="/j/2">Software Engineer at Another Co</a></li>
      <li><a href="/j/3">Platform Engineer at Third Co</a></li>
    </ul>
  </aside>
  <footer>
    <a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a>
    <p>© 2026 Example Company. All rights reserved.</p>
  </footer>
`;

const page = (title, body) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

export const JSON_LD_POSTING = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Senior Backend Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Example Company' },
  jobLocation: {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Lagos',
      addressCountry: 'Nigeria',
    },
  },
  employmentType: 'FULL_TIME',
  datePosted: '2026-10-01',
  description: DESCRIPTION_HTML,
};

export const fixtures = {
  /** A company career page that publishes JSON-LD. */
  structuredData: {
    url: 'https://careers.example.com/jobs/senior-backend-engineer',
    html: page(
      'Senior Backend Engineer | Example Company',
      `${NOISE_HEADER}
       <script type="application/ld+json">${JSON.stringify(JSON_LD_POSTING)}</script>
       <main><h1>Senior Backend Engineer</h1><div class="jd">${DESCRIPTION_HTML}</div></main>
       ${NOISE_FOOTER}`,
    ),
  },

  linkedin: {
    url: 'https://www.linkedin.com/jobs/view/4123456789/',
    html: page(
      'Example Company hiring Senior Backend Engineer in Lagos | LinkedIn',
      `${NOISE_HEADER}
       <div class="job-details-jobs-unified-top-card__job-title"><h1>Senior Backend Engineer</h1></div>
       <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/x">Example Company</a></div>
       <span class="job-details-jobs-unified-top-card__bullet">Lagos, Nigeria (Hybrid)</span>
       <div id="job-details"><div class="jobs-description__content">${DESCRIPTION_HTML}</div></div>
       ${NOISE_FOOTER}`,
    ),
  },

  indeed: {
    url: 'https://www.indeed.com/viewjob?jk=abc123',
    html: page(
      'Senior Backend Engineer - Example Company | Indeed.com',
      `${NOISE_HEADER}
       <div class="jobsearch-JobInfoHeader-title"><h1>Senior Backend Engineer</h1></div>
       <div data-company-name="true">Example Company</div>
       <div data-testid="job-location">Lagos, Nigeria</div>
       <div id="jobDescriptionText">${DESCRIPTION_HTML}</div>
       ${NOISE_FOOTER}`,
    ),
  },

  greenhouse: {
    url: 'https://boards.greenhouse.io/examplecompany/jobs/5566778',
    html: page(
      'Example Company - Senior Backend Engineer',
      `${NOISE_HEADER}
       <div id="header"><span class="company-name">Example Company</span></div>
       <h1 class="app-title">Senior Backend Engineer</h1>
       <div class="location">Lagos, Nigeria</div>
       <div id="content">${DESCRIPTION_HTML}</div>
       ${NOISE_FOOTER}`,
    ),
  },

  lever: {
    url: 'https://jobs.lever.co/examplecompany/8899aabb',
    html: page(
      'Example Company - Senior Backend Engineer',
      `${NOISE_HEADER}
       <div class="posting-headline"><h2>Senior Backend Engineer</h2>
         <div class="posting-categories"><span class="location">Lagos, Nigeria</span></div>
       </div>
       <div class="section-wrapper page-full-width">${DESCRIPTION_HTML}</div>
       ${NOISE_FOOTER}`,
    ),
  },

  /** A Nigerian board with no special markup: tests the generic path. */
  jobberman: {
    url: 'https://www.jobberman.com/listings/senior-backend-engineer-abc123',
    html: page(
      'Senior Backend Engineer at Example Company | Jobberman',
      `${NOISE_HEADER}
       <h1>Senior Backend Engineer</h1>
       <div class="company-name">Example Company</div>
       <article class="job-description">${DESCRIPTION_HTML}</article>
       ${NOISE_FOOTER}`,
    ),
  },

  /** No platform, no metadata, nested markup: the semantic fallback. */
  genericCareerPage: {
    url: 'https://example.io/careers/backend-engineer',
    html: page(
      'Senior Backend Engineer - Careers at Example Company',
      `${NOISE_HEADER}
       <div class="wrapper">
         <div class="sidebar"><h3>Open roles</h3><ul><li><a href="/a">Role A</a></li><li><a href="/b">Role B</a></li></ul></div>
         <section class="content"><h1>Senior Backend Engineer</h1>${DESCRIPTION_HTML}</section>
       </div>
       ${NOISE_FOOTER}`,
    ),
  },

  /** Hidden content must be ignored, visible content kept. */
  hiddenContent: {
    url: 'https://example.io/careers/backend-engineer',
    html: page(
      'Senior Backend Engineer',
      `<main>
         <div style="display:none">SECRET TRACKING PIXEL CONTENT that should never be extracted.</div>
         <div aria-hidden="true">Duplicate hidden navigation block</div>
         <article>${DESCRIPTION_HTML}</article>
       </main>`,
    ),
  },

  /** Not a job listing: the scanner must say so rather than guess. */
  blogPost: {
    url: 'https://example.com/blog/how-we-scaled-postgres',
    html: page(
      'How we scaled PostgreSQL | Example Blog',
      `${NOISE_HEADER}
       <article>
         <h1>How we scaled PostgreSQL to 2 million queries per second</h1>
         <p>${'Our database journey began with a single primary node. '.repeat(30)}</p>
       </article>
       ${NOISE_FOOTER}`,
    ),
  },

  /** An almost-empty shell, as seen before client-side rendering finishes. */
  emptyShell: {
    url: 'https://example.com/jobs/1',
    html: page('Loading…', '<div id="root"></div>'),
  },
};

export default fixtures;
