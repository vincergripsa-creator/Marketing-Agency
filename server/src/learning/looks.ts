/**
 * Looks as the agents know them (design plan D203, D204): the three design bandits and the research priors they start from, what the
 * company's own paid traffic says of each look, page tests, the design log and the French reason of every choice. Public data only:
 * the market's taste never comes here.
 */
import type { Rng } from '../contracts.js';
import type { ArtStyle, BanditArm, DesignLogEntry, Experiment, GuideArchetype, PageHero, PageTemplate, Product, WorldState } from '../shared.js';
import { ART_STYLES, HERO_INFO, HERO_NEEDS, PAGE_HEROES, PAGE_TEMPLATES, STYLE_INFO, TEMPLATE_INFO, TEMPLATE_NEEDS } from '../shared.js';
import { heroConvention, styleConvention, templateConvention } from '../sim/catalog/looks.js';
import { armStats, chooseArm } from './bandits.js';
import { adRows, nicheName, onReference, referenceChannels } from './data.js';
import { fmtNum, fmtPct, fold, plural, round, shorten } from './text.js';

export type LookKind = 'style' | 'template' | 'hero';
export const LOOK_KINDS: readonly LookKind[] = ['style', 'template', 'hero'];
export const LOOK_DIMENSIONS: Record<LookKind, string> = { style: 'cover_style', template: 'page_template', hero: 'page_hero' };
export const LOOK_ARMS: Record<LookKind, readonly string[]> = { style: ART_STYLES, template: PAGE_TEMPLATES, hero: PAGE_HEROES };
const INFO: Record<LookKind, Record<string, { label: string }>> = { style: STYLE_INFO, template: TEMPLATE_INFO, hero: HERO_INFO };
/** How a look's kind reads in a French line: « le style « Aura » », « le gabarit « Express » », « le visuel « Le pack » ». */
export const LOOK_NOUN: Record<LookKind, string> = { style: 'style', template: 'gabarit', hero: 'visuel' };
/** The playbook directive of each kind: « Style de couverture « Aura » sur « Niche » » (runtime/playbook.ts reads it back). */
export const LOOK_RULE: Record<LookKind, string> = { style: 'Style de couverture', template: 'Gabarit de page', hero: 'Visuel de page' };

export const lookDim = (kind: LookKind, nicheId: string): string => `${LOOK_DIMENSIONS[kind]}:${nicheId}`;
export const lookLabel = (kind: LookKind, key: string): string => INFO[kind][key]?.label ?? key;

/** A key or a label in any case or accent (« Mur d’avis », « proof ») as an arm of the kind; null for anything else. */
export function lookKey(kind: LookKind, text: string | null | undefined): string | null {
  const f = plain(String(text ?? ''));
  if (!f) return null;
  return LOOK_ARMS[kind].find((k) => k === f || plain(lookLabel(kind, k)) === f) ?? null;
}

/** The words that announce a look in a free text: « en style pop », « gabarit éditorial », « visuel le pack ». */
const LOOK_CUE: Record<LookKind, string> = { style: '(?:style|look|direction)', template: '(?:gabarit|page|modele)', hero: '(?:visuel|heros|hero|en tete)' };

const plain = (s: string): string => fold(s).replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The look of the kind a free text names, the founder's hint: its key or label right after the word of its kind (« style aura »:
 * « il aura » names nothing), or a label of two words or more anywhere (« ligne claire », « mur d’avis »).
 */
export function lookIn(kind: LookKind, text: string | null | undefined): string | null {
  const f = ` ${plain(String(text ?? ''))} `;
  if (!f.trim()) return null;
  for (const k of LOOK_ARMS[kind]) {
    const label = plain(lookLabel(kind, k));
    const named = [k, label].some((w) => new RegExp(` ${LOOK_CUE[kind]} (?:${w}) `).test(f));
    if (named || (label.includes(' ') && f.includes(` ${label} `))) return k;
  }
  return null;
}

// ───────────────────────────── switches ─────────────────────────────

/** Looks are drawn: the visual model is on and no control keeps the V1 look (D205). */
export function looksOn(w: Pick<WorldState, 'scenario'>): boolean {
  return w.scenario?.visualModel === 'on' && !w.scenario.control?.designV1;
}

