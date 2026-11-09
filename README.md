# CV Tailor

A Chrome extension that reads the job listing you are looking at, compares it against your CV, and generates a tailored, ATS-friendly CV you can download as PDF or DOCX.

Everything runs on your machine. The default AI provider is a local Ollama model, so no API key and no subscription is required. Cloud providers are optional and never used without your explicit consent.

---

## What it does

1. You upload your CV once (PDF, DOCX or plain text).
2. You open any job listing and click the extension.
3. It scans the page and extracts the job title, company and requirements.
4. It compares those requirements against your CV, citing evidence for every match.
5. It rewrites your CV for that specific job, without inventing anything.
6. You review, edit, preview and download the result.
7. Every tailored version is kept in history and never overwritten.

---

## Requirements

- **Node.js 18.17 or newer** (tested on Node 26).
- **Google Chrome** (or any Chromium browser that loads Manifest V3 extensions).
- **Ollama** for local AI — optional but recommended. Without any AI provider the extension still uploads CVs, scans job pages and runs keyword-based analysis; only the rewriting step needs a model.

---

## Setup

### 1. Install dependencies

```bash
cd backend
npm install

cd ../extension
npm install
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

The defaults work as-is for local Ollama. Everything in `.env` is optional; see [Configuration](#configuration).

### 3. Install a local model (recommended)

```bash
# Install Ollama from https://ollama.com, then:
ollama pull llama3.1:8b
ollama serve          # usually already running as a service
```

Any instruction-following model works. `llama3.1:8b` and `qwen2.5:7b` are good defaults; larger models produce noticeably better rewriting.

### 4. Start the backend

```bash
cd backend
npm start           # or: npm run dev   (restarts on file changes)
```

It listens on `http://127.0.0.1:8787`, bound to loopback only.

### 5. Build and load the extension

```bash
cd extension
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select `extension/.output/chrome-mv3`.

For development with hot reload, run `npm run dev` instead — WXT opens a browser with the extension already loaded.

---

## Using it

1. Click the CV Tailor icon. The **Dashboard** shows the page you are on.
2. Go to **My CV** and upload your CV. The first one becomes your default.
3. Open a job listing and press **Scan job page**. Review what was extracted — you can edit the title, company and description before continuing. If a site cannot be scanned, use **Paste** instead.
4. Press **Analyse & tailor CV**. You can close the popup; the run continues in the background.
5. The result opens on three tabs:
   - **Analysis** — match score, per-requirement evidence, gaps and recommendations.
   - **Edit** — the structured CV, editable field by field, with section reordering.
   - **Preview** — live rendering, template and typography options, PDF/DOCX download.
6. Everything you generate is listed under **Tailored**.

---

## Configuration

All settings live in `backend/.env`. None are required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Backend port. |
| `DEFAULT_AI_PROVIDER` | `ollama` | `ollama`, `openai` or `anthropic`. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Local Ollama endpoint. |
| `OLLAMA_MODEL` | `llama3.1:8b` | Default local model. Also settable in AI Settings. |
| `OLLAMA_NUM_CTX` | `8192` | Context window in tokens. Bigger handles longer CVs but costs RAM. |
| `OPENAI_API_KEY` | empty | Optional. Also settable from AI Settings. |
| `OPENAI_MODEL` | `gpt-4o-mini` | |
| `ANTHROPIC_API_KEY` | empty | Optional. Also settable from AI Settings. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | |
| `MAX_UPLOAD_MB` | `8` | CV upload size limit. |
| `MAX_BODY_MB` | `2` | JSON request size limit. |
| `AI_TIMEOUT_MS` | `180000` | Raise this if a local model times out on long CVs. |
| `ALLOWED_ORIGINS` | empty | Extra non-extension origins allowed through CORS. |
| `ALLOWED_EXTENSION_IDS` | empty | Restrict access to specific extension ids. |
| `DATA_DIR` | `./data` | Where CVs and tailored versions are stored. |

API keys are read and used by the backend only. They are never sent to the extension; the extension is told whether a key exists, nothing more.

---

## Architecture

```
Chrome extension (WXT + React + Tailwind)
   popup  ──────────────► local REST API ──────► application services
   background worker                                     │
      │ scanner injection                        AI provider interface
      │ long-running tailoring                            │
      ▼                              ┌──────────┬─────────┴────────┐
   active tab DOM                  OpenAI    Anthropic          Ollama
```

```
backend/src
├── ai/            provider interface + OpenAI, Anthropic and Ollama implementations
├── cv/            text extraction, structured parsing, truthfulness guard
├── job/           job description cleaning and keyword analysis
├── pipeline/      the five analysis stages and the match score
├── documents/     templates and the HTML, PDF and DOCX renderers
├── routes/        REST endpoints
└── store/         local JSON persistence

