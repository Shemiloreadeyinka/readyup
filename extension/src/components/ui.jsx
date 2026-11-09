import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react';

/** Shared primitives. Every screen is built from these, nothing bespoke. */

export const cx = (...values) => values.filter(Boolean).join(' ');

/* -------------------------------- Button -------------------------------- */

const BUTTON_VARIANTS = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:bg-brand-300',
  secondary:
    'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-white text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50',
};

const BUTTON_SIZES = {
  sm: 'h-7 px-2.5 text-xs gap-1',
  md: 'h-9 px-3.5 text-[13px] gap-1.5',
  lg: 'h-10 px-4 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  children,
  className,
  disabled,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : Icon ? (
        <Icon className="size-3.5" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

/* --------------------------------- Card --------------------------------- */

export function Card({ children, className, ...props }) {
  return (
    <div
      className={cx(
        'rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, icon: Icon }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-3.5 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden /> : null}
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-snug text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- Badge -------------------------------- */

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
};

export function Badge({ tone = 'neutral', children, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------- Alert -------------------------------- */

const ALERT_TONES = {
  info: { className: 'bg-brand-50 text-brand-900 border-brand-200', Icon: Info },
  success: { className: 'bg-emerald-50 text-emerald-900 border-emerald-200', Icon: CheckCircle2 },
  warning: { className: 'bg-amber-50 text-amber-900 border-amber-200', Icon: TriangleAlert },
  error: { className: 'bg-red-50 text-red-900 border-red-200', Icon: AlertCircle },
};

export function Alert({ tone = 'info', title, children, action, className }) {
  const { className: toneClass, Icon } = ALERT_TONES[tone] ?? ALERT_TONES.info;
  return (
    <div className={cx('rounded-lg border px-3 py-2.5 text-xs', toneClass, className)}>
      <div className="flex gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className={cx(title && 'mt-0.5', 'leading-snug')}>{children}</div> : null}
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Forms -------------------------------- */

export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <div className={cx('space-y-1', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11px] text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

export const Input = ({ className, ...props }) => (
  <input className={cx(CONTROL_CLASS, className)} {...props} />
);

export const Textarea = ({ className, ...props }) => (
  <textarea className={cx(CONTROL_CLASS, 'resize-y leading-snug', className)} {...props} />
);

export const Select = ({ className, children, ...props }) => (
  <select className={cx(CONTROL_CLASS, 'pr-7', className)} {...props}>
    {children}
  </select>
);

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label
      className={cx(
        'flex cursor-pointer items-start gap-2.5',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'mt-0.5 inline-flex h-4.5 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cx(
            'size-3.5 rounded-full bg-white transition-transform',
            checked && 'translate-x-3.5',
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-800">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/* ------------------------------- Feedback ------------------------------- */

export function Spinner({ className }) {
  return <Loader2 className={cx('size-4 animate-spin text-brand-600', className)} aria-hidden />;
}

export function LoadingPane({ label = 'Loading' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-500">
      <Spinner />
      <p className="text-xs">{label}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {Icon ? (
        <div className="mb-3 rounded-full bg-slate-100 p-3">
          <Icon className="size-5 text-slate-400" aria-hidden />
        </div>
      ) : null}
      <p className="text-[13px] font-semibold text-slate-800">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[280px] text-xs leading-snug text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Proportional bar used for the match score. Never a decorative widget. */
export function ScoreBar({ value, tone = 'brand' }) {
  const tones = {
    brand: 'bg-brand-600',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={cx('h-full rounded-full transition-[width]', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
      />
    </div>
  );
}
