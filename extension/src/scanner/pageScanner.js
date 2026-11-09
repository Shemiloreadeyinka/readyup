/**
 * Universal job description scanner.
 *
 * This whole module is one self-contained function because it is injected into
 * the active tab with chrome.scripting.executeScript({ func }). It therefore
 * cannot reference anything outside its own body: every helper lives inside.
 *
 * Extraction is layered, best source first:
 *   Layer 1  JSON-LD JobPosting / microdata  (structured, most reliable)
 *   Layer 2  platform-specific selectors     (LinkedIn, Indeed, Greenhouse, ...)
 *   Layer 3  semantic DOM scoring            (article/main/role=main, density)
 *   Layer 4  cleaned body text               (last resort)
 *
 * It only ever reads the DOM the browser already rendered for the user. It
 * does not touch authentication, bypass paywalls, or request anything.
 */
export function scanJobPage() {
  /* ----------------------------- utilities ------------------------------ */

  const NOISE_PATTERNS = [
    /^(accept|manage|allow)\s+(all\s+)?cookies/i,
    /^we use cookies/i,
    /^this (site|website) uses cookies/i,
    /^(sign|log)\s?in\b/i,
    /^(sign|register)\s?up\b/i,
    /^create (an )?account/i,
    /^(skip to|jump to) (main )?content/i,
    /^(share|save|report) (this )?job\b/i,
    /^(apply now|easy apply|quick apply|apply for this job)$/i,
    /^(back to|view all|see all|browse) (jobs|results|search)/i,
    /^(people also viewed|similar jobs|recommended for you|more jobs at|jobs you may be interested in)/i,
    /^\d+\s+(applicants?|views?)$/i,
    /^(privacy policy|terms (of|and) (use|service|conditions)|cookie policy|all rights reserved)/i,
    /^(©|copyright)\s/i,
    /^(home|about|contact|careers|blog|pricing|login|menu|search)$/i,
    /^(facebook|twitter|linkedin|instagram|youtube|tiktok)$/i,
    /^advertisement$/i,
    /^loading\b/i,
  ];

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME', 'TEMPLATE',
    'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SELECT', 'INPUT',
  ]);

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'TABLE', 'TR', 'BR', 'HR', 'BLOCKQUOTE', 'PRE', 'MAIN',
  ]);

  const JOB_TERMS = [
    'responsibilities', 'requirements', 'qualifications', 'experience',
    'skills', 'what you will do', "what you'll do", 'about the role',
    'who you are', 'benefits', 'we are looking for', 'job description',
    'preferred', 'nice to have', 'your role', 'about the job', 'salary',
  ];

  const clean = (text) =>
    String(text ?? '')
      .replace(/ /g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();

  const isNoiseLine = (line) =>
    !line || line.length <= 2 || NOISE_PATTERNS.some((pattern) => pattern.test(line));

  const stripNoise = (text) => {
    const seen = new Map();
    const kept = [];
    for (const line of clean(text).split('\n')) {
      if (isNoiseLine(line)) continue;
      const key = line.toLowerCase();
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > 1 && line.length < 80) continue;
      kept.push(line);
    }
    return kept.join('\n');
  };

  const isVisible = (element) => {
    if (!element || !element.isConnected) return false;
    if (element.getAttribute?.('aria-hidden') === 'true') return false;

    // checkVisibility accounts for hidden ancestors, which a computed-style
    // check on the element alone cannot do.
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }

    const style = window.getComputedStyle?.(element);
    if (!style) return true;
    return !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
  };

  /** innerText where available, textContent otherwise. */
  const nodeText = (node) => (node?.innerText ?? node?.textContent ?? '').trim();

  /** Converts an element subtree to text, keeping block and list structure. */
  const elementToText = (root) => {
    if (!root) return '';
    const parts = [];

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent.replace(/\s+/g, ' ');
        if (value.trim()) parts.push(value);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (SKIP_TAGS.has(node.tagName)) return;
      if (!isVisible(node)) return;

      const isListItem = node.tagName === 'LI';
      if (BLOCK_TAGS.has(node.tagName) || isListItem) parts.push('\n');
      if (isListItem) parts.push('- ');

      for (const child of node.childNodes) walk(child);

      if (BLOCK_TAGS.has(node.tagName) || isListItem) parts.push('\n');
    };

    walk(root);
    return clean(parts.join(''));
  };

  const textLength = (element) => nodeText(element).length;

  const countJobTerms = (text) => {
    const lower = text.toLowerCase();
    return JOB_TERMS.filter((term) => lower.includes(term)).length;
  };

  /* ------------------- Layer 1: structured metadata ---------------------- */

  const flattenJsonLd = (value, found) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) flattenJsonLd(item, found);
      return;
    }
    const type = value['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes('JobPosting')) found.push(value);
    if (value['@graph']) flattenJsonLd(value['@graph'], found);
  };

  const htmlToText = (html) => {
    if (!html) return '';
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent.replace(/\s+/g, ' '));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const isListItem = node.tagName === 'LI';
      if (BLOCK_TAGS.has(node.tagName) || isListItem) parts.push('\n');
      if (isListItem) parts.push('- ');
      for (const child of node.childNodes) walk(child);
      if (BLOCK_TAGS.has(node.tagName) || isListItem) parts.push('\n');
    };
    for (const child of holder.childNodes) walk(child);
    return clean(parts.join(''));
  };

  const readJsonLd = () => {
    const found = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        flattenJsonLd(JSON.parse(script.textContent), found);
      } catch {
        /* a malformed block on the page is not our problem */
      }
    }
    if (!found.length) return null;

    const posting = found[0];
    const locationOf = (value) => {
      const address = value?.jobLocation?.address ?? value?.jobLocation?.[0]?.address;
      if (!address) return value?.jobLocation?.name ?? null;
      return (
        [address.addressLocality, address.addressRegion, address.addressCountry]
          .filter((part) => typeof part === 'string')
          .join(', ') || null
      );
    };

    return {
      jobTitle: typeof posting.title === 'string' ? posting.title : null,
      company:
        posting.hiringOrganization?.name ??
        (typeof posting.hiringOrganization === 'string' ? posting.hiringOrganization : null),
      location: locationOf(posting),
      employmentType: Array.isArray(posting.employmentType)
        ? posting.employmentType.join(', ')
        : (posting.employmentType ?? null),
      datePosted: posting.datePosted ?? null,
      description: htmlToText(posting.description),
    };
  };

  /** Microdata fallback for pages using itemprop instead of JSON-LD. */
  const readMicrodata = () => {
    const scope = document.querySelector('[itemtype*="JobPosting" i]');
    if (!scope) return null;
    const prop = (name) => {
      const node = scope.querySelector(`[itemprop="${name}"]`);
      if (!node) return null;
      return (node.getAttribute('content') ?? node.textContent ?? '').trim() || null;
    };
    const descriptionNode = scope.querySelector('[itemprop="description"]');
    return {
      jobTitle: prop('title'),
      company: prop('hiringOrganization') ?? prop('name'),
      location: prop('jobLocation') ?? prop('addressLocality'),
      employmentType: prop('employmentType'),
      description: descriptionNode ? elementToText(descriptionNode) : '',
    };
  };

  /* ------------------ Layer 2: platform-specific rules ------------------- */

  const PLATFORMS = [
    {
      id: 'linkedin',
      name: 'LinkedIn',
      match: /(^|\.)linkedin\.com$/i,
      description: [
        '.jobs-description__content',
        '.jobs-box__html-content',
        '.show-more-less-html__markup',
        '.description__text',
        '#job-details',
      ],
      title: ['.job-details-jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'],
      company: [
        '.job-details-jobs-unified-top-card__company-name',
        '.topcard__org-name-link',
        '.topcard__flavor',
      ],
      location: [
        '.job-details-jobs-unified-top-card__bullet',
        '.topcard__flavor--bullet',
      ],
    },
    {
      id: 'indeed',
      name: 'Indeed',
      match: /(^|\.)indeed\.(com|co\.\w+|[a-z]{2})$/i,
      description: ['#jobDescriptionText', '.jobsearch-JobComponent-description'],
      title: ['.jobsearch-JobInfoHeader-title', 'h1.icl-u-xs-mb--xs', 'h1'],
      company: ['[data-company-name]', '.jobsearch-CompanyInfoWithoutHeaderImage div a', '.jobsearch-InlineCompanyRating div'],
      location: ['[data-testid="job-location"]', '.jobsearch-JobInfoHeader-subtitle div:last-child'],
    },
    {
      id: 'greenhouse',
      name: 'Greenhouse',
      match: /(^|\.)(greenhouse\.io|boards\.greenhouse\.io)$/i,
      description: ['#content', '.job__description', '.content'],
      title: ['.app-title', 'h1.section-header', 'h1'],
      company: ['.company-name', '#header .company-name'],
      location: ['.location', '.job__location'],
    },
    {
      id: 'lever',
      name: 'Lever',
      match: /(^|\.)(lever\.co|jobs\.lever\.co)$/i,
      description: ['.section-wrapper.page-full-width', '.posting-page', '[data-qa="job-description"]'],
      title: ['.posting-headline h2', 'h2'],
      company: ['.main-header-logo img', '.posting-headline .sort-by-time'],
      location: ['.posting-categories .location', '.sort-by-time'],
    },
    {
      id: 'workday',
      name: 'Workday',
      match: /myworkdayjobs\.com$/i,
      description: ['[data-automation-id="jobPostingDescription"]', '[data-automation-id="job-posting-details"]'],
      title: ['[data-automation-id="jobPostingHeader"]', 'h1'],
      company: ['[data-automation-id="company"]'],
      location: ['[data-automation-id="locations"]', '[data-automation-id="jobPostingLocation"]'],
    },
    {
      id: 'glassdoor',
      name: 'Glassdoor',
      match: /(^|\.)glassdoor\.(com|co\.\w+|[a-z]{2})$/i,
      description: ['.JobDetails_jobDescription__*', '#JobDescriptionContainer', '.desc'],
      title: ['[data-test="job-title"]', 'h1'],
      company: ['[data-test="employer-name"]'],
      location: ['[data-test="location"]'],
    },
    {
      id: 'jobberman',
      name: 'Jobberman',
      match: /(^|\.)jobberman\.com(\.\w+)?$/i,
      description: ['.job-description', 'article', '[class*="description"]'],
      title: ['h1', '.job-title'],
      company: ['[class*="company"] a', '.company-name'],
      location: ['[class*="location"]'],
    },
    {
      id: 'wellfound',
      name: 'Wellfound',
      match: /(^|\.)(wellfound\.com|angel\.co)$/i,
      description: ['[data-test="JobDescription"]', '.job-description', 'article'],
      title: ['[data-test="JobTitle"]', 'h1'],
      company: ['[data-test="StartupTitle"]', 'h2 a'],
      location: ['[data-test="JobLocation"]'],
    },
    {
      id: 'smartrecruiters',
      name: 'SmartRecruiters',
      match: /(^|\.)smartrecruiters\.com$/i,
      description: ['.job-sections', '#st-jobDescription', '.jobad-main'],
      title: ['.job-title', 'h1'],
      company: ['.company-name'],
      location: ['#st-location', '.job-location'],
    },
    {
      id: 'workable',
      name: 'Workable',
      match: /(^|\.)(workable\.com|apply\.workable\.com)$/i,
      description: ['[data-ui="job-description"]', '#jobsection', 'section[data-ui="job-description"]'],
      title: ['[data-ui="job-title"]', 'h1'],
      company: ['[data-ui="company-name"]'],
      location: ['[data-ui="job-location"]'],
    },
  ];

  const firstMatch = (selectors) => {
    for (const selector of selectors ?? []) {
      // Wildcard selectors cover hashed CSS-module class names.
      if (selector.includes('__*')) {
        const prefix = selector.replace('__*', '');
        const attribute = prefix.replace(/^\./, '');
        const node = document.querySelector(`[class*="${attribute}"]`);
        if (node && isVisible(node)) return node;
        continue;
      }
      try {
        const node = document.querySelector(selector);
        if (node && isVisible(node) && textLength(node) > 0) return node;
      } catch {
        /* invalid selector for this page */
      }
    }
    return null;
  };

  const detectPlatform = () =>
    PLATFORMS.find((platform) => platform.match.test(window.location.hostname)) ?? null;

  /* -------------------- Layer 3: semantic DOM scoring -------------------- */

  const CANDIDATE_SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '[class*="job-description" i]',
    '[class*="jobdescription" i]',
    '[id*="job-description" i]',
    '[id*="jobdescription" i]',
    '[class*="job-details" i]',
    '[class*="description" i]',
    '[class*="posting" i]',
    '[class*="vacancy" i]',
    '[id*="description" i]',
    'section',
    '.content',
    '#content',
  ];

  const scoreCandidate = (element) => {
    const text = nodeText(element);
    const length = text.trim().length;
    if (length < 250) return 0;

    const terms = countJobTerms(text);
    const links = element.querySelectorAll('a').length;
    const listItems = element.querySelectorAll('li').length;

    // Link-dense blocks are navigation or job lists, not a description.
    const linkDensity = links / Math.max(1, length / 500);

    let score = Math.min(length, 12000) / 100;
    score += terms * 25;
    score += Math.min(listItems, 25) * 2;
    score -= linkDensity * 30;
    if (element.tagName === 'ARTICLE' || element.getAttribute('role') === 'main') score += 20;
    if (/footer|nav|sidebar|related|similar|recommend/i.test(element.className)) score -= 60;

    return score;
  };

  const findBestBlock = () => {
    const seen = new Set();
    let best = null;
    let bestScore = 0;

    for (const selector of CANDIDATE_SELECTORS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const node of nodes) {
        if (seen.has(node) || !isVisible(node)) continue;
        seen.add(node);
        const score = scoreCandidate(node);
        if (score > bestScore) {
          bestScore = score;
          best = node;
        }
      }
    }
    return { element: best, score: bestScore };
  };

  /* --------------------------- page metadata ----------------------------- */

  const metaContent = (name) => {
    const node =
      document.querySelector(`meta[property="${name}"]`) ??
      document.querySelector(`meta[name="${name}"]`);
    return node?.getAttribute('content')?.trim() || null;
  };

  const siteName = () => {
    const fromMeta = metaContent('og:site_name');
    if (fromMeta) return fromMeta;
    const platform = detectPlatform();
    if (platform) return platform.name;
    const host = window.location.hostname.replace(/^www\./, '');
    return host.charAt(0).toUpperCase() + host.slice(1);
  };

  const guessTitleFromPage = () => {
    const heading = document.querySelector('h1');
    if (heading && textLength(heading) > 2 && textLength(heading) < 160) {
      return nodeText(heading);
    }
    const ogTitle = metaContent('og:title');
    if (ogTitle) return ogTitle;
    return document.title?.split(/[|\-–—]/)[0]?.trim() || null;
  };

  /**
   * Company name of last resort, read from the page title.
   * Titles follow a handful of conventions: "Company hiring Role",
   * "Role at Company", "Company - Role" and "Role | Company".
   */
  const guessCompanyFromPage = (jobTitle) => {
    const fromMeta = metaContent('og:site_name') ?? metaContent('application-name');
    if (fromMeta) return fromMeta;

    const title = document.title ?? '';
    const hiring = title.match(/^(.+?)\s+hiring\b/i);
    if (hiring) return hiring[1].trim();

    const at = title.match(/\bat\s+([^|•·–—]+?)(?:\s*[|•·–—]|$)/i);
    if (at) return at[1].trim();

    const parts = title
      .split(/\s*[|•·]\s*|\s+[-–—]\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (jobTitle) {
      const normalisedTitle = jobTitle.toLowerCase();
      const other = parts.find(
        (part) =>
          !normalisedTitle.includes(part.toLowerCase()) &&
          !part.toLowerCase().includes(normalisedTitle) &&
          !/^(careers?|jobs?|hiring|home)$/i.test(part) &&
          part.length > 2,
      );
      if (other) return other;
    }

    return null;
  };

  /** Is this page plausibly a single job listing? */
  const assessJobLikelihood = (description, structured) => {
    let score = 0;
    const reasons = [];

    if (structured) {
      score += 60;
      reasons.push('The page publishes JobPosting metadata.');
    }
    if (detectPlatform()) {
      score += 15;
      reasons.push(`Recognised job platform: ${detectPlatform().name}.`);
    }
    if (/\/(jobs?|careers?|vacanc(y|ies)|position|opening|apply|hiring)([/?#]|$)/i.test(window.location.pathname)) {
      score += 15;
      reasons.push('The URL looks like a job listing.');
    }

    const terms = countJobTerms(description);
    if (terms >= 3) {
      score += 25;
      reasons.push(`Found ${terms} job description sections.`);
    } else if (terms >= 1) {
      score += 10;
      reasons.push('Found some job description wording.');
    }

    if (description.length > 800) score += 10;
    else if (description.length < 300) {
      score -= 25;
      reasons.push('Very little description text was found.');
    }

    return { score: Math.max(0, Math.min(100, score)), reasons };
  };

  /* ----------------------------- the scan -------------------------------- */

  const structured = readJsonLd() ?? readMicrodata();
  const platform = detectPlatform();

  let description = '';
  let method = 'none';

  if (structured?.description && structured.description.length > 300) {
    description = structured.description;
    method = 'structured-data';
  }

  if (!description && platform) {
    const node = firstMatch(platform.description);
    if (node) {
      description = elementToText(node);
      method = `platform:${platform.id}`;
    }
  }

  if (description.length < 300) {
    const { element, score } = findBestBlock();
    if (element && score > 0) {
      const text = elementToText(element);
      if (text.length > description.length) {
        description = text;
        method = 'semantic-dom';
      }
    }
  }

  if (description.length < 300) {
    const body = elementToText(document.body);
    if (body.length > description.length) {
      description = body;
      method = 'body-text';
    }
  }

  description = stripNoise(description);

  const jobTitle =
    structured?.jobTitle ??
    (platform ? nodeText(firstMatch(platform.title)) || null : null) ??
    guessTitleFromPage();

  const company =
    structured?.company ??
    (platform ? nodeText(firstMatch(platform.company)) || null : null) ??
    guessCompanyFromPage(jobTitle);

  const location =
    structured?.location ?? (platform ? nodeText(firstMatch(platform.location)) || null : null);

  const { score, reasons } = assessJobLikelihood(description, Boolean(structured));

  return {
    ok: description.length >= 200,
    url: window.location.href,
    pageTitle: document.title,
    site: siteName(),
    platform: platform?.id ?? null,
    jobTitle: jobTitle || null,
    company: company || null,
    location: location || null,
    employmentType: structured?.employmentType ?? null,
    description,
    characterCount: description.length,
    method,
    confidence: score,
    reasons,
    scannedAt: new Date().toISOString(),
  };
}

export default scanJobPage;
