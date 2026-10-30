// Apprentissage: is the agency getting better? KPI trends, lessons, bandits, experiments, market truth (god mode).
import { useMemo, useState } from 'react';
import type { BanditArm, DailyKpi, Experiment, Lesson } from '../../../../shared/types';
import { Sparkline, SERIES } from '../charts';
import { Avatar, Bar, cx, Empty, Overlay, Pill, SectionTitle, Segmented } from '../common';
import { useApp } from '../context';
import { fmtDec, fmtEur, fmtInt, fmtPct, fmtRoas, ok, safeDiv } from '../format';
import { Icon } from '../icons';
import {
  agentColor, agentName, banditArmLabel, banditDimensionLabel, EXPERIMENT_DIM_LABEL, EXPERIMENT_STATUS, HOOK_LABEL, LESSON_TOPIC_LABEL,
  LESSON_TOPIC_TONE, METRIC_LABEL,
} from '../labels';

interface Trend { id: string; label: string; values: (number | null)[]; fmt(n: number): string; higherIsBetter: boolean; color: string }

/** Average of the first and of the last measured days (up to 7 each, never overlapping). */
function firstLast(values: (number | null)[]): { first: number | null; last: number | null } {
  const vals = values.filter(ok);
  if (vals.length < 2) return { first: null, last: null };
  const k = Math.max(1, Math.min(7, Math.floor(vals.length / 2)));
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return { first: avg(vals.slice(0, k)), last: avg(vals.slice(vals.length - k)) };
}

