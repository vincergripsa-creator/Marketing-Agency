// "Nouveau scénario": configure a fresh run (budget, difficulty, goal, mind) or load a saved one.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CompanySnapshot, Difficulty, ScenarioConfig } from '../../../shared/types';
import { api, type RunSummary } from '../api';
import { cx, Empty } from './common';
import { useApp } from './context';
import { fmtEur, fmtEurSigned } from './format';
import { Icon } from './icons';
import { DIFFICULTY_INFO } from './labels';

const RUN_STATUS: Record<string, string> = { running: 'en cours', paused: 'en pause', bankrupt: 'faillite', goal_reached: 'objectif atteint', finished: 'terminée' };

type Form = Omit<ScenarioConfig, 'goal'> & { targetProfit: number; byDay: number };

function defaults(s: ScenarioConfig | undefined): Form {
  return {
    name: s?.name ?? 'Agence PDF',
    companyName: s?.companyName ?? 'Pixel Agency',
    seed: Math.floor(Math.random() * 100_000),
    startingCash: s?.startingCash ?? 500,
    horizonDays: s?.horizonDays ?? 60,
    difficulty: s?.difficulty ?? 'normal',
    mindMode: s?.mindMode ?? 'auto',
    founderApproval: s?.founderApproval ?? false,
    chargeCompute: s?.chargeCompute ?? false,
    maxComputeEur: s?.maxComputeEur ?? 5,
    targetProfit: s?.goal?.targetProfit ?? 1000,
    byDay: s?.goal?.byDay ?? s?.horizonDays ?? 60,
  };
}

