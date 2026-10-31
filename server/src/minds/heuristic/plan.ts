/**
 * The plan chapter is built from the method itself, so no step can be lost: habits run in parallel from
 * their start day and are shown day by day, everything else is a true sequence with its own moments.
 * The diagnostic step is not part of it: it happens before the plan starts.
 */
import { bare, cap, labelOf, lf, norm, splitSentences, theUnit } from '../util.js';
import type { ArchetypeDef } from './archetypes.js';
import type { MethodStep } from './knowledge.js';
import type { NicheCtx } from './niche.js';
import type { SheetSpec } from './profiles.js';

/** One bar of the plan figure: a step, from its first to its last day. */
export interface PlanTrack { from: number; to: number; label: string }

export interface PlanRow {
  label: string;
  actions: string[];    // the method steps of this phase, in reading order
  tracks: PlanTrack[];  // the same steps with their span, on the axis of `PlanModel.span`
}

export interface PlanModel {
  rows: PlanRow[];      // phases, each listing its method steps in reading order
  sheet: SheetSpec;     // the table to tick
  dayByDay: boolean;    // the table has one line per day (or night, or week) of the plan
  span: { days: number; unit: string }; // the axis of the plan figure: its real calendar, else the ranks of its phases
}

/** Inline action for a table cell or a phase line. */
const act = (s: MethodStep): string => {
  const t = lf(s.text).replace(/\s+:\s+/g, ' — ');
  return s.duration ? `${t} (${s.duration})` : t;
};

const FROM: Record<string, string> = { jour: 'du jour', nuit: 'de la nuit', semaine: 'de la semaine', soir: 'du soir', mois: 'du mois' };

/** A bar's label: the column beside the bars holds two lines at most. */
const TRACK_LABEL = 46;
/** What fits behind an action in a table cell. */
const CHECK_MAX = 60;

/** Untagged habits: two from the start, the others spaced over the first 60 % of the plan. */
function stagger(i: number, k: number, n: number): number {
  if (i < 2) return 1;
  return Math.min(n, 1 + Math.round(((i - 1) * Math.ceil(n * 0.6)) / Math.max(1, k - 2)));
}

/** What to look at on a free day: the first sentence of the step's own detail, when it fits a cell. */
function checkOf(s: MethodStep): string {
  const first = bare(splitSentences(s.detail)[0] ?? '');
  return first && first.length <= CHECK_MAX ? ` — ${lf(first)}` : '';
}

function parallelPlan(c: NicheCtx): PlanModel {
  const { n, unitOne } = c.dur;
  const unit = cap(unitOne);
  const steps = c.method.map((s, i) => {
    const from = Math.min(n, Math.max(1, s.from ?? stagger(i, c.method.length, n)));
    return { s, from, to: Math.min(n, Math.max(from, s.to ?? n)) };
  }).sort((a, b) => a.from - b.from);
  const starts = [...new Set(steps.map((x) => x.from))].sort((a, b) => a - b);
  const rows: PlanRow[] = starts.map((from) => {
    const group = steps.filter((x) => x.from === from);
    const oneOff = group.every((x) => x.to === x.from) && from > 1;
    const label = oneOff ? `${unit} ${from}` : from === 1 ? `Dès ${theUnit(unitOne)} 1` : `À partir ${FROM[unitOne] ?? `du ${unitOne}`} ${from}`;
    return { label, actions: group.map((x) => act(x.s)), tracks: group.map((x) => ({ from: x.from, to: x.to, label: labelOf(x.s.text, TRACK_LABEL) })) };
  });
  const cells: (string | null)[][] = [];
  let last = '';
  for (let d = 1; d <= n; d++) {
    const fresh = steps.filter((x) => x.from === d);
    const active = steps.filter((x) => x.from <= d && x.to >= d);
    let text: string;
    if (fresh.length) text = `Démarrer : ${fresh.map((x) => act(x.s)).join(' ; ')}`;
    else if (d === n) text = 'Bilan final : comparer avec vos premières notes';
    else if (unitOne !== 'semaine' && d % 7 === 0) text = 'Bilan de la semaine : relire vos notes, ajuster un seul point';
    else {
      // rotates through what is active: a day of the plan is never the same line as the day before
      const pool = active.length ? active : steps;
      const focus = pool[(d - 1) % pool.length]!;
      text = `Focus : ${act(focus.s)}${checkOf(focus.s)}`;
      if (text === last) text = `Focus : ${act(focus.s)} — noter ce qui a changé`;
    }
    cells.push([text, null]);
    last = text;
  }
  return {
    rows,
    sheet: { title: `Votre plan de ${n} ${c.dur.unit}, à cocher`, columns: [unit, 'Au programme', 'Fait'], rows: Array.from({ length: n }, (_, i) => `${unit} ${i + 1}`), cells },
    dayByDay: true,
    span: { days: n, unit },
  };
}

/** The unit a moment is counted in (« semaines 2 à 6 » → semaine). */
const unitOfMoment = (when: string | null): string => norm(when ?? '').split(/\s+/)[0]?.replace(/s$/, '') ?? '';

function phasedPlan(c: NicheCtx, def: ArchetypeDef): PlanModel {
  const rows: PlanRow[] = [];
  // the real calendar when every step has one, in one unit: « mars » or « 6 mois avant » have no place on a numbered axis
  const counted = c.method.every((s) => s.from !== null && s.to !== null) && new Set(c.method.map((s) => unitOfMoment(s.when))).size === 1;
  c.method.forEach((s, i) => {
    const label = s.when ? cap(s.when) : `${cap(def.stepNoun.word)} ${i + 1}`;
    const last = rows[rows.length - 1];
    const track = { from: s.from ?? 0, to: s.to ?? 0, label: labelOf(s.text, TRACK_LABEL) };
    if (last && last.label === label) {
      last.actions.push(act(s));
      last.tracks.push(track);
    } else rows.push({ label, actions: [act(s)], tracks: [track] });
  });
  const unitOne = counted ? unitOfMoment(c.method[0]!.when) : '';
  const days = Math.max(1, ...c.method.map((s) => s.to ?? 0), unitOne === c.dur.unitOne ? c.dur.n : 0);
  if (!counted) rows.forEach((r, i) => { r.tracks = [{ from: i + 1, to: i + 1, label: `${r.label} : ${labelOf(r.actions[0]!, TRACK_LABEL)}` }]; });
  return {
    rows,
    sheet: { title: `Votre plan de ${c.dur.n} ${c.dur.unit}, à cocher`, columns: [def.planColumn, 'À faire', 'Fait'], rows: rows.map((r) => r.label), cells: rows.map((r) => [r.actions.join(' ; '), null]) },
    dayByDay: false,
    span: counted ? { days, unit: cap(unitOne) } : { days: rows.length, unit: 'Étape' },
  };
}

export function buildPlan(c: NicheCtx, def: ArchetypeDef): PlanModel {
  return def.plan === 'parallele' ? parallelPlan(c) : phasedPlan(c, def);
}
