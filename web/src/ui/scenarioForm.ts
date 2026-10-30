// State of the « Nouveau scénario » form (pure, unit-tested in derive.test.ts).
// A number field keeps what the founder types: nothing is parsed or clamped before blur or submit,
// and a field never moves another one.
import type { CompanySnapshot, ScenarioConfig } from '../../../shared/types';
import { fmtEur } from './format';

export type NumberField = 'startingCash' | 'horizonDays' | 'targetProfit' | 'byDay' | 'seed' | 'maxComputeEur';

export type ScenarioForm = Omit<ScenarioConfig, 'goal' | 'startingCash' | 'horizonDays' | 'seed' | 'maxComputeEur'> & Record<NumberField, string>;

/** Only used without server (demo mode): the server states its own minimum in SessionInfo. */
const FALLBACK_MIN_CASH = 110;
const FALLBACK_CASH = 500;
const FALLBACK_HORIZON = 60;

interface Limits { min: number; max: number; fallback: number; integer?: boolean }

const LIMITS: Record<Exclude<NumberField, 'byDay'>, Limits> = {
  // the minimum budget is a refusal (budgetError), never a silent raise: 0 here on purpose
  startingCash: { min: 0, max: 100_000, fallback: FALLBACK_CASH },
  horizonDays: { min: 7, max: 365, fallback: FALLBACK_HORIZON, integer: true },
  targetProfit: { min: 0, max: 1_000_000, fallback: 1000 },
  seed: { min: 0, max: 2 ** 31 - 1, fallback: 42, integer: true },
  maxComputeEur: { min: 0, max: 500, fallback: 5 },
};

/** Lowest budget the server accepts. */
export function minCashOf(s: CompanySnapshot | null | undefined): number {
  const min = s?.session?.minStartingCash;
  return typeof min === 'number' && Number.isFinite(min) && min > 0 ? min : FALLBACK_MIN_CASH;
}

export function defaultForm(s: ScenarioConfig | undefined, minCash: number, seed: number): ScenarioForm {
  return {
    name: s?.name ?? 'Agence PDF',
    companyName: s?.companyName ?? 'Pixel Agency',
    seed: String(seed),
    startingCash: String(Math.max(s?.startingCash ?? FALLBACK_CASH, minCash)),
    horizonDays: String(s?.horizonDays ?? FALLBACK_HORIZON),
    difficulty: s?.difficulty ?? 'normal',
    mindMode: s?.mindMode ?? 'auto',
    founderApproval: s?.founderApproval ?? false,
    chargeCompute: s?.chargeCompute ?? false,
    maxComputeEur: String(s?.maxComputeEur ?? 5),
    targetProfit: String(s?.goal?.targetProfit ?? 1000),
    byDay: String(s?.goal?.byDay ?? s?.horizonDays ?? FALLBACK_HORIZON),
  };
}

/** The number in a raw field: French comma and thousands spaces accepted, null when it is not one. */
export function readNumber(raw: string): number | null {
  const t = raw.replace(/[\s  ]/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function within(raw: string, { min, max, fallback, integer }: Limits): number {
  const n = readNumber(raw) ?? fallback;
  const v = Math.min(max, Math.max(min, n));
  return integer ? Math.floor(v) : Math.round(v * 100) / 100;
}

/** Value a field stands for once settled. The goal's deadline cannot pass the end of the run. */
function settled(form: ScenarioForm, field: NumberField): number {
  if (field !== 'byDay') return within(form[field], LIMITS[field]);
  const horizon = settled(form, 'horizonDays');
  return within(form.byDay, { min: 1, max: horizon, fallback: horizon, integer: true });
}

/** Blur: this field, and only this one, takes its settled value. */
export function settleField(form: ScenarioForm, field: NumberField): ScenarioForm {
  return { ...form, [field]: String(settled(form, field)) };
}

/** The deadline as typed passes the horizon: said under the field, applied only when the run starts. */
export function deadlineNote(form: ScenarioForm): string | null {
  const byDay = readNumber(form.byDay);
  const horizon = settled(form, 'horizonDays');
  return byDay !== null && byDay > horizon ? `Après la fin de la simulation : l’objectif sera ramené au jour ${horizon}.` : null;
}

export function budgetTooLow(form: ScenarioForm, minCash: number): boolean {
  const cash = readNumber(form.startingCash);
  return cash !== null && cash < minCash;
}

/** French refusal of a budget that cannot open a company, null when it can. */
export function budgetError(form: ScenarioForm, minCash: number): string | null {
  if (!budgetTooLow(form, minCash)) return null;
  return `Budget de départ trop bas : il faut au moins ${fmtEur(minCash, 0)} pour payer les frais de démarrage et le premier mois de frais fixes. Avec moins, l’agence serait en faillite dès le premier jour.`;
}

/** The scenario to launch: every number settled from what the form shows. */
export function scenarioConfig(form: ScenarioForm): Partial<ScenarioConfig> {
  const { targetProfit: _targetProfit, byDay: _byDay, ...rest } = form;
  return {
    ...rest,
    name: form.name.trim() || 'Agence PDF',
    companyName: form.companyName.trim() || 'Pixel Agency',
    seed: settled(form, 'seed'),
    startingCash: settled(form, 'startingCash'),
    horizonDays: settled(form, 'horizonDays'),
    maxComputeEur: settled(form, 'maxComputeEur'),
    goal: { targetProfit: settled(form, 'targetProfit'), byDay: settled(form, 'byDay') },
  };
}
