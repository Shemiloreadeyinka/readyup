import { scanJobPage } from '../src/scanner/pageScanner.js';
import { DEFAULT_BACKEND_URL, STORAGE_KEYS } from '../src/lib/constants.js';

/**
 * Background service worker.
 *
 * It owns two things the popup cannot do reliably on its own:
 *   1. injecting the scanner into the active tab (activeTab is granted to the
 *      extension, not to the popup document);
 *   2. running the tailoring request, which can take minutes on a local model
 *      and would be cancelled if it were tied to the popup's lifetime.
 *
 * Job state is mirrored into session storage so reopening the popup shows the
 * run still in progress.
 */
export default defineBackground(() => {
  const IDLE_STATE = { status: 'idle', stage: null, message: null, result: null, error: null };
  let tailorState = { ...IDLE_STATE };
  let activeRun = null;

  /**
   * Keeps the service worker alive for the length of a run.
   *
   * Chrome terminates an idle MV3 worker after about 30 seconds, and an
   * in-flight fetch does not reliably count as activity. A tailoring run takes
   * minutes, so without this the worker is killed mid-request and the finished
   * result never reaches the popup. Touching a chrome API on a timer resets
   * the idle countdown.
   */
  let keepAliveTimer = null;

  const startKeepAlive = () => {
    if (keepAliveTimer) return;
    keepAliveTimer = setInterval(() => {
      chrome.runtime.getPlatformInfo().catch(() => {});
    }, 20_000);
  };

  const stopKeepAlive = () => {
    if (!keepAliveTimer) return;
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  };

  // Local storage, not session: the result must survive the worker being
  // terminated, which is exactly when the popup needs to recover it.
  const persist = async () => {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.tailorState]: tailorState });
    } catch {
      /* storage is unavailable in some contexts; memory state still works */
    }
  };

  const setState = (patch) => {
    tailorState = { ...tailorState, ...patch };
    persist();
    chrome.runtime
      .sendMessage({ type: 'TAILOR_STATE', state: tailorState })
      .catch(() => {
        /* no popup is open; state is read on next open */
      });
  };

  const getBackendUrl = async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.backendUrl);
    return stored[STORAGE_KEYS.backendUrl] || DEFAULT_BACKEND_URL;
  };

  /** Calls the local backend and turns failures into readable messages. */
  const callBackend = async (path, options = {}) => {
    const baseUrl = await getBackendUrl();
    let response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      });
    } catch {
      throw new Error(
        `Could not reach the CV Tailor backend at ${baseUrl}. Start it with "npm start" in the backend folder.`,
      );
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Request failed with ${response.status}`);
      error.details = body?.error?.details;
      error.status = response.status;
      throw error;
    }
    return body;
  };

  /* ----------------------------- scanning -------------------------------- */

  const getActiveTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  };

  const RESTRICTED_SCHEMES = /^(chrome|edge|about|devtools|view-source|chrome-extension):/i;

  const scanActiveTab = async () => {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('No active tab was found.');

    if (!tab.url || RESTRICTED_SCHEMES.test(tab.url)) {
      throw new Error(
        'This page cannot be scanned because Chrome blocks extensions on browser pages. Open a job listing, or paste the description manually.',
      );
    }

    let injection;
    try {
      [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanJobPage,
      });
    } catch (error) {
      throw new Error(
        `This page could not be scanned (${error.message}). Some sites block extensions from reading their content. Use "Paste job description" instead.`,
      );
    }

    const result = injection?.result;
    if (!result) throw new Error('The scanner returned nothing. Reload the page and try again.');

    return { ...result, tabId: tab.id };
  };

  /* --------------------------- tailoring run ------------------------------ */

  /**
   * Recovers a run whose worker was killed before it could report back.
   *
   * The backend saves every tailored CV before responding, so a run that
   * "vanished" has almost always finished: look for a record created after
   * this run started rather than telling the user their work is gone.
   */
  const recoverFinishedRun = async (state) => {
    if (!state?.startedAt) return null;

    try {
      const { items } = await callBackend('/api/tailored');
      const candidate = (items ?? []).find((item) => {
        const created = Date.parse(item.createdAt);
        if (!Number.isFinite(created) || created < state.startedAt - 5000) return false;
        if (state.jobTitle && item.jobTitle !== state.jobTitle) return false;
        return true;
      });
      if (!candidate) return null;

      const { tailored } = await callBackend(`/api/tailored/${candidate.id}`);
      return tailored ?? null;
    } catch {
      return null;
    }
  };

  const runTailoring = async (payload) => {
    startKeepAlive();
    setState({
      status: 'running',
      stage: 'job-analysis',
      message: 'Analysing the job description',
      result: null,
      error: null,
      startedAt: Date.now(),
      jobTitle: payload.jobMeta?.jobTitle ?? null,
      company: payload.jobMeta?.company ?? null,
    });

    try {
      // Stage 1 runs separately so the UI can report real progress rather than
      // a single opaque wait.
      const analysed = await callBackend('/api/job/analyse', {
        method: 'POST',
        body: JSON.stringify({
          text: payload.jobText,
          meta: payload.jobMeta,
          provider: payload.provider,
          model: payload.model,
        }),
      });

      setState({ stage: 'tailoring', message: 'Comparing and tailoring your CV' });

      const tailored = await callBackend('/api/tailor', {
        method: 'POST',
        body: JSON.stringify({
          cvId: payload.cvId,
          jobText: payload.jobText,
          jobMeta: payload.jobMeta,
          jobAnalysis: analysed.analysis,
          templateId: payload.templateId,
          provider: payload.provider,
          model: payload.model,
        }),
      });

      setState({
        status: 'done',
        stage: 'done',
        message: 'Your tailored CV is ready',
        result: tailored.tailored,
        error: null,
      });
      return tailored.tailored;
    } catch (error) {
      setState({
        status: 'error',
        stage: null,
        message: null,
        error: { message: error.message, details: error.details ?? null },
      });
      throw error;
    } finally {
      activeRun = null;
      stopKeepAlive();
    }
  };

  /* ------------------------------ messaging ------------------------------- */

  const handlers = {
    PING: async () => ({ ok: true }),

    GET_ACTIVE_TAB: async () => {
      const tab = await getActiveTab();
      return {
        url: tab?.url ?? null,
        title: tab?.title ?? null,
        favIconUrl: tab?.favIconUrl ?? null,
        scannable: Boolean(tab?.url && !RESTRICTED_SCHEMES.test(tab.url)),
      };
    },

    SCAN_ACTIVE_TAB: () => scanActiveTab(),

    START_TAILOR: async (message) => {
      if (activeRun) throw new Error('A tailoring run is already in progress.');
      activeRun = runTailoring(message.payload);
      // Deliberately not awaited: the popup may close while this runs.
      activeRun.catch(() => {});
      return { started: true };
    },

    GET_TAILOR_STATE: async () => {
      // A "running" state with no run in flight means the worker was
      // terminated. The backend may well have finished the job.
      if (tailorState.status === 'running' && !activeRun) {
        const recovered = await recoverFinishedRun(tailorState);

        if (recovered) {
          setState({
            status: 'done',
            stage: 'done',
            message: 'Your tailored CV is ready',
            result: recovered,
            error: null,
          });
        } else {
          setState({
            status: 'error',
            stage: null,
            message: null,
            error: {
              message:
                'Chrome stopped the extension while that run was in progress. Check the Tailored tab in case it finished, then start it again.',
            },
          });
        }
      }
      return tailorState;
    },

    CLEAR_TAILOR: async () => {
      if (activeRun) throw new Error('Wait for the current run to finish first.');
      tailorState = { ...IDLE_STATE };
      await persist();
      return tailorState;
    },
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = handlers[message?.type];
    if (!handler) return false;

    handler(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));

    return true; // keeps the message channel open for the async response
  });

  // Restore state from before the worker was suspended. A "running" entry is
  // left as-is: GET_TAILOR_STATE resolves it by asking the backend whether the
  // job actually finished.
  chrome.storage.local
    .get(STORAGE_KEYS.tailorState)
    .then((stored) => {
      const saved = stored?.[STORAGE_KEYS.tailorState];
      if (saved) tailorState = saved;
    })
    .catch(() => {});
});
