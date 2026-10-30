/** Evening retro: KPI → bandit rewards → experiments → lessons (dedup) → playbooks → brain notes → activity feed. */
import type { BrainNote, BrainVault, ContentEngine, LessonDraft, MindContext } from '../contracts.js';
import type { AgentState, DailyKpi, Experiment, Lesson, WorldEvent, WorldState } from '../shared.js';
import { clamp, emit, nextId } from '../core/index.js';
import { isAnnouncedOutage } from '../sim/outage.js';
import { armStats, HYPE_ARMS, nearestArm, PRICE_ARMS, rewardArm } from './bandits.js';
import {
  addRow, adRows, ctrOf, cvrOf, emptyAgg, indexWorld, nicheName, priceOnDay, productOfRow, refundsOnDay, retroAgent, roasOf,
  type FunnelAgg,
} from './data.js';
import { updateExperiments, experimentValueKind } from './experiments.js';
import { detectLessons, EXPERIMENT_KEY_PREFIX, type HeuristicDraft } from './heuristics.js';
import { computeDailyKpi, upsertKpi } from './kpi.js';
import { basenameOf } from './markdown.js';
import {
  addRule, agentNoteName, agentNotePath, agentsForLesson, directiveSlot, hasMachineRule, lessonLink, lessonTitle, quotedTerms, replaceRuleEverywhere,
  syncDirective, TOPIC_DEPTS, writePlaybookNotes,
} from './playbooks.js';
import {
  DIMENSION_LABELS, fmtEur, fmtNum, fmtPct, fmtRatio, fold, jaccard, pad3, plural, round, safeDiv, shorten, slugify,
  tokenize, tokenSet, TOPIC_TAGS, unique,
} from './text.js';

/** New lessons per evening: a readable feed, not a firehose (one more slot for a critical lesson). */
export const MAX_NEW_LESSONS_PER_RETRO = 4;
export const JOURNAL_SECTION = '## Rétro du soir';
export const LESSON_HISTORY_SECTION = '## Historique';
/** Lines kept in a lesson note's history (oldest dropped first). */
export const LESSON_HISTORY_MAX = 8;

// ───────────────────────────── (b) bandit rewards ─────────────────────────────

/** CTR that earns a full reward (1) to the hook style and ad format of a creative. */
export const CTR_REWARD_SCALE = 0.05;
/** A creative is "fresh" until this many impressions; afterwards its daily CTR mostly measures fatigue… */
export const FRESH_CREATIVE_IMPRESSIONS = 30000;
/** …and its reward to the hook/format bandits only weighs this much. */
export const WORN_CREATIVE_WEIGHT = 0.25;

/**
 * Applies the shared-convention rewards for one day (hook_style, ad_format, price, hype, niche).
 * Idempotent per day through CompanyState.lastRetroDay (survives save/reload): a second retro the
 * same evening, or a retro replayed after loading a save, never double-counts the rewards.
 * An announced outage day rewards nothing: adRows leaves it out, it says nothing about a hook, a price or a niche.
 */
export function applyDailyRewards(world: WorldState, day: number): number {
  const last = Number(world.company.lastRetroDay);
  if (Number.isFinite(last) && last >= day) return 0;
  world.company.lastRetroDay = day;

  const ix = indexWorld(world);
  const perCreative = new Map<string, { agg: FunnelAgg; nicheId: string | null }>();
  const perProduct = new Map<string, FunnelAgg>();
  for (const r of adRows(world, day, day)) {
    const p = productOfRow(ix, r);
    const c = perCreative.get(r.creativeId) ?? { agg: emptyAgg(), nicheId: p?.nicheId ?? null };
    addRow(c.agg, r);
    perCreative.set(r.creativeId, c);
    if (p) perProduct.set(p.id, addRow(perProduct.get(p.id) ?? emptyAgg(), r));
  }
  // Impressions each creative had already received before today (its fatigue, visible in the ad stats).
  const seen = new Map<string, number>();
  for (const r of world.market?.adStats ?? []) if (r.day < day && perCreative.has(r.creativeId)) seen.set(r.creativeId, (seen.get(r.creativeId) ?? 0) + r.impressions);
  let rewards = 0;
  for (const [creativeId, { agg, nicheId }] of perCreative) {
    const creative = ix.creatives.get(creativeId);
    if (!creative || !nicheId || agg.impressions < 300) continue;
    // The hook and the format are judged on fresh audiences: a worn-out creative's CTR says "fatigue", not "bad
    // style" (before, the best style of a niche — the one run the longest — was punished for its own fatigue).
    // Scale 5 % instead of 3 %: good creatives run at 3-5 % CTR and used to all score 1, indistinguishable.
    const reward = clamp(ctrOf(agg) / CTR_REWARD_SCALE);
    const fresh = (seen.get(creativeId) ?? 0) < FRESH_CREATIVE_IMPRESSIONS ? 1 : WORN_CREATIVE_WEIGHT;
    const weight = clamp(agg.impressions / 1000, 0.5, 3) * fresh;
    rewardArm(world, `hook_style:${nicheId}`, creative.hookStyle, reward, weight);
    rewardArm(world, `ad_format:${nicheId}`, creative.format, reward, weight);
    rewards += 2;
  }
  const refunds = refundsOnDay(world, ix, day);
  const ordersToday = new Map<string, number>();
  for (const o of world.market?.orders ?? []) if (o.day === day) ordersToday.set(o.productId, (ordersToday.get(o.productId) ?? 0) + 1);
  for (const [productId, agg] of perProduct) {
    const p = ix.products.get(productId)!;
    const ref = refunds.get(productId) ?? { count: 0, amount: 0 };
    if (agg.landingViews >= 20) {
      const weight = clamp(agg.landingViews / 50, 0.5, 3);
      const priceArm = nearestArm(priceOnDay(p, day), PRICE_ARMS);
      if (priceArm) {
        rewardArm(world, `price:${p.nicheId}`, priceArm, clamp((agg.revenue - ref.amount) / agg.landingViews / 1.5), weight);
        rewards++;
      }
      const hypeArm = p.salesPage ? nearestArm(p.salesPage.hypeLevel, HYPE_ARMS) : null;
      if (hypeArm) {
        const sales = Math.max(agg.purchases, ordersToday.get(productId) ?? 0);
        const refundRate = safeDiv(ref.count, Math.max(1, sales));
        rewardArm(world, 'hype', hypeArm, clamp(cvrOf(agg) / 0.08) * (1 - Math.min(1, refundRate * 4)), weight);
        rewards++;
      }
    }
    if (agg.spend >= 3 && p.nicheId) {
      rewardArm(world, 'niche', p.nicheId, clamp(roasOf(agg) / 3), clamp(agg.spend / 20, 0.5, 3));
      rewards++;
    }
  }
  return rewards;
}

