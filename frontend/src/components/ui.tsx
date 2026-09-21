// Shared UI primitives — every page renders the same card, field, pill, dialog
// and button shells so spacing, type scale, and touch targets stay uniform.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// --------------------------------------------------------- Page heading ----

export function PageHeader({ eyebrow, title, subtitle, badge, badgeTone = 'info', actions }: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeTone?: 'safe' | 'danger' | 'waiting' | 'info' | 'neutral';
  actions?: ReactNode;
}) {
  return (
    <header className="rq-page-head">
      <div className="rq-page-head-copy">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="rq-page-head-side">
        {badge && <StatusPill tone={badgeTone}>{badge}</StatusPill>}
        {actions}
      </div>
    </header>
  );
}

/** Uniform toggle chip used for filters/choices on every page. */
export function Chip({ children, active, onClick, ariaLabel }: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <button className={`chip${active ? ' active' : ''}`} type="button" aria-pressed={active} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Card -----

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return (
    <section className={`card rq-card ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ icon, title, subtitle, actions, tone }: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tone?: 'danger' | 'ok' | 'warn' | 'info';
}) {
  return (
    <header className={`rq-card-head${tone ? ` tone-${tone}` : ''}`}>
      {icon && <span className="rq-card-icon" aria-hidden="true">{icon}</span>}
      <div className="rq-card-titles">
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="rq-card-actions">{actions}</div>}
    </header>
  );
}

// --------------------------------------------------------------- Modal -----

export function Modal({ open, onClose, title, subtitle, children, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <>
      <button className="rq-scrim" type="button" aria-label="Close dialog" onClick={onClose} />
      <div ref={ref} className={`rq-modal${wide ? ' rq-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="rq-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button className="rq-modal-close" type="button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="rq-modal-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

// -------------------------------------------------------------- Fields -----

interface FieldShell { label: string; hint?: string; children: ReactNode }

function Shell({ label, hint, children }: FieldShell) {
  return (
    <label className="rq-field">
      <span className="rq-field-label">{label}</span>
      {children}
      {hint && <span className="rq-field-hint">{hint}</span>}
    </label>
  );
}

export function TextField({ label, hint, value, onChange, placeholder, type = 'text', required, maxLength, inputMode, autoComplete }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  inputMode?: 'text' | 'tel' | 'numeric' | 'email';
  autoComplete?: string;
}) {
  return (
    <Shell label={label} hint={hint}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

export function NumberField({ label, hint, value, onChange, min, max, placeholder }: {
  label: string;
  hint?: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <Shell label={label} hint={hint}>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </Shell>
  );
}

export function SelectField<T extends string>({ label, hint, value, onChange, options }: {
  label: string;
  hint?: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <Shell label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Shell>
  );
}

export function TextAreaField({ label, hint, value, onChange, rows = 2, maxLength, placeholder }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <Shell label={label} hint={hint}>
      <textarea
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------- Pills ----

export type PillTone = 'safe' | 'danger' | 'waiting' | 'info' | 'neutral';

const PILL_LABEL: Record<PillTone, string> = { safe: 'SAFE', danger: 'NEEDS HELP', waiting: 'WAITING', info: 'INFO', neutral: '—' };

export function StatusPill({ tone, children }: { tone: PillTone; children?: ReactNode }) {
  return (
    <span className={`rq-status-pill rq-${tone}`} role="status">
      <i aria-hidden="true" />
      {children ?? PILL_LABEL[tone]}
    </span>
  );
}

export function toneForStatus(status: string | null | undefined): PillTone {
  if (status === 'SAFE') return 'safe';
  if (status === 'NEEDS_HELP' || status === 'AT_RISK') return 'danger';
  return 'waiting';
}

// ----------------------------------------------------------- Empty / misc --

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="rq-empty">
      {icon && <span className="rq-empty-icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}

export function ActionButton({ children, variant = 'secondary', onClick, disabled, type = 'button', ariaLabel, full }: {
  children: ReactNode;
  /** Color = purpose; shape/size always identical. help=analyze/info=voice/alert=recording/danger=SOS. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'help' | 'info' | 'alert';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  ariaLabel?: string;
  full?: boolean;
}) {
  const cls = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'rq-danger', help: 'btn-help', info: 'rq-info', alert: 'rq-alert' }[variant];
  return (
    <button type={type} className={`${cls} rq-action-btn${full ? ' rq-full' : ''}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  );
}

/** Compact list entry used by Home family/history summaries. */
export function MiniRow({ icon, title, meta, pill, onClick }: {
  icon?: ReactNode;
  title: string;
  meta?: string;
  pill?: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="rq-mini-row" type={onClick ? 'button' : undefined} onClick={onClick}>
      {icon && <span className="rq-mini-icon" aria-hidden="true">{icon}</span>}
      <span className="rq-mini-main"><strong>{title}</strong>{meta && <small>{meta}</small>}</span>
      {pill}
    </Tag>
  );
}
