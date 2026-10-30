// Second row: company badge + connection chip (left), simulation HUD with speed controls (right).
import type { CompanySnapshot } from '../../../shared/types';
import { TICKS_PER_DAY } from '../../../shared/types';
import type { ControlAction, Speed } from '../api';
import type { Connection } from '../store';
import { cx } from './common';
import type { SessionView } from './derive';
import { useApp } from './context';
import { fmtEur, fmtEurSigned } from './format';
import { Icon } from './icons';
import { DIFFICULTY_INFO, PHASE_HINT, PHASE_ICON, PHASE_LABEL } from './labels';

export function CompanyBadge({ connection, lastError, onRetry }: { connection: Connection; lastError: string | null; onRetry(): void }) {
  const { snapshot } = useApp();
  const sc = snapshot?.scenario;
  return (
    <div className="company-col">
      <div className="glass company-badge">
        <span className="badge-red">AGENCE PDF</span>
        <strong className="company-name">{snapshot?.company?.name || sc?.companyName || 'Pixel Agency'}</strong>
        {sc ? (
          <span className="company-sub">
            {sc.name} · {DIFFICULTY_INFO[sc.difficulty]?.label ?? sc.difficulty} · {sc.horizonDays} j
          </span>
        ) : null}
      </div>
      <ConnectionChip connection={connection} lastError={lastError} onRetry={onRetry} />
    </div>
  );
}

function ConnectionChip({ connection, lastError, onRetry }: { connection: Connection; lastError: string | null; onRetry(): void }) {
  if (connection === 'live') return null;
  if (connection === 'demo') {
    return (
      <div className="glass conn-chip conn-demo" title={lastError ?? undefined}>
        <span className="conn-dot" />
        <span className="conn-long">Mode démo (serveur non connecté)</span>
        <span className="conn-short">Mode démo</span>
        <button type="button" className="btn btn-xs" onClick={onRetry}><Icon name="refresh" size={12} /> Réessayer</button>
      </div>
    );
  }
  return (
    <div className="glass conn-chip conn-wait">
      <span className="spinner" />
      <span>{connection === 'connecting' ? 'Connexion au serveur…' : 'Connexion perdue, reconnexion…'}</span>
    </div>
  );
}

/**
 * busy = a control request of ours is in flight. sim = loop state from snapshot.session (server truth),
 * with the run status / remembered speed as fallback.
 */
export function SimHud({ sim, onControl, busy }: { sim: SessionView; onControl(action: ControlAction, speed?: Speed): void; busy: boolean }) {
  const { snapshot, toast } = useApp();
  if (!snapshot) return null;
  const f = snapshot.finance;
  const phase = snapshot.phase ?? 'morning';
  const running = sim.playing;
  const speed = sim.speed;
  const ended = sim.ended;
  // a tick is being computed while paused (+1 tick / +1 jour): don't queue more
  const stepping = sim.busy && !running;
  const lowCash = f && snapshot.scenario && f.cash < snapshot.scenario.startingCash * 0.3;
  const mind = snapshot.mind;
  const tickPct = Math.min(1, ((snapshot.tick ?? 0) + 1) / TICKS_PER_DAY);

  return (
    <div className="glass hud">
      <div className="hud-day" title={PHASE_HINT[phase]}>
        <span className={cx('phase-icon', `phase-${phase}`)}><Icon name={PHASE_ICON[phase]} size={15} /></span>
        <span className="hud-day-text">
          <strong>Jour {snapshot.day}</strong>
          <span className="muted">{PHASE_LABEL[phase]}</span>
        </span>
        <span className={cx('tick-meter', sim.busy && 'is-busy')} aria-hidden="true"><span style={{ width: `${tickPct * 100}%` }} /></span>
      </div>
      <span className="bar-sep" />
      <div className="hud-money" title="Trésorerie disponible">
        <span className="hud-label">Trésorerie</span>
        <strong className={cx(lowCash && 'txt-bad')}>{fmtEur(f?.cash)}</strong>
      </div>
      <div className="hud-money" title="Profit cumulé (hors capital de départ)">
        <span className="hud-label">Profit cumulé</span>
        <strong className={cx((f?.profit ?? 0) >= 0 ? 'txt-good' : 'txt-bad')}>{fmtEurSigned(f?.profit)}</strong>
      </div>
      <MindChip mind={mind} />
      {sim.lastError ? (
        <button type="button" className="hud-error" title={`Incident technique pendant le dernier tick : ${sim.lastError}`}
          onClick={() => toast({ tone: 'warn', title: 'Incident technique', text: `${sim.lastError} — l’agence réessaie au prochain créneau.`, ttl: 9000 })}>
          <Icon name="alert" size={12} /><span className="hud-error-text">Incident</span>
        </button>
      ) : null}
      <span className="bar-sep" />
      <div className="speed" role="group" aria-label="Vitesse de simulation">
        <button type="button" className={cx('icon-btn', running && 'icon-btn-on')} disabled={ended || busy}
          onClick={() => onControl(running ? 'pause' : 'play', speed)} title={running ? 'Pause' : 'Lecture'} aria-pressed={running}>
          <Icon name={running ? 'pause' : 'play'} size={15} />
        </button>
        {([1, 2, 4, 8] as Speed[]).map((s) => (
          <button key={s} type="button" className={cx('speed-btn', speed === s && 'speed-on')} disabled={ended || busy}
            onClick={() => onControl('play', s)} title={`Vitesse ×${s}${speed === s ? (running ? ' (en cours)' : ' (en pause)') : ''}`} aria-pressed={speed === s}>
            ×{s}
          </button>
        ))}
        <button type="button" className="speed-btn speed-step" disabled={ended || busy || stepping} onClick={() => onControl('step')} title="Avancer d’un tick">
          <Icon name="step" size={13} /> +1 tick
        </button>
        <button type="button" className="speed-btn speed-step" disabled={ended || busy || stepping} onClick={() => onControl('day')} title="Avancer d’une journée complète">
          <Icon name="forward" size={13} /> +1 jour
        </button>
      </div>
    </div>
  );
}

function MindChip({ mind }: { mind: CompanySnapshot['mind'] | undefined }) {
  if (!mind) return null;
  const claude = mind.mode === 'claude';
  const title = claude
    ? `Cerveau Claude · ${mind.calls} appels · ${mind.inputTokens.toLocaleString('fr-FR')} jetons entrée / ${mind.outputTokens.toLocaleString('fr-FR')} sortie · ${mind.fallbacks} replis heuristiques`
    : 'Cerveau heuristique : générateurs procéduraux hors-ligne, gratuits et déterministes';
  return (
    <span className={cx('mind-chip', claude ? 'mind-claude' : 'mind-heur')} title={title}>
      <Icon name={claude ? 'sparkle' : 'zap'} size={13} />
      {claude ? <>Claude · {fmtEur(mind.costEur)}</> : 'Heuristique'}
    </span>
  );
}