// ───────────────────────────── (e) engine reconciliation ─────────────────────────────

const TOPIC_LINKS: Record<Lesson['topic'], string[]> = {
  ads: ["Canaux d'acquisition"],
  pricing: ['Prix'],
  product: ["Structure d'un PDF qui vend"],
  support: ['Support client'],
  niche: ['Règle du un'],
  finance: ['Budget et garde-fous'],
  partnership: ["Canaux d'acquisition"],
  process: ['Identité'],
};

/** Seed notes a lesson should link to, from its topic and wording. */
function relevantLinks(topic: Lesson['topic'], insight: string, extra: readonly string[]): string[] {
  const f = fold(insight);
  const links = [...extra, ...(TOPIC_LINKS[topic] ?? [])];
  if (/\b(interdit|refus|conformite|ecrire)/.test(f) && /\b(pub|tiktok)/.test(f)) links.push('Conformité pub TikTok');
  if (/page de vente|promesse/.test(f)) links.push('Page de vente');
  if (/\bprix\b|par visiteur/.test(f)) links.push('Prix');
  if (/\bsupport\b|message client|chargeback|arnaque/.test(f)) links.push('Support client');
  if (/\bniche\b|regle du un/.test(f)) links.push('Règle du un');
  if (/\bpub|hook|createur|organique/.test(f)) links.push("Canaux d'acquisition");
  return unique(links).slice(0, 6);
}

function toLessonDraft(h: HeuristicDraft): LessonDraft {
  return { topic: h.topic, insight: h.insight, evidence: h.evidence, confidence: h.confidence, appliesToRoles: h.appliesToRoles };
}

function sanitizeDraft(d: unknown): LessonDraft | null {
  if (!d || typeof d !== 'object') return null;
  const x = d as Partial<LessonDraft>;
  const insight = String(x.insight ?? '').replace(/\s+/g, ' ').trim();
  if (insight.length < 8) return null;
  const topic = (x.topic && x.topic in TOPIC_DEPTS ? x.topic : 'process') as Lesson['topic'];
  return {
    topic,
    insight: shorten(insight, 280),
    evidence: shorten(String(x.evidence ?? '').replace(/\s+/g, ' ').trim(), 600),
    confidence: round(clamp(Number.isFinite(Number(x.confidence)) ? Number(x.confidence) : 0.5, 0.05, 0.98), 2),
    appliesToRoles: Array.isArray(x.appliesToRoles) ? x.appliesToRoles.map(String).filter(Boolean).slice(0, 8) : [],
  };
}

function sameQuoted(a: string, b: string): boolean {
  return quotedTerms(a).sort().join('|') === quotedTerms(b).sort().join('|');
}

function matchesHeuristic(h: HeuristicDraft, d: LessonDraft): boolean {
  if (h.insight === d.insight) return true;
  if (h.topic !== d.topic) return false;
  return sameQuoted(h.insight, d.insight) && jaccard(tokenSet(h.insight), tokenSet(d.insight)) >= 0.4;
}

function draftFromEngine(d: LessonDraft): HeuristicDraft {
  // numbers excluded: the same conclusion on fresher numbers keeps the same key (dedup, not a new lesson)
  const words = [...new Set(comparable(d.insight).split(' ').filter(Boolean))].slice(0, 6).join(' ');
  return {
    ...d,
    key: `${TOPIC_TAGS[d.topic]}-${slugify(words, 40)}`,
    title: lessonTitle(d),
    links: relevantLinks(d.topic, d.insight, []),
    tags: [],
    extraDepts: [],
    critical: false,
  };
}

