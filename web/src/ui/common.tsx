// Small presentational building blocks shared by all panels.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { QualityReport } from '../../../shared/types';
import { fileUrl } from '../api';
import { clamp01, fmtInt } from './format';
import { Icon, type IconName } from './icons';
import type { Tone } from './labels';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Avatar({ name, color, size = 32, chief = false, title }: { name: string; color: string; size?: number; chief?: boolean; title?: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span
      className={cx('avatar', chief && 'avatar-chief')}
      style={{ width: size, height: size, background: color, fontSize: Math.max(10, Math.round(size * 0.44)) } as CSSProperties}
      title={title ?? name}
    >
      {initial}
    </span>
  );
}

export function Pill({ tone = 'neutral', children, icon, title, className }: { tone?: Tone; children: ReactNode; icon?: IconName; title?: string; className?: string }) {
  return (
    <span className={cx('pill', `tone-${tone}`, className)} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

export function ChiefBadge() {
  return <span className="chief-badge">CHEF</span>;
}

export function Dot({ color, size = 8, pulse = false, title }: { color: string; size?: number; pulse?: boolean; title?: string }) {
  return <span className={cx('dot', pulse && 'dot-pulse')} style={{ width: size, height: size, background: color, color }} title={title} />;
}

/** Horizontal meter, value in 0..1. */
export function Bar({ value, color, height = 6, track, title }: { value: number; color?: string; height?: number; track?: string; title?: string }) {
  const v = clamp01(value);
  return (
    <span className="bar" style={{ height, background: track }} title={title}>
      <span className="bar-fill" style={{ width: `${v * 100}%`, background: color }} />
    </span>
  );
}

export function Empty({ icon = 'info', children, compact = false }: { icon?: IconName; children: ReactNode; compact?: boolean }) {
  return (
    <div className={cx('empty', compact && 'empty-compact')}>
      <Icon name={icon} size={compact ? 16 : 22} />
      <div>{children}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {right ? <span className="section-right">{right}</span> : null}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = 'md' }: {
  options: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange(v: T): void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cx('segmented', size === 'sm' && 'segmented-sm')} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          className={cx('seg', o.id === value && 'seg-active')}
          onClick={() => onChange(o.id)}
        >
          {o.label}
          {typeof o.count === 'number' ? <span className="seg-count">{fmtInt(o.count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon, big = false }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' | null; icon?: IconName; big?: boolean }) {
  return (
    <div className={cx('stat', big && 'stat-big')}>
      <div className="stat-label">{icon ? <Icon name={icon} size={13} /> : null}{label}</div>
      <div className={cx('stat-value', tone === 'good' && 'txt-good', tone === 'bad' && 'txt-bad', tone === 'warn' && 'txt-warn')}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

/** Generated files (PDF served inline, HTML sales pages, ad previews) always open in a new tab, never in the app's. */
export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Opens a generated file of the run in a new tab (disabled in demo mode). */
export function FileLink({ runId, path, children, icon = 'external', demo, className, title }: {
  runId: string; path: string | null | undefined; children: ReactNode; icon?: IconName; demo?: boolean; className?: string; title?: string;
}) {
  if (!path) return null;
  if (demo) {
    return (
      <span className={cx('btn btn-sm btn-ghost is-disabled', className)} title="Fichier indisponible en mode démo (serveur non connecté)">
        <Icon name={icon} size={13} />{children}
      </span>
    );
  }
  return (
    <a className={cx('btn btn-sm btn-ghost', className)} href={fileUrl(runId, path)} {...NEW_TAB} title={title ?? path}>
      <Icon name={icon} size={13} />{children}
    </a>
  );
}

const QUALITY_ROWS: { key: keyof QualityReport; label: string }[] = [
  { key: 'specificity', label: 'Spécificité' },
  { key: 'structure', label: 'Structure' },
  { key: 'actionability', label: 'Actionnable' },
  { key: 'humanTone', label: 'Ton humain' },
  { key: 'design', label: 'Design' },
  { key: 'compliance', label: 'Conformité' },
];

export function qualityColor(v: number): string {
  return v >= 75 ? '#16a34a' : v >= 55 ? '#d97706' : '#dc2626';
}

export function QualityBars({ q, rows = QUALITY_ROWS }: { q: QualityReport | null | undefined; rows?: { key: keyof QualityReport; label: string }[] }) {
  if (!q) return <div className="muted small">Pas encore évalué par le contrôle qualité.</div>;
  return (
    <div className="quality">
      {rows.map((r) => {
        const v = Number(q[r.key]) || 0;
        return (
          <div key={r.key} className="quality-row">
            <span className="quality-label">{r.label}</span>
            <Bar value={v / 100} color={qualityColor(v)} />
            <span className="quality-val">{Math.round(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Large floating panel over the world (tab overlays). */
export function Overlay({ title, subtitle, icon, onClose, children, actions, size = 'lg', className }: {
  title: string; subtitle?: ReactNode; icon: IconName; onClose(): void; children: ReactNode; actions?: ReactNode;
  size?: 'md' | 'lg'; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return (
    <section className={cx('overlay glass', `overlay-${size}`, className)} ref={ref} tabIndex={-1} aria-label={title}>
      <header className="overlay-head">
        <span className="overlay-icon"><Icon name={icon} size={17} /></span>
        <div className="overlay-titles">
          <h2>{title}</h2>
          {subtitle ? <div className="overlay-sub">{subtitle}</div> : null}
        </div>
        <div className="overlay-actions">
          {actions}
          <button type="button" className="icon-btn" onClick={onClose} title="Fermer (Échap)" aria-label="Fermer"><Icon name="x" /></button>
        </div>
      </header>
      <div className="overlay-body">{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
