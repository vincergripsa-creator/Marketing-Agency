/** Heuristic lesson detectors: turn the day's numbers into actionable French lessons with evidence. */
import type { BrainNote, LessonDraft } from '../contracts.js';
import type { AdCreative, AdFormat, DailyKpi, DeptId, Experiment, HookStyle, Lesson, Product, TaskKind, WorldState } from '../shared.js';
import { clamp } from '../core/index.js';
import { isScamFlag } from '../sim/market.js';
import { empiricalMean, nearestArm, PRICE_ARMS } from './bandits.js';
import {
  addRow, adRows, ctrOf, cvrOf, emptyAgg, financeView, findNoteLink, nicheName, priceOnDay, productOfRow, roasOf, windowLabel,
  type FunnelAgg, type WorldIndex,
} from './data.js';
import { experimentNiche, experimentThreshold, experimentValueKind, lowerIsBetter } from './experiments.js';
import {
  DIMENSION_LABELS, FORMAT_LABELS, HOOK_LABELS, TASK_LABELS, fmtEur, fmtNum, fmtPct, fmtRatio, fold, plural, round,
  safeDiv, shorten, slugify, unique,
} from './text.js';

export interface HeuristicDraft extends LessonDraft {
  /** Stable dedup key (French slug), also the suffix of the lesson note file name. */
  key: string;
  title: string;
  links: string[];
  tags: string[];
  extraDepts: DeptId[];
  /** Compliance / survival lessons kept even if the engine drops them. */
  critical: boolean;
  /** Route only to `extraDepts` (+ the CEO) instead of the topic's departments. */
  routeOnly?: boolean;
}

export interface RetroInput {
  world: WorldState;
  day: number;
  kpi: DailyKpi;
  ix: WorldIndex;
  notes: BrainNote[];
  concluded: Experiment[];
}

/** Claims the TikTok-like ad platform refuses (seed policy "Conformité pub TikTok"). */
export const BASE_BANNED_TERMS: readonly string[] = [
  'résultat garanti', 'garanti', 'garantie', '100 %', '100%', 'à coup sûr', 'en 3 jours', 'en 7 jours', 'miracle',
  'guérir', 'guérit', 'soigner', 'remplace votre médecin', 'devenir riche', 'revenu passif', 'sans effort',
  'argent facile', 'définitivement', 'sans risque', 'plus que 2 exemplaires', 'perdre 10 kilos',
];

function draft(d: Omit<HeuristicDraft, 'appliesToRoles' | 'extraDepts' | 'critical' | 'tags' | 'links'> & Partial<HeuristicDraft>): HeuristicDraft {
  return {
    appliesToRoles: [],
    extraDepts: [],
    critical: false,
    tags: [],
    links: [],
    ...d,
    confidence: round(clamp(d.confidence, 0.05, 0.98), 2),
  };
}

/** Confidence from sample size: n / (n + half), scaled by how clear the gap is. */
function sampleConfidence(n: number, half: number, gap = 1): number {
  return 0.25 + 0.7 * (n / (n + half)) * clamp(gap, 0.25, 1);
}

function nicheLink(inp: RetroInput, nicheId: string): string[] {
  const l = findNoteLink(inp.notes, 'niches', [nicheId, nicheName(inp.world, nicheId)]);
  return l ? [l] : [];
}

function productLink(inp: RetroInput, p: Product): string[] {
  const l = findNoteLink(inp.notes, 'produits', [p.id, p.title]);
  return l ? [l] : [];
}

type CreativeAgg = FunnelAgg & { creatives: Set<string> };

// ───────────────────────────── Ads ─────────────────────────────

function compareCreatives(inp: RetroInput, dim: 'hookStyle' | 'format'): HeuristicDraft[] {
  const { world, day, ix } = inp;
  const from = Math.max(1, day - 13);
  const perNiche = new Map<string, Map<string, CreativeAgg>>();
  for (const r of adRows(world, from, day)) {
    const c = ix.creatives.get(r.creativeId);
    const p = productOfRow(ix, r);
    const key = c?.[dim];
    if (!c || !p?.nicheId || !key) continue;
    const m = perNiche.get(p.nicheId) ?? new Map<string, CreativeAgg>();
    const agg = m.get(key) ?? { ...emptyAgg(), creatives: new Set<string>() };
    addRow(agg, r);
    agg.creatives.add(c.id);
    m.set(key, agg);
    perNiche.set(p.nicheId, m);
  }
  const out: HeuristicDraft[] = [];
  for (const [nicheId, m] of perNiche) {
    const list = [...m].filter(([, a]) => a.impressions >= 2000).sort((a, b) => ctrOf(b[1]) - ctrOf(a[1]));
    if (list.length < 2) continue;
    const [bKey, bAgg] = list[0]!;
    const [wKey, wAgg] = list[list.length - 1]!;
    const cb = ctrOf(bAgg);
    const cw = ctrOf(wAgg);
    const ratio = safeDiv(cb, Math.max(cw, 1e-6));
    if (cb <= 0 || ratio < 1.25) continue;
    const name = nicheName(world, nicheId);
    const label = (k: string) => (dim === 'hookStyle' ? HOOK_LABELS[k as HookStyle] : FORMAT_LABELS[k as AdFormat]) ?? k;
    const word = dim === 'hookStyle' ? 'hook' : 'format';
    const evidence = `${list
      .map(([k, a]) => `« ${k} » : CTR ${fmtPct(ctrOf(a), 2)} sur ${fmtNum(a.impressions)} impressions (${plural(a.creatives.size, 'pub', 'pubs')})`)
      .join(' · ')} — ${windowLabel(world, from, day)}.`;
    out.push(draft({
      key: `pub-${word}-${slugify(nicheId, 40)}`,
      topic: 'ads',
      title: `${word === 'hook' ? 'Hook' : 'Format'} « ${bKey} » sur ${name}`,
      insight: `Privilégier le ${word} « ${bKey} » (${label(bKey)}) sur « ${name} » : CTR ${fmtPct(cb, 2)} contre ${fmtPct(cw, 2)} pour « ${wKey} » (${label(wKey)}).`,
      evidence,
      confidence: sampleConfidence(Math.min(bAgg.impressions, wAgg.impressions), 6000, (ratio - 1) / 1),
      links: ["Canaux d'acquisition", ...nicheLink(inp, nicheId)],
      tags: [word === 'hook' ? 'hook' : 'format', 'tiktok'],
      extraDepts: ['creation'],
    }));
  }
  return out;
}

