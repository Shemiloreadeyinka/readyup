import { STORAGE_KEYS } from './constants.js';

/**
 * Local persistence.
 *
 * Small preferences live in chrome.storage.local; larger per-page artefacts
 * (scanned job descriptions, unsaved editor drafts) live in IndexedDB, which
 * has no practical size limit and survives the popup closing.
 */

const DB_NAME = 'cv-tailor';
const DB_VERSION = 1;
const STORES = { scans: 'scans', drafts: 'drafts' };

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.scans)) {
        db.createObjectStore(STORES.scans, { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains(STORES.drafts)) {
        db.createObjectStore(STORES.drafts, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = action(store);

    transaction.oncomplete = () => resolve(request?.result ?? null);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* ----------------------------- scanned jobs ----------------------------- */

export const saveScan = (scan) =>
  withStore(STORES.scans, 'readwrite', (store) =>
    store.put({ ...scan, savedAt: Date.now() }),
  ).catch(() => null);

export const loadScan = (url) =>
  withStore(STORES.scans, 'readonly', (store) => store.get(url)).catch(() => null);

export const clearScan = (url) =>
  withStore(STORES.scans, 'readwrite', (store) => store.delete(url)).catch(() => null);

/* ---------------------------- editor drafts ----------------------------- */

export const saveDraft = (id, draft) =>
  withStore(STORES.drafts, 'readwrite', (store) =>
    store.put({ id, draft, savedAt: Date.now() }),
  ).catch(() => null);

export const loadDraft = (id) =>
  withStore(STORES.drafts, 'readonly', (store) => store.get(id)).catch(() => null);

export const clearDraft = (id) =>
  withStore(STORES.drafts, 'readwrite', (store) => store.delete(id)).catch(() => null);

/* ----------------------------- preferences ------------------------------ */

export async function getPreference(key, fallback = null) {
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? fallback;
}

export async function setPreference(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

export const preferences = {
  selectedCvId: {
    get: () => getPreference(STORAGE_KEYS.selectedCvId),
    set: (value) => setPreference(STORAGE_KEYS.selectedCvId, value),
  },
  selectedTemplate: {
    get: () => getPreference(STORAGE_KEYS.selectedTemplate, 'modern-professional'),
    set: (value) => setPreference(STORAGE_KEYS.selectedTemplate, value),
  },
};
