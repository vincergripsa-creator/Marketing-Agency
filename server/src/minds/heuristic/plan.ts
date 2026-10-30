/**
 * The plan chapter is built from the method itself, so no step can be lost: habits run in parallel from
 * their start day and are shown day by day, everything else is a true sequence with its own moments.
 * The diagnostic step is not part of it: it happens before the plan starts.
 */
import { cap, lf, theUnit } from '../util.js';
import type { ArchetypeDef } from './archetypes.js';
import type { MethodStep } from './knowledge.js';
import type { NicheCtx } from './niche.js';
import type { SheetSpec } from './profiles.js';

export interface PlanRow { label: string; actions: string[] }

export interface PlanModel {
  rows: PlanRow[];      // phases, each listing its method steps in reading order
  sheet: SheetSpec;     // the table to tick
  dayByDay: boolean;    // the table has one line per day (or night, or week) of the plan
}

/** Inline action for a table cell or a phase line. */
const act = (s: MethodStep): string => {
  const t = lf(s.text).replace(/\s+:\s+/g, ' — ');
  return s.duration ? `${t} (${s.duration})` : t;
};

const FROM: Record<string, string> = { jour: 'du jour', nuit: 'de la nuit', semaine: 'de la semaine', soir: 'du soir', mois: 'du mois' };

/** Untagged habits: two from the start, the others spaced over the first 60 % of the plan. */
function stagger(i: number, k: number, n: number): number {
  if (i < 2) return 1;
  return Math.min(n, 1 + Math.round(((i - 1) * Math.ceil(n * 0.6)) / Math.max(1, k - 2)));
}

function parallelPlan(c: NicheCtx): PlanModel {
  const { n, unitOne } = c.dur;
  const unit = cap(unitOne);
  const steps = c.method.map((s, i) => {
    const from = Math.min(n, Math.max(1, s.from ?? stagger(i, c.method.length, n)));
    return { s, from, to: Math.min(n, Math.max(from, s.to ?? n)) };
  });
  const starts = [...new Set(steps.map((x) => x.from))].sort((a, b) => a - b);
  const rows: PlanRow[] = starts.map((from) => {
    const group = steps.filter((x) => x.from === from);
    const oneOff = group.every((x) => x.to === x.from) && from > 1;
    const label = oneOff ? `${unit} ${from}` : from === 1 ? `Dès ${theUnit(unitOne)} 1` : `À partir ${FROM[unitOne] ?? `du ${unitOne}`} ${from}`;
    return { label, actions: group.map((x) => act(x.s)) };
  });
  const cells: (string | null)[][] = [];
  for (let d = 1; d <= n; d++) {
    const fresh = steps.filter((x) => x.from === d);
    const active = steps.filter((x) => x.from <= d && x.to >= d);
    let text: string;
    if (fresh.length) text = `Démarrer : ${fresh.map((x) => act(x.s)).join(' ; ')}`;
    else if (d === n) text = 'Bilan final : comparer avec vos premières notes';
    else if (unitOne !== 'semaine' && d % 7 === 0) text = 'Bilan de la semaine : relire vos notes, ajuster un seul point';
    else text = `Priorité : ${act(active[(d - 1) % Math.max(1, active.length)]?.s ?? steps[0]!.s)}`;
    cells.push([text, null]);
  }
  return {
    rows,
    sheet: { title: `Votre plan de ${n} ${c.dur.unit}, à cocher`, columns: [unit, 'Au programme', 'Fait'], rows: Array.from({ length: n }, (_, i) => `${unit} ${i + 1}`), cells },
    dayByDay: true,
  };
}

function phasedPlan(c: NicheCtx, def: ArchetypeDef): PlanModel {
  const rows: PlanRow[] = [];
  c.method.forEach((s, i) => {
    const label = s.when ? cap(s.when) : `${cap(def.stepNoun.word)} ${i + 1}`;
    const last = rows[rows.length - 1];
    if (last && last.label === label) last.actions.push(act(s));
    else rows.push({ label, actions: [act(s)] });
  });
  return {
    rows,
    sheet: { title: `Votre plan de ${c.dur.n} ${c.dur.unit}, à cocher`, columns: [def.planColumn, 'À faire', 'Fait'], rows: rows.map((r) => r.label), cells: rows.map((r) => [r.actions.join(' ; '), null]) },
    dayByDay: false,
  };
}

export function buildPlan(c: NicheCtx, def: ArchetypeDef): PlanModel {
  return def.plan === 'parallele' ? parallelPlan(c) : phasedPlan(c, def);
}