function lowCtr(inp: RetroInput): HeuristicDraft[] {
  const from = Math.max(1, inp.day - 2);
  const agg = emptyAgg();
  for (const r of adRows(inp.world, from, inp.day)) addRow(agg, r);
  const ctr = ctrOf(agg);
  if (agg.impressions < 5000 || ctr >= 0.008) return [];
  return [draft({
    key: 'pub-ctr-faible',
    topic: 'ads',
    title: 'Hooks trop faibles',
    insight: `Retravailler les 2 premières secondes des pubs : le CTR moyen plafonne à ${fmtPct(ctr, 2)}, loin du 1,5 % visé.`,
    evidence: `${plural(agg.clicks, 'clic', 'clics')} pour ${fmtNum(agg.impressions)} impressions sur les ${windowLabel(inp.world, from, inp.day)} (${fmtEur(agg.spend)} dépensés).`,
    confidence: sampleConfidence(agg.impressions, 15000),
    links: ["Canaux d'acquisition"],
    tags: ['hook', 'ctr'],
    extraDepts: ['creation'],
  })];
}

function fatigue(inp: RetroInput): HeuristicDraft[] {
  const { world, day, ix } = inp;
  const perCreative = new Map<string, Map<number, FunnelAgg>>();
  for (const r of adRows(world, 1, day)) {
    const m = perCreative.get(r.creativeId) ?? new Map<number, FunnelAgg>();
    m.set(r.day, addRow(m.get(r.day) ?? emptyAgg(), r));
    perCreative.set(r.creativeId, m);
  }
  let best: { c: AdCreative; first: number; last: number; drop: number; days: number; freq: number; impressions: number } | null = null;
  for (const [creativeId, byDay] of perCreative) {
    if (!byDay.has(day) || byDay.size < 4) continue;
    const c = ix.creatives.get(creativeId);
    if (!c) continue;
    const days = [...byDay.keys()].sort((a, b) => a - b);
    const sum = (ds: number[]) => ds.reduce((agg, d) => {
      const x = byDay.get(d)!;
      agg.impressions += x.impressions;
      agg.clicks += x.clicks;
      agg.maxFrequency = Math.max(agg.maxFrequency, x.maxFrequency);
      return agg;
    }, emptyAgg());
    const head = sum(days.slice(0, 2));
    const tail = sum(days.slice(-2));
    if (head.impressions < 600 || tail.impressions < 600) continue;
    const first = ctrOf(head);
    const last = ctrOf(tail);
    if (first <= 0) continue;
    const drop = 1 - last / first;
    if (drop >= 0.35 && (!best || drop > best.drop)) {
      best = { c, first, last, drop, days: days[days.length - 1]! - days[0]! + 1, freq: tail.maxFrequency, impressions: head.impressions + tail.impressions };
    }
  }
  if (!best) return [];
  return [draft({
    key: 'pub-fatigue',
    topic: 'ads',
    title: 'Fatigue créative',
    insight: `Renouveler une pub dès que son CTR chute d'un tiers : « ${shorten(best.c.hook, 60)} » est passée de ${fmtPct(best.first, 2)} à ${fmtPct(best.last, 2)} en ${best.days} jours.`,
    evidence: `Pub ${best.c.id} (${best.c.hookStyle}, ${best.c.format}) : baisse de ${fmtPct(best.drop, 0)} du CTR, fréquence ${fmtRatio(best.freq)}, ${fmtNum(best.impressions)} impressions comparées.`,
    confidence: sampleConfidence(best.impressions, 8000, best.drop / 0.6),
    links: ["Canaux d'acquisition"],
    tags: ['fatigue', 'tiktok'],
    extraDepts: ['creation'],
  })];
}

function creativeText(c: AdCreative): string {
  return [c.hook, c.caption, c.cta, ...(c.hashtags ?? []), ...(c.scenes ?? []).flatMap((s) => [s.onScreenText, s.voiceover, s.visual])]
    .filter(Boolean)
    .join(' \n ');
}