/** …and the agency learns them: bandits, tests, lessons, rules and refreshes. `noDesignLearning` keeps the draws and nothing else. */
export function designLearning(w: Pick<WorldState, 'scenario'>): boolean {
  return looksOn(w) && !w.scenario.control?.noDesignLearning;
}

// ───────────────────────────── the research priors ─────────────────────────────

/** What the agents know of a shelf: the family the guide's palette says, the archetype the company's research names. */
export interface LookShelf { family: string | null; archetype: GuideArchetype | null }

export function shelfOf(world: WorldState, p: Pick<Product, 'design'> | undefined, nicheId: string): LookShelf {
  const family = p?.design?.family ?? world.company.products.find((x) => x.nicheId === nicheId && x.design?.family)?.design?.family ?? null;
  return { family, archetype: world.company.research?.voc?.[nicheId]?.knowledge?.archetype ?? null };
}

/** + for a convention of the shelf, − for its opposite, from the table the market's taste was drawn around (§5). */
export function conventionOf(kind: LookKind, key: string, shelf: LookShelf): number {
  if (kind === 'style') return styleConvention(key as ArtStyle, shelf.family);
  if (kind === 'template') return templateConvention(key as PageTemplate, shelf.archetype);
  return heroConvention(key as PageHero, shelf.family);
}

/**
 * Where a look's day scores before any sale, and how many days of evidence the research is worth: a fresh agency starts from
 * conventions. The mean is a typical page of the research, 2.5 % of paid visitors buying and 5 % of sales refunded: 0.025 / 0.08 × 0.8.
 */
export const LOOK_PRIOR = { mean: 0.25, strength: 6 } as const;

/** The arms of a niche's design bandit, each created once from the research priors as pseudo-counts (D203). */
export function ensureLookArms(world: WorldState, kind: LookKind, nicheId: string, shelf: LookShelf): BanditArm[] {
  const all = (world.company.bandits ??= {});
  const arms = (all[lookDim(kind, nicheId)] ??= []);
  for (const key of LOOK_ARMS[kind]) {
    if (arms.some((a) => a.key === key)) continue;
    const mean = LOOK_PRIOR.mean * (1 + conventionOf(kind, key, shelf));
    arms.push({ key, alpha: round(LOOK_PRIOR.strength * mean, 4), beta: round(LOOK_PRIOR.strength * (1 - mean), 4), pulls: 0, reward: 0 });
  }
  return arms;
}

// ───────────────────────────── what a guide wears ─────────────────────────────

export function lookNow(p: Pick<Product, 'design' | 'salesPage'>, kind: LookKind): string | undefined {
  return kind === 'style' ? p.design?.style : kind === 'template' ? p.salesPage?.template : p.salesPage?.hero;
}

/** Reviews a page can show. */
export const reviewCount = (p: Pick<Product, 'stats'>): number => Math.max(p.stats.reviews.length, p.stats.ratingCount ?? 0);

/** A kit sold with the guide, or a bonus to fan out beside it. */
export const hasBundle = (p: Pick<Product, 'bumpProductId' | 'content'>): boolean => !!p.bumpProductId || !!p.content?.bonus?.title;

/** The templates and heroes whose needs hold today (TEMPLATE_NEEDS, HERO_NEEDS): an agent never picks one whose needs fail. */
export function eligibleLooks(p: Pick<Product, 'stats' | 'files' | 'bumpProductId' | 'content'>, kind: 'template' | 'hero'): string[] {
  const previews = (p.files.previews?.length ?? 0) > 0;
  if (kind === 'template') {
    return PAGE_TEMPLATES.filter((t) => {
      const need = TEMPLATE_NEEDS[t];
      return !(need?.minReviews && reviewCount(p) < need.minReviews) && !(need?.previews && !previews);
    });
  }
  return PAGE_HEROES.filter((h) => {
    const need = HERO_NEEDS[h];
    return !(need?.previews && !previews) && !(need?.bundle && !hasBundle(p));
  });
}

// ───────────────────────────── page tests ─────────────────────────────

