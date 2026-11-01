/**
 * The CEO's Monday over the guides on sale (scale §5). A main is judged on what it really brought in over 28 days, never before a real
 * paid test. A loser its buyers like stops costing and goes on selling, one they dislike stops. Everything here is observable: ledger,
 * ad stats, reviews, refunds. Rival pressure is never read: it shows as a fall in paid conversion.
 */
import type { AgentId, PortfolioLine, PortfolioReview, PortfolioVerdict, Product, StagePolicy, WorldState } from '../shared.js';
import { channelOf } from '../shared.js';
import { harvesting, isReworking, productHealth, refundsTooHigh, versionSince } from './acquisition.js';
import { allocationOf } from './cfo.js';
import type { RuntimeCtx } from './ctx.js';
import { speak } from './ctx.js';
import { logDecision } from './digest.js';
import { detectedComplaints, productMetrics, referenceChannel } from './metrics.js';
import { sim } from './modules.js';
import { officerId } from './org/officers.js';
import { buyersLike, buyersRead, harvestProduct, killProduct, learnNiche, paidOn, roasOver } from './pipeline.js';
import { growthOn, mainsOver, type MainRead, policyOf } from './stages.js';
import { dec, eur, pct, round2, short, sum } from './util.js';

export const PORTFOLIO = {
  maxVersion: 3,                                  // a guide is rewritten twice, no more
  cvrDrop: 0.3, cvrDays: 14, cvrViews: 200,       // the fall in paid conversion that calls for a new version, and what it is read on
  retestDays: 45,                                 // a harvested guide waits this long for its one paid test
} as const;

const VERDICT_LABELS: Record<PortfolioVerdict, string> = { test: 'en test', double_down: 'à pousser', keep: 'gardé(s)', rework: 'à réécrire', harvest: 'en récolte', kill: 'arrêté(s)' };

/** Buyers themselves say something is wrong: a rewrite can help. Otherwise the problem is the market, not the text. */
export function buyersUnhappy(w: WorldState, p: Product): boolean {
  const h = productHealth(w, p);
  const m = productMetrics(w, p.id, h.since);
  return (h.reviews.length >= 3 && h.rating > 0 && h.rating < 4) || detectedComplaints(w, p.id, h.since) >= 2 || refundsTooHigh(m.refunds, m.sales);
}

/** How far paid conversion fell: the last 14 closed days against the best 14 days of this version, 200 views each at least. Null when it cannot be read. */
export function cvrDrop(w: WorldState, p: Product, since: number): number | null {
  const { cvrDays, cvrViews } = PORTFOLIO;
  const channel = referenceChannel(w, p.id); // a channel's intent is its own: a mix shift is no drop
  const outage = sim.announcedOutageDays(w);
  const toDay = sim.lastClosedDay(w);
  const days = new Map<number, { views: number; buys: number }>();
  for (const s of w.market.adStats) {
    if (s.productId !== p.id || s.day < since || s.day > toDay || channelOf(s) !== channel || outage.includes(s.day)) continue;
    const d = days.get(s.day) ?? { views: 0, buys: 0 };
    d.views += s.landingViews;
    d.buys += s.purchases;
    days.set(s.day, d);
  }
  const windowEnding = (end: number): number | null => {
    let views = 0, buys = 0;
    for (let day = end - cvrDays + 1; day <= end; day++) {
      views += days.get(day)?.views ?? 0;
      buys += days.get(day)?.buys ?? 0;
    }
    return views >= cvrViews ? buys / views : null;
  };
  const last = windowEnding(toDay);
  if (last === null) return null;
  let best = last;
  for (let end = since + cvrDays - 1; end < toDay; end++) best = Math.max(best, windowEnding(end) ?? 0);
  return best > 0 ? 1 - last / best : null;
}

/** Ad euros of this version or test as the Mondays read them: rows leave after 90 days, a test that ended long ago did not un-happen (scale §5.2). */
function paidSince(w: WorldState, p: Product, since: number): number {
  const eur = Math.max(paidOn(w, p.id, since), p.paidRead?.since === since ? p.paidRead.eur : 0);
  if (eur > 0) p.paidRead = { since, eur };
  return eur;
}