function cleanTerm(t: string | undefined): string | null {
  if (!t) return null;
  const s = t.replace(/[«»"“”]/g, '').replace(/\s+/g, ' ').trim().replace(/^[\s,;:.!?-]+|[\s,;:.!?-]+$/g, '').toLowerCase();
  if (s.length < 2 || s.length > 40 || s.split(' ').length > 4) return null;
  return s;
}

/** Offending word of an ad rejection: quoted term of the reason, "mot interdit : X", or a known banned claim. */
export function extractBannedTerm(reason: string, text: string, known: readonly string[]): string | null {
  const r = String(reason ?? '');
  const candidates: (string | null)[] = [];
  for (const m of r.matchAll(/«\s*([^»]{1,40}?)\s*»|“([^”]{1,40})”|"([^"]{1,40})"/g)) candidates.push(cleanTerm(m[1] ?? m[2] ?? m[3]));
  const colon = r.match(/(?:mot|terme|expression|allégation|formulation|promesse)[^:]{0,30}:\s*([^.,;()«»]{2,40})/i);
  if (colon) candidates.push(cleanTerm(colon[1]));
  const fr = fold(r);
  const sortedKnown = [...known].sort((a, b) => b.length - a.length);
  for (const k of sortedKnown) if (fold(k) && fr.includes(fold(k))) candidates.push(cleanTerm(k));
  const clean = unique(candidates.filter((c): c is string => Boolean(c)));
  const ft = fold(text);
  const inText = clean.find((c) => ft.includes(fold(c)));
  if (inText) return inText;
  if (clean.length) return clean[0]!;
  for (const k of sortedKnown) if (fold(k) && ft.includes(fold(k))) return cleanTerm(k);
  return null;
}

function rejections(inp: RetroInput): HeuristicDraft[] {
  const { world, day } = inp;
  const creatives = world.company.creatives ?? [];
  const today = creatives.filter((c) => c.review?.status === 'rejected' && (c.review.day === day || (c.review.day == null && c.createdDay === day)));
  if (today.length === 0) return [];
  const known = unique([
    ...BASE_BANNED_TERMS,
    ...Object.values(world.company.research?.voc ?? {}).flatMap((v) => v?.bannedClaims ?? []),
  ]);
  const strikes = world.market?.adAccount?.strikes ?? 0;
  const byTerm = new Map<string, AdCreative[]>();
  const unknown: AdCreative[] = [];
  for (const c of today) {
    const term = extractBannedTerm(c.review.reason ?? '', creativeText(c), known);
    if (term) byTerm.set(term, [...(byTerm.get(term) ?? []), c]);
    else unknown.push(c);
  }
  const out: HeuristicDraft[] = [];
  for (const [term, list] of byTerm) {
    const ft = fold(term);
    const total = creatives.filter((c) => c.review?.status === 'rejected' && (fold(c.review.reason ?? '').includes(ft) || fold(creativeText(c)).includes(ft))).length;
    const c = list[0]!;
    out.push(draft({
      key: `pub-mot-interdit-${slugify(term, 30)}`,
      topic: 'ads',
      title: `Mot interdit en pub : ${term}`,
      insight: `Ne jamais écrire « ${term} » dans une pub : la plateforme refuse ce type de promesse et chaque refus rapproche le compte de la suspension.`,
      evidence: `${plural(list.length, 'pub refusée', 'pubs refusées')} le jour ${day}, dont « ${shorten(c.hook, 60)} » (${c.id}) — motif : « ${shorten(c.review.reason ?? 'non précisé', 110)} ». ${plural(total, 'refus', 'refus')} au total pour ce mot, ${plural(strikes, 'avertissement', 'avertissements')} sur le compte pub.`,
      confidence: 0.9,
      links: ['Conformité pub TikTok', "Canaux d'acquisition"],
      tags: ['conformite', 'tiktok', 'refus'],
      extraDepts: ['creation'],
      critical: true,
    }));
  }
  for (const c of unknown) {
    const reason = c.review.reason ?? 'motif non précisé';
    out.push(draft({
      key: `pub-refus-${slugify(reason, 30)}`,
      topic: 'ads',
      title: 'Pub refusée',
      insight: `Faire relire chaque pub par la conformité avant envoi : refus pour « ${shorten(reason, 80)} ».`,
      evidence: `Pub « ${shorten(c.hook, 60)} » (${c.id}) refusée le jour ${day}. ${plural(strikes, 'avertissement', 'avertissements')} sur le compte pub.`,
      confidence: 0.75,
      links: ['Conformité pub TikTok'],
      tags: ['conformite', 'tiktok', 'refus'],
      extraDepts: ['creation'],
      critical: true,
    }));
  }
  return out;
}

function adAccount(inp: RetroInput): HeuristicDraft[] {
  const acc = inp.world.market?.adAccount;
  if (!acc) return [];
  if (acc.banned) {
    return [draft({
      key: 'pub-compte-suspendu',
      topic: 'ads',
      title: 'Compte pub suspendu',
      insight: `Compte pub suspendu : basculer sur l'organique et les créateurs à la commission${acc.bannedUntilDay ? ` jusqu'au jour ${acc.bannedUntilDay}` : ''}, puis faire relire chaque pub avant envoi.`,
      evidence: `${plural(acc.strikes, 'avertissement', 'avertissements')} cumulés avant la suspension du compte.`,
      confidence: 0.95,
      links: ['Conformité pub TikTok', "Canaux d'acquisition"],
      tags: ['conformite', 'compte'],
      extraDepts: ['direction', 'creation'],
      critical: true,
    })];
  }
  if (acc.strikes >= 2) {
    return [draft({
      key: 'pub-compte-avertissements',
      topic: 'ads',
      title: 'Compte pub en danger',
      insight: `Compte pub à ${acc.strikes} avertissements (3 = suspension possible) : chaque pub passe par une relecture conformité avant envoi.`,
      evidence: `${plural(acc.strikes, 'avertissement', 'avertissements')} sur le compte, ${plural((inp.world.company.creatives ?? []).filter((c) => c.review?.status === 'rejected').length, 'pub refusée', 'pubs refusées')} depuis le début.`,
      confidence: 0.85,
      links: ['Conformité pub TikTok'],
      tags: ['conformite', 'compte'],
      extraDepts: ['direction', 'creation'],
      critical: true,
    })];
  }
  return [];
}

function organic(inp: RetroInput): HeuristicDraft[] {
  const { world, day } = inp;
  // viral posts are outliers with their own lesson below: the style comparison uses the median of the others
  const posts = (world.market?.organicPosts ?? []).filter((p) => p.day > day - 7 && p.day <= day && !p.viral);
  const out: HeuristicDraft[] = [];
  const by = new Map<string, number[]>();
  for (const p of posts) by.set(p.hookStyle, [...(by.get(p.hookStyle) ?? []), Math.max(0, p.views)]);
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const list = [...by].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, { n: v.length, med: median(v) }] as const).sort((a, b) => b[1].med - a[1].med);
  if (posts.length >= 6 && list.length >= 2) {
    const [bk, bv] = list[0]!;
    const [wk, wv] = list[list.length - 1]!;
    const ratio = safeDiv(bv.med, Math.max(1, wv.med));
    if (ratio >= 1.8) {
      out.push(draft({
        key: 'organique-hook',
        topic: 'ads',
        title: `Organique : hooks « ${bk} »`,
        insight: `En organique, les hooks « ${bk} » (${HOOK_LABELS[bk as HookStyle] ?? bk}) font ${fmtRatio(ratio)}× plus de vues que les « ${wk} » : en publier davantage.`,
        evidence: `${fmtNum(bv.med)} vues (médiane) sur ${bv.n} posts « ${bk} » contre ${fmtNum(wv.med)} sur ${wv.n} posts « ${wk} » (7 derniers jours, posts viraux exclus).`,
        confidence: sampleConfidence(posts.length, 20, (ratio - 1) / 2),
        links: ["Canaux d'acquisition"],
        tags: ['organique', 'tiktok'],
      }));
    }
  }
  const viral = (world.market?.organicPosts ?? []).filter((p) => p.day === day && p.viral).sort((a, b) => b.views - a.views)[0];
  if (viral) {
    out.push(draft({
      key: 'organique-viral',
      topic: 'ads',
      title: 'Post viral à décliner',
      insight: `Décliner en pub le hook du post devenu viral : « ${shorten(viral.hook, 70)} » (${viral.hookStyle}).`,
      evidence: `${fmtNum(viral.views)} vues, ${plural(viral.clicks, 'clic', 'clics')} et ${plural(viral.sales, 'vente', 'ventes')} le jour ${day} (format ${viral.format}).`,
      confidence: 0.55,
      links: ["Canaux d'acquisition"],
      tags: ['organique', 'viral'],
      extraDepts: ['creation'],
    }));
  }
  return out;
}

// ───────────────────────────── Pricing & sales page ─────────────────────────────

