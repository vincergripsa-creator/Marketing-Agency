/**
 * Growth stages (scale §4.2). A stage is a policy table, not a label: it sets how many guides the company runs, what a
 * paid test gets and where a week's profit goes. Gates read closed days only, from the ledger and the orders. With
 * `scaling` off nothing here decides anything: LEGACY_POLICY carries the old constants, so the control is the old company.
 */
import type { GateCheck, GateProgress, GrowthState, Product, StageId, StagePolicy, WorldState } from '../shared.js';
import { productPnls } from './accounting.js';
import type { RuntimeCtx } from './ctx.js';
import { speak } from './ctx.js';
import { logDecision } from './digest.js';
import { closedWindow, currentBudget, isUpsellProduct, orderRevenue } from './metrics.js';
import { officerId } from './org/officers.js';
import { dec, eur, round2, sum, uniq } from './util.js';

export const STAGES: readonly StageId[] = ['survie', 'adequation', 'acceleration', 'portefeuille'];

export const STAGE_LABELS: Record<StageId, string> = { survie: 'Survie', adequation: 'Adéquation', acceleration: 'Accélération', portefeuille: 'Portefeuille' };

export const STAGE_POLICY: Record<StageId, StagePolicy> = {
  survie: { maxMains: 2, paidTestEur: 100, testDailyEur: 20, creativesPerCampaign: 3, split: { scale: 0.7, test: 0.3, reserve: 0 }, reserveDays: 7, bumpMinSales: null, magnetMinSales: null },
  adequation: { maxMains: 4, paidTestEur: 150, testDailyEur: 25, creativesPerCampaign: 3, split: { scale: 0.6, test: 0.3, reserve: 0.1 }, reserveDays: 10, bumpMinSales: 40, magnetMinSales: 30 },
  acceleration: { maxMains: 8, paidTestEur: 150, testDailyEur: 40, creativesPerCampaign: 5, split: { scale: 0.55, test: 0.25, reserve: 0.2 }, reserveDays: 14, bumpMinSales: 20, magnetMinSales: 15 },
  portefeuille: { maxMains: 12, paidTestEur: 200, testDailyEur: 60, creativesPerCampaign: 6, split: { scale: 0.5, test: 0.25, reserve: 0.25 }, reserveDays: 21, bumpMinSales: 20, magnetMinSales: 15 },
};

/** The company before the growth pillar. It reinvests nothing by rule, so its split and its reserve are never read. */
export const LEGACY_POLICY: StagePolicy = { maxMains: 8, paidTestEur: 0, testDailyEur: 40, creativesPerCampaign: 3, split: { scale: 1, test: 0, reserve: 0 }, reserveDays: 0, bumpMinSales: null, magnetMinSales: null };

/** The gate into each stage: its numbers, and how many Mondays in a row they must hold. */
export const STAGE_GATES = {
  adequation: { weeks: 1, mainSales14: 15, mainRoas14: 1.2, mainSpend14: 80 },
  acceleration: { weeks: 2, profit14: 150, mains: 2, cashMultiple: 1.5 },
  portefeuille: { weeks: 2, profit28: 800, mains: 4, niches: 3, topShare: 0.6, ownedShare: 0.1 },
  /** Mondays in a row with a loss over 28 days before a stage falls by one. */
  floorWeeks: 3,
} as const;

/** Company decisions only: the market runs in both arms, so a paired seed is one market (scale §2.1). */
export function growthOn(w: WorldState): boolean {
  return w.scenario.scaling === true;
}

export function policyOf(w: WorldState): StagePolicy {
  return growthOn(w) ? STAGE_POLICY[w.company.growth?.stage ?? 'survie'] : LEGACY_POLICY;
}

export interface MainRead { product: Product; sales: number; adSpend: number; roas: number | null; contribution: number }

/**
 * Live mains over the last `days` closed days, each with what it really brought in: its own profit, its follow-up's and
 * its kit's, from the ledger. `profit` is the whole company's over the same days.
 */
export function mainsOver(w: WorldState, days: number): { profit: number; mains: MainRead[] } {
  const { fromDay, toDay } = closedWindow(w, days);
  const { products, total } = productPnls(w, fromDay, toDay);
  const rows = new Map(products.map((r) => [r.productId, r]));
  const profitOf = (id: string | null | undefined): number => (id ? rows.get(id)?.profit ?? 0 : 0);
  const mains = w.company.products.filter((p) => p.status === 'live' && p.kind !== 'kit' && !isUpsellProduct(w, p.id)).map((product) => {
    const row = rows.get(product.id);
    return {
      product, sales: row?.sales ?? 0, adSpend: row?.adSpend ?? 0, roas: row?.roas ?? null,
      contribution: round2(profitOf(product.id) + profitOf(product.upsellProductId) + profitOf(product.bumpProductId)),
    };
  });
  return { profit: total, mains };
}

const check = (label: string, value: number, target: number, ok = value >= target): GateCheck => ({ label, value: round2(value), target, ok });

function adequationChecks(w: WorldState): GateCheck[] {
  const { mainSales14, mainRoas14, mainSpend14 } = STAGE_GATES.adequation;
  const { profit, mains } = mainsOver(w, 14);
  const proven = mains.filter((m) => m.sales >= mainSales14 && (m.roas ?? 0) >= mainRoas14 && m.adSpend >= mainSpend14);
  return [
    check('Profit sur 14 jours', profit, 0, profit > 0),
    check(`Guides à ${mainSales14} ventes et ROAS ${dec(mainRoas14, 1)} sur ${eur(mainSpend14)} de pub, 14 jours`, proven.length, 1),
  ];
}