/** Its one paid test, 45 days on, if the guide it would test is not the one that lost. */
export function retestDue(w: WorldState, p: Product): boolean {
  const h = p.harvest;
  return !!h && !h.retest && w.day - h.day >= PORTFOLIO.retestDays && (p.price !== h.price || p.version !== h.version) && !productHealth(w, p).severe && !isReworking(w, p.id);
}

/** `standing`: this line changes nothing today, the existing paths or a harvest already at rest hold it. */
interface Judged { verdict: PortfolioVerdict; reason: string; standing?: boolean }

function judge(w: WorldState, m: MainRead, paid: number, roas14: number | null, since: number, policy: StagePolicy, scaleRoas: number): Judged {
  const p = m.product;
  const money = `${m.contribution > 0 ? 'rapporte ' : m.contribution < 0 ? 'perd ' : ''}${eur(Math.abs(m.contribution))} sur 28 jours`;
  const severe = productHealth(w, p).severe;
  if (severe) return { verdict: p.version < PORTFOLIO.maxVersion ? 'rework' : 'kill', reason: severe, standing: true };
  if (isReworking(w, p.id)) return { verdict: 'rework', reason: `réécriture de la v${p.version} en cours`, standing: true };
  if (harvesting(p)) return { verdict: 'harvest', reason: `en récolte depuis le jour ${p.harvest!.day}, ${money} sans pub`, standing: true };
  if (paid < policy.paidTestEur) return { verdict: 'test', reason: `${eur(paid)} de pub sur ${eur(policy.paidTestEur)} : pas de verdict avant un vrai test payant` };
  const read = roas14 === null ? 'aucune pub sur 14 jours' : `ROAS 14 j ${dec(roas14)}`;
  if (roas14 !== null && roas14 >= scaleRoas && m.contribution > 0) return { verdict: 'double_down', reason: `${read} pour ${dec(scaleRoas)} exigés, ${money}` };
  if (m.contribution > 0) return { verdict: 'keep', reason: `${money}, ${read}` };
  if (p.version < PORTFOLIO.maxVersion) {
    if (buyersUnhappy(w, p)) return { verdict: 'rework', reason: `${money} et ses acheteurs se plaignent` };
    const drop = cvrDrop(w, p, since);
    if (drop !== null && drop >= PORTFOLIO.cvrDrop) return { verdict: 'rework', reason: `${money}, conversion payante en baisse de ${pct(drop, 0)} sur son meilleur moment` };
  }
  const heard = buyersRead(w, p);
  const buyers = `${heard.rating > 0 ? `note ${dec(heard.rating, 1)}/5` : 'aucun avis'}, ${pct(heard.refundRate, 0)} de remboursements`;
  if (buyersLike(heard)) return { verdict: 'harvest', reason: `${money} pour ${eur(paid)} de pub, mais ${buyers} : plus de pub, il reste en vente` };
  return { verdict: 'kill', reason: `${money} pour ${eur(paid)} de pub, ${buyers}` };
}

/** What a verdict changes today. A double down and a rework are planned by the CEO's plan, which reads them right after this ritual. */
async function settle(ctx: RuntimeCtx, line: PortfolioLine, p: Product, by: AgentId, was: PortfolioVerdict | undefined, notes: string[]): Promise<void> {
  const w = ctx.world;
  const { verdict, reason, contribution28: impactEur } = line;
  const title = short(p.title, 60);
  const note = (text: string) => notes.push(`« ${title} » : ${text}.`);
  if (verdict === 'harvest') {
    harvestProduct(ctx, p, reason, by);
    logDecision(w, { kind: 'harvest', who: by, text: `« ${title} » passe en récolte`, why: reason, productId: p.id, impactEur });
    note('en récolte');
  } else if (verdict === 'kill') {
    await killProduct(ctx, p, reason, by, impactEur);
    note('arrêté');
  } else if (verdict === 'rework') {
    logDecision(w, { kind: 'rework', who: by, text: `« ${title} » part en v${p.version + 1}`, why: reason, productId: p.id, impactEur });
    note(`v${p.version + 1} à écrire`);
  } else if (verdict === 'double_down' && was !== 'double_down') {
    logDecision(w, { kind: 'double_down', who: by, text: `On double la mise sur « ${title} »`, why: reason, productId: p.id, impactEur });
    note('on double la mise');
  }
  if (p.harvest?.retest?.open && verdict !== 'test') delete p.harvest; // the test paid: a main again
}