function prices(inp: RetroInput): HeuristicDraft[] {
  const { world, day, ix } = inp;
  const from = Math.max(1, day - 20);
  type Bucket = { lv: number; revenue: number; purchases: number; refunds: number };
  const per = new Map<string, Map<string, Bucket>>();
  for (const r of adRows(world, from, day)) {
    const p = productOfRow(ix, r);
    if (!p?.nicheId) continue;
    const bucket = nearestArm(priceOnDay(p, r.day), PRICE_ARMS);
    if (!bucket) continue;
    const m = per.get(p.nicheId) ?? new Map<string, Bucket>();
    const cur: Bucket = m.get(bucket) ?? { lv: 0, revenue: 0, purchases: 0, refunds: 0 };
    cur.lv += Math.max(0, r.landingViews);
    cur.revenue += Math.max(0, r.revenue);
    cur.purchases += Math.max(0, r.purchases);
    m.set(bucket, cur);
    per.set(p.nicheId, m);
  }
  for (const o of world.market?.orders ?? []) {
    if (o.day < from || o.day > day || o.source !== 'ads' || !(o.refunded || o.chargeback)) continue;
    const p = ix.products.get(o.productId);
    const bucket = nearestArm(o.price, PRICE_ARMS);
    const cur = p && bucket ? per.get(p.nicheId)?.get(bucket) : undefined;
    if (cur) cur.refunds += Math.abs(o.price);
  }
  const out: HeuristicDraft[] = [];
  for (const [nicheId, m] of per) {
    const name = nicheName(world, nicheId);
    const ppv = (v: { lv: number; revenue: number; refunds: number }) => safeDiv(v.revenue - v.refunds, v.lv);
    const list = [...m].filter(([, v]) => v.lv >= 60).sort((a, b) => ppv(b[1]) - ppv(a[1]));
    const base = { topic: 'pricing' as const, links: ['Prix', 'Page de vente', ...nicheLink(inp, nicheId)], tags: ['prix'], key: `prix-${slugify(nicheId, 40)}` };
    if (list.length >= 2) {
      const [bk, bv] = list[0]!;
      const [wk, wv] = list[list.length - 1]!;
      const gap = ppv(bv) - ppv(wv);
      if (gap >= 0.05 && ppv(bv) > 0 && safeDiv(ppv(bv), Math.max(0.01, ppv(wv))) >= 1.2) {
        out.push(draft({
          ...base,
          title: `Prix cible ${bk} € sur ${name}`,
          insight: `Prix cible « ${bk} » sur « ${name} » : ${fmtEur(ppv(bv))} de profit par visiteur contre ${fmtEur(ppv(wv))} à ${wk} €.`,
          evidence: list.map(([k, v]) => `${k} € : ${fmtEur(ppv(v))}/visiteur, conversion ${fmtPct(safeDiv(v.purchases, v.lv))} sur ${fmtNum(v.lv)} visites`).join(' · ') + ` — ${windowLabel(world, from, day)}.`,
          confidence: sampleConfidence(Math.min(bv.lv, wv.lv), 150, gap / 0.3),
        }));
      }
      continue;
    }
    if (list.length === 1) {
      const [k, v] = list[0]!;
      const cvr = safeDiv(v.purchases, v.lv);
      const idx = PRICE_ARMS.indexOf(k as (typeof PRICE_ARMS)[number]);
      if (v.lv >= 150 && cvr >= 0.06 && idx >= 0 && idx < PRICE_ARMS.length - 1) {
        const next = PRICE_ARMS[idx + 1]!;
        out.push(draft({
          ...base,
          title: `Monter le prix sur ${name}`,
          insight: `Prix cible « ${next} » sur « ${name} » à tester : ${fmtPct(cvr)} des visiteurs achètent déjà à ${k} €, la demande supporte plus.`,
          evidence: `${plural(v.purchases, 'vente', 'ventes')} pour ${fmtNum(v.lv)} visites à ${k} € (${windowLabel(world, from, day)}), ${fmtEur(ppv(v))} de profit par visiteur.`,
          confidence: sampleConfidence(v.lv, 300, 0.6),
        }));
      } else if (v.lv >= 150 && cvr < 0.01 && idx > 0 && Number(k) >= 24) {
        const prev = PRICE_ARMS[idx - 1]!;
        out.push(draft({
          ...base,
          title: `Baisser le prix sur ${name}`,
          insight: `Prix cible « ${prev} » sur « ${name} » : à ${k} €, ${v.purchases > 0 ? `seulement ${fmtPct(cvr)} des visiteurs achètent` : `aucun des ${fmtNum(v.lv)} visiteurs n'a acheté`}.`,
          evidence: `${plural(v.purchases, 'vente', 'ventes')} pour ${fmtNum(v.lv)} visites à ${k} € (${windowLabel(world, from, day)}).`,
          confidence: sampleConfidence(v.lv, 300, 0.5),
        }));
      }
    }
  }
  return out;
}

function salesPageConversion(inp: RetroInput): HeuristicDraft[] {
  const { world, day, ix } = inp;
  const from = Math.max(1, day - 2);
  const per = new Map<string, FunnelAgg>();
  for (const r of adRows(world, from, day)) {
    const p = productOfRow(ix, r);
    if (p) per.set(p.id, addRow(per.get(p.id) ?? emptyAgg(), r));
  }
  const out: HeuristicDraft[] = [];
  for (const [productId, a] of per) {
    const p = ix.products.get(productId)!;
    const cvr = cvrOf(a);
    if (a.landingViews < 150 || cvr >= 0.01) continue;
    out.push(draft({
      key: LESSON_KEYS.page(productId),
      topic: 'pricing',
      title: `Page de vente à retravailler : ${shorten(p.title, 50)}`,
      insight: `Réécrire la page de vente de « ${shorten(p.title, 70)} » avec les mots exacts des clients et les objections traitées : seulement ${fmtPct(cvr)} des visiteurs achètent.`,
      evidence: `${plural(a.purchases, 'vente', 'ventes')} pour ${fmtNum(a.landingViews)} visites sur les ${windowLabel(world, from, day)} (prix ${fmtEur(p.price, 0)}, promesse ${p.salesPage ? fmtRatio(p.salesPage.hypeLevel) : 'n/c'}).`,
      confidence: sampleConfidence(a.landingViews, 400),
      links: ['Page de vente', ...productLink(inp, p)],
      tags: ['page-de-vente', 'conversion'],
    }));
  }
  return out;
}

// ───────────────────────────── Product ─────────────────────────────

function productOrders(inp: RetroInput, windowDays: number): Map<string, { n: number; refunded: number }> {
  const out = new Map<string, { n: number; refunded: number }>();
  for (const o of inp.world.market?.orders ?? []) {
    if (o.day <= inp.day - windowDays || o.day > inp.day) continue;
    const cur = out.get(o.productId) ?? { n: 0, refunded: 0 };
    cur.n += 1;
    if (o.refunded || o.chargeback) cur.refunded += 1;
    out.set(o.productId, cur);
  }
  return out;
}

