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
import { activeHolds, adsHold, launchHold } from './holds.js';
import { excludedNiches, openTasksForProduct, PAID_AD_TASKS } from './pipeline.js';
import { agentById, agentLoad, capableAgents, chiefOf, createTask, depState, fixSelfReview, isOpen, KIND_META, logTask, openTasks, PRODUCT_KINDS, taskById } from './tasks.js';
import { short, str, uniq } from './util.js';

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
  pourrait pourrais pourrions pourriez devrait devrais devrions devriez serait serais avoir fasse fassions fassiez aimerait aimerions voudrions
  envie quelque chose truc machin bidule qqch quelquechose pas arrete arreter point situation lieux
`);

/**
 * The founder's words for what the catalogue says otherwise, first word = the niche's own keyword. Synonyms only count
 * in a request about a subject: « vendre plus » alone is not about Vinted.
 */
const SYNONYMS = new Map<string, string>(`
  sommeil dormir dort dorme dorment dormez endormir endort endorme endormi endormie
  bebe nourrisson nourrissons nouveau-ne
  ventre maigrir mincir amincir minceur regime kilo kilos
  relooker renovation renover retaper restaurer restauration repeindre rajeunir
  revendre vendre vends vendez vendeuse
  potager legume legumes plante plantes jardin
  mariage marier marie mariee noces
  stress angoisse angoisses trac lyceen lyceenne lyceens
  bac baccalaureat
  chat chaton chatons
  urssaf microentreprise microentrepreneur autoentrepreneur autoentreprise
  japon japonais
`.trim().split(/\n/).flatMap((line) => {
  const [word, ...others] = line.trim().split(/\s+/);
  return others.map((o): [string, string] => [stemOf(o), stemOf(word!)]);
}));

const canon = (stem: string): string => SYNONYMS.get(stem) ?? stem;

/** Words of the trade: they say what to do, not which niche it is about (only ignored outside a product request). */
const OPERATIONS = stems(`
  hook accroche tiktok pub publicite campagne creative crea video organique post poster prix tarif euro page vente client message mail
  email support inbox rapport chiffre kpi bilan stat test experience budget roas ctr cpm concurrent concurrence createur influenceur
  partenaire partenariat affiliation commission upsell suite couverture titre plan rembourse remboursement baisse baisser monte monter
  coupe couper scale optimise optimiser analyse analyser recherche rechercher ecoute voix commentaire forum ameliore corrige reecris
  verifie humanise hausse relance suivi bloque retard tresorerie compta marge