extension/src
├── scanner/       the injected page scanner
├── lib/           API client, storage, shared state
├── components/    UI primitives and the analysis, editor and preview views
└── pages/         Dashboard, My CV, Tailored, AI Settings
```

### The AI provider interface

Every provider extends `AiProvider` and implements only transport: `chat()`, `testConnection()`, `listModels()`. The five analysis methods — `analyseJob`, `analyseCV`, `compareCVWithJob`, `tailorCV`, `generateSuggestions` — are shared, so switching providers cannot change the tailoring logic. Adding a provider means adding one class and one entry in `src/ai/index.js`.

### The five-stage pipeline

| Stage | What it does | If the model fails |
| --- | --- | --- |
| 1. Job analysis | Structured requirements, ATS keywords | Falls back to keyword analysis |
| 2. CV analysis | Structured CV | Falls back to the built-in parser |
| 3. Comparison | Evidence-backed matches | Falls back to deterministic matching |
| 4. Tailoring | The rewritten CV | Fails with a clear message — this stage needs a model |
| 5. Recommendations | Coaching suggestions | Skipped; the CV is still produced |

### The match score

The score is **recomputed by the backend** from the individual match statuses, never taken from the model. Strong matches count fully, partial matches count half, required technologies count double. Every point traces back to a requirement, the same inputs always give the same number, and the UI states plainly that it measures evidence of alignment with the posting — not a probability of being hired.

### Truthfulness

Prompting alone is not a guarantee, so `backend/src/cv/factCheck.js` checks every tailored CV against the original before it is shown:

- Contact details, employer names, job titles and dates are **restored** from the original CV if the model changed them.
- Education and certifications are copied across unchanged.
- Skills the original CV never mentions are **removed**.
- Numbers that do not appear in the original are **flagged for your review** rather than silently kept.
- Roles with no counterpart in the original are flagged as unverified.

Where a metric would genuinely strengthen the CV, the model is instructed to ask you for it. Those questions appear under *Questions from the analysis*.

---

## Testing

```bash
cd backend && npm test        # 117 tests
cd extension && npm test      # 44 tests (builds first, then asserts on the artifact)
```

What is covered:

- **Job extraction** — scanner tests run against DOM fixtures for LinkedIn, Indeed, Greenhouse, Lever, Jobberman, a JSON-LD career page and a generic page, asserting that requirements are captured and that cookie banners, navigation, "people also viewed" and footers are not. A blog post and an unrendered page shell must be reported as *not* job listings.
- **CV extraction** — PDF and DOCX are generated, extracted and re-parsed, asserting that names, emails, employers, dates and skills survive the round trip. Scanned-image PDFs and unsupported files are rejected with readable messages.
- **AI provider switching** — all three providers expose the same interface; switching providers changes only the transport; cloud providers are blocked without consent; unknown providers are rejected.
- **Cloud detection** — Ollama `-cloud` model names and non-loopback server URLs are classified as cloud and gated by consent, including when passed as a per-request override; loopback URLs and ordinary model names are not. Context-window overflow warns once and reaches the user rather than only the log.
- **AI response validation** — malformed model output (code fences, prose wrappers, trailing commas, braces inside strings) is parsed or rejected with a useful error; loose field names and out-of-range scores are normalised.
- **CV–job comparison** — evidence citation, reproducible scores, and the 0% and 100% boundaries.
- **Truthfulness** — altered employers, changed contact details, invented metrics, invented skills and invented roles are each corrected or flagged.
- **CV generation** — all three templates render valid PDF, DOCX and HTML; user content is escaped; custom section order and typography are honoured.
- **Extension ↔ backend contract** — upload, list, edit, default, delete, analyse, tailor, preview, download and history over real HTTP with a `chrome-extension://` origin, including CORS rejection of other origins.
- **The built artifact** — the shipped bundle is checked for the correct JSX runtime and no free global `React` (a classic-runtime build compiles cleanly but dies at render), that the manifest requests no broad host access or auto-injected content script, and that the scanner survives bundling as a self-contained function.
- **End to end** — a stub server speaking the Ollama wire protocol drives the complete flow: upload, analyse, tailor, edit, download both formats, and read back history, asserting that the original CV is never modified and that a second run creates a new version rather than replacing the first.

### Testing against real job sites

Automated tests use fixtures. To check a live site:

1. Start the backend and load the extension.
2. Open a listing on LinkedIn, Indeed, Jobberman, Greenhouse, Lever or a company career page.
3. Click the extension, press **Scan job page** and expand **Review extracted description**.
4. Confirm the requirements are present and that site chrome is not.

If a site renders its description late, wait for the page to finish loading and press **Rescan**. If a site blocks extension access entirely, the **Paste** path always works.

---

## Privacy and security

