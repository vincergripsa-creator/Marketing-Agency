/**
 * Recherche + Direction: rank niche opportunities (buzz / interest vs competition, competitor
 * weaknesses, depth of the voice of customer) and propose a rule-of-one angle with a start price.
 */
import type { CompetitorProduct, TrendSignal, VoiceOfCustomer } from '../../shared.js';
import type { OpportunityRanking } from '../../contracts.js';
import { cap, clampNum, clauseLabel, clean, extractAgeRange, fit, fmtEur, lf, norm, uniqStrings } from '../util.js';
import { firstPerson, safeVoc } from './niche.js';
import { knownProfile } from './profiles.js';

export const PRICE_LADDER = [9, 14, 19, 24, 29, 39, 49] as const;

/** Start low (brain: « commencer bas »): the ladder step just below the median anchor. */
export function suggestPrice(anchors: readonly number[], competitorPrices: readonly number[], target: number | null): number {
  if (target !== null && Number.isFinite(target)) return Math.round(clampNum(target, 9, 49, 19));
  const pool = (anchors.length ? anchors : competitorPrices).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (pool.length === 0) return 14;
  const mid = pool[Math.floor((pool.length - 1) / 2)]!;
  const below = PRICE_LADDER.filter((p) => p <= mid);
  return below.length ? below[below.length - 1]! : 9;
}

const COMPETITION_PENALTY: Record<TrendSignal['competitionHint'], number> = { faible: 0, moyenne: 12, forte: 26 };

export function heuristicRanking(
  input: { signals: TrendSignal[]; competitors: Record<string, CompetitorProduct[]>; voc: Record<string, VoiceOfCustomer>; excludeNicheIds: string[] },
  targetPrice: number | null | ((s: TrendSignal) => number | null),
): OpportunityRanking {
  const priceRule = (s: TrendSignal): number | null => (typeof targetPrice === 'function' ? targetPrice(s) : targetPrice);
  const exclude = new Set(input.excludeNicheIds ?? []);
  const bySignal = new Map<string, TrendSignal>();
  for (const s of input.signals ?? []) {
    if (!s?.nicheId || exclude.has(s.nicheId)) continue;
    const prev = bySignal.get(s.nicheId);
    if (!prev || s.tiktokBuzz + s.searchInterest > prev.tiktokBuzz + prev.searchInterest) bySignal.set(s.nicheId, s);
  }
  // niches we only know through voice-of-customer research still deserve a rank
  for (const [id, v] of Object.entries(input.voc ?? {})) {
    if (exclude.has(id) || bySignal.has(id) || !v) continue;
    bySignal.set(id, { nicheId: id, name: id, audience: '', category: '', searchInterest: 40, tiktokBuzz: 40, competitionHint: 'moyenne', sampleTitles: [] });
  }

  const ranked = [...bySignal.values()].map((s) => {
    const comps = (input.competitors ?? {})[s.nicheId] ?? [];
    const voc = input.voc?.[s.nicheId] ? safeVoc(input.voc[s.nicheId], s.nicheId) : null;
    const demand = 0.55 * clampNum(s.tiktokBuzz, 0, 100, 40) + 0.45 * clampNum(s.searchInterest, 0, 100, 40);
    const weaknesses = uniqStrings(comps.flatMap((c) => c.weaknesses ?? []));
    const reviews = comps.reduce((a, c) => a + (c.reviews ?? 0), 0);
    const avgRating = comps.length ? comps.reduce((a, c) => a + (c.rating ?? 0), 0) / comps.length : 0;
    let score = demand * 0.7 + 10 - COMPETITION_PENALTY[s.competitionHint ?? 'moyenne'];
    score += Math.min(14, weaknesses.length * 3);
    if (reviews > 0) score += Math.min(6, Math.log10(1 + reviews) * 2.5); // proof that people pay
    if (comps.length && avgRating < 4) score += 4;                          // room to do better
    if (comps.length > 5) score -= 5;
    if (voc) {
      score += Math.min(10, (voc.pains.length + voc.phrases.length) * 0.8);
      score += voc.priceAnchors.length ? 4 : 0;
      score += voc.depth === 'deep' ? 4 : 0;
      score -= Math.min(8, voc.bannedClaims.length * 2);
    }
    score = Math.round(clampNum(score, 0, 100, 0));

    const audienceBase = clean(s.audience) || 'un public précis';
    const age = extractAgeRange([s.audience, s.name, ...(voc?.pains ?? []), ...(voc?.phrases ?? []), ...(voc?.knowledge.facts ?? [])]);
    const audience = age && !extractAgeRange([s.audience]) ? `${audienceBase} (${age})` : audienceBase;
    const mainPain = voc?.pains.find((p) => !firstPerson(p) && p.length >= 15 && p.length <= 110) ?? voc?.pains[0] ?? s.name;
    // the guide treats the niche's main problem: the first pain of a research sample may be a side issue
    const problem = knownProfile(s.nicheId)?.pain ?? cap(clauseLabel(mainPain, 110) ?? clean(mainPain));
    const price = suggestPrice(voc?.priceAnchors ?? [], comps.map((c) => c.price), priceRule(s));
    const phrase = voc?.phrases[0];
    const phraseQ = phrase ? clauseLabel(phrase, 60) : null;
    const angle = `Un seul problème : ${lf(problem)}. Une seule personne : ${lf(audience)}.${phraseQ ? ` Le guide parle avec leurs mots (« ${lf(phraseQ)} »).` : ''}`;
    const parts = [
      `buzz TikTok ${Math.round(s.tiktokBuzz)}/100, intérêt ${Math.round(s.searchInterest)}/100, concurrence ${s.competitionHint}`,
      comps.length ? `${comps.length} concurrent${comps.length > 1 ? 's' : ''} (${reviews} avis, note moyenne ${avgRating.toFixed(1).replace('.', ',')})` : 'aucun concurrent repéré',
      weaknesses.length ? `les acheteurs leur reprochent « ${lf(clauseLabel(weaknesses[0]!, 60) ?? fit(weaknesses[0]!, 60))} »` : '',
      voc ? `${voc.pains.length + voc.phrases.length} douleurs et phrases clients récoltées${voc.priceAnchors.length ? `, prix cités autour de ${fmtEur(price)}` : ''}` : 'recherche client à approfondir',
    ].filter(Boolean);
    return { nicheId: s.nicheId, score, why: cap(`${parts.join(' ; ')}.`), angle, audience, problem, suggestedPrice: price };
  });

  ranked.sort((a, b) => b.score - a.score || norm(a.nicheId).localeCompare(norm(b.nicheId)));
  return { ranked };
}
