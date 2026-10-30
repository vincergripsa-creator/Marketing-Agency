/**
 * Founder missions: what the founder really asked for (which niche, which product), the tasks that follow, the
 * honest answer when the company cannot do it, and the chief of staff's daily follow-up. The niches are only read
 * through the research tools, as any employee would: names, audiences, problems and keywords, never the market truth.
 */
import type { DayPlanItem } from '../contracts.js';
import type { AgentState, Mission, Product, Task, TaskKind, TrendSignal } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { nameOf, nicheBriefOf, nicheName, productOf, say } from './ctx.js';
import { nextId } from '../core/index.js';
import { excludedNiches, openTasksForProduct } from './pipeline.js';
import { agentById, agentLoad, capableAgents, chiefOf, createTask, depState, fixSelfReview, isOpen, KIND_META, logTask, openTasks, PRODUCT_KINDS, taskById } from './tasks.js';
import { short, uniq } from './util.js';

// ───────────────────────────── reading the request ─────────────────────────────

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`´]/g, "'");
}

function words(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/\d/.test(w));
}

/** Plural out, first 6 letters: enough for guide/guides or soignant/soignante, not for japon/japonais. */
function stemOf(word: string): string {
  return (word.length > 3 ? word.replace(/[sx]$/, '') : word).slice(0, 6);
}

const stems = (list: string): Set<string> => new Set(list.split(/\s+/).map(stemOf));

/** Words that never name a subject: grammar, the request itself, wishes about the outcome. */
const NOT_A_TOPIC = stems(`
  les des une dans sur sous pour par avec sans chez vers entre contre depuis pendant cet cette ces mon mes ton tes son ses
  notre nos votre vos leur leurs nous vous moi toi elle ils elles qui que quoi dont plus moins tres bien etre comment pourquoi quand
  quel quelle quels quelles tout tous toute toutes aux
  lance lancer lancez lancons lancement cree creer creez creons creation ecris ecrire ecrivez ecrit redige rediger redigez redaction
  sors sortir sortez sortons produis produire produisez fais faire faites faisons fait prepare preparer preparez publie publier publiez
  propose proposer proposez veux voudrais voudrait faut faudrait aimerais besoin peux peut pouvez trouve trouver trouvez choisis choisir
  choisissez cherche chercher aide aider explique expliquer apprendre enseigner montre montrer parle parler traite traiter couvre couvrir
  gerer reussir ameliorer
  guide pdf produit ebook livre manuel nouveau nouvelle nouveaux nouvelles autre deuxieme second seconde troisieme premier premiere
  prochain prochaine mission niche sujet theme idee marche opportunite complet complete rapide petit gros grand grande vrai bon bonne
  beau belle super top meilleur meilleure urgent vite maintenant aujourd hui demain stp svp merci bonjour salut rentable profitable
  vendeur qualite revenu argent gagner rapporter augmenter succes populaire tendance demande public lecteur acheteur
  jour semaine mois annee
`);

/** Words of the trade: they say what to do, not which niche it is about (only ignored outside a product request). */
const OPERATIONS = stems(`
  hook accroche tiktok pub publicite campagne creative crea video organique post poster prix tarif euro page vente client message mail
  email support inbox rapport chiffre kpi bilan stat test experience budget roas ctr cpm concurrent concurrence createur influenceur
  partenaire partenariat affiliation commission upsell suite couverture titre plan rembourse remboursement baisse baisser monte monter
  coupe couper scale optimise optimiser analyse analyser recherche rechercher ecoute voix commentaire forum ameliore corrige reecris
  verifie humanise hausse relance suivi bloque retard tresorerie compta marge