function hypeAndQuality(inp: RetroInput): HeuristicDraft[] {
  const { world, day, ix } = inp;
  const stats = productOrders(inp, 10);
  const out: HeuristicDraft[] = [];
  const rows = [...stats]
    .map(([id, s]) => ({ p: ix.products.get(id), ...s, rate: safeDiv(s.refunded, s.n) }))
    .filter((x): x is { p: Product; n: number; refunded: number; rate: number } => Boolean(x.p) && x.n >= 10);

  const hyped = rows.filter((x) => (x.p.salesPage?.hypeLevel ?? 0) >= 0.55 && x.rate >= 0.12).sort((a, b) => b.rate - a.rate);
  if (hyped.length) {
    const worst = hyped[0]!;
    const sober = rows.filter((x) => (x.p.salesPage?.hypeLevel ?? 1) <= 0.45);
    const soberN = sober.reduce((s, x) => s + x.n, 0);
    const soberRate = safeDiv(sober.reduce((s, x) => s + x.refunded, 0), soberN);
    out.push(draft({
      key: 'produit-promesse-max',
      topic: 'product',
      title: 'Promesse plafonnée à 0.4',
      insight: 'Niveau de promesse max « 0.4 » sur les pages de vente : la survente fait exploser les remboursements.',
      evidence: `« ${shorten(worst.p.title, 60)} » (promesse ${fmtRatio(worst.p.salesPage?.hypeLevel ?? 0)}) : ${fmtPct(worst.rate)} de remboursements sur ${plural(worst.n, 'vente', 'ventes')} en 10 jours${soberN >= 10 ? `, contre ${fmtPct(soberRate)} pour les pages sobres (${plural(soberN, 'vente', 'ventes')})` : ''}.`,
      confidence: sampleConfidence(worst.n, 25, worst.rate / 0.25),
      links: ['Page de vente', "Structure d'un PDF qui vend", ...productLink(inp, worst.p)],
      tags: ['promesse', 'remboursement'],
      extraDepts: ['boutique'],
      critical: true,
    }));
  }

  for (const x of rows) {
    const p = x.p;
    const reviews = p.stats?.reviews ?? [];
    const lowRating = reviews.length >= 3 && (p.stats?.rating ?? 5) > 0 && (p.stats?.rating ?? 5) < 3.6;
    const soberRefunds = x.rate >= 0.12 && (p.salesPage?.hypeLevel ?? 0) < 0.55;
    if (!lowRating && !soberRefunds) continue;
    const worstReview = [...reviews].sort((a, b) => a.rating - b.rating)[0];
    out.push(draft({
      key: LESSON_KEYS.quality(p.id),
      topic: 'product',
      title: `Guide v${(p.version ?? 1) + 1} : ${shorten(p.title, 50)}`,
      insight: `Retravailler « ${shorten(p.title, 70)} » en v${(p.version ?? 1) + 1} à partir des plaintes clients : ${soberRefunds ? `${fmtPct(x.rate)} de remboursements malgré une promesse sobre` : `note moyenne de ${fmtRatio(p.stats.rating)}/5`}.`,
      evidence: `${plural(x.n, 'vente', 'ventes')} et ${plural(x.refunded, 'remboursement', 'remboursements')} sur 10 jours, note ${p.stats?.rating ? `${fmtRatio(p.stats.rating)}/5 (${reviews.length} avis)` : 'sans avis'}${worstReview ? ` — pire avis : « ${shorten(worstReview.text, 90)} »` : ''}.`,
      confidence: sampleConfidence(x.n + reviews.length * 3, 30),
      links: ["Structure d'un PDF qui vend", ...productLink(inp, p)],
      tags: ['qualite', 'v2'],
    }));
  }

  for (const p of world.company.products ?? []) {
    if (p.status !== 'live' || p.upsellProductId || (p.stats?.sales ?? 0) < 20) continue;
    out.push(draft({
      key: `produit-upsell-${slugify(p.id, 30)}`,
      topic: 'product',
      title: `Upsell à créer : ${shorten(p.title, 50)}`,
      insight: `Préparer le 2e guide « La suite est ici » pour les acheteurs de « ${shorten(p.title, 70)} » : ils n'ont rien d'autre à acheter.`,
      evidence: `${plural(p.stats.sales, 'vente', 'ventes')} et ${fmtEur(p.stats.revenue)} de CA, aucun upsell relié (${plural(p.stats.upsellSales ?? 0, "vente d'upsell", "ventes d'upsell")}).`,
      confidence: sampleConfidence(p.stats.sales, 40),
      links: ["Structure d'un PDF qui vend", 'Prix', ...productLink(inp, p)],
      tags: ['upsell'],
      extraDepts: ['boutique'],
    }));
  }
  return out;
}

// ───────────────────────────── Support ─────────────────────────────

