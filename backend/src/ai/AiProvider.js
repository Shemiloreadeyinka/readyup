import { parseModelJson } from '../utils/json.js';
import {
  jobAnalysisPrompt,
  cvAnalysisPrompt,
  comparisonPrompt,
  tailoringPrompt,
  suggestionsPrompt,
} from './prompts.js';

/**
 * Common interface every AI provider implements.
 *
 * Subclasses implement only the transport concerns:
 *   - chat({ system, prompt, json, temperature, signal }) -> string
 *   - testConnection() -> { ok, message, models? }
 *   - listModels() -> string[]
 *
 * The analysis methods below are shared, so the CV tailoring engine never has
 * to know which provider is active. Swapping providers cannot change business
 * logic, only transport.
 */
export class AiProvider {
  /**
   * @param {object} options
   * @param {string} options.id    provider identifier, e.g. "ollama"
   * @param {string} options.label human readable name
   * @param {string} options.model model identifier in use
   * @param {boolean} options.isCloud whether data leaves the machine
   * @param {number} options.timeoutMs request timeout
   */
  constructor({ id, label, model, isCloud = false, timeoutMs = 180000 }) {
    if (new.target === AiProvider) {
      throw new TypeError('AiProvider is abstract; use a concrete provider');
    }
    this.id = id;
    this.label = label;
    this.model = model;
    this.isCloud = isCloud;
    this.timeoutMs = timeoutMs;

    // Non-fatal problems noticed mid-request (context truncation, for
    // example). The pipeline drains these so they reach the user instead of
    // only the server log.
    this.warnings = [];
  }

  /** Records a non-fatal warning once, however many stages hit it. */
  warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  /** Returns the collected warnings and clears them. */
  drainWarnings() {
    const collected = [...this.warnings];
    this.warnings.length = 0;
    return collected;
  }

  /* ----------------------------- transport ------------------------------ */

  /**
   * Sends a single-turn request to the model.
   * @abstract
   * @returns {Promise<string>} raw text response
   */
  // eslint-disable-next-line no-unused-vars
  async chat({ system, prompt, json, temperature, signal }) {
    throw new Error(`${this.id}: chat() is not implemented`);
  }

  /** @returns {Promise<{ok: boolean, message: string, models?: string[]}>} */
  async testConnection() {
    throw new Error(`${this.id}: testConnection() is not implemented`);
  }

  /** @returns {Promise<string[]>} */
  async listModels() {
    return [];
  }

  /** Creates an AbortSignal honouring the configured timeout. */
  createTimeout() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    return { signal: controller.signal, done: () => clearTimeout(timer) };
  }

  /** Runs a prompt pair and parses the JSON response. */
  async completeJson({ system, prompt, temperature = 0.2 }) {
    const { signal, done } = this.createTimeout();
    try {
      const raw = await this.chat({ system, prompt, json: true, temperature, signal });
      return parseModelJson(raw);
    } finally {
      done();
    }
  }

  /* -------------------------- common interface -------------------------- */

  /** Stage 1: structured analysis of a job description. */
  async analyseJob(jobText, meta = {}) {
    return this.completeJson({ ...jobAnalysisPrompt(jobText, meta), temperature: 0.1 });
  }

  /** Stage 2: structured analysis of a CV. */
  async analyseCV(cvText) {
    return this.completeJson({ ...cvAnalysisPrompt(cvText), temperature: 0 });
  }

  /** Stage 3: evidence-based comparison of CV against job. */
  async compareCVWithJob(jobAnalysis, cvAnalysis) {
    return this.completeJson({
      ...comparisonPrompt(jobAnalysis, cvAnalysis),
      temperature: 0.1,
    });
  }

  /** Stage 4: produce the tailored CV. */
  async tailorCV(jobAnalysis, cvAnalysis, comparison) {
    return this.completeJson({
      ...tailoringPrompt(jobAnalysis, cvAnalysis, comparison),
      temperature: 0.25,
    });
  }

  /** Stage 5: coaching recommendations. */
  async generateSuggestions(jobAnalysis, comparison) {
    return this.completeJson({
      ...suggestionsPrompt(jobAnalysis, comparison),
      temperature: 0.3,
    });
  }

  describe() {
    return {
      id: this.id,
      label: this.label,
      model: this.model,
      isCloud: this.isCloud,
      cloudReason: this.cloudReason ?? null,
    };
  }
}

export default AiProvider;