function num(v: string, fallback: number, min: number, max: number): number {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function ScenarioModal({ onClose, onLoaded }: { onClose(): void; onLoaded(s: CompanySnapshot): void }) {
  const { snapshot, demo, toast } = useApp();
  const [form, setForm] = useState<Form>(() => defaults(snapshot?.scenario));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector('input')?.focus();
    if (demo) { setRuns([]); setRunsError('Serveur non connecté'); return; }
    let cancelled = false;
    api.runs().then((r) => { if (!cancelled) setRuns(r); }).catch((e) => { if (!cancelled) { setRuns([]); setRunsError(e instanceof Error ? e.message : 'Indisponible'); } });
    return () => { cancelled = true; };
  }, [demo]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (demo) { setError('Le serveur n’est pas connecté : lance « npm run dev » puis réessaie.'); return; }
    setBusy(true);
    setError(null);
    const { targetProfit, byDay, ...rest } = form;
    const config: Partial<ScenarioConfig> = {
      ...rest,
      name: rest.name.trim() || 'Agence PDF',
      companyName: rest.companyName.trim() || 'Pixel Agency',
      goal: { targetProfit, byDay: Math.min(byDay, rest.horizonDays) },
    };
    try {
      const snap = await api.scenario(config);
      onLoaded(snap);
      toast({ tone: 'good', icon: 'flag', title: 'Nouveau scénario lancé', text: `${config.companyName} · ${fmtEur(config.startingCash ?? 0, 0)} · ${DIFFICULTY_INFO[config.difficulty ?? 'normal'].label}` });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de lancer le scénario');
    } finally {
      setBusy(false);
    }
  };

  const load = async (runId: string) => {
    setBusy(true);
    setError(null);
    try {
      const snap = await api.load(runId);
      onLoaded(snap);
      toast({ tone: 'info', icon: 'refresh', title: 'Run chargée', text: runId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal glass" role="dialog" aria-modal="true" aria-label="Nouveau scénario" ref={dialogRef}>
        <header className="overlay-head">
          <span className="overlay-icon"><Icon name="plus" size={17} /></span>
          <div className="overlay-titles">
            <h2>Nouveau scénario</h2>
            <div className="overlay-sub">L’agence repart de zéro avec son budget, apprend seule et doit devenir rentable.</div>
          </div>
          <div className="overlay-actions">
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
          </div>
        </header>
        <div className="modal-body">
          <form className="scenario-form" onSubmit={(e) => void submit(e)}>
            <div className="form-grid">
              <label className="field"><span>Nom du scénario</span><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={60} /></label>
              <label className="field"><span>Entreprise</span><input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} maxLength={40} /></label>
              <label className="field"><span>Budget de départ (€)</span><input type="number" min={50} max={100000} step={50} value={form.startingCash} onChange={(e) => set('startingCash', num(e.target.value, 500, 50, 100000))} /></label>
              <label className="field"><span>Horizon (jours)</span><input type="number" min={7} max={365} value={form.horizonDays} onChange={(e) => { const h = num(e.target.value, 60, 7, 365); setForm((f) => ({ ...f, horizonDays: h, byDay: Math.min(f.byDay, h) || h })); }} /></label>
              <label className="field"><span>Objectif de profit (€)</span><input type="number" min={0} max={1000000} step={50} value={form.targetProfit} onChange={(e) => set('targetProfit', num(e.target.value, 1000, 0, 1_000_000))} /></label>
              <label className="field"><span>Avant le jour</span><input type="number" min={1} max={form.horizonDays} value={form.byDay} onChange={(e) => set('byDay', num(e.target.value, form.horizonDays, 1, form.horizonDays))} /></label>
              <label className="field">
                <span>Graine (seed)</span>
                <span className="field-inline">
                  <input type="number" value={form.seed} onChange={(e) => set('seed', Math.floor(num(e.target.value, 42, 0, 2 ** 31 - 1)))} />
                  <button type="button" className="icon-btn" onClick={() => set('seed', Math.floor(Math.random() * 100_000))} title="Graine aléatoire"><Icon name="dice" size={15} /></button>
                </span>
              </label>
              <label className="field">
                <span>Plafond compute Claude (€)</span>
                <input type="number" min={0} max={500} step={1} value={form.maxComputeEur} onChange={(e) => set('maxComputeEur', num(e.target.value, 5, 0, 500))} />
              </label>
            </div>

            <div className="field-label">Difficulté</div>
            <div className="difficulty">
              {(['facile', 'normal', 'cauchemar'] as Difficulty[]).map((d) => (
                <button key={d} type="button" className={cx('diff-card', `diff-${d}`, form.difficulty === d && 'is-on')} onClick={() => set('difficulty', d)} aria-pressed={form.difficulty === d}>
                  <strong>{DIFFICULTY_INFO[d].label}</strong>
                  <span>{DIFFICULTY_INFO[d].text}</span>
                </button>
              ))}
            </div>

            <div className="field-label">Mode cerveau</div>
            <div className="segmented">
              {([['auto', 'Auto'], ['heuristic', 'Heuristique'], ['claude', 'Claude']] as const).map(([id, label]) => (
                <button key={id} type="button" className={cx('seg', form.mindMode === id && 'seg-active')} onClick={() => set('mindMode', id)}>{label}</button>
              ))}
            </div>
            <div className="muted small field-help">
              {form.mindMode === 'auto' ? 'Claude si une clé ANTHROPIC_API_KEY est configurée côté serveur, sinon heuristique.' : form.mindMode === 'claude' ? 'Chaque agent pense avec Claude (Opus, Sonnet, Haiku selon le rôle), dans la limite du plafond.' : 'Générateurs procéduraux hors-ligne : gratuit et déterministe.'}
            </div>

            <div className="toggles">
              <label className="toggle">
                <input type="checkbox" checked={form.founderApproval} onChange={(e) => set('founderApproval', e.target.checked)} />
                <span className="toggle-ui" />
                <span><strong>Validation fondateur</strong><span className="muted small">Lancements, pubs et remboursements &gt; 50 € attendent ton feu vert.</span></span>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={form.chargeCompute} onChange={(e) => set('chargeCompute', e.target.checked)} />
                <span className="toggle-ui" />
                <span><strong>Facturer le compute</strong><span className="muted small">Le coût réel des jetons Claude est débité de la trésorerie.</span></span>
              </label>
            </div>

            {error ? <div className="banner-inline banner-bad"><Icon name="alert" size={13} /> {error}</div> : null}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>Annuler</button>
              <button type="submit" className="btn btn-dark" disabled={busy}>{busy ? <span className="spinner spinner-light" /> : <Icon name="play" size={13} />} Lancer le scénario</button>
            </div>
          </form>

          <aside className="runs">
            <div className="field-label">Runs sauvegardées</div>
            {runs === null ? <div className="muted small"><span className="spinner" /> Chargement…</div> : null}
            {runs && runs.length === 0 ? <Empty compact icon="layers">{runsError ? `Liste indisponible (${runsError}).` : 'Aucune run sauvegardée.'}</Empty> : null}
            <div className="runs-list">
              {(runs ?? []).map((r) => (
                <div key={r.runId} className={cx('run', r.runId === snapshot?.runId && 'is-current')}>
                  <div className="run-main">
                    <strong>{r.companyName ?? r.name ?? r.runId}</strong>
                    <span className="muted small">
                      {[r.name && r.companyName ? r.name : null, r.difficulty ? DIFFICULTY_INFO[r.difficulty as Difficulty]?.label ?? r.difficulty : null, typeof r.day === 'number' ? `jour ${r.day}` : null, r.status ? RUN_STATUS[r.status] ?? r.status : null].filter(Boolean).join(' · ') || r.runId}
                    </span>
                    {typeof r.profit === 'number' || typeof r.cash === 'number' ? (
                      <span className="small">
                        {typeof r.cash === 'number' ? <>Trésorerie {fmtEur(r.cash, 0)} </> : null}
                        {typeof r.profit === 'number' ? <span className={r.profit >= 0 ? 'txt-good' : 'txt-bad'}>· {fmtEurSigned(r.profit, 0)}</span> : null}
                      </span>
                    ) : null}
                  </div>
                  {r.runId === snapshot?.runId ? <span className="pill tone-green">en cours</span> : (
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void load(r.runId)}>Charger</button>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