function support(inp: RetroInput): HeuristicDraft[] {
  const { world, day, kpi } = inp;
  const out: HeuristicDraft[] = [];
  const escalated = (world.market?.inbox ?? []).filter((m) => m.status === 'escalated' && m.deadlineDay >= day - 1 && m.deadlineDay <= day);
  if (escalated.length) {
    const subjects = unique(escalated.map((m) => shorten(m.subject, 40))).slice(0, 3).join(', '); // what we can read, not the hidden intent
    out.push(draft({
      key: 'support-delai',
      topic: 'support',
      title: 'Répondre sous 24 h',
      insight: `Répondre à chaque message client sous 24 h : les messages ignorés tournent en mauvais avis ou en chargeback.`,
      evidence: `${plural(escalated.length, 'message escaladé', 'messages escaladés')} faute de réponse (jours ${day - 1} à ${day}, sujets : ${subjects}) — ${plural(kpi.openTickets, 'ticket encore ouvert', 'tickets encore ouverts')}.`,
      confidence: 0.5 + Math.min(0.4, escalated.length * 0.1),
      links: ['Support client'],
      tags: ['delai', 'escalade'],
    }));
  }
  const ledgerToday = (world.ledger ?? []).filter((e) => e.day === day);
  const chargebacks = ledgerToday.filter((e) => e.type === 'chargeback');
  if (chargebacks.length) {
    const lost = chargebacks.reduce((s, e) => s + Math.abs(e.amount), 0);
    out.push(draft({
      key: 'support-chargeback',
      topic: 'support',
      title: 'Rembourser plutôt que subir un chargeback',
      insight: "Rembourser sans discuter toute demande de bonne foi : un chargeback coûte le montant de la vente plus les frais.",
      evidence: `${plural(chargebacks.length, 'chargeback', 'chargebacks')} le jour ${day}, ${fmtEur(lost)} perdus (${shorten(chargebacks.map((e) => e.memo).filter(Boolean).join(' ; '), 120) || 'sans détail'}).`,
      confidence: 0.6 + Math.min(0.3, chargebacks.length * 0.1),
      links: ['Support client', 'Budget et garde-fous'],
      tags: ['chargeback', 'remboursement'],
      extraDepts: ['finance'],
      critical: true,
    }));
  }
  const stolen = ledgerToday.filter((e) => e.type === 'scam_loss');
  // a scam_loss on an order id = a false claim paid to a real buyer; the rest went to strangers
  const claims = stolen.filter((e) => e.ref && inp.ix.orders.has(e.ref));
  if (claims.length) {
    const lost = claims.reduce((s, e) => s + Math.abs(e.amount), 0);
    out.push(draft({
      key: 'support-fausse-reclamation',
      topic: 'support',
      title: 'Vérifier la commande avant de rembourser',
      insight: 'Vérifier la commande avant de rembourser une réclamation (double débit, PDF jamais reçu, paiement non reconnu) : le nombre de débits, les téléchargements et les échanges passés disent si elle est vraie.',
      evidence: `${plural(claims.length, 'fausse réclamation payée', 'fausses réclamations payées')} le jour ${day}, ${fmtEur(lost)} perdus : ${shorten(claims.map((e) => e.memo).filter(Boolean).join(' ; '), 140)}.`,
      confidence: 0.7 + Math.min(0.2, claims.length * 0.08),
      links: ['Support client', 'Budget et garde-fous'],
      tags: ['arnaque', 'remboursement'],
      extraDepts: ['finance'],
      critical: true,
    }));
  }
  const scams = stolen.filter((e) => !claims.includes(e));
  if (scams.length) {
    const lost = scams.reduce((s, e) => s + Math.abs(e.amount), 0);
    out.push(draft({
      key: 'support-arnaque',
      topic: 'support',
      title: 'Arnaques : ne jamais payer',
      insight: "Ne jamais payer ni cliquer sur un lien envoyé par un inconnu (faux support TikTok, promesse de vues) : bloquer et signaler.",
      evidence: `${fmtEur(lost)} perdus le jour ${day} : ${shorten(scams.map((e) => e.memo).filter(Boolean).join(' ; '), 140) || 'arnaque sans détail'}.`,
      confidence: 0.9,
      links: ['Support client', 'Budget et garde-fous'],
      tags: ['arnaque', 'securite'],
      extraDepts: ['finance', 'partenariats'],
      critical: true,
    }));
  }
  if (kpi.avgReplyScore > 0 && kpi.avgReplyScore < 55) {
    out.push(draft({
      key: 'support-qualite',
      topic: 'support',
      title: 'Réponses support trop faibles',
      insight: "Relire chaque réponse support avant envoi : identifier l'intention, montrer de l'empathie, proposer une solution concrète et signer.",
      evidence: `Score moyen des réponses : ${fmtNum(kpi.avgReplyScore)}/100 le jour ${day} (objectif ≥ 70).`,
      confidence: 0.55,
      links: ['Support client'],
      tags: ['qualite'],
    }));
  }
  const arms = (world.company.bandits?.support_tone ?? []).filter((a) => a.pulls >= 6).sort((a, b) => empiricalMean(b) - empiricalMean(a));
  if (arms.length >= 2) {
    const best = arms[0]!;
    const worst = arms[arms.length - 1]!;
    const gap = empiricalMean(best) - empiricalMean(worst);
    if (gap >= 0.08) {
      out.push(draft({
        key: 'support-ton',
        topic: 'support',
        title: `Ton support « ${best.key} »`,
        insight: `Ton support « ${best.key} » : score moyen ${fmtNum(empiricalMean(best) * 100)}/100 contre ${fmtNum(empiricalMean(worst) * 100)}/100 en ton « ${worst.key} ».`,
        evidence: arms.map((a) => `« ${a.key} » : ${fmtNum(empiricalMean(a) * 100)}/100 sur ${a.pulls} réponses`).join(' · ') + '.',
        confidence: sampleConfidence(Math.min(best.pulls, worst.pulls), 15, gap / 0.2),
        links: ['Support client'],
        tags: ['ton'],
      }));
    }
  }
  return out;
}

// ───────────────────────────── Partnerships ─────────────────────────────

function creators(inp: RetroInput): HeuristicDraft[] {
  const { world } = inp;
  const out: HeuristicDraft[] = [];
  const partnerships = world.market?.partnerships ?? [];
  const profiles = new Map((world.market?.creators ?? []).map((c) => [c.id, c]));
  const scams = partnerships.filter((p) => p.status === 'scam');
  if (scams.length) {
    const flags = unique(scams.flatMap((p) => profiles.get(p.creatorId)?.redFlags.filter(isScamFlag) ?? [])).slice(0, 4);
    const lost = scams.reduce((s, p) => s + Math.abs(p.upfront), 0);
    // what the public profile of a scammer looked like: the numbers to watch when no red flag was showing
    const profile = (id: string): string => {
      const c = profiles.get(id);
      if (!c) return id;
      return `@${c.handle} : ${fmtPct(safeDiv(c.avgViews, c.followers), 0)} de vues par abonné, engagement ${fmtPct(c.engagement, 1)}, ${fmtEur(safeDiv(c.askUpfront * 1000, c.avgViews), 0)} pour 1 000 vues`;
    };
    out.push(draft({
      key: 'partenariat-arnaque',
      topic: 'partnership',
      title: 'Créateurs : signaux d\'alerte',
      insight: flags.length
        ? `Refuser tout créateur qui présente ces signaux : ${flags.map((f) => `« ${shorten(f, 50)} »`).join(', ')} — et jamais d'avance sans preuve de résultats.`
        : "Ne jamais verser d'avance à un créateur sans preuve de résultats (statistiques réelles, anciens partenariats) : comparer ses vues à ses abonnés, son engagement et son prix pour 1 000 vues.",
      evidence: `${plural(scams.length, 'arnaque', 'arnaques')} de créateurs, ${fmtEur(lost)} d'avances perdues : ${scams.slice(0, 3).map((p) => `${profile(p.creatorId)} (${fmtEur(p.upfront)})`).join(' ; ')}.`,
      confidence: 0.7 + Math.min(0.25, scams.length * 0.08),
      links: ["Canaux d'acquisition", 'Budget et garde-fous'],
      tags: ['createurs', 'arnaque'],
      extraDepts: ['finance'],
      critical: true,
    }));
  }
  const delivered = partnerships.filter((p) => p.status === 'delivered');
  const commissionOnly = delivered.filter((p) => p.upfront <= 0 && p.sales > 0);
  if (commissionOnly.length) {
    const revenue = commissionOnly.reduce((s, p) => s + p.revenue, 0);
    const sales = commissionOnly.reduce((s, p) => s + p.sales, 0);
    out.push(draft({
      key: 'partenariat-commission',
      topic: 'partnership',
      title: 'Petits créateurs à la commission',
      insight: 'Multiplier les petits créateurs payés à la commission seulement : ils vendent sans coûter un euro d\'avance.',
      evidence: `${plural(commissionOnly.length, 'partenariat', 'partenariats')} à la commission : ${plural(sales, 'vente', 'ventes')}, ${fmtEur(revenue)} de CA, 0 € d'avance.`,
      confidence: sampleConfidence(sales, 20),
      links: ["Canaux d'acquisition"],
      tags: ['createurs', 'commission'],
    }));
  }
  const paid = delivered.filter((p) => p.upfront > 0);
  const paidUp = paid.reduce((s, p) => s + p.upfront, 0);
  const paidRev = paid.reduce((s, p) => s + p.revenue, 0);
  if (paid.length >= 1 && paidRev < paidUp) {
    out.push(draft({
      key: LESSON_KEYS.advance,
      topic: 'partnership',
      title: 'Avances aux créateurs non rentables',
      insight: "Limiter les avances aux créateurs et basculer sur un modèle à la commission : les avances ne sont pas remboursées par les ventes.",
      evidence: `${fmtEur(paidUp)} avancés à ${plural(paid.length, 'créateur', 'créateurs')} pour ${fmtEur(paidRev)} de ventes générées.`,
      confidence: sampleConfidence(paid.length, 3),
      links: ["Canaux d'acquisition", 'Budget et garde-fous'],
      tags: ['createurs', 'avance'],
      extraDepts: ['finance'],
    }));
  }
  return out;
}

