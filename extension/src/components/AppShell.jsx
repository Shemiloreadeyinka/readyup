import { FileText, History, LayoutDashboard, Settings, X } from 'lucide-react';
import { cx } from './ui.jsx';
import { useApp } from '../lib/AppContext.jsx';

export const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'my-cv', label: 'My CV', icon: FileText },
  { id: 'tailored', label: 'Tailored', icon: History },
  { id: 'settings', label: 'AI', icon: Settings },
];

function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;

  const tones = {
    info: 'bg-slate-900 text-white',
    success: 'bg-emerald-600 text-white',
    error: 'bg-red-600 text-white',
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-14 z-50 flex flex-col items-center gap-1.5 px-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cx(
            'pointer-events-auto flex w-full items-start gap-2 rounded-lg px-3 py-2 text-xs shadow-lg',
            tones[toast.tone] ?? tones.info,
          )}
        >
          <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AppShell({ activeTab, onTabChange, children }) {
  return (
    <div className="relative flex h-full flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-brand-600 text-[11px] font-bold text-white">
            CV
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-none text-slate-900">CV Tailor</p>
            <p className="mt-0.5 text-[10px] leading-none text-slate-500">
              Tailor your CV to any job listing
            </p>
          </div>
        </div>
      </header>

      <main className="scroll-pane">{children}</main>

      <Toasts />

      <nav className="flex shrink-0 border-t border-slate-200 bg-white">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default AppShell;
