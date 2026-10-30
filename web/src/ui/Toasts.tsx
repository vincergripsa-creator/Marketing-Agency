// Toast stack (top centre) for important events: sale bursts, ad rejections, goal, bankruptcy.
import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './common';
import { Icon, type IconName } from './icons';

export type ToastTone = 'good' | 'bad' | 'warn' | 'info';
/** action: optional link shown in the toast (e.g. « Voir le produit »); clicking it also closes the toast. */
export interface ToastAction { label: string; run(): void }
export interface ToastInput { tone?: ToastTone; title: string; text?: string; icon?: IconName; ttl?: number; action?: ToastAction }
export interface Toast extends Required<Pick<ToastInput, 'tone' | 'title' | 'ttl'>> { id: number; text?: string; icon?: IconName; action?: ToastAction }

const ICON_FOR: Record<ToastTone, IconName> = { good: 'sparkle', bad: 'alert', warn: 'alert', info: 'info' };
const MAX_TOASTS = 5;

/** Adds a toast unless an identical one (same title + text) is already visible; keeps the last MAX_TOASTS. */
export function addToast(list: readonly Toast[], t: Toast): Toast[] {
  if (list.some((x) => x.title === t.title && x.text === t.text)) return list as Toast[];
  return [...list, t].slice(-MAX_TOASTS);
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    seq.current += 1;
    const t: Toast = { id: seq.current, tone: input.tone ?? 'info', title: input.title, text: input.text, icon: input.icon, ttl: input.ttl ?? 5200, action: input.action };
    setToasts((list) => addToast(list, t));
  }, []);

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} t={t} onDismiss={onDismiss} />)}
    </div>
  );
}

/**
 * Each toast owns its expiry timer: it is (re)armed whenever the toast is mounted, so a hot reload or a
 * StrictMode double mount can never leave a toast stuck on screen.
 */
function ToastItem({ t, onDismiss }: { t: Toast; onDismiss(id: number): void }) {
  useEffect(() => {
    const tm = setTimeout(() => onDismiss(t.id), t.ttl);
    return () => clearTimeout(tm);
  }, [t.id, t.ttl, onDismiss]);
  return (
    <div className={cx('toast glass', `toast-${t.tone}`)}>
      <span className="toast-icon"><Icon name={t.icon ?? ICON_FOR[t.tone]} size={16} /></span>
      <div className="toast-body">
        <strong>{t.title}</strong>
        {t.text ? <span>{t.text}</span> : null}
        {t.action ? (
          <button type="button" className="link-btn toast-action" onClick={() => { t.action?.run(); onDismiss(t.id); }}>
            {t.action.label} <Icon name="arrowRight" size={11} />
          </button>
        ) : null}
      </div>
      <button type="button" className="icon-btn icon-btn-sm" onClick={() => onDismiss(t.id)} aria-label="Fermer"><Icon name="x" size={14} /></button>
    </div>
  );
}