// ───────────────────────────── Niches & finance ─────────────────────────────

/** « Couper les pubs » stops a niche's paid ads (runtime/acquisition.ts): it takes a real sample, not one campaign's bad days. */
export const NICHE_CUT_MIN_SPEND = 100;
/** Days of ads behind the numbers of a niche lesson. */
export const NICHE_WINDOW_DAYS = 7;

function niches(inp: RetroInput): HeuristicDraft[] {
  const { world, day, ix } = inp;
  const from = Math.max(1, day - NICHE_WINDOW_DAYS + 1);
  const per = new Map<string, FunnelAgg>();
  for (const r of adRows(world, from, day)) {
    const p = productOfRow(ix, r);
    if (p?.nicheId) per.set(p.nicheId, addRow(per.get(p.nicheId) ?? emptyAgg(), r));
  }
  const out: HeuristicDraft[] = [];
  for (const [nicheId, a] of per) {
    const roas = roasOf(a);
    const name = nicheName(world, nicheId);
    const base = {
      key: LESSON_KEYS.niche(nicheId),
      topic: 'niche' as const,
      links: ['Règle du un', 'Objectifs', ...nicheLink(inp, nicheId)],
      tags: ['roas'],
      evidence: `${fmtEur(a.spend)} dépensés, ${fmtEur(a.revenue)} de CA publicitaire, ${plural(a.purchases, 'vente', 'ventes')} sur les ${windowLabel(world, from, day)}.`,
      confidence: sampleConfidence(a.spend, 150),
    };
    if (a.spend >= 30 && roas >= 1.5) {
      out.push(draft({ ...base, title: `Garder la niche ${name}`, insight: `Garder et intensifier la niche « ${name} » : ROAS de ${fmtRatio(roas)} sur ${plural(a.days.size, 'jour', 'jours')}.` }));
    } else if (a.spend >= NICHE_CUT_MIN_SPEND && roas < 0.8) {
      out.push(draft({ ...base, title: `Niche ${name} non rentable`, insight: `Couper les pubs de la niche « ${name} » ou retravailler l'offre : ROAS de ${fmtRatio(roas)} sur ${plural(a.days.size, 'jour', 'jours')}.` }));
    }
  }
  return out;
}

/**
 * One lesson for the cash situation (survival / short runway / profitable): a new state REVISES it, so the
 * playbooks never hold "scale up" and "survival mode" at the same time.
 */
export const FINANCE_KEY = 'finance-tresorerie';

function finance(inp: RetroInput): HeuristicDraft[] {
  const { world, day } = inp;
  if (day < 3) return [];
  const f = financeView(world, day);
  const start = Math.max(1, world.scenario?.startingCash ?? 500);
  const links = ['Budget et garde-fous', 'Objectifs'];
  const evidence = `Trésorerie ${fmtEur(f.cash)} au jour ${day}, profit sur 7 jours ${fmtEur(f.profit7d)}, dépense pub sur 7 jours ${fmtEur(f.adSpend7d)}${f.runwayDays !== null ? `, runway ${fmtNum(f.runwayDays)} jours` : ''}.`;
  if (f.cash <= 0.3 * start) {
    return [draft({
      key: FINANCE_KEY,
      topic: 'finance',
      title: 'Mode survie',
      insight: "Mode survie : trésorerie sous 30 % du budget de départ, couper les pubs non rentables et miser sur l'organique et les créateurs à la commission.",
      evidence,
      confidence: 0.9,
      links,
      tags: ['tresorerie', 'survie'],
      extraDepts: ['growth'],
      critical: true,
    })];
  }
  if (f.runwayDays !== null && f.runwayDays < 14) {
    return [draft({
      key: FINANCE_KEY,
      topic: 'finance',
      title: 'Runway court',
      insight: `Runway sous 14 jours : plafonner la pub à 8 % de la trésorerie et couper tout ce qui a un ROAS sous 0,8.`,
      evidence,
      confidence: 0.8,
      links,
      tags: ['tresorerie', 'runway'],
      extraDepts: ['growth'],
      critical: true,
    })];
  }
  if (f.profit7d > 0 && f.cumulativeProfit > 0) {
    return [draft({
      key: FINANCE_KEY,
      topic: 'finance',
      title: 'Rentable : scaler prudemment',
      insight: 'Rentable sur 7 jours : augmenter les budgets des campagnes gagnantes de 20 à 30 % par jour maximum, jamais plus.',
      evidence,
      confidence: 0.6,
      links,
      tags: ['croissance'],
      extraDepts: ['growth'],
    })];
  }
  return [];
}

// ───────────────────────────── Process ─────────────────────────────

