// Toast stack (top centre) for important events: sale bursts, ad rejections, goal, bankruptcy.
import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './common';
import { Icon, type IconName } from './icons';

export type ToastTone = 'good' | 'bad' | 'warn' | 'info';
export interface ToastInput { tone?: ToastTone; title: string; text?: string; icon?: IconName; ttl?: number }
export interface Toast extends Required<Pick<ToastInput, 'tone' | 'title' | 'ttl'>> { id: number; text?: string; icon?: IconName }

const ICON_FOR: Record<ToastTone, IconName> = { good: 'sparkle', bad: 'alert', warn: 'alert', info: 'info' };
const MAX_TOASTS = 5;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const push = useCallback((input: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    const t: Toast = { id, tone: input.tone ?? 'info', title: input.title, text: input.text, icon: input.icon, ttl: input.ttl ?? 5200 };
    setToasts((list) => {
      // identical toast already visible → don't stack duplicates
      if (list.some((x) => x.title === t.title && x.text === t.text)) return list;
      return [...list, t].slice(-MAX_TOASTS);
    });
    timers.current.set(id, setTimeout(() => dismiss(id), t.ttl));
  }, [dismiss]);

  useEffect(() => () => { for (const tm of timers.current.values()) clearTimeout(tm); }, []);

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast glass', `toast-${t.tone}`)}>
          <span className="toast-icon"><Icon name={t.icon ?? ICON_FOR[t.tone]} size={16} /></span>
          <div className="toast-body">
            <strong>{t.title}</strong>
            {t.text ? <span>{t.text}</span> : null}
          </div>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => onDismiss(t.id)} aria-label="Fermer"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
