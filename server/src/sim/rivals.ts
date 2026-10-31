/**
 * Sellers who copy what sells (scale §6.3). A winner draws them, their pressure fades on its own and a new version shakes
 * half of it off, so a guide has to be reinvented every few months. `Rival` is hidden truth: agents only see the listing.
 */
import { clamp, streamRng } from '../core/index.js';
import type { Rng } from '../contracts.js';
import type { CompetitorProduct, NicheTruth, Product, Rival, WorldState } from '../shared.js';
import { GROWTH } from './growth.js';
import { fmtEur, short, uniform } from './text.js';

/** Sales a rival reads: the last two weeks, always inside the orders compaction keeps. */
const SALES_WINDOW_DAYS = 14;
const PLATFORMS = ['etsy', 'gumroad', 'stan'] as const;
const COPY_PRICE = { min: 0.6, max: 0.9, floor: 5 };

/** What the niche's rivals leave of a conversion rate. */
export function rivalFactor(world: WorldState, nicheId: string): number {
  let total = 0;
  for (const r of world.market.rivals ?? []) if (r.nicheId === nicheId) total += r.pressure;
  return 1 - Math.min(GROWTH.rivals.maxTotal, total);
}

/** A niche keeps its last rivals: the older ones have faded to nothing, and state stays bounded on a run of any length. */
function keepListed(world: WorldState, niche: NicheTruth): void {
  const mine = (world.market.rivals ?? []).filter((r) => r.nicheId === niche.id);
  const gone = new Set(mine.slice(0, -GROWTH.rivals.maxListed).map((r) => r.id));
  if (!gone.size) return;
  world.market.rivals = world.market.rivals!.filter((r) => !gone.has(r.id));
  niche.competitors = niche.competitors.filter((c) => !gone.has(c.id.replace(/^cmp_/, '')));
}

/** A new seller copies `copied`: one pressure on the niche, one line in its competitors, so `listCompetitors` shows it. */
export function addRival(world: WorldState, niche: NicheTruth, copied: Pick<Product, 'title'>, rng: Rng, pressure: number, price: number): { rival: Rival; platform: CompetitorProduct['platform'] } {
  const rivals = (world.market.rivals ??= []);
  const platform = rng.pick(PLATFORMS);
  const rank = rivals.filter((r) => r.nicheId === niche.id && r.day === world.day).length;
  const rival: Rival = { id: `riv_${niche.id}_${world.day}_${rank}`, nicheId: niche.id, day: world.day, pressure, price };
  rivals.push(rival);
  niche.competitors.push({
    id: `cmp_${rival.id}`, nicheId: niche.id,
    title: `${short(copied.title, 40)} (édition express)`,
    price, reviews: rng.int(3, 25), rating: 4.7, ageDays: 1, platform,
    weaknesses: ["Copie quasi conforme d'un guide existant", 'Avis suspects publiés le même jour'],
  });
  keepListed(world, niche);
  return { rival, platform };
}

/** What each guide sold over the window. A kit is no sale of its own: it rides on its guide's. */
function recentSales(world: WorldState): Map<string, number> {
  const sold = new Map<string, number>();
  const orders = world.market.orders;
  for (let i = orders.length - 1; i >= 0; i--) {
    const o = orders[i]!;
    if (world.day - o.day >= SALES_WINDOW_DAYS) break;
    if (o.source !== 'bump') sold.set(o.productId, (sold.get(o.productId) ?? 0) + 1);
  }
  return sold;
}

/**
 * The day's close: old pressure fades, then each niche that sells may draw a seller, on a stream of its own. No world event:
 * who gets copied follows the sales, and the market's events stay the same whatever the company does. Returns the notes.
 */
export function rollRivals(world: WorldState, rng: Rng): string[] {
  const { baseDaily, refSalesPerDay, pressureMin, pressureMax, halfLifeDays } = GROWTH.rivals;
  const fade = Math.pow(0.5, 1 / halfLifeDays);
  for (const r of world.market.rivals ?? []) if (r.day < world.day) r.pressure *= fade;
  const sold = recentSales(world);
  const key = rng.int(0, 0x7fffffff);
  const notes: string[] = [];
  world.market.niches.forEach((niche, index) => {
    const mine = world.company.products.filter((p) => p.nicheId === niche.id);
    const sales = mine.reduce((s, p) => s + (sold.get(p.id) ?? 0), 0);
    const chance = baseDaily * clamp(sales / SALES_WINDOW_DAYS / refSalesPerDay, 0, 2);
    const copied = mine.filter((p) => p.status === 'live').sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0))[0];
    const r = streamRng(key, index);
    if (!copied || !r.chance(chance)) return;
    const pressure = uniform(r, pressureMin, pressureMax);
    const price = Math.max(COPY_PRICE.floor, Math.round(copied.price * uniform(r, COPY_PRICE.min, COPY_PRICE.max)));
    const { platform } = addRival(world, niche, copied, r, pressure, price);
    notes.push(`Un vendeur ${platform} copie « ${short(copied.title, 40)} » à ${fmtEur(price)}.`);
  });
  return notes;
}

/** A new version on sale: the copies are of the old one. Once per version, however often it is listed again. */
export function refreshRivals(world: WorldState, p: Product): void {
  if (p.version <= (p.publishedVersion ?? 1)) return;
  p.publishedVersion = p.version;
  for (const r of world.market.rivals ?? []) if (r.nicheId === p.nicheId) r.pressure *= GROWTH.rivals.refreshCut;
}
