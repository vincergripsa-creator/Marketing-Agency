// Run milestone banner: bankrupt and goal reached (the agency keeps working) / horizon finished (the run is over, unless the founder lets it go on).
import type { CompanySnapshot } from '../../../shared/types';
import { cx } from './common';
import { useApp } from './context';
import { endedBankrupt, goalLate, goalTitle } from './derive';
import { fmtEur, fmtEurSigned, fmtInt, sum } from './format';
import { Icon } from './icons';

const goalKey = (runId: string): string => `agency.goal-banner.${runId}`;
const endKey = (s: Pick<CompanySnapshot, 'runId' | 'status'>): string => `${s.runId}:${s.status}`;

function goalClosed(runId: string): boolean {
  try { return localStorage.getItem(goalKey(runId)) === '1'; } catch { return false; }
}

/**
 * The banner has something to say and this viewer did not close it. `closed` holds for the page; the goal's closing outlives a reload.
 * Only that one: « Faillite » is a state to keep in sight, and the end of a run carries « Continuer sans fin ».
 */
export function endBannerShown(s: CompanySnapshot | null, closed: string | null): boolean {
  if (!s || (s.status !== 'bankrupt' && s.status !== 'goal_reached' && s.status !== 'finished')) return false;
  return closed !== endKey(s) && !(s.status === 'goal_reached' && goalClosed(s.runId));
}

/** What `endBannerShown` reads next. A browser that keeps nothing shows the goal again on the next load, no more. */
export function closeEndBanner(s: CompanySnapshot | null): string | null {
  if (!s) return null;
  if (s.status === 'goal_reached') try { localStorage.setItem(goalKey(s.runId), '1'); } catch { /* private mode */ }
  return endKey(s);
}

export function EndBanner({ onNewScenario, onDismiss, onFinance, onExtend }: { onNewScenario(): void; onDismiss(): void; onFinance(): void; onExtend?(): void }) {
  const { snapshot } = useApp();
  if (!snapshot) return null;
  const st = snapshot.status;
  if (st !== 'bankrupt' && st !== 'goal_reached' && st !== 'finished') return null;
  const f = snapshot.finance;
  const products = snapshot.company?.products ?? [];
  const sales = sum(products, (p) => p.stats?.sales ?? 0);
  const lessons = snapshot.company?.lessons?.length ?? 0;
  const goal = snapshot.scenario?.goal;
  const late = goalLate(snapshot);
  const after = snapshot.scenario?.openEnded ? 'L’agence continue de tourner, sans fin.' : 'L’agence continue de tourner jusqu’à la fin de la simulation.';
  const canExtend = st === 'finished' && !!onExtend;

  const conf = st === 'bankrupt'
    ? { cls: 'end-bad', icon: 'alert' as const, title: 'Faillite', text: `La trésorerie est négative au jour ${snapshot.day}. L’agence continue en mode survie : plus aucune dépense payante, seulement le support, l’organique et les créateurs à la commission, jusqu’au retour d’une trésorerie positive.` }
    : endedBankrupt(snapshot)
      ? { cls: 'end-bad', icon: 'alert' as const, title: 'Faillite', text: `La simulation s’arrête après ${snapshot.scenario?.horizonDays ?? snapshot.day} jours sur une trésorerie négative. Profit final : ${fmtEurSigned(f?.profit)}.` }
    : st === 'goal_reached'
      ? { cls: late ? 'end-neutral' : 'end-good', icon: 'sparkle' as const, title: goalTitle(snapshot), text: `${fmtEurSigned(f?.profit)} de profit au jour ${snapshot.day}${goal ? (late ? ` : ${fmtEur(goal.targetProfit, 0)} atteints au jour ${snapshot.goalReachedDay}, l’échéance était le jour ${goal.byDay}` : ` (objectif ${fmtEur(goal.targetProfit, 0)} avant le jour ${goal.byDay})`) : ''}. ${after}` }
      : { cls: (f?.profit ?? 0) >= 0 ? 'end-good' : 'end-neutral', icon: 'flag' as const, title: 'Fin de la simulation', text: `Horizon de ${snapshot.scenario?.horizonDays ?? snapshot.day} jours atteint. Profit final : ${fmtEurSigned(f?.profit)}.` };

  return (
    <div className={cx(`end-banner glass ${conf.cls}`, canExtend && 'end-extend')} role="alert">
      <span className="end-icon"><Icon name={conf.icon} size={22} /></span>
      <div className="end-body">
        <strong>{conf.title}</strong>
        <span>{conf.text}</span>
        <span className="end-stats">
          Trésorerie {fmtEur(f?.cash)} · {fmtInt(sales)} ventes · {fmtInt(products.filter((p) => p.status === 'live').length)} guides en vente · {fmtInt(lessons)} leçons
        </span>
      </div>
      <div className="end-actions">
        <button type="button" className="btn btn-sm" onClick={onFinance}>Voir les finances</button>
        {canExtend ? <button type="button" className="btn btn-dark btn-sm" onClick={onExtend}><Icon name="play" size={13} /> Continuer sans fin</button> : null}
        <button type="button" className={canExtend ? 'btn btn-sm' : 'btn btn-dark btn-sm'} onClick={onNewScenario}><Icon name="plus" size={13} /> Nouveau scénario</button>
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Masquer"><Icon name="x" /></button>
      </div>
    </div>
  );
}