/** A page test: one guide, two templates alternating by day, read on conversion, at most 14 days (D204). */
export const PAGE_TEST = {
  days: 14,
  views: 2000,         // landing views per variant that end it early: about 50 sales each, still short of 16 / r² for a 15 % lift
  minSales: 10,        // sales of the two leaders before a winner can be named…
  z: 1.64,             // …and how clearly the first must lead (one-sided 95 %): most tests do not win
  dailyViews: 50,      // paid landing views a day the guide needs before two weeks can read anything
} as const;

/** The variant a page test shows on a day: they alternate from its first day, the control first. */
export function variantOn(e: Pick<Experiment, 'day' | 'variants'>, day: number): string | undefined {
  const n = e.variants.length;
  return n ? e.variants[(((day - e.day) % n) + n) % n] : undefined;
}

export function pageTestsOf(world: WorldState, productId: string): Experiment[] {
  return (world.company.experiments ?? []).filter((e) => e.dimension === 'page_template' && e.productId === productId);
}

export function runningPageTest(world: WorldState, productId: string): Experiment | undefined {
  return pageTestsOf(world, productId).find((e) => e.status === 'running');
}

/** The challenger of a page test: the template the bandit believes in most after the one worn, among those the guide can wear. */
export function pageChallenger(world: WorldState, p: Product, shelf: LookShelf): string | null {
  const current = p.salesPage?.template;
  if (!current) return null;
  const eligible = eligibleLooks(p, 'template').filter((t) => t !== current);
  if (!eligible.length) return null;
  ensureLookArms(world, 'template', p.nicheId, shelf);
  return armStats(world, lookDim('template', p.nicheId)).find((s) => eligible.includes(s.key))?.key ?? eligible[0]!;
}

export interface LookRead { views: number; sales: number }
export const cvrOf = (r: LookRead | undefined): number => (r && r.views > 0 ? r.sales / r.views : 0);

/** Two-proportion z of `a` over `b`. */
export function zOf(a: LookRead, b: LookRead): number {
  if (a.views <= 0 || b.views <= 0) return 0;
  const pooled = (a.sales + b.sales) / (a.views + b.views);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.views + 1 / b.views));
  return se > 0 ? (cvrOf(a) - cvrOf(b)) / se : 0;
}

/** A page test names a winner only on enough sales and a clear lead: most tests do not win, and a noisy one must not write a rule. */
export function pageTestWinner(results: Record<string, { n: number; value: number }>): string | null {
  const list = Object.entries(results).filter(([, r]) => r.n > 0).sort((a, b) => b[1].value - a[1].value || b[1].n - a[1].n);
  if (list.length < 2) return null;
  const read = (r: { n: number; value: number }): LookRead => ({ views: r.n, sales: Math.round(r.value * r.n) });
  const [first, second] = [read(list[0]![1]), read(list[1]![1])];
  if (first.sales + second.sales < PAGE_TEST.minSales || zOf(first, second) < PAGE_TEST.z) return null;
  return list[0]![0];
}

// ───────────────────────────── evidence ─────────────────────────────

/** Days of a niche's traffic a choice, a refresh or a lesson reads. */
export const LOOK_EVIDENCE_DAYS = 45;

/** What a guide wore on a day: a page test's variant of that day, else its design log, else what it wears now. */
function wearer(world: WorldState, p: Product, kind: LookKind): (day: number) => string | undefined {
  const tests = kind === 'template' ? pageTestsOf(world, p.id) : [];
  const log = p.designLog ?? [];
  return (day) => {
    const e = tests.find((x) => x.day <= day && day <= (x.endDay ?? world.day));
    if (e) return variantOn(e, day);
    let entry: DesignLogEntry | undefined;
    for (const x of log) if (x.day <= day) entry = x;
    entry ??= log[0];
    if (!entry) return lookNow(p, kind);
    return kind === 'style' ? entry.style : kind === 'template' ? entry.template : entry.hero;
  };
}

export function lookOn(world: WorldState, p: Product, kind: LookKind, day: number): string | undefined {
  return wearer(world, p, kind)(day);
}