/** Engine drafts are final; they inherit keys/links of the heuristic they rephrase; critical heuristics always survive. */
export function reconcileDrafts(heuristics: HeuristicDraft[], engineDrafts: unknown): HeuristicDraft[] {
  const drafts = Array.isArray(engineDrafts) ? engineDrafts.map(sanitizeDraft).filter((d): d is LessonDraft => d !== null) : [];
  if (drafts.length === 0) return heuristics;
  const used = new Set<HeuristicDraft>();
  const out: HeuristicDraft[] = [];
  for (const d of drafts) {
    const match = heuristics.find((h) => !used.has(h) && matchesHeuristic(h, d));
    if (match) {
      used.add(match);
      // never lose a machine-readable rule the heuristic engine relies on
      const insight = hasMachineRule(match.insight) && !hasMachineRule(d.insight) ? match.insight : d.insight;
      out.push({ ...match, insight, evidence: d.evidence || match.evidence, confidence: d.confidence, appliesToRoles: d.appliesToRoles });
    } else out.push(draftFromEngine(d));
  }
  for (const h of heuristics) if (h.critical && !used.has(h)) out.push(h);
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
}

// ───────────────────────────── (f) dedup ─────────────────────────────

/** Stable dedup key of a lesson: Lesson.key, or (older saves) the suffix of its note file name. */
export function lessonKeyOf(l: Pick<Lesson, 'notePath' | 'key'>): string {
  return l.key || basenameOf(l.notePath ?? '').replace(/^jour-\d+-/, '');
}

/** Insight without its numbers (stemmed, so "1 jour" = "2 jours"). */
function comparable(s: string): string {
  return tokenize(String(s ?? '').replace(/\d+(?:[.,]\d+)?/g, ' ')).join(' ');
}

/**
 * What a lesson concludes: its directive clause (before " : ", the numbers that follow are only the
 * justification) with the quoted terms kept verbatim — « 29 » → « 24 » or « story » → « pov » is a new
 * conclusion (revision), while fresher numbers or another runner-up are a confirmation.
 */
export function conclusionOf(insight: string): string {
  const head = String(insight ?? '').split(/\s:\s/)[0] ?? '';
  return `${comparable(head)}|${quotedTerms(head).join('|')}`;
}

function isExperimentKey(key: string): boolean {
  return key.startsWith(EXPERIMENT_KEY_PREFIX);
}

function isExperimentLesson(l: Lesson): boolean {
  return isExperimentKey(lessonKeyOf(l));
}

export function findDuplicateLesson(lessons: readonly Lesson[], d: Pick<HeuristicDraft, 'key' | 'topic' | 'insight'>): Lesson | undefined {
  const key = slugify(d.key, 50);
  return (
    lessons.find((l) => l.topic === d.topic && lessonKeyOf(l) === key) ??
    // an observation and an experiment stay two lessons, even in almost the same words: see settleDirectiveSlots
    lessons.find((l) => l.topic === d.topic && isExperimentLesson(l) === isExperimentKey(key) && sameQuoted(l.insight, d.insight) && jaccard(tokenSet(l.insight), tokenSet(d.insight)) >= 0.6)
  );
}

/**
 * One active lesson per directive slot (same directive, same niche), so contradictory rules never coexist: a concluded
 * experiment outranks an observation, then comes the lesson touched tonight, then the strongest. The others leave
 * world.company.lessons for retiredLessons, marked with what replaced them.
 */
function settleDirectiveSlots(world: WorldState, day: number, touched: ReadonlySet<Lesson>): { lesson: Lesson; by: Lesson }[] {
  const bySlot = new Map<string, Lesson[]>();
  for (const l of world.company.lessons) {
    const slot = directiveSlot(l.insight);
    if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), l]);
  }
  const retired: { lesson: Lesson; by: Lesson }[] = [];
  for (const group of bySlot.values()) {
    if (group.length < 2) continue;
    const [by, ...losers] = [...group].sort((a, b) =>
      Number(isExperimentLesson(b)) - Number(isExperimentLesson(a)) || Number(touched.has(b)) - Number(touched.has(a)) || b.confidence - a.confidence || b.day - a.day);
    for (const lesson of losers) {
      lesson.supersededBy = by!.id;
      lesson.retiredDay = day;
      retired.push({ lesson, by: by! });
    }
  }
  if (retired.length) {
    const out = new Set(retired.map((r) => r.lesson));
    world.company.lessons = world.company.lessons.filter((l) => !out.has(l));
    (world.company.retiredLessons ??= []).push(...out);
  }
  return retired;
}

// ───────────────────────────── helpers ─────────────────────────────

function placeholderAgent(): AgentState {
  return {
    id: 'nora', name: 'Nora', role: 'Responsable RH et apprentissage', dept: 'rh', isChief: true, tier: 'haiku',
    persona: "Anime la rétro du soir et tient la mémoire de l'agence.", skills: ['rétro', 'playbooks'],
    tools: ['brain.read', 'brain.write'], taskKinds: ['retro', 'performance_review'],
    avatar: { skin: '#f1c27d', hair: '#3b2a1a', shirt: '#7c5cbf', pants: '#2f2f3a', hairStyle: 1, accessory: 'glasses' },
    status: 'working', place: 'rh', currentTaskId: null, energy: 100, level: 1, xp: 0,
    perf: { done: 0, approved: 0, rejected: 0, failed: 0, score: 0 }, bubble: null,
  };
}