function processIssues(inp: RetroInput): HeuristicDraft[] {
  const { world, day } = inp;
  const per = new Map<TaskKind, { n: number; dept: DeptId; notes: string[]; failed: number; rejected: number }>();
  for (const t of world.company.tasks ?? []) {
    const bad = (t.reviews ?? []).filter((r) => r.day === day && r.verdict !== 'approve');
    const failedToday = t.status === 'failed' && (t.dayDone === day || (t.dayDone == null && t.dayCreated >= day - 1));
    if (!bad.length && !failedToday) continue;
    const cur = per.get(t.kind) ?? { n: 0, dept: t.dept, notes: [], failed: 0, rejected: 0 };
    cur.n += bad.length + (failedToday ? 1 : 0);
    cur.failed += failedToday ? 1 : 0;
    cur.rejected += bad.length;
    cur.notes.push(...bad.flatMap((r) => (r.notes ?? []).map((n) => n.replace(/«\s*/g, '“').replace(/\s*»/g, '”'))));
    per.set(t.kind, cur);
  }
  const out: HeuristicDraft[] = [];
  for (const [kind, v] of [...per].sort((a, b) => b[1].n - a[1].n).slice(0, 3)) {
    if (v.n < 2) continue;
    const counts = new Map<string, number>();
    for (const n of v.notes) counts.set(n, (counts.get(n) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => `« ${shorten(n, 70)} »`);
    const label = TASK_LABELS[kind] ?? kind;
    out.push(draft({
      key: `process-${slugify(kind, 30)}`,
      topic: 'process',
      title: `Process : ${label}`,
      insight: `Pour la tâche « ${label} », relire les notes de revue précédentes et la checklist du cerveau avant de rendre : trop d'allers-retours.`,
      evidence: `${plural(v.rejected, 'revue négative', 'revues négatives')} et ${plural(v.failed, 'échec', 'échecs')} le jour ${day}${top.length ? ` — motifs fréquents : ${top.join(', ')}` : ''}.`,
      confidence: sampleConfidence(v.n, 4),
      links: ['Identité'],
      tags: ['process', kind],
      extraDepts: [v.dept],
      routeOnly: true, // the team doing this task + the CEO, not every chief
    }));
  }
  return out;
}

// ───────────────────────────── Experiments ─────────────────────────────

/** Stable keys of the lessons the company turns into work (runtime/strategy.ts, handlers/partners.ts). */
export const LESSON_KEYS = {
  page: (productId: string): string => `page-conversion-${slugify(productId, 30)}`,
  quality: (productId: string): string => `produit-qualite-${slugify(productId, 30)}`,
  niche: (nicheId: string): string => `niche-${slugify(nicheId, 40)}`,
  advance: 'partenariat-avance',
} as const;

/** Key prefix of the lessons concluded by an A/B experiment. */
export const EXPERIMENT_KEY_PREFIX = 'experience-';

const EXP_TOPIC: Record<Experiment['dimension'], Lesson['topic']> = {
  hook_style: 'ads', ad_format: 'ads', price: 'pricing', sales_hype: 'product', support_tone: 'support', niche: 'niche',
};

function fmtExpValue(e: Experiment, v: number): string {
  const kind = experimentValueKind(e);
  if (kind === 'eur') return `${fmtEur(v)}/visiteur`;
  if (kind === 'ratio') return `ROAS ${fmtRatio(v)}`;
  if (kind === 'score') return `${fmtNum(v)}/100`;
  return fmtPct(v, 2);
}

function experiments(inp: RetroInput): HeuristicDraft[] {
  const out: HeuristicDraft[] = [];
  for (const e of inp.concluded) {
    if (!e.winner) continue;
    const w = e.winner;
    const others = Object.entries(e.results).filter(([k, r]) => k !== w && r.n > 0);
    others.sort((a, b) => (lowerIsBetter(e) ? b[1].value - a[1].value : a[1].value - b[1].value));
    const loser = others[0];
    const wv = fmtExpValue(e, e.results[w]?.value ?? 0);
    const vs = loser ? ` contre ${fmtExpValue(e, loser[1].value)} pour « ${loser[0]} »` : '';
    // a niche-scoped experiment says so (and gets its own lesson per niche)
    const nicheId = experimentNiche(inp.world, e);
    const on = nicheId ? ` sur « ${nicheName(inp.world, nicheId)} »` : '';
    let insight: string;
    switch (e.dimension) {
      case 'hook_style': insight = `Privilégier le hook « ${w} » (${HOOK_LABELS[w as HookStyle] ?? w})${on} : il gagne l'expérience (${wv}${vs}).`; break;
      case 'ad_format': insight = `Privilégier le format « ${w} » (${FORMAT_LABELS[w as AdFormat] ?? w})${on} : il gagne l'expérience (${wv}${vs}).`; break;
      case 'price': insight = `Prix cible « ${Math.round(Number(w)) || w} »${on} : il gagne l'expérience de prix (${wv}${vs}).`; break;
      case 'sales_hype': insight = `Niveau de promesse max « ${w} »${on} : meilleur compromis conversion / remboursements (${wv}${vs}).`; break;
      case 'support_tone': insight = `Ton support « ${w} » : il gagne l'expérience (${wv}${vs}).`; break;
      default: insight = `Miser sur la niche « ${nicheName(inp.world, w)} » : elle gagne l'expérience (${wv}${vs}).`;
    }
    const minN = Math.min(...Object.values(e.results).map((r) => r.n));
    out.push(draft({
      key: `${EXPERIMENT_KEY_PREFIX}${slugify(e.dimension, 20)}${nicheId ? `-${slugify(nicheId, 28)}` : ''}`,
      topic: EXP_TOPIC[e.dimension] ?? 'process',
      title: `Expérience ${DIMENSION_LABELS[e.dimension] ?? e.dimension} : « ${w} »`,
      insight,
      evidence: `Expérience ${e.id} (« ${shorten(e.hypothesis, 90)} », jours ${e.day} à ${e.endDay ?? inp.day}) : ${Object.entries(e.results).map(([k, r]) => `« ${k} » ${fmtExpValue(e, r.value)} (n = ${fmtNum(r.n)})`).join(' · ')}.`,
      confidence: 0.4 + 0.5 * clamp(safeDiv(Number.isFinite(minN) ? minN : 0, experimentThreshold(e))),
      links: e.dimension === 'price' ? ['Prix'] : e.dimension === 'support_tone' ? ['Support client'] : e.dimension === 'sales_hype' ? ['Page de vente'] : e.dimension === 'niche' ? ['Règle du un'] : ["Canaux d'acquisition"],
      tags: ['experience', e.dimension],
      extraDepts: e.dimension === 'sales_hype' ? ['boutique', 'analyse'] : ['analyse'],
    }));
  }
  return out;
}

/** All heuristic detectors, most important first. Every draft carries numbers in its evidence. */
export function detectLessons(inp: RetroInput): HeuristicDraft[] {
  const detectors = [
    rejections, adAccount, finance, hypeAndQuality, support, creators, experiments,
    (i: RetroInput) => compareCreatives(i, 'hookStyle'), (i: RetroInput) => compareCreatives(i, 'format'),
    prices, niches, fatigue, lowCtr, salesPageConversion, organic, processIssues,
  ];
  const out: HeuristicDraft[] = [];
  const seen = new Set<string>();
  for (const d of detectors) {
    let drafts: HeuristicDraft[] = [];
    try {
      drafts = d(inp);
    } catch {
      drafts = []; // a malformed record must never break the evening retro
    }
    for (const x of drafts) {
      if (seen.has(x.key)) continue;
      seen.add(x.key);
      out.push(x);
    }
  }
  return out;
}