`);

function topicOf(text: string): string[] {
  return uniq(words(text).map(stemOf).filter((w) => !NOT_A_TOPIC.has(w)));
}

const PRODUCT_WORD = '(?:guide|pdf|produit|ebook|e-book|livre|manuel)';
const FILLER = '(?:\\s+(?:nous|moi|un|une|le|la|les|notre|mon|ma|des|du|de|d|petit|mini|nouveau|nouvelle|autre|second|seconde|deuxieme|2e|vrai|bon|beau))*';
const PRODUCT_ASK = new RegExp(`\\b(?:lance[rz]?|lancons|cree[rz]?|creons|ecris|ecrire|ecrivez|ecrivons|redige[rz]?|redigeons|sors|sortir|sortez|sortons|produis|produire|produisez|fais|faire|faites|faisons|prepare[rz]?|preparons|publie[rz]?|publions|veux|voudrais|faut)\\b${FILLER}\\s+${PRODUCT_WORD}\\b`);
const NEW_PRODUCT = new RegExp(`\\b(?:nouveau|nouvelle|deuxieme|second|seconde|2e|autre)\\s+(?:${PRODUCT_WORD}|niche)\\b`);

/** Does the founder ask for a product to exist (rather than for work on what exists)? */
export function asksForProduct(text: string): boolean {
  const t = fold(text);
  return PRODUCT_ASK.test(t) || NEW_PRODUCT.test(t);
}

// ───────────────────────────── matching a niche ─────────────────────────────

interface NicheWords { nicheId: string; name: string; strong: Set<string>; weak: Set<string>; signal: number; found?: TrendSignal }
interface Scored extends NicheWords { hits: number; strongHits: number; score: number; coverage: number }

/** A topic counts as covered from this share of its words: « le sommeil du chien » is neither the sleep guide nor the puppy one. */
const MIN_COVERAGE = 0.6;

/** The niches the company can see: its research so far, its own products, and the trend tool asked about this subject. */
function visibleNiches(ctx: RuntimeCtx, query: string): NicheWords[] {
  const { research, products } = ctx.world.company;
  let found: TrendSignal[] = [];
  try { found = ctx.tools.searchTrends(query); } catch { found = []; }
  const ids = uniq([...research.trends.map((t) => t.nicheId), ...found.map((t) => t.nicheId), ...products.map((p) => p.nicheId)]);
  return ids.map((nicheId) => {
    const brief = nicheBriefOf(ctx, nicheId);
    const signal = found.find((t) => t.nicheId === nicheId) ?? research.trends.find((t) => t.nicheId === nicheId);
    return {
      nicheId, name: brief.name,
      strong: new Set(words([brief.name, ...brief.keywords].join(' ')).map(stemOf)),
      weak: new Set(words([brief.audience, brief.problem, brief.category].join(' ')).map(stemOf)),
      signal: signal ? signal.searchInterest + signal.tiktokBuzz : 0,
      found: found.find((t) => t.nicheId === nicheId),
    };
  });
}

function scored(niches: NicheWords[], topic: string[]): Scored[] {
  return niches.map((n) => {
    const strong = topic.filter((w) => n.strong.has(w)).length;
    const weak = topic.filter((w) => !n.strong.has(w) && n.weak.has(w)).length;
    return { ...n, hits: strong + weak, strongHits: strong, score: 2 * strong + weak, coverage: topic.length ? (strong + weak) / topic.length : 0 };
  }).filter((s) => s.hits > 0)
    .sort((a, b) => b.score - a.score || b.signal - a.signal || a.nicheId.localeCompare(b.nicheId));
}

/** The research team now knows this niche: pick_opportunity can rank it. */
function learnSignal(ctx: RuntimeCtx, n: NicheWords): void {
  const { trends } = ctx.world.company.research;
  if (n.found && !trends.some((t) => t.nicheId === n.nicheId)) trends.push(n.found);
}

// ───────────────────────────── routing ─────────────────────────────

export type MissionRoute =
  | { kind: 'tasks'; items: DayPlanItem[]; wantsProduct: boolean; nicheId: string | null } // wantsProduct: their chain ends on a new product
  | { kind: 'new_product'; nicheId: string; name: string; others: string[] }
  | { kind: 'existing'; product: Product; nicheId: string }
  | { kind: 'no_product'; nicheId: string; name: string }
  | { kind: 'unknown'; topic: string; leads: string[] };

/** The founder's own words for the subject (« sommeil bébé »), for the answer. */
function topicWords(text: string, topic: string[]): string {
  const wanted = new Set(topic);
  return uniq(text.split(/[^\p{L}\p{N}-]+/u).filter((w) => wanted.has(stemOf(fold(w))))).join(' ') || text;
}

function leadsFor(ctx: RuntimeCtx): string[] {
  const { research } = ctx.world.company;
  const taken = new Set(excludedNiches(ctx, { includeActive: true }));
  const ids = research.shortlist.length ? research.shortlist : research.trends.map((t) => t.nicheId);
  return ids.filter((id) => !taken.has(id)).slice(0, 3).map((id) => nicheName(ctx, id));
}

const NICHE_KINDS: TaskKind[] = ['mine_pains', 'scan_competitors'];

/** Items of a mission without a product chain: research work needs a niche, a scan does not. */
function tasksRoute(ctx: RuntimeCtx, items: DayPlanItem[], wantsProduct: boolean, nicheId: string | null): MissionRoute {
  let list = items.map((it) => (nicheId && NICHE_KINDS.includes(it.kind) ? { ...it, input: { ...it.input, nicheId } } : it));
  // A scan creates the research of its best leads, then the pick when a product is wanted: nothing to run beside it.
  if (list.some((it) => it.kind === 'scan_trends')) list = list.filter((it) => !(NICHE_KINDS.includes(it.kind) && !it.input.nicheId) && !(wantsProduct && it.kind === 'pick_opportunity'));
  const fallback = ctx.world.company.products.find((p) => p.status === 'live')?.nicheId ?? ctx.world.company.research.shortlist[0];
  list = list.flatMap((it) => {
    if (!NICHE_KINDS.includes(it.kind) || it.input.nicheId || it.input.productId) return [it];
    return fallback ? [{ ...it, input: { ...it.input, nicheId: fallback } }] : [];
  });
  return { kind: 'tasks', items: list, wantsProduct: wantsProduct && list.some((it) => it.kind === 'scan_trends' || it.kind === 'pick_opportunity'), nicheId };
}

export function routeMission(ctx: RuntimeCtx, text: string, items: DayPlanItem[]): MissionRoute {
  const wantsProduct = asksForProduct(text) || items.some((it) => it.kind === 'pick_opportunity');
  const topic = topicOf(text);
  if (wantsProduct) {
    if (!topic.length) {
      // No subject: the team chooses, starting from the market (« Publie le guide » is about what already exists).
      const ready = items.some((it) => it.kind === 'scan_trends' || it.kind === 'pick_opportunity' || it.kind === 'publish_product');
      return tasksRoute(ctx, ready ? items : [{ kind: 'scan_trends', title: KIND_META.scan_trends.label, dept: KIND_META.scan_trends.dept, priority: 1, input: {}, why: `Le fondateur a demandé : « ${short(text, 120)} »` }], true, null);
    }
    const matches = scored(visibleNiches(ctx, topicWords(text, topic)), topic).filter((s) => s.coverage >= MIN_COVERAGE);
    const best = matches[0];
    if (!best) return { kind: 'unknown', topic: topicWords(text, topic), leads: leadsFor(ctx) };
    learnSignal(ctx, best);
    const product = productInNiche(ctx, best.nicheId);
    if (product) return { kind: 'existing', product, nicheId: best.nicheId };
    return { kind: 'new_product', nicheId: best.nicheId, name: best.name, others: matches.slice(1, 3).filter((m) => m.score === best.score).map((m) => m.name) };
  }
  // Any other mission may name a niche in passing (« baisse le prix du guide sommeil »): it must then act on that one.
  const about = topic.filter((w) => !OPERATIONS.has(w));
  const matches = about.length ? scored(visibleNiches(ctx, topicWords(text, about)), about).filter((s) => s.strongHits > 0) : [];
  const tied = matches.filter((m) => m.score === matches[0]!.score);
  const owned = tied.filter((m) => productInNiche(ctx, m.nicheId));
  const best = tied.length === 1 ? tied[0] : owned.length === 1 ? owned[0] : undefined;
  if (!best) return tasksRoute(ctx, items, false, null);
  const product = productInNiche(ctx, best.nicheId);
  const needProduct = items.filter((it) => PRODUCT_KINDS.includes(it.kind));
  if (needProduct.length && !product && needProduct.length === items.length) return { kind: 'no_product', nicheId: best.nicheId, name: best.name };
  const pointed = items.filter((it) => product || !PRODUCT_KINDS.includes(it.kind)).map((it) => (
    PRODUCT_KINDS.includes(it.kind) ? { ...it, input: { ...it.input, productId: product!.id, nicheId: best.nicheId } } : it
  ));
  return tasksRoute(ctx, pointed, false, best.nicheId);
}

/** The company's product in a niche: the live one, else the one in the works (an upsell only if nothing else). */
export function productInNiche(ctx: RuntimeCtx, nicheId: string): Product | undefined {
  const mine = ctx.world.company.products.filter((p) => p.nicheId === nicheId && p.status !== 'killed');
  return mine.find((p) => p.status === 'live') ?? mine.find((p) => p.status !== 'paused') ?? mine[0];
}

/** Research on the requested niche, then the pick forced on it (the pipeline follows from pick_opportunity). */
export function startNicheChain(ctx: RuntimeCtx, nicheId: string, missionId: string, createdBy: Task['createdBy']): Task[] {
  const w = ctx.world;
  const name = nicheName(ctx, nicheId);
  const opts = { createdBy, missionId, priority: 1 as const };
  const voc = w.company.research.voc[nicheId];
  const research: Task[] = [];
  if (!voc || voc.depth !== 'deep') research.push(createTask(w, { ...opts, kind: 'mine_pains', title: `Écouter la voix du client — ${short(name, 40)} (mission du fondateur)`, input: { nicheId, depth: 'deep' }, workLeft: 2 }));
  if (!w.company.research.competitors[nicheId]) research.push(createTask(w, { ...opts, kind: 'scan_competitors', title: `Analyser la concurrence — ${short(name, 40)} (mission du fondateur)`, input: { nicheId } }));
  const pick = createTask(w, { ...opts, kind: 'pick_opportunity', title: `Cadrer le guide — ${short(name, 44)} (mission du fondateur)`, input: { nicheId }, dependsOn: research.map((t) => t.id) });
  return [...research, pick];
}

// ───────────────────────────── where it stands ─────────────────────────────

const STATUS_FR: Record<Product['status'], string> = {
  idea: 'à l’état d’idée', research: 'en recherche', writing: 'en rédaction', design: 'en création graphique', qa: 'en relecture', ready: 'prêt à publier',
  live: 'en ligne', paused: 'en pause', killed: 'arrêté',
};

/** One line, no sentence break: the chat cuts its situation on sentences. */
function oneLine(text: string): string {
  return text.replace(/[.;!?]+\s+/g, ', ').replace(/\s+/g, ' ').replace(/[.;!?,\s]+$/, '').trim();
}

export function missionStatusLine(ctx: RuntimeCtx, m: Mission): string {
  const world = ctx.world;
  const head = `Mission du fondateur (jour ${m.day}) « ${short(oneLine(m.text), 110)} »`;
  const product = world.company.products.find((p) => p.id === m.productId) ?? (m.nicheId ? world.company.products.find((p) => p.nicheId === m.nicheId && p.status !== 'killed') : undefined);
  const tasks = m.taskIds.map((id) => taskById(world, id)).filter((t): t is Task => !!t);
  const done = tasks.filter((t) => t.status === 'done').length;
  const stage = tasks.find((t) => t.status === 'in_progress' || t.status === 'review') ?? tasks.find((t) => t.status === 'awaiting_founder' || t.status === 'pending');
  if (m.status === 'failed') return `${head} : échouée, ${oneLine((m.outcome ?? 'aucun résultat').split(/(?<=[.!?])\s/)[0]!)}`;
  if (m.status === 'done') return `${head} : terminée${product ? `, résultat « ${short(product.title, 60)} » ${STATUS_FR[product.status]}` : ''}${m.outcome && !product ? `, ${oneLine(m.outcome)}` : ''}`;
  const facts = [
    product ? `produit « ${short(product.title, 60)} » ${STATUS_FR[product.status]}` : m.nicheId ? `niche « ${short(nicheName(ctx, m.nicheId), 60)} », produit pas encore créé` : '',
    tasks.length ? `${done}/${tasks.length} tâches terminées` : '',
    stage ? `étape en cours « ${short(stage.title, 70)} »` : '',
  ].filter(Boolean);
  return `${head} : en cours${facts.length ? `, ${facts.join(', ')}` : ''}`;
}

/** Latest founder missions, the open ones first. */
export function founderMissionLines(ctx: RuntimeCtx, max = 6): string[] {
  const mine = ctx.world.company.missions.filter((m) => m.from === 'founder');
  const ordered = [...mine.filter((m) => m.status === 'open').reverse(), ...mine.filter((m) => m.status !== 'open').reverse()];
  return ordered.slice(0, max).map((m) => missionStatusLine(ctx, m));
}

// ───────────────────────────── the chief of staff's follow-up ─────────────────────────────

/** A dead mission is restarted this many times before the founder is told it failed. */
export const MAX_RELAUNCHES = 2;
/** Open this many days without being finished: someone has to look at it. */
export const STALE_TASK_DAYS = 2;

/** The answer stays on the mission, in the feed and in the agent's chat with the founder. */
export function tellFounder(ctx: RuntimeCtx, agentId: string, m: Mission, text: string): void {
  m.outcome = text;
  say(ctx, agentId, `${nameOf(ctx, agentId)} au fondateur : ${text}`, 'founder');
  const w = ctx.world;
  const history = (w.company.chats[agentId] ??= []);
  history.push({ id: nextId(w, 'msg'), day: w.day, from: agentId, text, at: Date.now() });
}

/**
 * Every open founder mission that asked for a product: the chain must be alive. A mission whose tasks all ended
 * without any product in its niche is restarted, then reported as failed; it never closes by itself.
 */
export function followFounderMissions(ctx: RuntimeCtx, agent: AgentState): string[] {
  const w = ctx.world;
  const lines: string[] = [];
  for (const m of w.company.missions) {
    if (m.from !== 'founder' || m.status !== 'open') continue;
    if (!m.wantsProduct || !m.nicheId) { lines.push(missionStatusLine(ctx, m)); continue; }
    const product = productInNiche(ctx, m.nicheId);
    if (product) {
      m.productId = product.id;
      lines.push(missionStatusLine(ctx, m));
      continue;
    }
    if (m.taskIds.some((id) => { const t = taskById(w, id); return !!t && isOpen(t); })) { lines.push(missionStatusLine(ctx, m)); continue; }
    if ((m.relaunches ?? 0) < MAX_RELAUNCHES) {
      m.relaunches = (m.relaunches ?? 0) + 1;
      startNicheChain(ctx, m.nicheId, m.id, agent.id);
      lines.push(`${agent.name} relance « ${short(m.text, 60)} » : plus aucune tâche et pas de produit (relance ${m.relaunches}/${MAX_RELAUNCHES})`);
      continue;
    }
    m.status = 'failed';
    const text = `La mission « ${short(m.text, 80)} » échoue : ${MAX_RELAUNCHES} relances sans produit. Rien d'autre n'a été lancé à la place.`;
    tellFounder(ctx, agent.id, m, text);
    lines.push(text);
  }
  return lines;
}

/** Day a task became workable: its last dependency done, else the day it was created. */
function readySince(world: RuntimeCtx['world'], t: Task): number {
  return Math.max(t.dayCreated, ...t.dependsOn.map((id) => taskById(world, id)?.dayDone ?? 0));
}

/**
 * Tasks left behind for STALE_TASK_DAYS days: ready but nobody takes them, stuck with someone overloaded, a reviewer
 * who never comes, a founder decision forgotten. Tasks waiting on another task are that task's problem.
 */
export function unblockStaleTasks(ctx: RuntimeCtx, agent: AgentState): string[] {
  const w = ctx.world;
  const lines: string[] = [];
  const reassign = (t: Task, to: AgentState, age: number) => {
    const from = agentById(w, t.assignee);
    if (from?.currentTaskId === t.id) { from.currentTaskId = null; from.status = 'idle'; from.bubble = null; }
    t.assignee = to.id;
    fixSelfReview(w, t);
    t.status = 'pending';
    t.priority = 1;
    logTask(t, `Jour ${w.day} : ${agent.name} confie la tâche à ${to.name} (bloquée depuis ${age} jours).`);
    lines.push(`${agent.name} débloque « ${short(t.title, 60)} » (${age} jours) : confiée à ${to.name}`);
  };
  for (const t of openTasks(w)) {
    const age = w.day - readySince(w, t);
    if (age < STALE_TASK_DAYS || t.kind === 'follow_missions') continue;
    if (t.status === 'awaiting_founder') {
      if (age % 3 === 2) lines.push(`${agent.name} rappelle au fondateur une décision en attente depuis ${age} jours : ${short(String(t.input.founderAsk ?? t.title), 90)}`);
      continue;
    }
    if (t.status === 'review') {
      const reviewer = agentById(w, t.reviewer);
      const backup = chiefOf(w, t.dept);
      if (!reviewer && backup) {
        t.reviewer = backup.id === t.assignee ? 'camille' : backup.id;
        lines.push(`${agent.name} débloque la relecture de « ${short(t.title, 60)} » : ${backup.name} s'en charge`);
      }
      continue;
    }
    if (depState(w, t) !== 'ready' || (t.status === 'in_progress' && agentById(w, t.assignee)?.currentTaskId === t.id)) continue;
    const product = productOf(ctx, t.input.productId);
    if (product?.status === 'killed') {
      t.status = 'cancelled';
      t.dayDone = w.day;
      logTask(t, `Jour ${w.day} : annulée par ${agent.name}, le produit est arrêté.`);
      lines.push(`${agent.name} annule « ${short(t.title, 60)} » : le produit est arrêté`);
      continue;
    }
    const owner = agentById(w, t.assignee);
    const others = capableAgents(w, t.kind, t.dept).filter((a) => a.id !== t.assignee);
    const free = [...others].sort((a, b) => agentLoad(w, a.id) - agentLoad(w, b.id))[0];
    if (!owner) { if (free) reassign(t, free, age); continue; }
    if (free && agentLoad(w, free.id) + 1 < agentLoad(w, owner.id)) reassign(t, free, age);
    else if (t.priority !== 1) {
      t.priority = 1;
      logTask(t, `Jour ${w.day} : ${agent.name} la passe en priorité (ouverte depuis ${age} jours).`);
      lines.push(`${agent.name} remonte « ${short(t.title, 60)} » en priorité (${age} jours) pour ${owner.name}`);
    }
  }
  return lines;
}

/** Open tasks of the product a mission follows, shown on the mission without taking them over. */
export function linkProductTasks(ctx: RuntimeCtx, m: Mission, productId: string): void {
  for (const t of openTasksForProduct(ctx, productId)) if (!m.taskIds.includes(t.id)) m.taskIds.push(t.id);
}
