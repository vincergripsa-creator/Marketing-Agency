/** Initial market state: seeded niche truth, creators (some scammers), empty books. */
import { clamp, round2 } from '../core/index.js';
import type { DifficultyProfile, Rng } from '../contracts.js';
import type { AdFormat, CreatorProfile, Difficulty, HookStyle, MarketState, NicheTruth, ScenarioConfig, WorldState } from '../shared.js';
import { CREATORS, DIFFICULTY, NICHE_VARIATION } from './balance.js';
import { ensureChannelMarket } from './channels.js';
import { FEMALE_NAMES, FIRST_NAMES, MALE_NAMES } from './customers.js';
import { NICHE_CATALOG, cloneNiche } from './niches.js';
import { lognormal, norm, uniform } from './text.js';

export function difficultyProfile(d: Difficulty): DifficultyProfile {
  return { ...(DIFFICULTY[d] ?? DIFFICULTY.normal) };
}

export function findNiche(world: WorldState, nicheId: string): NicheTruth | undefined {
  return world.market?.niches?.find((n) => n.id === nicheId);
}

function vary(rng: Rng): number {
  return 1 + uniform(rng, -NICHE_VARIATION, NICHE_VARIATION);
}

/** ±15 % seeded variation on every hidden parameter: two runs never share the exact same market. */
export function varyNiche(n: NicheTruth, rng: Rng): NicheTruth {
  n.demand = round2(clamp(n.demand * vary(rng), 0.05, 1));
  const f = vary(rng);
  const min = Math.max(3, Math.round(n.wtp.min * f));
  const sweet = Math.max(min + 1, Math.round(n.wtp.sweet * f));
  n.wtp = { min, sweet, max: Math.max(sweet + 2, Math.round(n.wtp.max * f)) };
  n.competition = round2(clamp(n.competition * vary(rng), 0.05, 0.95));
  n.tiktokAffinity = round2(clamp(n.tiktokAffinity * vary(rng), 0.1, 1));
  n.cpmBase = round2(n.cpmBase * vary(rng));
  for (const k of Object.keys(n.hookAffinity) as HookStyle[]) n.hookAffinity[k] = round2(clamp((n.hookAffinity[k] ?? 1) * vary(rng), 0.5, 1.8));
  for (const k of Object.keys(n.formatAffinity) as AdFormat[]) n.formatAffinity[k] = round2(clamp((n.formatAffinity[k] ?? 1) * vary(rng), 0.5, 1.8));
  n.refundSensitivity = round2(clamp(n.refundSensitivity * vary(rng), 0, 1));
  n.complianceRisk = round2(clamp(n.complianceRisk * vary(rng), 0, 1));
  n.seasonality = n.seasonality.map((s) => round2(s * (1 + uniform(rng, -0.03, 0.03))));
  for (const c of n.competitors) c.reviews = Math.max(1, Math.round(c.reviews * vary(rng)));
  return n;
}

// ───────────────────────────── Creators ─────────────────────────────

const HANDLE_PREFIX: Record<string, string[]> = {
  'Parentalité': ['maman', 'papa', 'parents', 'bebe', 'famille', 'lesptits'],
  'Animaux': ['woof', 'miaou', 'animaux', 'toutou', 'chat', 'educ'],
  'Études & concours': ['revisions', 'etudes', 'prepa', 'concours', 'bac', 'campus'],
  'Argent & entrepreneuriat': ['freelance', 'business', 'argent', 'micro', 'entrepreneure', 'side'],
  'Maison & jardin': ['deco', 'diy', 'jardin', 'maison', 'recup', 'atelier'],
  'Santé & forme': ['forme', 'fit', 'bienetre', 'coach', 'sport'],
  'Cuisine & budget': ['cuisine', 'recettes', 'budget', 'popote', 'mealprep'],
  'Vie & événements': ['mariage', 'wedding', 'fete', 'jourJ', 'fiances'],
  'Voyage': ['voyage', 'travel', 'baroudeuse', 'japon', 'sac.a.dos'],
};