- The backend binds to `127.0.0.1` only and accepts requests from Chrome extension origins (narrowable with `ALLOWED_EXTENSION_IDS`) plus any origin you list in `ALLOWED_ORIGINS`.
- The extension requests `activeTab` rather than access to all sites: it can only read a page after you click the extension on it.
- Its only declared host permissions are `127.0.0.1` and `localhost`. It cannot talk to any remote server.
- API keys live in the backend. The extension only ever learns whether a key is configured.
- No CV content reaches a cloud provider until you turn on **Allow cloud processing** in AI Settings. Requests made before that are refused by the backend, not just hidden in the UI.
- **"Local" is judged by where inference happens, not by the provider's name.** An Ollama Cloud model (any name ending `-cloud`) is proxied by the local daemon to ollama.com, and an Ollama server on another host is reached over the network. Both are treated as cloud: same consent requirement, same "Cloud" badge, and the error names the specific reason. A `localhost` URL on its own is never taken as proof that data stayed put.
- Uploaded files are parsed in memory and discarded; only the extracted text and structure are stored, under `backend/data`.
- Error responses never include stack traces or configuration values.
- The scanner reads only the DOM the browser has already rendered for you. It does not touch authentication, CAPTCHAs, paywalls or any site protection.

To delete everything, stop the backend and remove `backend/data`.

---

## Choosing where the model runs

This pipeline is output-heavy: each tailoring run makes four sequential calls and emits roughly **4,000 output tokens**, because every stage writes a complete JSON document and the tailoring stage writes your whole CV back out.

| Setup | Time per CV | Notes |
| --- | --- | --- |
| Discrete GPU (8GB+ VRAM), 8B model | under a minute | The comfortable local option. |
| Apple Silicon, 8B model | 1–3 minutes | Unified memory does well here. |
| Modern CPU only, 4–8 cores, 8B model | **15–20 minutes** | Works, but raise `AI_TIMEOUT_MS` to `900000` first: a single call can exceed the 3-minute default. Needs ~6GB free RAM. |
| Ollama Cloud (`-cloud` model) | seconds | No code changes; the local daemon proxies it. Counts as cloud, so consent is required. |
| Cloud API (OpenAI, Groq, Gemini, …) | seconds | Set `OPENAI_BASE_URL` to any OpenAI-compatible endpoint. |

On a CPU-only machine, dropping to a 3B model roughly halves the time but costs noticeably more quality. Tailoring is the one stage with no non-AI fallback, so that is where a weak model shows most.

The context window matters too. Ollama **truncates silently** when a prompt does not fit, which degrades a parse without failing it. The default 8,192 suits a two-page CV; the backend estimates each prompt and warns you in the run notes when it approaches the limit, and you can raise the window in AI Settings if you have the RAM.

## Known limitations

- **Scanned-image PDFs cannot be read.** There is no OCR. Export a text-based PDF or upload the DOCX.
- **PDF generation uses PDFKit, not a headless browser.** This keeps `npm install` small and produces real selectable single-column text, which is what ATS parsers want. The HTML preview is pixel-accurate for layout but the PDF is laid out independently, so the two differ slightly in line breaks. PDF fonts are limited to Helvetica, Times Roman and Courier.
- **Local models are slower and less reliable than cloud models.** See [Choosing where the model runs](#choosing-where-the-model-runs). If parsing fails the built-in parser takes over, and the UI says so rather than pretending it worked.
- **Platform selectors age.** Job boards change their markup. When a platform selector stops matching, the semantic and body-text layers still extract the description, and the confidence badge tells you how much to trust it.
- **Single-page apps may need a rescan** if the description renders after the popup reads the page.
- **A tailoring run does not survive the service worker being suspended.** If Chrome stops the worker mid-run, the popup reports the run was interrupted instead of showing a stale spinner.
- **The match score is not a hiring prediction.** It measures how much of the posting your CV evidences, nothing more.

---

## Troubleshooting

**"Backend not reachable"** — start it with `npm start` in `backend/`. If you changed `PORT`, update the backend URL in AI Settings.

**"Could not reach Ollama"** — run `ollama serve`, then `ollama list` to confirm a model is installed. Check the URL in AI Settings matches.

**"Ollama does not have the model"** — `ollama pull <model>`, or pick an installed one from the dropdown in AI Settings.

**Tailoring times out** — raise `AI_TIMEOUT_MS` in `.env`, or use a smaller model.

**The scan captured the wrong text** — expand **Review extracted description** and edit it, or use **Paste**. The pasted path produces identical results.

**"This page cannot be scanned"** — Chrome blocks extensions on `chrome://` pages and the Web Store. Open the listing in a normal tab.

**No name or email detected after upload** — the CV was parsed without AI. Start Ollama and press **Re-parse**, or correct the fields in the editor.
