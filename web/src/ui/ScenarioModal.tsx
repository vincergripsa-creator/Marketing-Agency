// "Nouveau scénario": configure a fresh run (budget, difficulty, goal, mind) or load a saved one.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { CompanySnapshot, Difficulty } from '../../../shared/types';
import { api, type RunSummary } from '../api';
import { cx, Empty } from './common';
import { useApp } from './context';
import { fmtEur, fmtEurSigned } from './format';
import { Icon } from './icons';
import { DIFFICULTY_INFO } from './labels';
import { budgetError, budgetTooLow, deadlineNote, defaultForm, minCashOf, scenarioConfig, settleField, type NumberField, type ScenarioForm } from './scenarioForm';

const RUN_STATUS: Record<string, string> = { running: 'en cours', paused: 'en pause', bankrupt: 'faillite', goal_reached: 'objectif atteint', finished: 'terminée' };

const randomSeed = () => Math.floor(Math.random() * 100_000);

export function ScenarioModal({ onClose, onLoaded }: { onClose(): void; onLoaded(s: CompanySnapshot): void }) {
  const { snapshot, demo, toast } = useApp();
  const minCash = minCashOf(snapshot);
  const [form, setForm] = useState<ScenarioForm>(() => defaultForm(snapshot?.scenario, minCash, randomSeed()));
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

  const set = <K extends keyof ScenarioForm>(k: K, v: ScenarioForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  /** Raw text while typing; the field settles on blur, or when the scenario is launched. */
  const numberInput = (field: NumberField) => ({
    type: 'text',
    inputMode: 'decimal',
    autoComplete: 'off',
    value: form[field],
    onChange: (e: ChangeEvent<HTMLInputElement>) => { set(field, e.target.value); setError(null); },
    onBlur: () => setForm((f) => settleField(f, field)),
  } as const);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (demo) { setError('Le serveur n’est pas connecté : lance « npm run dev » puis réessaie.'); return; }
    const refusal = budgetError(form, minCash);
    if (refusal) { setError(refusal); return; }
    setBusy(true);
    setError(null);
    const config = scenarioConfig(form);
    try {
      const snap = await api.scenario(config);
      onLoaded(snap);
      toast({ tone: 'good', icon: 'flag', title: 'Nouveau scénario lancé', text: `${config.companyName} · ${fmtEur(config.startingCash ?? 0, 0)} · ${DIFFICULTY_INFO[config.difficulty ?? 'normal'].label} · ${fmtEur(config.goal?.targetProfit, 0)} avant le jour ${config.goal?.byDay}` });
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

  const deadline = deadlineNote(form);

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
              <label className="field">
                <span>Budget de départ (€)</span>
                <input {...numberInput('startingCash')} />
                <span className={cx('field-note', budgetTooLow(form, minCash) && 'is-bad')}>Minimum {fmtEur(minCash, 0)} : frais de démarrage et premier mois de frais fixes.</span>
              </label>
              <label className="field"><span>Horizon (jours)</span><input {...numberInput('horizonDays')} /></label>
              <label className="field"><span>Objectif de profit (€)</span><input {...numberInput('targetProfit')} /></label>
              <label className="field">
                <span>Avant le jour</span>
                <input {...numberInput('byDay')} />
                {deadline ? <span className="field-note is-warn">{deadline}</span> : null}
              </label>
              <label className="field">
                <span>Graine (seed)</span>
                <span className="field-inline">
                  <input {...numberInput('seed')} />
                  <button type="button" className="icon-btn" onClick={() => set('seed', String(randomSeed()))} title="Graine aléatoire"><Icon name="dice" size={15} /></button>
                </span>
              </label>
              <label className="field">
                <span>Plafond compute Claude (€)</span>
                <input {...numberInput('maxComputeEur')} />
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