/** Explicit clues of a scammer. A creator showing one of these never delivers; a stealth scammer shows none. */
const SCAM_FLAG_TEMPLATES: readonly ((rng: Rng, upfront: number) => string)[] = [
  (rng) => `abonnés achetés (pic de +${rng.int(25, 60)} 000 en ${rng.int(2, 4)} jours)`,
  (_, up) => `demande ${up} € d'avance avant toute discussion`,
  () => 'DM copié-collé envoyé à plusieurs marques',
  () => 'commentaires génériques en anglais sous ses vidéos',
  (rng) => `engagement anormalement bas (${(rng.int(2, 8) / 10).toFixed(1).replace('.', ',')} %)`,
  () => 'exige un paiement hors plateforme (« entre proches »)',
  () => 'refuse toute rémunération à la commission',
];
const SCAM_FLAG_RE = [/abonnes achetes/, /d'avance avant toute discussion/, /dm copie-colle/, /commentaires generiques/, /engagement anormalement bas/, /paiement hors plateforme/, /refuse toute remuneration/];

/** Ambiguous but harmless clues shown on some legit creators. */
const SOFT_FLAGS: readonly ((rng: Rng) => string)[] = [
  (rng) => `profil récent (${rng.int(3, 8)} mois)`,
  () => 'répond surtout le soir',
  () => 'peu de vidéos sur la niche ces 30 derniers jours',
  () => 'a déjà fait une collaboration avec un concurrent',
];

export function isScamFlag(flag: string): boolean {
  const f = norm(flag);
  return SCAM_FLAG_RE.some((re) => re.test(f));
}

/** Hidden truth of a creator: an explicit red flag, or the niche's hidden list (stealth scammers show no flag). */
export function isScammer(world: WorldState, c: CreatorProfile): boolean {
  return c.redFlags.some(isScamFlag) || !!findNiche(world, c.nicheId)?.scamCreatorIds?.includes(c.id);
}

function handleFor(rng: Rng, niche: NicheTruth, used: Set<string>): string {
  const prefixes = HANDLE_PREFIX[niche.category] ?? ['creatrice', 'conseils'];
  for (let i = 0; i < 20; i++) {
    const p = norm(rng.pick(prefixes)).replace(/[^a-z.]/g, '');
    const style = rng.int(0, 3);
    // "maman.de.hugo" names the child; otherwise the name is the creator's own
    const names = style === 0 ? FIRST_NAMES : p === 'maman' || p === 'baroudeuse' || p === 'entrepreneure' ? FEMALE_NAMES : p === 'papa' ? MALE_NAMES : FIRST_NAMES;
    const first = norm(rng.pick(names)).replace(/[^a-z]/g, '');
    const h = style === 0 ? `${p}.de.${first}` : style === 1 ? `${p}_${first}` : style === 2 ? `${first}.${p}` : `${p}${first}${rng.int(2, 99)}`;
    if (!used.has(h)) { used.add(h); return h; }
  }
  const fallback = `${niche.id.split('-')[0]}_${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

/** Scammer without a red flag: only their public numbers give them away, and each of those numbers alone stays ambiguous. */
function makeStealthScammer(rng: Rng, id: string, handle: string, niche: NicheTruth): CreatorProfile {
  const s = CREATORS.stealth;
  const followers = Math.round(Math.min(400000, Math.max(8000, lognormal(rng, s.followersMedian, 0.7))) / 100) * 100;
  const avgViews = Math.round(followers * uniform(rng, s.viewRate.min, s.viewRate.max));
  const perK = uniform(rng, s.upfrontPerKViews.min, s.upfrontPerKViews.max);
  return {
    id, handle, nicheId: niche.id, followers, avgViews,
    engagement: round2(uniform(rng, s.engagement.min, s.engagement.max) * 100) / 100,
    askUpfront: Math.max(s.minUpfront, Math.round(((avgViews / 1000) * perK) / 10) * 10),
    askCommission: rng.pick(s.commissions),
    redFlags: rng.chance(CREATORS.softFlagShare) ? [rng.pick(SOFT_FLAGS)(rng)] : [],
  };
}

export function makeCreator(rng: Rng, niche: NicheTruth, index: number, scam: boolean, used: Set<string>, stealth = false): CreatorProfile {
  const id = `crt_${niche.id}_${index}`;
  const handle = handleFor(rng, niche, used);
  if (scam && stealth) return makeStealthScammer(rng, id, handle, niche);
  if (scam) {
    const followers = Math.round(Math.min(900000, Math.max(20000, lognormal(rng, 85000, 0.6))) / 100) * 100;
    const upfront = rng.int(15, 60) * 10;
    const flags = rng.shuffle(SCAM_FLAG_TEMPLATES.slice()).slice(0, rng.int(1, 3)).map((f) => f(rng, upfront));
    return {
      id, handle, nicheId: niche.id, followers,
      avgViews: Math.round(followers * uniform(rng, 0.004, 0.02)),
      engagement: round2(uniform(rng, 0.002, 0.008) * 100) / 100,
      askUpfront: upfront,
      askCommission: rng.chance(0.5) ? 0 : 0.05,
      redFlags: flags,
    };
  }
  const followers = Math.round(Math.min(400000, Math.max(1500, lognormal(rng, 16000, 1))) / 100) * 100;
  const avgViews = Math.round(followers * uniform(rng, 0.08, 0.35));
  // small creators mostly work on commission; bigger ones price their reach (≈ 12-30 € per 1 000 views)
  const asks = followers < 20000 ? rng.chance(0.3) : rng.chance(0.85);
  const perK = uniform(rng, CREATORS.upfrontPerKViews.min, CREATORS.upfrontPerKViews.max);
  const askUpfront = asks ? Math.max(30, Math.round(((avgViews / 1000) * perK) / 10) * 10) : 0;
  return {
    id, handle, nicheId: niche.id, followers,
    avgViews,
    engagement: round2(uniform(rng, 0.03, 0.09) * 100) / 100,
    askUpfront,
    askCommission: Math.round(uniform(rng, 0.2, 0.45) * 20) / 20,
    redFlags: rng.chance(CREATORS.softFlagShare) ? [rng.pick(SOFT_FLAGS)(rng)] : [],
  };
}

/** Draws one creator of the niche at the difficulty's scam rates. Its id is the caller's to change before marking it. */
export function rollCreator(rng: Rng, niche: NicheTruth, index: number, difficulty: Difficulty, used: Set<string>): { creator: CreatorProfile; scam: boolean } {
  const scam = rng.chance(CREATORS.scamShare[difficulty] ?? 0.25);
  const stealth = scam && rng.chance(CREATORS.stealthScamShare[difficulty] ?? 0.35);
  return { creator: makeCreator(rng, niche, index, scam, used, stealth), scam };
}

/** Records the hidden truth of a scammer on its niche (never on the public profile). */
export function markScammer(niche: NicheTruth, creatorId: string): void {
  (niche.scamCreatorIds ??= []).push(creatorId);
}

function makeCreators(niche: NicheTruth, rng: Rng, difficulty: Difficulty, used: Set<string>): CreatorProfile[] {
  const n = rng.int(CREATORS.perNicheMin, CREATORS.perNicheMax);
  const rolls = Array.from({ length: n }, (_, i) => rollCreator(rng, niche, i + 1, difficulty, used));
  // at least one honest creator per niche, so commission deals are always possible
  if (rolls.every((r) => r.scam)) rolls[0] = { creator: makeCreator(rng, niche, 1, false, used), scam: false };
  for (const r of rolls) if (r.scam) markScammer(niche, r.creator.id);
  return rolls.map((r) => r.creator);
}

export function createMarketState(scenario: ScenarioConfig, rng: Rng): MarketState {
  // nearby seeds (1, 2, 3…) give correlated mulberry32 streams at equal offsets: a seed-dependent
  // burn-in desynchronises them so each run gets a genuinely different market
  const burn = 16 + Math.floor(rng.next() * 97);
  for (let i = 0; i < burn; i++) rng.next();
  const niches = NICHE_CATALOG.map((n) => varyNiche(cloneNiche(n), rng));
  const used = new Set<string>();
  const creators = niches.flatMap((n) => makeCreators(n, rng, scenario?.difficulty ?? 'normal', used));
  const market: MarketState = {
    niches,
    customers: [],
    orders: [],
    inbox: [],
    adStats: [],
    organicPosts: [],
    creators,
    partnerships: [],
    events: [],
    modifiers: { cpmMultiplier: 1, cpmUntilDay: 0, paymentHoldUntilDay: 0, outageDay: 0 },
    adAccount: { strikes: 0, banned: false, bannedUntilDay: 0 },
    creativeImpressions: {},
  };
  ensureChannelMarket({ market, scenario }); // draws on the seed, never on `rng`
  return market;
}