/** A niche's paid traffic per look, on each guide's reference channel, each day under the look it wore (announced outages out). */
export function lookEvidence(world: WorldState, nicheId: string, kind: LookKind, fromDay: number, toDay: number): Map<string, LookRead> {
  const out = new Map<string, LookRead>();
  const wears = new Map<string, (day: number) => string | undefined>();
  for (const p of world.company.products ?? []) if (p.nicheId === nicheId && p.kind !== 'kit') wears.set(p.id, wearer(world, p, kind));
  if (!wears.size) return out;
  const refs = referenceChannels(world, toDay);
  for (const r of adRows(world, Math.max(1, fromDay), toDay)) {
    const wore = wears.get(r.productId);
    if (!wore || !onReference(refs, r.productId, r)) continue;
    const key = wore(r.day);
    if (!key) continue;
    const cur = out.get(key) ?? { views: 0, sales: 0 };
    cur.views += Math.max(0, r.landingViews);
    cur.sales += Math.max(0, r.purchases);
    out.set(key, cur);
  }
  return out;
}

/** Everyone else's traffic, pooled. */
export function restOf(reads: ReadonlyMap<string, LookRead>, key: string): LookRead {
  let views = 0;
  let sales = 0;
  for (const [k, r] of reads) if (k !== key) { views += r.views; sales += r.sales; }
  return { views, sales };
}

/** Visitors before a look's conversion says anything in a reason. */
export const LOOK_READ_MIN = 300;

/** « le plus vendeur sur la niche, 14 % de conversion en plus sur 2 300 visiteurs », in the agent's words. */
function evidenceWhy(key: string, reads: ReadonlyMap<string, LookRead>, conventional: boolean, niche: string): string {
  const own = reads.get(key);
  const rest = restOf(reads, key);
  if (own && own.views >= LOOK_READ_MIN && rest.views >= LOOK_READ_MIN) {
    const read = [...reads].filter(([, r]) => r.views >= LOOK_READ_MIN).sort((a, b) => cvrOf(b[1]) - cvrOf(a[1]));
    if (cvrOf(rest) <= 0) return own.sales > 0 ? `le seul qui vend sur la niche : ${fmtPct(cvrOf(own))} de conversion sur ${fmtNum(own.views)} visiteurs` : `aucun look ne vend encore sur la niche (${fmtNum(own.views)} visiteurs)`;
    const lift = cvrOf(own) / cvrOf(rest) - 1;
    if (read[0]?.[0] === key && lift >= 0.05) return `le plus vendeur sur la niche, ${fmtPct(lift, 0)} de conversion en plus sur ${fmtNum(own.views)} visiteurs`;
    if (lift >= 0) return `${fmtPct(lift, 0)} de conversion en plus que les autres sur ${fmtNum(own.views)} visiteurs`;
    return `le bandit lui laisse sa chance malgré ${fmtPct(-lift, 0)} de conversion en moins sur ${fmtNum(own.views)} visiteurs`;
  }
  if (own && own.views > 0) return `encore peu de données (${fmtNum(own.views)} visiteurs), le bandit tente sa chance`;
  return conventional ? `convention du genre pour « ${niche} », pas encore de données` : `pari du bandit, pas encore de données sur « ${niche} »`;
}

// ───────────────────────────── the choice ─────────────────────────────

/** Share of the choices that go to the least-tried look instead of the bandit's draw. */
export const LOOK_EXPLORE = 0.15;

export interface LookAsk {
  kind: LookKind;
  nicheId: string;
  shelf: LookShelf;
  eligible: readonly string[];
  founder?: string | null;     // the founder's hint
  rule?: string | null;        // the agent's playbook rule for the niche
  test?: string | null;        // the variant a running test wants today
  exclude?: readonly string[]; // what the evidence says to leave (a refresh never puts the same lagging look back)
  rng: Rng;                    // STREAM.design: never the company's
  sharp?: { samples: number; rng: Rng };
}

export interface LookChoice { key: string; source: 'founder' | 'rule' | 'test' | 'bandit' | 'explore' | 'random' | 'keep'; why: string }

/**
 * The look an agent picks (D203): the founder's hint, a playbook rule for the niche, a running test, then the least-tried look now
 * and then, else a Thompson draw on the niche's bandit, sharpened by talent. Without design learning: a uniform draw.
 */