async function mindContext(world: WorldState, brain: BrainVault, agent: AgentState, query: string): Promise<MindContext> {
  let brainNotes: MindContext['brainNotes'] = [];
  try {
    brainNotes = (await brain.search(query, 4)).map((r) => ({ path: r.path, title: r.title, excerpt: r.excerpt }));
  } catch {
    brainNotes = [];
  }
  return { agent, playbook: [...(world.company.playbooks?.[agent.id] ?? [])], brainNotes, lessons: (world.company.lessons ?? []).slice(-10), day: world.day };
}

function dimensionLabel(world: WorldState, dim: string): string {
  const [base, nicheId] = dim.split(':');
  const label = DIMENSION_LABELS[base!] ?? base!;
  return nicheId ? `${label} · ${nicheName(world, nicheId)}` : label;
}

function armLabel(world: WorldState, dim: string, key: string): string {
  if (dim === 'niche') return nicheName(world, key);
  if (dim.startsWith('price')) return `${key} €`;
  return key;
}

function kpiTable(k: DailyKpi): string {
  const rows: [string, string][] = [
    ['Trésorerie', fmtEur(k.cash)],
    ["Chiffre d'affaires", fmtEur(k.revenue)],
    ['Dépense pub', fmtEur(k.adSpend)],
    ['Profit du jour', fmtEur(k.profit)],
    ['Profit cumulé', fmtEur(k.cumulativeProfit)],
    ['Ventes', fmtNum(k.sales)],
    ['Remboursements', fmtNum(k.refunds)],
    ['Impressions', fmtNum(k.impressions)],
    ['Clics', fmtNum(k.clicks)],
    ['CTR', fmtPct(k.ctr, 2)],
    ['Conversion page', fmtPct(k.cvr, 2)],
    ['ROAS', fmtRatio(k.roas)],
    ['Coût par achat (CAC)', fmtEur(k.cac)],
    ['Tickets ouverts', fmtNum(k.openTickets)],
    ['Score support moyen', k.avgReplyScore > 0 ? `${fmtNum(k.avgReplyScore)}/100` : '—'],
    ['Produits en ligne', fmtNum(k.liveProducts)],
    ['Tâches terminées', fmtNum(k.tasksDone)],
    ['Leçons apprises', fmtNum(k.lessonsLearned)],
  ];
  return ['| Indicateur | Valeur |', '|---|---|', ...rows.map(([a, b]) => `| ${a} | ${b} |`)].join('\n');
}

function fmtExp(e: Experiment, v: number): string {
  const kind = experimentValueKind(e);
  if (kind === 'eur') return `${fmtEur(v)}/visiteur`;
  if (kind === 'ratio') return fmtRatio(v);
  if (kind === 'score') return `${fmtNum(v)}/100`;
  return fmtPct(v, 2);
}

function fallbackMemo(k: DailyKpi, lessons: Lesson[], incidents: string[]): string {
  const parts = [
    `Jour ${k.day} : ${fmtEur(k.revenue)} de chiffre d'affaires pour ${fmtEur(k.adSpend)} de pub, profit du jour ${fmtEur(k.profit)} (cumul ${fmtEur(k.cumulativeProfit)}, trésorerie ${fmtEur(k.cash)}).`,
    `${plural(k.sales, 'vente', 'ventes')}, ${plural(k.refunds, 'remboursement', 'remboursements')}, CTR ${fmtPct(k.ctr, 2)}, ROAS ${fmtRatio(k.roas)}.`,
  ];
  if (incidents.length) parts.push(`À retenir : ${shorten(incidents[0]!, 140)}`);
  parts.push(lessons.length ? `${plural(lessons.length, 'leçon retenue', 'leçons retenues')}, la plus forte : ${shorten(lessons[0]!.insight, 140)}` : 'Pas de nouvelle leçon : on continue de tester et de mesurer.');
  return parts.join(' ');
}

function lessonNoteBody(world: WorldState, l: Lesson, links: string[], history: readonly string[] = []): string {
  const agents = (world.company.agents ?? []).filter((a) => l.appliesTo.includes(a.id));
  const source = (world.company.agents ?? []).find((a) => a.id === l.source)?.name ?? l.source;
  const hist = history.length ? ['', LESSON_HISTORY_SECTION, ...history.slice(-LESSON_HISTORY_MAX)] : [];
  const by = l.supersededBy ? (world.company.lessons ?? []).find((x) => x.id === l.supersededBy) : undefined;
  const retired = l.supersededBy ? [`**Leçon retirée le jour ${l.retiredDay ?? '?'}**${by ? ` : remplacée par ${lessonLink(by)}` : ''}. Elle ne s'applique plus.`, ''] : [];
  return [
    `> ${l.insight}`,
    '',
    ...retired,
    '## Preuves',
    l.evidence || '_Pas de chiffre associé._',
    '',
    `**Confiance** : ${fmtPct(l.confidence, 0)} · **Thème** : ${TOPIC_TAGS[l.topic] ?? l.topic} · **Source** : ${source} · **Jour** : ${l.day}`,
    '',
    '## Appliquée dans les playbooks',
    agents.length ? agents.map((a) => `[[${agentNoteName(world, a)}]]`).join(' · ') : '_Aucun agent ciblé._',
    '',
    '## Liens',
    [`Rétro du [[jour-${pad3(l.day)}]]`, ...links.map((x) => `[[${x}]]`)].join(' · '),
    ...hist,
  ].join('\n');
}

