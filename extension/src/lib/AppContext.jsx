import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import api from './api.js';
import { preferences } from './storage.js';

/**
 * Application state shared by every screen: the backend connection, the CV
 * library, AI settings and templates. Screens never fetch these themselves,
 * so the popup opens with one coordinated load.
 */

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [backend, setBackend] = useState({ status: 'checking', error: null });
  const [cvs, setCvs] = useState([]);
  const [selectedCvId, setSelectedCvId] = useState(null);
  const [aiSettings, setAiSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [toasts, setToasts] = useState([]);

  const toastId = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message, tone = 'info') => {
      toastId.current += 1;
      const id = toastId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4000);
      return id;
    },
    [dismissToast],
  );

  const refreshCvs = useCallback(async () => {
    const { items } = await api.listCvs();
    setCvs(items);

    // Keep the selection valid: prefer the stored choice, then the default CV.
    const stored = await preferences.selectedCvId.get();
    const exists = items.some((item) => item.id === stored);
    const next = exists ? stored : (items.find((item) => item.isDefault)?.id ?? items[0]?.id ?? null);

    setSelectedCvId(next);
    if (next !== stored) await preferences.selectedCvId.set(next);
    return items;
  }, []);

  const refreshSettings = useCallback(async () => {
    const settings = await api.getAiSettings();
    setAiSettings(settings);
    return settings;
  }, []);

  const connect = useCallback(async () => {
    setBackend({ status: 'checking', error: null });
    try {
      await api.health();
      const [, , templateResponse] = await Promise.all([
        refreshCvs(),
        refreshSettings(),
        api.getTemplates(),
      ]);
      setTemplates(templateResponse.templates);
      setBackend({ status: 'connected', error: null });
    } catch (error) {
      setBackend({ status: 'offline', error: error.message });
    }
  }, [refreshCvs, refreshSettings]);

  useEffect(() => {
    connect();
  }, [connect]);

  const chooseCv = useCallback(async (id) => {
    setSelectedCvId(id);
    await preferences.selectedCvId.set(id);
  }, []);

  const selectedCv = useMemo(
    () => cvs.find((item) => item.id === selectedCvId) ?? null,
    [cvs, selectedCvId],
  );

  const value = useMemo(
    () => ({
      backend,
      connect,
      cvs,
      selectedCv,
      selectedCvId,
      chooseCv,
      refreshCvs,
      aiSettings,
      refreshSettings,
      setAiSettings,
      templates,
      notify,
      toasts,
      dismissToast,
    }),
    [
      backend,
      connect,
      cvs,
      selectedCv,
      selectedCvId,
      chooseCv,
      refreshCvs,
      aiSettings,
      refreshSettings,
      templates,
      notify,
      toasts,
      dismissToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