function accelerationChecks(w: WorldState): GateCheck[] {
  const { profit14, mains: minMains, cashMultiple } = STAGE_GATES.acceleration;
  const { profit, mains } = mainsOver(w, 14);
  const cash = currentBudget(w).cash;
  return [
    check('Profit sur 14 jours', profit, profit14),
    check('Guides qui rapportent sur 14 jours', mains.filter((m) => m.contribution > 0).length, minMains),
    check(`Trésorerie, ${dec(cashMultiple, 1)} fois le départ`, cash, round2(cashMultiple * w.scenario.startingCash)),
  ];
}

function portefeuilleChecks(w: WorldState): GateCheck[] {
  const { profit28, mains: minMains, niches, topShare, ownedShare } = STAGE_GATES.portefeuille;
  const { profit, mains } = mainsOver(w, 28);
  const earning = mains.filter((m) => m.contribution > 0);
  const total = sum(earning.map((m) => m.contribution));
  const top = total > 0 ? Math.max(...earning.map((m) => m.contribution)) / total : 1;
  const { fromDay, toDay } = closedWindow(w, 28);
  const { first, followOn } = orderRevenue(w, fromDay, toDay);
  const owned = first + followOn > 0 ? followOn / (first + followOn) : 0;
  return [
    check('Profit sur 28 jours', profit, profit28),
    check('Guides qui rapportent sur 28 jours', earning.length, minMains),
    check('Niches qui rapportent', uniq(earning.map((m) => m.product.nicheId)).length, niches),
    { ...check('Part du meilleur guide', top, topShare, total > 0 && top <= topShare), lower: true },
    check('Part des revenus de la clientèle (e-mail, suites, kits)', owned, ownedShare),
  ];
}

const nextOf = (stage: StageId): StageId | null => STAGES[STAGES.indexOf(stage) + 1] ?? null;

/** The next stage and how far its gate is. Reads, moves nothing: `advanceStage` holds the count. */
export function evaluateStage(ctx: RuntimeCtx): GateProgress {
  const w = ctx.world;
  const stage = w.company.growth?.stage ?? 'survie';
  const next = nextOf(stage);
  const weeksHeld = w.company.growth?.gateWeeks ?? 0;
  if (next === 'adequation') return { next, checks: adequationChecks(w), weeksHeld, weeksNeeded: STAGE_GATES.adequation.weeks };
  if (next === 'acceleration') return { next, checks: accelerationChecks(w), weeksHeld, weeksNeeded: STAGE_GATES.acceleration.weeks };
  if (next === 'portefeuille') return { next, checks: portefeuilleChecks(w), weeksHeld, weeksNeeded: STAGE_GATES.portefeuille.weeks };
  return { next: null, checks: [], weeksHeld: 0, weeksNeeded: 0 };
}

function moveStage(ctx: RuntimeCtx, g: GrowthState, to: StageId, why: string): void {
  const w = ctx.world;
  const text = `l'agence quitte l'étape ${STAGE_LABELS[g.stage]} pour l'étape ${STAGE_LABELS[to]}`; // the label last: the digest reads the move off it
  Object.assign(g, { stage: to, stageSinceDay: w.day, gateWeeks: 0, floorWeeks: 0 });
  g.gate = evaluateStage(ctx);
  logDecision(w, { kind: 'stage', who: officerId(w, 'ceo'), text: text.charAt(0).toUpperCase() + text.slice(1), why });
  speak(ctx, 'ceo', `${text} : ${why}`, 'meeting');
}

/** A gate cleared, as the founder reads it: every number behind the move. */
function gateNumbers(gate: GateProgress): string {
  return gate.checks.map((c) => `${c.label} ${dec(c.value)} (cible ${dec(c.target)})`).join(', ');
}

/** Cash running out does not wait for Monday: back to the first stage at once, any morning. True while it lasts. */
export function dropStage(ctx: RuntimeCtx): boolean {
  const g = ctx.world.company.growth;
  const b = currentBudget(ctx.world);
  const distress = b.survival || b.bankrupt;
  if (g && distress && g.stage !== 'survie') moveStage(ctx, g, 'survie', `${b.bankrupt ? 'trésorerie négative' : 'mode survie'}, ${eur(b.cash)} en caisse`);
  return distress;
}

/**
 * Monday's check. A gate held for its count of checks in a row moves one stage up, 3 Mondays of loss over 28 days move one
 * stage down, cash running out comes first. The count is the stage's own: a move resets it.
 */
export function advanceStage(ctx: RuntimeCtx): void {
  const w = ctx.world;
  const g = w.company.growth;
  if (!g || !growthOn(w)) return;
  const distress = dropStage(ctx);
  const profit28 = mainsOver(w, 28).profit;
  g.floorWeeks = profit28 < 0 && g.stage !== 'survie' ? g.floorWeeks + 1 : 0;
  if (g.floorWeeks >= STAGE_GATES.floorWeeks) moveStage(ctx, g, STAGES[STAGES.indexOf(g.stage) - 1]!, `${g.floorWeeks} lundis de suite en perte sur 28 jours (${eur(profit28)})`);
  else {
    const gate = evaluateStage(ctx);
    const held = !distress && gate.next !== null && gate.checks.every((c) => c.ok);
    g.gateWeeks = held ? g.gateWeeks + 1 : 0;
    if (held && g.gateWeeks >= gate.weeksNeeded) moveStage(ctx, g, gate.next!, gateNumbers(gate));
  }
  g.gate = evaluateStage(ctx);
}
