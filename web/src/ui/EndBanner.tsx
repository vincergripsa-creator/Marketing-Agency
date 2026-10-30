// End-of-run banner: bankrupt / goal reached / horizon finished.
import { useApp } from './context';
import { fmtEur, fmtEurSigned, fmtInt, sum } from './format';
import { Icon } from './icons';

export function EndBanner({ onNewScenario, onDismiss, onFinance }: { onNewScenario(): void; onDismiss(): void; onFinance(): void }) {
  const { snapshot } = useApp();
  if (!snapshot) return null;
  const st = snapshot.status;
  if (st !== 'bankrupt' && st !== 'goal_reached' && st !== 'finished') return null;
  const f = snapshot.finance;
  const products = snapshot.company?.products ?? [];
  const sales = sum(products, (p) => p.stats?.sales ?? 0);
  const lessons = snapshot.company?.lessons?.length ?? 0;
  const goal = snapshot.scenario?.goal;

  const conf = st === 'bankrupt'
    ? { cls: 'end-bad', icon: 'alert' as const, title: 'Faillite', text: `La trésorerie est à sec au jour ${snapshot.day}. L’agence a appris ${fmtInt(lessons)} leçons — relance un scénario pour qu’elle fasse mieux.` }
    : st === 'goal_reached'
      ? { cls: 'end-good', icon: 'sparkle' as const, title: 'Objectif atteint !', text: `${fmtEurSigned(f?.profit)} de profit au jour ${snapshot.day}${goal ? ` (objectif ${fmtEur(goal.targetProfit, 0)} avant le jour ${goal.byDay})` : ''}.` }
      : { cls: (f?.profit ?? 0) >= 0 ? 'end-good' : 'end-neutral', icon: 'flag' as const, title: 'Fin de la simulation', text: `Horizon de ${snapshot.scenario?.horizonDays ?? snapshot.day} jours atteint. Profit final : ${fmtEurSigned(f?.profit)}.` };

  return (
    <div className={`end-banner glass ${conf.cls}`} role="alert">
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
        <button type="button" className="btn btn-dark btn-sm" onClick={onNewScenario}><Icon name="plus" size={13} /> Nouveau scénario</button>
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Masquer"><Icon name="x" /></button>
      </div>
    </div>
  );
}
