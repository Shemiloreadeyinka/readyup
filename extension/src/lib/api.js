import { DEFAULT_BACKEND_URL, STORAGE_KEYS } from './constants.js';

/**
 * Client for the local backend.
 *
 * Everything the extension does goes through here. API keys never live in the
 * extension: the backend holds them and the extension only ever learns whether
 * a key is present.
 */

let cachedBackendUrl = null;

export async function getBackendUrl() {
  if (cachedBackendUrl) return cachedBackendUrl;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.backendUrl);
  cachedBackendUrl = stored[STORAGE_KEYS.backendUrl] || DEFAULT_BACKEND_URL;
  return cachedBackendUrl;
}

export async function setBackendUrl(url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  const value = trimmed || DEFAULT_BACKEND_URL;
  new URL(value); // throws on malformed input before we save it
  await chrome.storage.local.set({ [STORAGE_KEYS.backendUrl]: value });
  cachedBackendUrl = value;
  return value;
}

/** A failed backend call, carrying the structured details the API returned. */
export class ApiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** True when the backend refused because cloud consent has not been given. */
  get needsCloudConsent() {
    return this.details?.code === 'CLOUD_CONSENT_REQUIRED';
  }
}

async function request(path, { method = 'GET', body, raw = false, signal } = {}) {
  const baseUrl = await getBackendUrl();
  const isFormData = body instanceof FormData;

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal,
      headers: isFormData || !body ? undefined : { 'Content-Type': 'application/json' },
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(
      `Could not reach the CV Tailor backend at ${baseUrl}. Start it with "npm start" in the backend folder.`,
      { status: 0 },
    );
  }

  if (raw) {
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new ApiError(failure?.error?.message ?? `Request failed (${response.status})`, {
        status: response.status,
        details: failure?.error?.details,
      });
    }
    return response;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload?.error?.message ?? `Request failed (${response.status})`, {
      status: response.status,
      details: payload?.error?.details,
    });
  }
  return payload;
}

export const api = {
  health: () => request('/api/health'),

  /* ------------------------------ AI settings --------------------------- */
  getAiSettings: () => request('/api/ai/settings'),
  saveAiSettings: (settings) => request('/api/ai/settings', { method: 'PUT', body: settings }),
  testAiProvider: (options) => request('/api/ai/test', { method: 'POST', body: options }),
  listAiModels: (provider) =>
    request(`/api/ai/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),

  /* --------------------------------- CVs -------------------------------- */
  listCvs: () => request('/api/cvs'),
  getCv: (id) => request(`/api/cvs/${id}`),
  uploadCv: (file, name) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    return request('/api/cvs', { method: 'POST', body: form });
  },
  updateCv: (id, patch) => request(`/api/cvs/${id}`, { method: 'PATCH', body: patch }),
  reparseCv: (id) => request(`/api/cvs/${id}/reparse`, { method: 'POST', body: {} }),
  deleteCv: (id) => request(`/api/cvs/${id}`, { method: 'DELETE' }),

  /* --------------------------------- jobs ------------------------------- */
  analyseJob: (payload, signal) =>
    request('/api/job/analyse', { method: 'POST', body: payload, signal }),

  /* ----------------------------- tailored CVs --------------------------- */
  listTailored: () => request('/api/tailored'),
  getTailored: (id) => request(`/api/tailored/${id}`),
  updateTailored: (id, patch) => request(`/api/tailored/${id}`, { method: 'PATCH', body: patch }),
  deleteTailored: (id) => request(`/api/tailored/${id}`, { method: 'DELETE' }),

  /* ------------------------------ documents ----------------------------- */
  getTemplates: () => request('/api/documents/templates'),
  previewDocument: (payload) => request('/api/documents/preview', { method: 'POST', body: payload }),

  /** Downloads a rendered CV and hands the browser a blob URL to save. */
  downloadDocument: async (payload) => {
    const response = await request('/api/documents/download', {
      method: 'POST',
      body: payload,
      raw: true,
    });

    const disposition = response.headers.get('content-disposition') ?? '';
    const suggested = disposition.match(/filename="([^"]+)"/)?.[1];
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    try {
      await chrome.downloads.download({
        url,
        filename: suggested || `cv.${payload.format}`,
        saveAs: true,
      });
    } finally {
      // Chrome has read the blob by the time the download is registered.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    return { fileName: suggested, size: blob.size };
  },
};

export default api;