/** History lines of an existing lesson note ("- **Confirmation — jour 4** …"), older "### …" blocks included. */
export function lessonHistory(body: string | null | undefined): string[] {
  const text = String(body ?? '');
  const out: string[] = [];
  const i = text.indexOf(`\n${LESSON_HISTORY_SECTION}\n`);
  if (i >= 0) {
    for (const line of text.slice(i + LESSON_HISTORY_SECTION.length + 2).split('\n')) {
      if (/^##\s/.test(line)) break;
      if (line.startsWith('- ')) out.push(line);
    }
  }
  // notes written by an earlier version appended "### Confirmation — jour N" blocks
  for (const m of text.matchAll(/^### (Révision|Confirmation) — jour (\d+)/gm)) out.push(`- **${m[1]} — jour ${m[2]}**`);
  return out;
}

function historyLine(world: WorldState, l: Lesson, day: number, revised: boolean, reached: readonly string[]): string {
  const agents = (world.company.agents ?? []).filter((a) => reached.includes(a.id));
  const who = agents.length ? ` · nouveaux playbooks : ${agents.map((a) => `[[${agentNoteName(world, a)}]]`).join(' · ')}` : '';
  return `- **${revised ? 'Révision' : 'Confirmation'} — jour ${day}** ([[jour-${pad3(day)}]]) : ${shorten(l.evidence || 'sans chiffre', 220)} · confiance ${fmtPct(l.confidence, 0)}${who}`;
}

// ───────────────────────────── external incidents ─────────────────────────────

const incidentNoteName = (day: number): string => `incident-externe-jour-${pad3(day)}`;

function outageEvent(world: WorldState, day: number): WorldEvent | undefined {
  return (world.market?.events ?? []).find((e) => e.kind === 'platform_outage' && (e.refs?.day ?? e.day + 1) === day);
}

function outageLine(world: WorldState, day: number): string {
  const ev = outageEvent(world, day);
  return `Incident externe : panne de paiement du jour ${day}${ev ? `, annoncée le jour ${ev.day}` : ''}. Aucune vente n'était possible, ce jour ne dit rien de nos pubs, de nos prix ni de nos guides.`;
}

/** Memo of an outage day: what happened, never a reading of the day's numbers as a performance. */
function outageMemo(world: WorldState, k: DailyKpi): string {
  return `${outageLine(world, k.day)} ${k.adSpend > 0 ? `${fmtEur(k.adSpend)} de pub dépensés sans vente possible` : 'Pubs en pause, aucune dépense pub'}, trésorerie ${fmtEur(k.cash)}.`;
}

/** An announced outage leaves an « incident externe » note instead of a performance lesson. */
async function writeOutageNote(world: WorldState, brain: BrainVault, day: number): Promise<void> {
  const rows = (world.market?.adStats ?? []).filter((r) => r.day === day);
  const agg = rows.reduce((a, r) => addRow(a, r), emptyAgg());
  const ev = outageEvent(world, day);
  await brain.write({
    path: `journal/${incidentNoteName(day)}.md`,
    title: `Incident externe — panne de paiement du jour ${day}`,
    tags: ['incident', 'incident-externe'],
    day,
    body: [
      `> ${outageLine(world, day)}`,
      '',
      "## Ce qui s'est passé",
      ev?.description ?? 'Le prestataire de la boutique a annoncé une panne du paiement.',
      '',
      '## Impact mesuré',
      `- Pub dépensée pendant la panne : ${fmtEur(agg.spend)}`,
      `- Visiteurs arrivés sur une boutique sans paiement : ${fmtNum(agg.landingViews)}`,
      '- Ventes possibles : aucune',
      '',
      "## Ce qu'on en fait",
      '- Ce jour est exclu des fenêtres de conversion, de ROAS et de niche, des expériences et des bandits.',
      "- Aucune leçon de performance n'en est tirée : une panne ne juge ni nos pubs, ni nos prix, ni nos guides.",
      ...(agg.spend > 0 ? [`- Les ${fmtEur(agg.spend)} de pub étaient évitables : la panne était annoncée, les campagnes devaient être en pause ce jour-là.`] : []),
      '',
      `Liens : [[jour-${pad3(day)}]] · [[Budget et garde-fous]]`,
    ].join('\n'),
  });
}

// ───────────────────────────── runRetro ─────────────────────────────

export async function runRetro(world: WorldState, engine: ContentEngine, brain: BrainVault, incidents: string[]): Promise<Lesson[]> {
  const day = world.day;
  const incidentLines = (Array.isArray(incidents) ? incidents : []).map((s) => String(s ?? '').trim()).filter(Boolean);
  const outage = isAnnouncedOutage(world, day);
  if (outage) incidentLines.unshift(outageLine(world, day));
  world.company.lessons ??= [];
  world.company.playbooks ??= {};

  // (a) KPI of the day
  const kpi = computeDailyKpi(world, day);
  upsertKpi(world, kpi);

  // (b) bandit rewards from today's market data
  applyDailyRewards(world, day);

  // (c) experiments
  const concluded = updateExperiments(world);

  // (d) heuristic lessons
  let notes: BrainNote[] = [];
  try {
    notes = await brain.list();
  } catch {
    notes = [];
  }
  const ix = indexWorld(world);
  const heuristics = detectLessons({ world, day, kpi, ix, notes, concluded });

  // (e) the engine (heuristic or Claude) turns them into the final drafts
  const nora = retroAgent(world) ?? placeholderAgent();
  const ctx = await mindContext(world, brain, nora, `leçons rétro ${unique(heuristics.map((h) => TOPIC_TAGS[h.topic])).join(' ')}`);
  let engineDrafts: unknown = null;
  try {
    engineDrafts = await engine.extractLessons(
      {
        kpis: (world.company.kpis ?? []).slice(-14).filter((k) => !isAnnouncedOutage(world, k.day)),
        experiments: [...concluded, ...(world.company.experiments ?? []).filter((e) => e.status === 'running')],
        incidents: incidentLines,
        heuristicLessons: heuristics.map(toLessonDraft),
      },
      ctx,
    );
  } catch {
    engineDrafts = null; // engine failure → heuristic lessons only
  }
  // a concluded experiment only speaks once: it comes right after the critical lessons, before the evening's cap
  const finalDrafts = reconcileDrafts(heuristics, engineDrafts).sort(
    (a, b) => Number(b.critical) - Number(a.critical) || Number(isExperimentKey(b.key)) - Number(isExperimentKey(a.key)) || b.confidence - a.confidence,
  );

  // (f) persist lessons (dedup: same key → confidence update) + (g) playbooks
  const created: { lesson: Lesson; draft: HeuristicDraft }[] = [];
  const updated: { lesson: Lesson; draft: HeuristicDraft; revised: boolean; reached: string[] }[] = [];
  const changedAgents = new Set<string>();
  const touched = new Set<Lesson>();
  /** `onlyNewAgents`: a confirmed lesson only reaches agents it never reached (no ping-pong between singleton rules). */
  const applyToPlaybooks = (lesson: Lesson, d: HeuristicDraft, onlyNewAgents = false): void => {
    const targets = agentsForLesson(world, lesson.topic, d.extraDepts, d.appliesToRoles, d.routeOnly);
    for (const a of targets) {
      if (onlyNewAgents && lesson.appliesTo.includes(a.id)) continue;
      const r = addRule(world, a.id, lesson.insight);
      if (r === 'added' || r === 'replaced') changedAgents.add(a.id);
      if ((world.company.playbooks[a.id] ?? []).includes(lesson.insight)) lesson.appliesTo = unique([...lesson.appliesTo, a.id]);
    }
  };

  for (const d of finalDrafts) {
    // what an experiment concluded on a directive and a niche stays concluded: an observation does not reopen it
    const slot = directiveSlot(d.insight);
    if (slot && !isExperimentKey(slugify(d.key, 50)) && world.company.lessons.some((l) => isExperimentLesson(l) && directiveSlot(l.insight) === slot)) continue;
    const dup = findDuplicateLesson(world.company.lessons, d);
    if (dup) {
      const revised = conclusionOf(dup.insight) !== conclusionOf(d.insight);
      touched.add(dup);
      if (!revised && dup.evidence === d.evidence && dup.insight === d.insight) continue; // nothing new since last time
      dup.key ??= slugify(d.key, 50);
      dup.changedDay = day;
      if (revised) {
        // the data now says something different: new wording everywhere, confidence restarts from the new sample
        dup.confidence = d.confidence;
      } else {
        // same conclusion on fresher data: confidence rises with every confirmation
        dup.confidence = round(Math.min(0.97, Math.max(dup.confidence, d.confidence) + 0.05 * d.confidence), 2);
      }
      if (dup.insight !== d.insight) {
        // the insight's numbers are refreshed too (not only the evidence), in every playbook that holds the rule
        const old = dup.insight;
        dup.insight = d.insight;
        for (const id of replaceRuleEverywhere(world, old, d.insight)) changedAgents.add(id);
      }
      dup.evidence = d.evidence;
      const before = new Set(dup.appliesTo);
      applyToPlaybooks(dup, d, !revised);
      updated.push({ lesson: dup, draft: d, revised, reached: dup.appliesTo.filter((id) => !before.has(id)) });
      continue;
    }
    if (created.length >= MAX_NEW_LESSONS_PER_RETRO + (d.critical ? 1 : 0)) continue; // the rest waits for a later evening
    const lesson: Lesson = {
      key: slugify(d.key, 50),
      id: nextId(world, 'les'),
      day,
      topic: d.topic,
      insight: d.insight,
      evidence: d.evidence,
      confidence: round(clamp(d.confidence, 0.05, 0.99), 2),
      source: nora.id,
      appliesTo: [],
      notePath: `lecons/jour-${pad3(day)}-${slugify(d.key, 50)}.md`,
    };
    world.company.lessons.push(lesson);
    touched.add(lesson);
    applyToPlaybooks(lesson, d);
    created.push({ lesson, draft: d });
  }

  // directives: one lesson per slot, and its rule is the only value left in any playbook
  const retired = settleDirectiveSlots(world, day, touched);
  for (const { lesson, by } of retired) {
    for (const id of replaceRuleEverywhere(world, lesson.insight, by.insight)) {
      changedAgents.add(id);
      by.appliesTo = unique([...by.appliesTo, id]);
    }
    touched.add(by);
  }
  for (const l of touched) {
    if (!world.company.lessons.includes(l)) continue; // retired just above: its value must not come back
    for (const id of syncDirective(world, l.insight)) {
      changedAgents.add(id);
      l.appliesTo = unique([...l.appliesTo, id]);
    }
  }

  // brain notes — a failing disk write is reported in the feed but never aborts the retro
  const failures: string[] = [];
  const safely = async (what: string, op: () => Promise<unknown>): Promise<void> => {
    try {
      await op();
    } catch (err) {
      failures.push(`${what} (${err instanceof Error ? err.message : String(err)})`);
    }
  };
  const writeLessonNote = (lesson: Lesson, draft: Pick<HeuristicDraft, 'tags' | 'links'>, history: readonly string[] = [], tags: readonly string[] = []) =>
    brain.write({
      path: lesson.notePath,
      title: lessonTitle(lesson),
      tags: unique(['lecon', TOPIC_TAGS[lesson.topic], ...draft.tags, ...tags]),
      body: lessonNoteBody(world, lesson, relevantLinks(lesson.topic, lesson.insight, draft.links), history),
      day,
    });

  const stillActive = (x: { lesson: Lesson }): boolean => world.company.lessons.includes(x.lesson);
  for (const { lesson, draft } of created.filter(stillActive)) await safely(lesson.notePath, () => writeLessonNote(lesson, draft));
  // a confirmed / revised lesson note is rewritten with the current insight and numbers on top and a short,
  // capped history below (instead of an endless stack of appended blocks)
  for (const { lesson, draft, revised, reached } of updated.filter(stillActive)) {
    await safely(lesson.notePath, async () => {
      const existing = await brain.read(lesson.notePath);
      const own = existing && existing.path === lesson.notePath ? existing : null;
      const history = [...lessonHistory(own?.body), historyLine(world, lesson, day, revised, reached)];
      return writeLessonNote(lesson, draft, history, own?.tags ?? []);
    });
  }
  for (const { lesson, by } of retired) {
    await safely(lesson.notePath, async () => {
      const existing = await brain.read(lesson.notePath);
      const own = existing && existing.path === lesson.notePath ? existing : null;
      const line = `- **Retirée — jour ${day}** ([[jour-${pad3(day)}]]) : remplacée par ${lessonLink(by)}`;
      return writeLessonNote(lesson, { tags: ['retiree'], links: [] }, [...lessonHistory(own?.body), line], own?.tags ?? []);
    });
  }
  if (outage) await safely(`journal/${incidentNoteName(day)}.md`, () => writeOutageNote(world, brain, day));
  if (created.length) {
    await safely('lecons/_index.md', () =>
      brain.append('lecons/_index.md', created.map(({ lesson }) => `- ${lessonLink(lesson)} — jour ${day}, confiance ${fmtPct(lesson.confidence, 0)}`).join('\n'), day),
    );
  }

  // brain notes: playbooks of the agents whose rules changed, plus every agent who has no note yet (so each
  // [[Prénom]] link resolves) — the seed vault only ships the department notes ("Playbook Growth"…)
  const existingPaths = new Set(notes.map((n) => fold(n.path)));
  const missing = (world.company.agents ?? []).filter((a) => !existingPaths.has(fold(agentNotePath(world, a)))).map((a) => a.id);
  const toRefresh = unique([...changedAgents, ...missing]);
  if (toRefresh.length) await safely('playbooks/', () => writePlaybookNotes(world, brain, toRefresh, day));

  // KPI refreshed with today's lessons
  kpi.lessonsLearned = (world.company.lessons ?? []).filter((l) => l.day === day).length;
  upsertKpi(world, kpi);

  // (h) journal of the day
  const newLessons = created.filter(stillActive).map((c) => c.lesson);
  let memo = outage ? outageMemo(world, kpi) : '';
  try {
    if (!outage) {
      memo = String(
        (await engine.dailyMemo({ day, kpi, notes: [...incidentLines, ...newLessons.map((l) => `Leçon : ${l.insight}`), ...concluded.map((e) => `Expérience conclue : ${e.hypothesis} → ${e.winner ?? 'sans gagnant'}`)] }, ctx)) ?? '',
      ).trim();
    }
  } catch {
    memo = '';
  }
  if (!memo) memo = fallbackMemo(kpi, newLessons, incidentLines);
  const journalPath = `journal/jour-${pad3(day)}.md`;
  const section: string[] = [JOURNAL_SECTION, '', ...memo.split('\n').map((l) => `> ${l}`), '', '### Chiffres du jour', '', kpiTable(kpi), '', '### Incidents'];
  section.push(...(incidentLines.length ? incidentLines.map((i) => `- ${i}`) : ['- Aucun incident notable.']));
  if (outage) section.push(`- Note d'incident : [[${incidentNoteName(day)}]]`);
  section.push('', '### Leçons du jour');
  section.push(...(newLessons.length ? newLessons.map((l) => `- ${lessonLink(l)} — ${l.evidence ? shorten(l.evidence, 160) : 'sans chiffre'} _(confiance ${fmtPct(l.confidence, 0)})_`) : ['- Pas de nouvelle leçon aujourd’hui.']));
  if (updated.length) {
    section.push('', '### Leçons confirmées ou révisées');
    section.push(...updated.map(({ lesson, revised }) => `- ${lessonLink(lesson)} — ${revised ? 'révisée' : 'confirmée'}, confiance ${fmtPct(lesson.confidence, 0)}`));
  }
  if (retired.length) {
    section.push('', '### Leçons retirées');
    section.push(...retired.map(({ lesson, by }) => `- ${lessonLink(lesson)} — remplacée par ${lessonLink(by)}`));
  }
  const running = (world.company.experiments ?? []).filter((e) => e.status === 'running');
  if (concluded.length || running.length) {
    section.push('', '### Expériences');
    for (const e of concluded) {
      section.push(`- Conclue : « ${e.hypothesis} » → ${e.winner ? `gagnant « ${armLabel(world, e.dimension, e.winner)} »` : 'pas de gagnant net'} (${Object.entries(e.results).map(([k, r]) => `${k} ${fmtExp(e, r.value)}, n = ${fmtNum(r.n)}`).join(' · ')})`);
    }
    for (const e of running) section.push(`- En cours depuis le jour ${e.day} : « ${e.hypothesis} » (${Object.entries(e.results).map(([k, r]) => `${k} n = ${fmtNum(r.n)}`).join(' · ') || 'pas encore de données'})`);
  }
  const banditRows: string[] = [];
  for (const dim of Object.keys(world.company.bandits ?? {}).sort()) {
    const stats = armStats(world, dim);
    const pulls = stats.reduce((s, a) => s + a.pulls, 0);
    if (!stats.length || pulls === 0) continue;
    banditRows.push(`| ${dimensionLabel(world, dim)} | ${armLabel(world, dim, stats[0]!.key)} | ${fmtPct(stats[0]!.mean, 0)} | ${fmtNum(pulls)} |`);
  }
  if (banditRows.length) section.push('', '### Ce que pensent les bandits', '', '| Décision | En tête | Score estimé | Essais |', '|---|---|---|---|', ...banditRows.slice(0, 16));
  if (changedAgents.size) {
    const names = (world.company.agents ?? []).filter((a) => changedAgents.has(a.id)).map((a) => `[[${agentNoteName(world, a)}]]`);
    section.push('', '### Playbooks mis à jour', names.join(' · '));
  }
  section.push('', `Jour précédent : ${day > 1 ? `[[jour-${pad3(day - 1)}]]` : '—'} · [[Objectifs]] · [[00 - Accueil]]`);

  // the journal may already hold sections written during the day (daily report…): keep them, replace only the retro
  const existingJournal = await brain.read(journalPath).catch(() => null);
  const own = existingJournal?.path === journalPath ? existingJournal : null;
  const kept = own ? own.body.split(JOURNAL_SECTION)[0]!.trimEnd() : '';
  await safely(journalPath, () =>
    brain.write({
      path: journalPath,
      title: own ? own.title : `Journal — jour ${day}`,
      tags: unique(['journal', 'retro', ...(own ? own.tags : [])]),
      body: `${kept ? `${kept}\n\n` : ''}${section.join('\n')}`,
      day,
    }),
  );
  const journalIndex = notes.find((n) => n.path === 'journal/_index.md');
  if (!journalIndex || !journalIndex.body.includes(`[[jour-${pad3(day)}]]`)) {
    await safely('journal/_index.md', () =>
      brain.append('journal/_index.md', `- [[jour-${pad3(day)}]] — profit du jour ${fmtEur(kpi.profit)}, ${plural(newLessons.length, 'leçon', 'leçons')}`, day),
    );
  }

  // (i) activity feed
  if (failures.length) {
    emit(world, { agentId: nora.id, kind: 'thought', text: shorten(`${nora.name} n'arrive pas à écrire dans le cerveau : ${failures.join(' ; ')}`, 160) });
  }
  if (outage) emit(world, { agentId: nora.id, kind: 'brain_write', text: `${nora.name} classe le jour ${day} en incident externe : la panne ne compte pas dans les chiffres de performance.` });
  for (const l of newLessons) emit(world, { agentId: nora.id, kind: 'lesson', text: `Nouvelle leçon : ${shorten(l.insight, 110)}` });
  for (const { lesson } of retired) emit(world, { agentId: nora.id, kind: 'lesson', text: `Leçon retirée, une expérience ou un chiffre plus récent la remplace : ${shorten(lesson.insight, 90)}` });
  for (const e of concluded) {
    emit(world, {
      agentId: nora.id,
      kind: 'lesson',
      text: e.winner
        ? `Expérience conclue (${dimensionLabel(world, e.dimension)}) : « ${armLabel(world, e.dimension, e.winner)} » gagne.`
        : `Expérience conclue (${dimensionLabel(world, e.dimension)}) sans gagnant net.`,
    });
  }
  if (updated.length) emit(world, { agentId: nora.id, kind: 'lesson', text: `${plural(updated.length, 'leçon confirmée', 'leçons confirmées')} par les chiffres du jour.` });
  emit(world, {
    agentId: nora.id,
    kind: 'brain_write',
    text: `${nora.name} écrit le journal du jour ${day}${created.length ? ` et ${plural(created.length, 'leçon', 'leçons')}` : ''} dans le cerveau.`,
  });
  if (changedAgents.size) {
    const names = (world.company.agents ?? []).filter((a) => changedAgents.has(a.id)).map((a) => a.name);
    emit(world, {
      agentId: nora.id,
      kind: 'brain_write',
      text: `Playbooks mis à jour : ${names.length > 4 ? `${names.slice(0, 4).join(', ')} et ${plural(names.length - 4, 'autre', 'autres')}` : names.join(', ')}.`,
    });
  }

  return newLessons;
}
