// Where the company stands, in place of the old red pill (ui §6.8). The popover's StageMeter stays in the Effectif chunk until the founder opens it.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { StageId, StageView } from '../../../shared/types';
import { cx } from './common';
import { useApp } from './context';

const StageMeter = lazy(() => import('./tabs/EffectifTab')
  .then((m) => ({ default: m.StageMeter }))
  .catch(() => ({ default: () => <span className="muted small">Détail du palier indisponible.</span> })));

const STAGE_ORDER: readonly StageId[] = ['survie', 'adequation', 'acceleration', 'portefeuille'];
export const STAGE_LABEL: Record<StageId, string> = { survie: 'Survie', adequation: 'Adéquation', acceleration: 'Accélération', portefeuille: 'Portefeuille' };

/** Read out by a screen reader: the badge alone says the stage and the next one. */
export function stageAria(stage: StageView): string {
  const head = `Palier ${stage.level + 1} sur ${stage.total} : ${stage.name}.`;
  const next = stage.gate?.next ?? STAGE_ORDER[stage.level + 1];
  return next ? `${head} Prochain palier : ${STAGE_LABEL[next]}.` : `${head} Dernier palier.`;
}

export function StageBadge() {
  const { snapshot } = useApp();
  const stage = snapshot?.scene?.stage;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    // capture, like the menus of the top bar: Esc closes this, not the tab behind it
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [open]);

  if (!stage) return null;
  return (
    <div className="stage-badge" ref={wrapRef}>
      <button type="button" ref={buttonRef} className="stage-badge-btn" aria-label={stageAria(stage)} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="stage-pips" aria-hidden="true">
          {Array.from({ length: stage.total }, (_, i) => <span key={i} className={cx('stage-pip', i <= stage.level && 'is-on')} />)}
        </span>
        <span className="stage-badge-text">Palier {stage.level + 1}/{stage.total} · {stage.name}</span>
      </button>
      {open ? (
        <div className="stage-pop glass" role="dialog" aria-label="Palier de l’agence">
          <Suspense fallback={<span className="muted small"><span className="spinner" /> Chargement…</span>}>
            <StageMeter stage={stage} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