export function chooseLook(world: WorldState, ask: LookAsk): LookChoice | null {
  const exclude = ask.exclude ?? [];
  const kept = ask.eligible.filter((k) => !exclude.includes(k));
  const open = kept.length ? kept : [...ask.eligible];
  if (!open.length) return null;
  if (ask.founder && ask.eligible.includes(ask.founder)) return { key: ask.founder, source: 'founder', why: 'demande du fondateur' };
  if (!designLearning(world)) return { key: ask.rng.pick(open), source: 'random', why: 'tirage au sort, sans apprentissage (groupe témoin)' };
  const niche = nicheName(world, ask.nicheId);
  if (ask.rule && open.includes(ask.rule)) return { key: ask.rule, source: 'rule', why: `règle du playbook pour « ${niche} »` };
  if (ask.test && open.includes(ask.test)) return { key: ask.test, source: 'test', why: 'variante du jour du test A/B en cours' };
  const arms = ensureLookArms(world, ask.kind, ask.nicheId, ask.shelf);
  const pulls = (k: string): number => arms.find((a) => a.key === k)?.pulls ?? 0;
  if (open.length > 1 && ask.rng.next() < LOOK_EXPLORE) {
    const fewest = Math.min(...open.map(pulls));
    const key = ask.rng.pick(open.filter((k) => pulls(k) === fewest));
    return { key, source: 'explore', why: fewest === 0 ? `jamais porté sur « ${niche} » : on l’essaie` : `le moins essayé sur « ${niche} » (${plural(fewest, 'jour', 'jours')} de ventes mesurés), on lui redonne sa chance` };
  }
  const key = chooseArm(world, lookDim(ask.kind, ask.nicheId), open, ask.rng, ask.sharp);
  const reads = lookEvidence(world, ask.nicheId, ask.kind, world.day - LOOK_EVIDENCE_DAYS, world.day);
  return { key, source: 'bandit', why: evidenceWhy(key, reads, conventionOf(ask.kind, key, ask.shelf) > 0, niche) };
}

/** The favourite look of each kind on a niche: the bandit's best arm once it has a few days of sales behind it. */
export function favouriteLooks(world: WorldState, nicheId: string, minPulls = 5): Partial<Record<LookKind, string>> {
  const out: Partial<Record<LookKind, string>> = {};
  for (const kind of LOOK_KINDS) {
    const best = armStats(world, lookDim(kind, nicheId)).find((a) => a.pulls >= minPulls);
    if (best) out[kind] = best.key;
  }
  return out;
}

// ───────────────────────────── the design log ─────────────────────────────

export const DESIGN_LOG_MAX = 12;
/** A refresh's entry starts with this word: the 30-day cap and the digest read it back. */
export const REFRESH_WORD = 'Refonte';

export const isRefreshEntry = (e: Pick<DesignLogEntry, 'why'>): boolean => e.why.startsWith(REFRESH_WORD);

/**
 * The look a guide wears from today, in its log (D204), at most 12 entries. `coverOnly` leaves the page out: the page written for
 * the same version then completes that entry, one look, one line. The same look twice in a row is not a change.
 */
export function logLook(p: Product, day: number, why: string, coverOnly = false): void {
  const style = p.design?.style;
  if (!style) return;
  const template = coverOnly ? undefined : p.salesPage?.template;
  const hero = coverOnly ? undefined : p.salesPage?.hero;
  const log = (p.designLog ??= []);
  const last = log[log.length - 1];
  if (last && last.style === style && last.template === template && last.hero === hero) return;
  const sameVersion = !!last && last.version === p.version && last.style === style;
  if (sameVersion && !last.template && !last.hero && (template || hero)) {
    if (template) last.template = template;
    if (hero) last.hero = hero;
    last.why = shorten(`${last.why} ; ${why}`, 300);
    return;
  }
  log.push({ day, version: p.version, style, ...(template ? { template } : {}), ...(hero ? { hero } : {}), why: shorten(why, 300) });
  if (log.length > DESIGN_LOG_MAX) log.splice(0, log.length - DESIGN_LOG_MAX);
}

/** Last day the guide's look was refreshed, from its log. */
export function lastRefreshDay(p: Pick<Product, 'designLog'>): number {
  return Math.max(0, ...(p.designLog ?? []).filter(isRefreshEntry).map((e) => e.day));
}
