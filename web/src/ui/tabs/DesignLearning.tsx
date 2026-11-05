// Apprentissage › Design (design plan D207): what the agents believe of looks, niche by niche, as their bandits hold it; their page
// tests and what they found. In god mode only, the market's true taste beside each arm (D201), so belief and truth can be compared.
import type { CompanySnapshot, Experiment, VisualTaste } from '../../../../shared/types';
import { Bar, cx, Empty } from '../common';
import { useApp } from '../context';
import { designBandits, favouriteOf, isPageTest, LOOK_KINDS, LOOK_TITLE, lookLabel, truthOf, type ArmRead, type LookKind, type NicheLooks } from '../design';
import { fmtDec, fmtInt, fmtPct, plural } from '../format';
import { Icon } from '../icons';
import { nicheName, type Lookups } from '../labels';
import { PageTestRow } from '../Looks';

const KIND_NOUN: Record<LookKind, string> = { style: 'style', template: 'gabarit', hero: 'visuel' };

/** The niche of a page test: its own, else its guide's. */
function nicheOfTest(e: Experiment, l: Lookups): string | null {
  return e.nicheId ?? (e.productId ? l.products.get(e.productId)?.nicheId ?? null : null);
}

/** Niches that hold a design bandit or a page test, most measured first; with no bandit yet, a niche still shows its tests. */
export function designNiches(s: CompanySnapshot | null, l: Lookups): { niche: NicheLooks; tests: Experiment[] }[] {
  const bandits = designBandits(s?.company?.bandits);
  const tests = (s?.company?.experiments ?? []).filter(isPageTest);
  const out = bandits.map((niche) => ({ niche, tests: [] as Experiment[] }));
  for (const e of tests) {
    const id = nicheOfTest(e, l);
    if (!id) continue;
    let row = out.find((r) => r.niche.nicheId === id);
    if (!row) out.push(row = { niche: { nicheId: id, kinds: {}, days: 0 }, tests: [] });
    row.tests.push(e);
  }
  for (const r of out) r.tests.sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.day - a.day);
  return out;
}

/** « vérité : style « Aura » ×1,14 — les agents misent sur « Pop » ». */
function truthLine(niche: NicheLooks, taste: VisualTaste): string {
  return LOOK_KINDS.flatMap((k) => {
    const t = truthOf(taste, k);
    if (!t?.best) return [];
    const fav = favouriteOf(niche.kinds[k]);
    const agree = fav && fav.arm.key === t.best ? 'les agents l’ont trouvé' : fav ? `les agents misent sur « ${fav.arm.label} »` : 'pas encore de pari';
    return [`${KIND_NOUN[k]} « ${lookLabel(k, t.best)} » ×${fmtDec(t.values[t.best] ?? 1, 2)} (${agree})`];
  }).join(' · ');
}

function Dim({ kind, arms, taste }: { kind: LookKind; arms: ArmRead[] | undefined; taste: VisualTaste | undefined }) {
  const fav = favouriteOf(arms);
  const truth = truthOf(taste, kind);
  const max = Math.max(0.0001, ...(arms ?? []).map((a) => a.cvr));
  return (
    <div className="design-dim" data-kind={kind}>
      <div className="design-dim-head">
        {LOOK_TITLE[kind]}
        {fav ? <span className="fav">· favori : {fav.arm.label}{fav.measured ? '' : ' (convention de la recherche, jamais porté)'}</span> : null}
      </div>
      {arms?.length ? arms.map((a) => {
        const best = fav?.arm.key === a.key;
        const real = truth?.values[a.key];
        return (
          <div key={a.key} className={cx('arm design-arm', best && 'arm-best', truth && 'with-truth')}>
            <span className="arm-label" title={best ? 'Le favori du bandit aujourd’hui' : undefined}>{best ? <Icon name="crown" size={11} /> : null}{a.label}</span>
            <Bar value={a.cvr / max} color={best ? '#2a78d6' : '#9ec5f4'} height={7} />
            <span className="arm-val" title="Conversion estimée par le bandit (remboursements déduits)">{fmtPct(a.cvr, 1)}</span>
            <span className="arm-pulls muted" title="Jours de ventes mesurés">{fmtInt(a.pulls)} j</span>
            {truth ? (
              <span className={cx('arm-truth', truth.best === a.key && 'truth-best')} title="Goût réel du marché pour ce look (mode dieu) : ×1 = neutre">
                {truth.best === a.key ? <Icon name="eye" size={10} /> : null}×{fmtDec(real ?? 1, 2)}
              </span>
            ) : null}
          </div>
        );
      }) : <div className="muted small">Pas encore de mesure.</div>}
    </div>
  );
}

export function DesignLearning() {
  const { snapshot, lookups, godMode } = useApp();
  const rows = designNiches(snapshot, lookups);
  const day = snapshot?.day ?? 1;
  if (!rows.length) {
    return (
      <Empty compact icon="palette">
        Pas encore de données de design. Chaque soir, la rétro note pour chaque guide en vente le style de sa couverture, le gabarit et le visuel de sa page, puis ses visites et ses ventes du jour : les bandits de sa niche apprennent ainsi quels looks vendent.
      </Empty>
    );
  }
  const truths = godMode ? snapshot?.godMode?.niches ?? [] : [];
  return (
    <div className="design-niches">
      {rows.map(({ niche, tests }) => {
        const taste = truths.find((n) => n.id === niche.nicheId)?.visualTaste;
        return (
          <div key={niche.nicheId} className="design-niche card" data-niche={niche.nicheId}>
            <div className="bandit-head">
              <strong>{nicheName(lookups, niche.nicheId)}</strong>
              <span className="muted small">{niche.days ? `${plural(niche.days, 'jour', 'jours')} de ventes ${niche.days >= 2 ? 'mesurés' : 'mesuré'}` : 'pas encore de vente mesurée'}</span>
            </div>
            {taste ? <div className="god-line"><Icon name="eye" size={12} /> <span><strong>Vérité du marché :</strong> {truthLine(niche, taste)}</span></div> : null}
            <div className="design-dims">
              {LOOK_KINDS.map((k) => <Dim key={k} kind={k} arms={niche.kinds[k]} taste={taste} />)}
            </div>
            {tests.length ? (
              <div className="design-tests">
                <div className="design-dim-head">Tests de gabarit · {fmtInt(tests.length)}</div>
                {tests.slice(0, 6).map((e) => <PageTestRow key={e.id} e={e} day={day} product={e.productId ? lookups.products.get(e.productId)?.title ?? null : null} />)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