/** The Monday review of every live main, after the CFO. What it decides is done here, what it asks for goes through the plan. */
export async function reviewPortfolio(ctx: RuntimeCtx, by: AgentId = officerId(ctx.world, 'ceo')): Promise<PortfolioReview | null> {
  const w = ctx.world;
  const growth = w.company.growth;
  if (!growth) return null;
  const policy = policyOf(w);
  const { scaleRoas } = growth.allocation ?? allocationOf(w);
  const previous = growth.portfolio;
  const { mains } = mainsOver(w, 28);
  const earned = sum(mains.map((m) => Math.max(0, m.contribution)));
  const lines: PortfolioLine[] = [];
  const notes: string[] = [];
  for (const m of mains) {
    const p = m.product;
    if (retestDue(w, p)) {
      p.harvest!.retest = { day: w.day, open: true };
      notes.push(`« ${short(p.title, 60)} » : prix ou version ont changé, un dernier test payant.`);
    }
    const since = p.harvest?.retest?.day ?? versionSince(w, p);
    const paid = paidSince(w, p, since);
    const roas14 = roasOver(w, p, 14);
    const { verdict, reason, standing } = judge(w, m, paid, roas14, since, policy, scaleRoas);
    const line: PortfolioLine = {
      productId: p.id, nicheId: p.nicheId, title: p.title, verdict, reason, contribution28: m.contribution,
      roas14: roas14 === null ? null : round2(roas14), paidTested: paid, share: earned > 0 ? round2(Math.max(0, m.contribution) / earned) : 0,
    };
    lines.push(line);
    learnNiche(w, p);
    if (!standing) await settle(ctx, line, p, by, previous?.lines.find((l) => l.productId === p.id)?.verdict, notes);
  }
  const review: PortfolioReview = {
    day: w.day, week: Math.ceil(w.day / 7), notes,
    lines: lines.sort((a, b) => b.contribution28 - a.contribution28 || a.productId.localeCompare(b.productId)),
    slots: { used: lines.filter((l) => l.verdict !== 'harvest' && l.verdict !== 'kill').length, max: policy.maxMains },
  };
  growth.portfolio = review;
  if (lines.length) speak(ctx, 'ceo', `revue du portefeuille : ${portfolioCounts(review)}, ${review.slots.used} guide(s) sur ${review.slots.max} places`, 'meeting');
  return review;
}

/** The verdicts of a review, in French, in the order of the ladder. */
export function portfolioCounts(review: PortfolioReview): string {
  const verdicts = Object.keys(VERDICT_LABELS) as PortfolioVerdict[];
  return verdicts.flatMap((v) => {
    const n = review.lines.filter((l) => l.verdict === v).length;
    return n ? [`${n} ${VERDICT_LABELS[v]}`] : [];
  }).join(', ') || 'aucun guide en ligne';
}

const QUEUE_FIRST = 0;
const QUEUE_TESTS = 1;
const QUEUE_REST = 2;

/**
 * Who reaches the money first: what the review doubled down on, then guides waiting for their paid test, a guide launched since Monday
 * among them. Rows keep their order inside a rank. Without a review the queue is the old one: nothing to sort.
 */
export function budgetQueue<T>(w: WorldState, rows: readonly T[], productOf: (row: T) => string): T[] {
  const review = growthOn(w) ? w.company.growth?.portfolio : null;
  if (!review) return [...rows];
  const verdicts = new Map(review.lines.map((l) => [l.productId, l.verdict]));
  const rank = (row: T): number => {
    const v = verdicts.get(productOf(row));
    return v === 'double_down' ? QUEUE_FIRST : v === 'test' || v === undefined ? QUEUE_TESTS : QUEUE_REST;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b));
}