export function LearningTab({ onClose }: { onClose(): void }) {
  const { snapshot } = useApp();
  const kpis = snapshot?.company?.kpis ?? [];
  const lessons = snapshot?.company?.lessons ?? [];
  const bandits = snapshot?.company?.bandits ?? {};
  const experiments = snapshot?.company?.experiments ?? [];

  const trends: Trend[] = useMemo(() => {
    const val = (k: DailyKpi, f: (k: DailyKpi) => number, needs: (k: DailyKpi) => boolean) => (needs(k) ? f(k) : null);
    return [
      { id: 'ctr', label: 'CTR des pubs', color: SERIES.blue, higherIsBetter: true, fmt: (n) => fmtPct(n, 2), values: kpis.map((k) => val(k, (x) => x.ctr, (x) => x.impressions > 0)) },
      { id: 'cvr', label: 'Conversion page de vente', color: SERIES.aqua, higherIsBetter: true, fmt: (n) => fmtPct(n, 1), values: kpis.map((k) => val(k, (x) => x.cvr, (x) => x.clicks > 0 || x.sales > 0)) },
      { id: 'roas', label: 'ROAS', color: SERIES.violet, higherIsBetter: true, fmt: fmtRoas, values: kpis.map((k) => val(k, (x) => x.roas, (x) => x.adSpend > 0)) },
      { id: 'refund', label: 'Taux de remboursement', color: SERIES.orange, higherIsBetter: false, fmt: (n) => fmtPct(n, 1), values: kpis.map((k) => val(k, (x) => safeDiv(x.refunds, x.sales), (x) => x.sales > 0)) },
      { id: 'reply', label: 'Qualité des réponses support', color: SERIES.magenta, higherIsBetter: true, fmt: (n) => `${Math.round(n)}/100`, values: kpis.map((k) => val(k, (x) => x.avgReplyScore, (x) => x.avgReplyScore > 0)) },
      { id: 'profit', label: 'Profit quotidien', color: '#0ca30c', higherIsBetter: true, fmt: (n) => fmtEur(n, 0), values: kpis.map((k) => k.profit) },
    ];
  }, [kpis]);

  return (
    <Overlay title="Apprentissage" subtitle={`${fmtInt(lessons.length)} leçons · ${fmtInt(Object.keys(bandits).length)} bandits · ${fmtInt(experiments.length)} expériences`} icon="grad" onClose={onClose}>
      <SectionTitle right={<span className="muted small">premiers jours mesurés vs 7 derniers</span>}>L’agence s’améliore-t-elle ?</SectionTitle>
      {kpis.length < 2 ? <Empty compact icon="trendUp">Les tendances apparaissent après deux journées clôturées.</Empty> : (
        <div className="trend-grid">
          {trends.map((t) => {
            const { first, last } = firstLast(t.values);
            const delta = first !== null && last !== null && first !== 0 ? (last - first) / Math.abs(first) : null;
            // zero baseline: compare directions instead of a meaningless percentage
            const diff = first !== null && last !== null ? last - first : null;
            const better = diff === null || Math.abs(diff) < 1e-9 ? null : t.higherIsBetter ? diff > 0 && (delta === null || delta > 0.02) : diff < 0 && (delta === null || delta < -0.02);
            const worse = diff === null || Math.abs(diff) < 1e-9 ? null : t.higherIsBetter ? diff < 0 && (delta === null || delta < -0.02) : diff > 0 && (delta === null || delta > 0.02);
            return (
              <div key={t.id} className="trend card">
                <div className="trend-label">{t.label}</div>
                <div className="trend-row">
                  <strong>{last !== null ? t.fmt(last) : '—'}</strong>
                  <Sparkline values={t.values} color={t.color} />
                </div>
                <div className={cx('trend-delta', better && 'txt-good', worse && 'txt-bad')}>
                  {first === null || last === null ? 'pas assez de données' : delta === null ? (
                    <>{t.fmt(first)} → {t.fmt(last)} depuis le début</>
                  ) : (
                    <><Icon name={delta >= 0 ? 'trendUp' : 'trendDown'} size={12} /> {delta >= 0 ? '+' : '−'}{fmtPct(Math.abs(delta), 0)} vs début ({first !== null ? t.fmt(first) : '—'})</>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="two-col two-col-wide">
        <div>
          <SectionTitle>Leçons · {lessons.length}</SectionTitle>
          <Lessons lessons={lessons} />
        </div>
        <div>
          <SectionTitle right={<span className="muted small">échantillonnage de Thompson</span>}>Bandits</SectionTitle>
          <Bandits bandits={bandits} />
          <SectionTitle>Expériences A/B · {experiments.length}</SectionTitle>
          <Experiments experiments={experiments} />
        </div>
      </div>
      <GodTruth />
    </Overlay>
  );
}

type TopicFilter = 'all' | Lesson['topic'];

function Lessons({ lessons }: { lessons: Lesson[] }) {
  const { lookups, openBrainNote, openAgent } = useApp();
  const [topic, setTopic] = useState<TopicFilter>('all');
  if (lessons.length === 0) return <Empty compact icon="grad">Aucune leçon encore. Chaque soir, la rétro transforme les chiffres du jour en leçons, écrites dans le cerveau et ajoutées aux playbooks.</Empty>;
  const topics = [...new Set(lessons.map((l) => l.topic))];
  const list = [...lessons].filter((l) => topic === 'all' || l.topic === topic).sort((a, b) => b.day - a.day || b.confidence - a.confidence).slice(0, 60);
  return (
    <>
      <div className="filters-row">
        <Segmented<TopicFilter> size="sm" value={topic} onChange={setTopic} options={[
          { id: 'all', label: 'Toutes', count: lessons.length },
          ...topics.map((t) => ({ id: t, label: LESSON_TOPIC_LABEL[t] ?? t, count: lessons.filter((l) => l.topic === t).length })),
        ]} />
      </div>
      <ol className="timeline">
        {list.map((l) => (
          <li key={l.id} className="tl-item">
            <span className="tl-day">J{l.day}</span>
            <div className="tl-body">
              <div className="tl-top">
                <Pill tone={LESSON_TOPIC_TONE[l.topic] ?? 'neutral'}>{LESSON_TOPIC_LABEL[l.topic] ?? l.topic}</Pill>
                <span className="muted small">par {agentName(lookups, l.source)}</span>
              </div>
              <div className="tl-insight">{l.insight}</div>
              {l.evidence ? <div className="tl-evidence"><Icon name="chart" size={11} /> {l.evidence}</div> : null}
              <div className="tl-conf">
                <span className="small muted">Confiance</span>
                <Bar value={l.confidence} height={5} color={l.confidence >= 0.7 ? '#16a34a' : l.confidence >= 0.4 ? '#d97706' : '#94a3b8'} />
                <span className="small">{fmtPct(l.confidence, 0)}</span>
              </div>
              <div className="tl-applied">
                {l.appliesTo?.length ? <span className="small muted">Appliquée à</span> : null}
                {(l.appliesTo ?? []).slice(0, 8).map((id) => (
                  <button key={id} type="button" className="mini-agent" onClick={() => openAgent(id)} title={agentName(lookups, id)}>
                    <Avatar name={agentName(lookups, id)} color={agentColor(lookups, id)} size={18} />
                  </button>
                ))}
                {l.notePath ? <button type="button" className="link-btn small" onClick={() => openBrainNote(l.notePath)}><Icon name="brain" size={11} /> note</button> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function Bandits({ bandits }: { bandits: Record<string, BanditArm[]> }) {
  const { lookups } = useApp();
  const dims = Object.entries(bandits).filter(([, arms]) => Array.isArray(arms) && arms.length > 0)
    .sort((a, b) => b[1].reduce((s, x) => s + x.pulls, 0) - a[1].reduce((s, x) => s + x.pulls, 0));
  if (dims.length === 0) return <Empty compact icon="dice">Pas encore de bandit : ils démarrent dès les premières pubs, ventes et réponses support.</Empty>;
  return (
    <div className="bandits">
      {dims.map(([key, arms]) => {
        const stats = arms.map((a) => ({ key: a.key, mean: safeDiv(a.alpha, a.alpha + a.beta, 0.5), pulls: a.pulls }));
        const total = stats.reduce((s, x) => s + x.pulls, 0);
        const best = stats.reduce((b, x) => (x.pulls > 0 && x.mean > (b?.mean ?? -1) ? x : b), null as (typeof stats)[number] | null);
        return (
          <div key={key} className="bandit card">
            <div className="bandit-head">
              <strong>{banditDimensionLabel(lookups, key)}</strong>
              <span className="muted small">{fmtInt(total)} essais</span>
            </div>
            {[...stats].sort((a, b) => b.mean - a.mean).map((s) => (
              <div key={s.key} className={cx('arm', best?.key === s.key && 'arm-best')}>
                <span className="arm-label">{banditArmLabel(lookups, key, s.key)}</span>
                <Bar value={s.mean} color={best?.key === s.key ? '#2a78d6' : '#9ec5f4'} height={7} />
                <span className="arm-val">{fmtDec(s.mean, 2)}</span>
                <span className="arm-pulls muted">{fmtInt(s.pulls)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Experiments({ experiments }: { experiments: Experiment[] }) {
  const { lookups } = useApp();
  if (experiments.length === 0) return <Empty compact icon="layers">Aucune expérience formalisée pour l’instant.</Empty>;
  const list = [...experiments].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.day - a.day).slice(0, 20);
  return (
    <div className="experiments">
      {list.map((e) => {
        const values = e.variants.map((v) => e.results?.[v]?.value ?? 0);
        const max = Math.max(0.0001, ...values);
        const isRate = e.metric === 'ctr' || e.metric === 'cvr' || e.metric === 'refund_rate' || e.metric === 'resolution';
        // a price test compares euros per visitor, whatever its metric says (experimentValueKind on the server)
        const perVisitor = e.dimension === 'price' && e.metric !== 'refund_rate';
        const status = EXPERIMENT_STATUS[e.status];
        return (
          <div key={e.id} className="experiment card">
            <div className="bandit-head">
              <Pill tone={status.tone} title={status.title}>{status.label}</Pill>
              <span className="muted small">{EXPERIMENT_DIM_LABEL[e.dimension] ?? e.dimension} · {perVisitor ? 'Profit par visiteur' : METRIC_LABEL[e.metric] ?? e.metric} · J{e.day}{e.endDay ? ` → J${e.endDay}` : ''} · {agentName(lookups, e.owner)}</span>
            </div>
            <div className="exp-hyp">{e.hypothesis}</div>
            {e.variants.map((v) => {
              const r = e.results?.[v];
              const label = banditArmLabel(lookups, e.dimension === 'sales_hype' ? 'hype' : e.dimension, v);
              return (
                <div key={v} className={cx('arm', e.winner === v && 'arm-best')}>
                  <span className="arm-label">{e.winner === v ? <Icon name="crown" size={11} /> : null} {label}</span>
                  <Bar value={(r?.value ?? 0) / max} color={e.winner === v ? '#16a34a' : '#9ec5f4'} height={7} />
                  <span className="arm-val" title={perVisitor ? 'Par visiteur' : undefined}>{r ? (perVisitor ? fmtEur(r.value) : isRate ? fmtPct(r.value, 1) : e.metric === 'roas' ? fmtRoas(r.value) : fmtDec(r.value, 2)) : '—'}</span>
                  <span className="arm-pulls muted">n={fmtInt(r?.n ?? 0)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function GodTruth() {
  const { snapshot, godMode } = useApp();
  const niches = snapshot?.godMode?.niches ?? [];
  if (!godMode) return null;
  return (
    <div className="god-truth card">
      <SectionTitle right={<Pill tone="violet" icon="eye">mode dieu</Pill>}>Vérité cachée du marché</SectionTitle>
      {niches.length === 0 ? <div className="muted small">Aucune donnée cachée reçue du serveur.</div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Niche</th><th className="num">Demande</th><th className="num">Prix accepté (min · idéal · max)</th><th className="num">Concurrence</th><th className="num">Affinité TikTok</th><th>Meilleur hook</th></tr></thead>
            <tbody>
              {niches.map((n) => {
                const bestHook = Object.entries(n.hookAffinity ?? {}).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
                return (
                  <tr key={n.id}>
                    <td><strong>{n.name}</strong></td>
                    <td className="num">{fmtPct(n.demand, 0)}</td>
                    <td className="num">{fmtEur(n.wtp?.min, 0)} · <strong>{fmtEur(n.wtp?.sweet, 0)}</strong> · {fmtEur(n.wtp?.max, 0)}</td>
                    <td className="num">{fmtPct(n.competition, 0)}</td>
                    <td className="num">{fmtPct(n.tiktokAffinity, 0)}</td>
                    <td className="small">{bestHook ? `${HOOK_LABEL[bestHook[0] as keyof typeof HOOK_LABEL] ?? bestHook[0]} ×${fmtDec(bestHook[1] ?? 1, 1)}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">Ces chiffres sont invisibles pour les agents : ils doivent les deviner avec leurs recherches bruitées et leurs tests.</div>
    </div>
  );
}