`);

function topicOf(text: string, synonyms = false): string[] {
  const topic = words(text).map(stemOf).filter((w) => !NOT_A_TOPIC.has(w));
  return uniq(synonyms ? topic.map(canon) : topic);
}

const PRODUCT_WORD = '(?:guide|pdf|produit|ebook|e-book|livre|manuel)';
const THING = '(?:truc|machin|quelque chose|quelquechose|qqch)';
const FILLER = '(?:[\\s-]+(?:nous|moi|un|une|le|la|les|notre|mon|ma|des|du|de|d|petit|mini|nouveau|nouvelle|autre|second|seconde|deuxieme|2e|vrai|bon|beau))*';
const ASK_VERB = '(?:lance[rz]?|lancons|cree[rz]?|creons|ecris|ecrire|ecrivez|ecrivons|redige[rz]?|redigeons|sors|sortir|sortez|sortons|produis|produire|produisez|fais|faire|faites|faisons|fasse|fassions|fassiez|prepare[rz]?|preparons|publie[rz]?|publions|veux|voudrais|voudrions|aimerais|aimerait|aimerions|faut|faudrait)';
const PRODUCT_ASK = new RegExp(`\\b${ASK_VERB}\\b${FILLER}[\\s-]+${PRODUCT_WORD}\\b`);
/** « avoir » or « vendre » a guide only asks for a new one with an indefinite article: « vendre le guide » is about ours. */
const PRODUCT_WISH = new RegExp(`\\b(?:avoir|vendre|vends|vendez)\\s+(?:un|une)${FILLER}[\\s-]+${PRODUCT_WORD}\\b`);
const THING_ASK = new RegExp(`\\b${ASK_VERB}\\b${FILLER}[\\s-]+${THING}\\s+(?:sur|pour|autour|a propos|au sujet|concernant|contre)\\b`);
/** No verb at all: « un guide sur la permaculture », « guide TOEIC ». A question or a remark about a guide is something else. */
const BARE_ASK = /^(?:(?:un|une|petit|mini)\s+)*(?:guide|ebook|e-book)\s+\S/;
const DIVE_IN = /\b(?:se lance|lance[sz]?[\s-]toi|lancons[\s-]nous)\s+sur\b/;
const NEW_PRODUCT = new RegExp(`\\b(?:nouveau|nouvelle|deuxieme|second|seconde|2e|autre)\\s+(?:${PRODUCT_WORD}|niche)\\b`);

/** Does the founder ask for a product to exist (rather than for work on what exists)? */
export function asksForProduct(text: string): boolean {
  const t = fold(text).trim();
  if (PRODUCT_ASK.test(t) || PRODUCT_WISH.test(t) || NEW_PRODUCT.test(t) || (BARE_ASK.test(t) && !/[:?]/.test(t))) return true;
  // « fais quelque chose pour les remboursements » is not a product: only a real subject makes it one.
  return (THING_ASK.test(t) || DIVE_IN.test(t)) && topicOf(text).some((w) => !OPERATIONS.has(w));
}

// ───────────────────────────── matching a niche ─────────────────────────────

interface NicheWords { nicheId: string; name: string; strong: Set<string>; weak: Set<string>; signal: number; found?: TrendSignal }
interface Scored extends NicheWords { hits: number; strongHits: number; score: number; coverage: number }

/** A topic counts as covered from this share of its words: « le sommeil du chien » is neither the sleep guide nor the puppy one. */
const MIN_COVERAGE = 0.6;
/** A word this many niches share (« appartement », « budget ») tells none of them apart: coverage rests on the rarer ones. */
const COMMON_WORD_NICHES = 3;

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
  const rare = topic.filter((w) => niches.filter((n) => n.strong.has(w) || n.weak.has(w)).length < COMMON_WORD_NICHES);
  const telling = rare.length ? rare : topic;
  return niches.map((n) => {
    const strong = topic.filter((w) => n.strong.has(w)).length;
    const weak = topic.filter((w) => !n.strong.has(w) && n.weak.has(w)).length;
    return { ...n, hits: strong + weak, strongHits: strong, score: 2 * strong + weak, coverage: telling.filter((w) => n.strong.has(w) || n.weak.has(w)).length / Math.max(1, telling.length) };
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
  | { kind: 'unknown'; topic: string; leads: string[]; near: string[] }
  | { kind: 'unclear'; topic: string; niche: string | null } // nothing in the request tells what to do
  | { kind: 'held'; reason: string }                         // the work asked for is what the founder himself stopped
  | { kind: 'order'; order: FounderOrder };

/** The founder's own words for the subject (« sommeil bébé »), for the answer. */
function topicWords(text: string, topic: string[]): string {
  const wanted = new Set(topic);
  return uniq(text.split(/[^\p{L}\p{N}-]+/u).filter((w) => { const s = stemOf(fold(w)); return wanted.has(s) || wanted.has(canon(s)); })).join(' ') || text;
}

/** What the trend tool is asked: his words, and the catalogue's when a synonym stood for them. */
function trendQuery(text: string, topic: string[]): string {
  return uniq([...topicWords(text, topic).split(' '), ...topic]).join(' ');
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

// ───────────────────────────── the founder's orders ─────────────────────────────

export type OrderAction = 'stop_ads' | 'trim_ads' | 'stop_spending' | 'stop_launches' | 'pause_product' | 'kill_product' | 'resume_ads' | 'resume_launches' | 'resume_product' | 'resume_all' | 'raise_budget';

export type FounderOrder =
  | { action: Exclude<OrderAction, 'trim_ads'>; product: Product | null }
  | { action: 'no_target'; asked: OrderAction; topic: string };

const ADS_WORD = '(?:pubs?|publicites?|campagnes?|ads|acquisition payante)';
const PRODUCT_NOUN = '(?:guides?|pdf|produits?|ebooks?|e-books?|livres?|manuels?)';
const STOP_VERB = '(?:coupe[rz]?|arrete[rz]?|stoppe[rz]?|stop|suspends?|suspendre|suspendez|gele[rz]?|desactive[rz]?|eteins|eteignez|bloque[rz]?)';
const BACK_VERB = '(?:reprends?|reprenez|reprendre|relance[rz]?|reactive[rz]?|remets?|remettez|remettre|redemarre[rz]?|rallume[rz]?|republie[rz]?|publie[rz]?)';
/** At most four words apart: « coupe moi toutes les pubs », and not a verb that speaks of something else. */
const NEAR = '(?:[\\s-]+\\S+){0,4}?[\\s-]+';
const anyOf = (...patterns: string[]): RegExp => new RegExp(patterns.join('|'));

const STOP_SPENDING = anyOf(`\\bne\\s+depense[zr]?\\s+(?:plus|rien)\\b`, `\\b${STOP_VERB}\\b${NEAR}depens`, `\\b(?:plus|zero|aucune)\\s+(?:de\\s+|d')?depenses?\\b`, `\\bne\\b.*\\bplus\\b\\s+(?:un\\s+)?(?:euro|centime)\\b`);
const RESUME_ADS = new RegExp(`\\b${BACK_VERB}\\b${NEAR}${ADS_WORD}\\b`);
const RESUME_LAUNCHES = new RegExp(`\\b${BACK_VERB}\\b${NEAR}(?:lancements?|nouveaux?\\s+${PRODUCT_NOUN})`);
const RESUME_ANY = /\b(?:leve[rz]?|annule[rz]?)\b.*\b(?:ordre|gel|pause|stop|blocage|interdiction)\b/;
const STOP_ADS = anyOf(
  `\\b${STOP_VERB}\\b${NEAR}${ADS_WORD}\\b`, `\\bmets?\\b.*\\b${ADS_WORD}\\b.*\\ben pause\\b`, `\\b(?:mets?|mettez|mettre)\\s+en\\s+pause\\b.*\\b${ADS_WORD}\\b`,
  `\\bpause\\b${NEAR}${ADS_WORD}\\b`, `\\bne\\s+\\S+\\s+(?:plus|pas)\\b${NEAR}${ADS_WORD}\\b`, `^(?:plus|pas|aucune?)\\s+(?:de\\s+|d'|aucune?\\s+)?${ADS_WORD}\\b`,
);
/** Cutting what loses money is media buying, not an order to stop. */
const ONLY_LOSERS = /non rentables?|perdantes?|a perte|mauvaises?|fatiguees?|sous (?:un )?roas|qui (?:ne\s+)?(?:perdent|marchent pas|rapportent pas|convertissent pas|vendent pas)/;
const STOP_LAUNCHES = anyOf(
  `\\b${STOP_VERB}\\b${NEAR}(?:lancer|lancements?|creer|produire)\\b`, `\\b${STOP_VERB}\\b.*\\bnouve(?:aux?|lles?)\\s+${PRODUCT_NOUN}`,
  `\\bne\\s+(?:lance|lancez|cree|creez|sors|sortez|produis|produisez|fais|faites)\\s+(?:plus|pas)\\b.*\\b${PRODUCT_NOUN}`, `^(?:plus|pas|aucun)\\s+(?:de\\s+)?nouveaux?\\s+${PRODUCT_NOUN}`,
);
const KILL_PRODUCT = anyOf(`\\b(?:tue[rz]?|kill|supprime[rz]?|abandonne[rz]?|enterre[rz]?)\\b${NEAR}(?:${PRODUCT_NOUN}|niche)\\b`, `\\barrete[rz]?\\s+definitivement\\b`);
/** Stopping a page, a price or a title of the guide is not stopping the guide. */
const PART_OF_GUIDE = /\b(?:prix|tarif|titre|couverture|page|chapitre|hooks?|accroches?)\b/;
const PAUSE_PRODUCT = anyOf(`\\b(?:${STOP_VERB}|retire[rz]?|enleve[rz]?)\\b${NEAR}${PRODUCT_NOUN}\\b`);
const OFF_SALE = anyOf(
  `\\barrete[rz]?\\s+de\\s+(?:vendre|proposer)\\b`, `\\bne\\s+(?:vends?|vendez)\\s+plus\\b`, `\\b(?:sors|sortez|retire[rz]?|enleve[rz]?)\\b.*\\b(?:boutique|vente|catalogue)\\b`,
  `\\bmets?\\b.*\\b${PRODUCT_NOUN}\\b.*\\ben pause\\b`, `\\b(?:mets?|mettez|mettre)\\s+en\\s+pause\\b.*\\b${PRODUCT_NOUN}\\b`, `\\bhors ligne\\b`,
);
const RESUME_PRODUCT = new RegExp(`\\b${BACK_VERB}\\b${NEAR}${PRODUCT_NOUN}\\b`);
const RAISE_BUDGET = /\b(?:double[rz]?|triple[rz]?|multiplie[rz]?|augmente[rz]?|monte[rz]?|booste[rz]?)\b.*\b(?:budget|depenses?)\b/;

/** What the founder orders, read before anything looks for keywords: « coupe toutes les pubs » is not a request about pubs. */
export function orderAction(text: string): OrderAction | null {
  const t = fold(text).trim();
  if (STOP_SPENDING.test(t) && !/inutiles?|superflues?/.test(t)) return 'stop_spending';
  if (RESUME_ANY.test(t)) return new RegExp(ADS_WORD).test(t) ? 'resume_ads' : /lancement|guide/.test(t) ? 'resume_launches' : 'resume_all';
  if (RESUME_ADS.test(t)) return 'resume_ads';
  if (RESUME_LAUNCHES.test(t)) return 'resume_launches';
  if (STOP_ADS.test(t)) return ONLY_LOSERS.test(t) ? 'trim_ads' : 'stop_ads';
  if (STOP_LAUNCHES.test(t)) return 'stop_launches';
  if (KILL_PRODUCT.test(t)) return 'kill_product';
  if (OFF_SALE.test(t) || (PAUSE_PRODUCT.test(t) && !PART_OF_GUIDE.test(t))) return 'pause_product';
  if (RESUME_PRODUCT.test(t)) return 'resume_product';
  if (RAISE_BUDGET.test(t)) return 'raise_budget';
  return null;
}

/** Words of the order itself: what is left names the product. */
const ORDER_WORDS = new Set(`arrete arreter arretez stoppe stopper stop coupe couper coupez suspends suspendre suspendez gele geler desactive eteins bloque mets met mettez mettre
  pause ordre nouvel jusqu tue tuer kill supprime supprimer abandonne abandonner enterre retire retirer enleve enlever sors sortez vendre vends vendez vente proposer boutique
  catalogue ligne hors remets remettre remettez reprends reprendre reprenez relance relancer reactive redemarre rallume republie publie publier leve annule definitivement
  depense depenser lancer lance lancement double triple multiplie augmente monte booste budget`.split(/\s+/).map((w) => canon(stemOf(w))));

/** The product an order speaks of: the one of the niche it names, else, for a product order, the only one there is. */
function orderTarget(ctx: RuntimeCtx, text: string): { product: Product | null; topic: string } {
  const about = topicOf(text, true).filter((w) => !OPERATIONS.has(w) && !ORDER_WORDS.has(w));
  if (!about.length) return { product: null, topic: '' };
  const named = scored(visibleNiches(ctx, trendQuery(text, about)), about).filter((s) => s.strongHits > 0);
  for (const n of named) {
    const product = productInNiche(ctx, n.nicheId);
    if (product) return { product, topic: '' };
  }
  // Words around the order (« ça coûte trop cher ») name no product unless the founder says he means one.
  return { product: null, topic: named.length || new RegExp(`\\b${PRODUCT_NOUN}\\b`).test(fold(text)) ? topicWords(text, about) : '' };
}

function readOrder(ctx: RuntimeCtx, text: string): FounderOrder | 'trim_ads' | null {
  const action = orderAction(text);
  if (!action) return null;
  const w = ctx.world;
  const holds = activeHolds(w);
  switch (action) {
    case 'trim_ads': return 'trim_ads';
    case 'stop_spending': case 'stop_launches': case 'raise_budget': return { action, product: null };
    case 'resume_launches': return launchHold(w) ? { action, product: null } : null;
    case 'resume_all': return holds.length ? { action, product: null } : null;
    case 'stop_ads': case 'resume_ads': {
      const { product, topic } = orderTarget(ctx, text);
      if (action === 'resume_ads' && !holds.some((h) => h.kind === 'ads')) return null;
      return topic ? { action: 'no_target', asked: action, topic } : { action, product };
    }
    case 'pause_product': case 'kill_product': case 'resume_product': {
      const { product, topic } = orderTarget(ctx, text);
      const held = (p: Product) => holds.some((h) => h.kind === 'product' && h.productId === p.id);
      if (action === 'resume_product') {
        const shelved = holds.filter((h) => h.kind === 'product');
        if (!product && !topic && shelved.length > 1) return { action: 'no_target', asked: action, topic };
        const target = product ?? w.company.products.find((p) => p.id === shelved[0]?.productId);
        return target && held(target) ? { action, product: target } : null;
      }
      if (product) return { action, product };
      const current = w.company.products.filter((p) => p.status !== 'killed' && p.status !== 'paused');
      return !topic && current.length === 1 ? { action, product: current[0]! } : { action: 'no_target', asked: action, topic };
    }
  }
}

/** Ad work the founder himself stopped is not started again behind his back: he lifts his order first. */
function respectHolds(ctx: RuntimeCtx, route: Extract<MissionRoute, { kind: 'tasks' }>): MissionRoute {
  const heldBy = (it: DayPlanItem) => (PAID_AD_TASKS.includes(it.kind) ? adsHold(ctx.world, str(it.input.productId) ?? null) : null);
  const free = route.items.filter((it) => !heldBy(it));
  if (free.length === route.items.length) return route;
  return free.length ? { ...route, items: free } : { kind: 'held', reason: heldBy(route.items[0]!)!.reason };
}

export function routeMission(ctx: RuntimeCtx, text: string, items: DayPlanItem[]): MissionRoute {
  const order = readOrder(ctx, text);
  if (order === 'trim_ads') return tasksRoute(ctx, [{ kind: 'optimize_ads', title: KIND_META.optimize_ads.label, dept: KIND_META.optimize_ads.dept, priority: 1, input: {}, why: `Le fondateur a demandé : « ${short(text, 120)} »` }], false, null);
  if (order) return { kind: 'order', order };
  const route = askedRoute(ctx, text, items);
  return route.kind === 'tasks' ? respectHolds(ctx, route) : route;
}

function askedRoute(ctx: RuntimeCtx, text: string, items: DayPlanItem[]): MissionRoute {
  const wantsProduct = asksForProduct(text) || items.some((it) => it.kind === 'pick_opportunity');
  const topic = topicOf(text, wantsProduct);
  if (wantsProduct) {
    if (!topic.length) {
      // No subject: the team chooses, starting from the market (« Publie le guide » is about what already exists).
      const ready = items.some((it) => it.kind === 'scan_trends' || it.kind === 'pick_opportunity' || it.kind === 'publish_product');
      return tasksRoute(ctx, ready ? items : [{ kind: 'scan_trends', title: KIND_META.scan_trends.label, dept: KIND_META.scan_trends.dept, priority: 1, input: {}, why: `Le fondateur a demandé : « ${short(text, 120)} »` }], true, null);
    }
    const all = scored(visibleNiches(ctx, trendQuery(text, topic)), topic);
    const matches = all.filter((s) => s.coverage >= MIN_COVERAGE);
    const best = matches[0];
    if (!best) return { kind: 'unknown', topic: topicWords(text, topic), leads: leadsFor(ctx), near: all.filter((s) => s.strongHits > 0).slice(0, 2).map((s) => s.name) };
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
  // Nothing said what to do: a subject without a task is an open question, not a report closed as done.
  if (about.length && items.length && items.every((it) => it.input.vague === true)) return { kind: 'unclear', topic: topicWords(text, about), niche: best?.name ?? null };
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
        t.reviewer = backup.id;
        fixSelfReview(w, t);
        lines.push(`${agent.name} débloque la relecture de « ${short(t.title, 60)} » : ${nameOf(ctx, t.reviewer)} s'en charge`);
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
