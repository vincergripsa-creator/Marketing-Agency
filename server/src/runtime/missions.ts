/**
 * Founder missions: what the founder really asked for (which niche, which product), the tasks that follow, the
 * honest answer when the company cannot do it, and the chief of staff's daily follow-up. The niches are only read
 * through the research tools, as any employee would: names, audiences, problems and keywords, never the market truth.
 */
import type { DayPlanItem } from '../contracts.js';
import type { AgentId, AgentState, Alumnus, Campaign, ChannelId, Mission, Product, Task, TaskKind, TrendSignal } from '../shared.js';
import { CHANNEL_IDS, channelOf } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { nameOf, nicheBriefOf, nicheName, productOf, say } from './ctx.js';
import { nextId } from '../core/index.js';
import { activeHolds, adsHold, hiringHold, launchHold } from './holds.js';
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

export type MissionRoute = (
  | { kind: 'tasks'; items: DayPlanItem[]; wantsProduct: boolean; nicheId: string | null } // wantsProduct: their chain ends on a new product
  | { kind: 'new_product'; nicheId: string; name: string; others: string[] }
  | { kind: 'existing'; product: Product; nicheId: string }
  | { kind: 'no_product'; nicheId: string; name: string }
  | { kind: 'unknown'; topic: string; leads: string[]; near: string[] }
  | { kind: 'unclear'; topic: string; niche: string | null } // nothing in the request tells what to do
  | { kind: 'held'; reason: string }                         // the work asked for is what the founder himself stopped
  | { kind: 'order'; orders: FounderOrder[] }
) & { orders?: FounderOrder[] }; // beside any other route: said in the same sentence

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
function tasksRoute(ctx: RuntimeCtx, items: DayPlanItem[], wantsProduct: boolean, nicheId: string | null): Extract<MissionRoute, { kind: 'tasks' }> {
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

/** Orders about one person: they need a name the company knows. */
export type PersonOrder = 'pin_agent' | 'unpin_agent' | 'fire_agent';

export type OrderAction = 'stop_ads' | 'trim_ads' | 'stop_spending' | 'stop_launches' | 'pause_product' | 'kill_product' | 'resume_ads' | 'resume_launches' | 'resume_product' | 'resume_all' | 'raise_budget'
  | 'stop_firing' | 'allow_firing' | 'stop_hiring' | 'resume_hiring' | PersonOrder | 'negated';

export type FounderOrder =
  | { action: Exclude<OrderAction, 'trim_ads' | 'negated' | PersonOrder>; product: Product | null; channels?: ChannelId[]; spared?: Campaign[] } // channels: the ones he named, absent = all of them. spared: what « sauf » leaves alone
  | { action: PersonOrder; agent: AgentState }
  | { action: 'no_target'; asked: OrderAction; topic: string }
  | { action: 'no_agent'; asked: PersonOrder; name: string; left: Alumnus | null }
  | { action: 'trim_ads'; channel: ChannelId | null } // beside a request: on its own a trim is a plain task
  | { action: 'negated'; text: string }               // he said what must not happen: nothing happens, and he is told
  | { action: 'stop_campaign' | 'resume_campaign'; campaign: Campaign; number: number }
  | { action: 'no_campaign'; asked: 'stop_ads' | 'resume_ads'; number: number };

const ADS_WORD = '(?:pubs?|publicites?|campagnes?|ads|acquisition payante)';
/** His words for a channel: « Facebook » is the account Meta runs (D59), « Google » alone is Search, YouTube has its own name. */
const CHANNEL_WORDS: Readonly<Record<string, ChannelId>> = {
  tiktok: 'tiktok', meta: 'meta', facebook: 'meta', fb: 'meta', instagram: 'meta', insta: 'meta',
  youtube: 'youtube', shorts: 'youtube', pinterest: 'pinterest', google: 'google', search: 'google', adwords: 'google',
};
const CHANNEL_WORD = `(?:${Object.keys(CHANNEL_WORDS).join('|')})`;
const CHANNEL_NAMED = new RegExp(`\\b${CHANNEL_WORD}\\b`);
/** The verb's object is the channel, nothing else: « coupe tout sur Meta », « arrête les pubs Facebook », not « coupe les hooks trop longs sur Meta ». */
const ON_CHANNEL = `(?:[\\s-]+(?:moi|nous|tout|tous|toutes?|le|la|les|nos|mes|sur|de|du|des|en|${ADS_WORD}))*[\\s-]+${CHANNEL_WORD}\\b`;
/** Every verb of an order but the firing ones, in the infinitive a refusal and a limit take: « ne pas couper », « sans toucher ». */
const UNDONE_INFINITIVE = '(?:couper|arreter|stopper|suspendre|geler|desactiver|eteindre|bloquer|tuer|supprimer|abandonner|enterrer|retirer|enlever|reprendre|relancer|reactiver|remettre|redemarrer|rallumer|degeler|debloquer|lever|annuler|doubler|tripler|multiplier|augmenter|monter|booster|toucher|bouger|changer|modifier|baisser|reduire)';
const FIRE_INFINITIVE = '(?:virer|licencier)';
/** « sans toucher au reste », « sans annuler les lancements »: a limit on the order before it, never a refusal of it. */
const LIMIT = `sans\\s+(?:(?:rien|y|le|la|les|l'|leur|lui|me|nous)\\s*)?(?:${UNDONE_INFINITIVE}|${FIRE_INFINITIVE})`;
const EXCEPT = `(?:sauf|hors(?!\\s+(?:ligne|de\\b))|excepte|a\\s+part|mais\\s+pas|${LIMIT})`;
/** What comes after one of these is kept: « coupe tout sauf TikTok », « coupe tout, garde TikTok ». */
const SPARE_WORD = `(?:${EXCEPT}|garde[rsz]?|laisse[rz]?)`;
const SPARED = new RegExp(`\\b${SPARE_WORD}\\b`);
const KEEPS = new RegExp(`\\b${EXCEPT}\\b`);
const keepsAt = (text: string): number => fold(text).search(KEEPS);
/** What an order acts on: the rules read this, or « coupe tout sauf les guides » would stop the guides. */
function headOf(text: string): string {
  const t = text.normalize('NFC');
  const at = keepsAt(t);
  return at < 0 ? t : t.slice(0, at).trimEnd();
}
/** What the same order leaves alone, '' when it says nothing of it. */
function keptOf(text: string): string {
  const t = text.normalize('NFC');
  const at = keepsAt(t);
  return at < 0 ? '' : t.slice(at);
}
const PRODUCT_NOUN = '(?:guides?|pdf|produits?|ebooks?|e-books?|livres?|manuels?)';
const STOP_VERB = '(?:coupe[rz]?|arrete[rz]?|stoppe[rz]?|stop|suspends?|suspendre|suspendez|gele[rz]?|desactive[rz]?|eteins|eteignez|bloque[rz]?)';
const BACK_VERB = '(?:reprends?|reprenez|reprendre|relance[rz]?|reactive[rz]?|remets?|remettez|remettre|redemarre[rz]?|rallume[rz]?|republie[rz]?|publie[rz]?)';
/** At most four words apart: « coupe moi toutes les pubs », and not a verb that speaks of something else. */
const NEAR = '(?:[\\s-]+\\S+){0,4}?[\\s-]+';
const anyOf = (...patterns: string[]): RegExp => new RegExp(patterns.join('|'));

const STOP_SPENDING = anyOf(`\\bne\\s+depense[zr]?\\s+(?:plus|rien)\\b`, `\\b${STOP_VERB}\\b${NEAR}depens`, `\\b(?:plus|zero|aucune)\\s+(?:de\\s+|d')?depenses?\\b`, `\\bne\\b.*\\bplus\\b\\s+(?:un\\s+)?(?:euro|centime)\\b`);
const RESUME_ADS = anyOf(`\\b${BACK_VERB}\\b${NEAR}${ADS_WORD}\\b`, `\\b${BACK_VERB}\\b${ON_CHANNEL}`);
const RESUME_LAUNCHES = new RegExp(`\\b${BACK_VERB}\\b${NEAR}(?:lancements?|nouveaux?\\s+${PRODUCT_NOUN})`);
const RESUME_ANY = /\b(?:leve[rz]?|annule[rz]?)\b.*\b(?:ordres?|gel|pause|stop|blocages?|interdictions?)\b/;
const STOP_ADS = anyOf(
  `\\b${STOP_VERB}\\b${NEAR}${ADS_WORD}\\b`, `\\bmets?\\b.*\\b${ADS_WORD}\\b.*\\ben pause\\b`, `\\b(?:mets?|mettez|mettre)\\s+en\\s+pause\\b.*\\b${ADS_WORD}\\b`,
  `\\bpause\\b${NEAR}${ADS_WORD}\\b`, `\\bne\\s+\\S+\\s+(?:plus|pas)\\b${NEAR}${ADS_WORD}\\b`, `^(?:plus|pas|aucune?)\\s+(?:de\\s+|d'|aucune?\\s+)?${ADS_WORD}\\b`,
  `\\b${STOP_VERB}\\b${ON_CHANNEL}`, `\\bmets?\\b${ON_CHANNEL}\\s+en pause\\b`, `\\b(?:mets?|mettez|mettre)\\s+en\\s+pause\\b${ON_CHANNEL}`,
  `^(?:plus|pas|aucune?)\\s+(?:de\\s+|d')?${CHANNEL_WORD}\\b`,
);
/** Every channel but one: the one rule that reads past the limit. */
const ALL_BUT_CHANNEL = new RegExp(`\\b${STOP_VERB}\\b${NEAR}${SPARE_WORD}\\s+(?:sur\\s+|a\\s+|au\\s+)?${CHANNEL_WORD}\\b`);
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

const FIRE_VERB = '(?:vire[rz]?|virons|licencie[rz]?|licencions)'; // not « renvoie »: « renvoie Marie vers le support » fires nobody
const STAFF_WORD = "(?:d')?(?:embauches?|embaucher|recrutements?|recruter)";
const CAN = '(?:tu\\s+peux|vous\\s+pouvez|on\\s+peut)\\s+(?:de\\s+nouveau\\s+|a\\s+nouveau\\s+)?';
/** What follows a verb and is no person: « vire les pubs », « garde le prix », « garde TikTok », « tu peux virer si besoin ». */
const NOT_A_NAME = `(?:${Object.keys(CHANNEL_WORDS).join('|')}|personne|pas|plus|jamais|moi|nous|le|la|les|l|un|une|des|du|de|d|ce|cet|cette|ces|ca|cela|ceci|tout|tous|toute|toutes|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|qui|que|quand|si|en|au|aux|a|bien|juste|seulement|maintenant|plutot|desormais|encore)`;
/** The person an order names: the word after the verb and its « -moi », captured. */
const PERSON = `(?:[\\s-]+(?:moi|nous))?[\\s-]+(?!${NOT_A_NAME}\\b)([a-z0-9][a-z0-9'-]*)`;

const STOP_FIRING = anyOf(
  `\\bne\\s+${FIRE_VERB}\\s+(?:plus\\s+)?personne\\b`, `\\bne\\s+${FIRE_VERB}\\s+(?:plus|pas)\\s*$`, `\\b(?:pas|plus|aucun|zero)\\s+(?:de\\s+|d')?(?:licenciements?|renvois?)\\b`,
  `\\barrete[rz]?\\s+de\\s+(?:virer|licencier)\\b`, `\\b${STOP_VERB}\\b${NEAR}(?:licenciements?|renvois?|departs?)\\b`,
);
/** What refuses the verb after it, however he says it: « pas question de virer », « évite de couper ». */
const REFUSAL = "(?:\\b(?:pas|plus)\\s+(?:besoin|question|la\\s+peine|utile|necessaire)|\\b(?:evite[rz]?|refuse[rz]?|hors\\s+de\\s+question|interdit|inutile))\\s+(?:de\\s+|d')";
/** « il ne faut pas couper », « faut pas virer », « jamais virer »: the negation stands right before an infinitive, or « en plus coupe les pubs » would refuse its own order. */
const NOT_BEFORE = (verb: string): string => `\\b(?:pas|jamais|(?<!\\b(?:en|de|au)\\s)plus)\\s+(?:surtout\\s+|du\\s+tout\\s+|\\S+ment\\s+)?${verb}\\b`;
/** « ne vire pas Sarah » protects her: the same order as « garde Sarah ». */
const SPARE_PERSON = anyOf(`\\b(?:ne\\s+)?${FIRE_VERB}\\s+(?:pas|plus|jamais|ni)${PERSON}`, `${REFUSAL}${FIRE_VERB}\\b${PERSON}`, `${NOT_BEFORE(FIRE_INFINITIVE)}${PERSON}`);
/** Every verb of an order, « touche » and « bouge », which are how he says to leave things alone. Not « publie »: « ne publie plus de pubs » is a stop. Not the firing verbs: their refusal is a pin. */
const UNDONE_VERB = `(?:${STOP_VERB}|eteindre|tue[rz]?|kill|supprime[rz]?|abandonne[rz]?|enterre[rz]?|retire[rz]?|enleve[rz]?|reprends?|reprenez|reprendre|relance[rz]?|reactive[rz]?|remets?|remettez|remettre|redemarre[rz]?|rallume[rz]?|degele[rz]?|debloque[rz]?|leve[rz]?|annule[rz]?|double[rz]?|triple[rz]?|multiplie[rz]?|augmente[rz]?|monte[rz]?|booste[rz]?|touche[rz]?|bouge[rz]?|change[rz]?|modifie[rz]?|baisse[rz]?|reduis|reduisez|reduire)`;
/** « ne coupe pas les pubs », « ne coupe absolument pas », « ne coupe ni… », « n'arrête rien », « pas besoin de couper », « arrête de couper », « je ne veux pas que tu coupes »: what he refuses is the verb of the order itself. */
const NEGATED = anyOf(
  `(?:\\bne\\s+|\\bn')(?:les?\\s+|la\\s+|l'|y\\s+|me\\s+|nous\\s+)?${UNDONE_VERB}\\s+(?:\\S+\\s+){0,2}?(?:pas|plus|jamais|rien|aucune?|ni)\\b`,
  `${REFUSAL}${UNDONE_VERB}\\b`, NOT_BEFORE(UNDONE_INFINITIVE), `\\barrete[rz]?\\s+de\\s+${UNDONE_VERB}\\b`, "\\b(?:pas|plus)\\s+(?:que\\s+|qu')(?:tu|vous|on|nous|ils?|elles?)\\b",
);
const PIN_PERSON = new RegExp(`\\b(?:garde[rsz]?|protege[rsz]?|epingle[rsz]?)\\b${PERSON}`);
const UNPIN_PERSON = anyOf(
  `\\bdesepingle[rsz]?\\b${PERSON}`, `\\bne\\s+(?:garde|protege)[sz]?\\s+plus${PERSON}`, `\\bplus\\s+besoin\\s+de\\s+(?:garder|proteger)${PERSON}`,
  `\\b(?:leve[rz]?|retire[rz]?|enleve[rz]?)\\s+(?:la\\s+protection|l'epingle)[\\s,]+(?:de\\s+|d')([a-z0-9][a-z0-9'-]*)`,
);
/** What may open a firing. It cannot be undone and « viré » folds to « vire »: a doubt, a « si » or a past tense before the verb is no order. */
const FIRE_LEAD = `(?:(?:bon|ok|allez|alors|donc|oui|et|puis|stp|svp)\\s+)*(?:${CAN}|(?:tu\\s+dois|vous\\s+devez|on\\s+doit|il\\s+faut|faut|je\\s+veux|on(?:\\s+va)?)\\s+)?`;
const FIRE_PERSON = new RegExp(`^${FIRE_LEAD}${FIRE_VERB}\\b${PERSON}`);
const ALLOW_FIRING = anyOf(`(?<!\\bsi\\s)\\b${CAN}(?:virer|licencier)\\b`, `\\b(?:licenciements?|renvois?)\\s+(?:sont\\s+)?(?:autorises?|permis)\\b`, `\\b(?:${BACK_VERB}|degele[rz]?|debloque[rz]?)\\b${NEAR}(?:licenciements?|renvois?|departs)\\b`, `\\b(?:leve[rz]?|annule[rz]?)\\b.*\\b(?:licenci|vire|renvo)`, `\\b(?:leve[rz]?|annule[rz]?)\\b.*\\b(?:ordres?|gel|pause|stop|blocages?|interdictions?)\\b.*\\bdeparts?\\b`);
const STOP_HIRING = anyOf(
  `\\b${STOP_VERB}\\b${NEAR}${STAFF_WORD}\\b`, `\\bgel\\s+des\\s+${STAFF_WORD}\\b`, `\\b(?:ne\\s+|n')(?:embauche[rz]?|recrute[rz]?)\\s+(?:plus|personne|pas)\\b`,
  `^(?:plus|pas|aucune?)\\s+(?:de\\s+|d'|aucune?\\s+)?(?:nouvelles?\\s+)?${STAFF_WORD}\\b`,
);
const RESUME_HIRING = anyOf(`\\b(?:${BACK_VERB}|degele[rz]?|debloque[rz]?)\\b${NEAR}${STAFF_WORD}\\b`, `(?<!\\bsi\\s)\\b${CAN}(?:embaucher|recruter)\\b`, `\\b(?:leve[rz]?|annule[rz]?)\\b.*\\b${STAFF_WORD}\\b`);

/** Who works here. A question fires nobody and protects nobody: « faut-il virer Tom ? », « pourquoi ne pas virer Tom ? ». */
function teamOrder(full: string, asking: boolean): OrderAction | null {
  const t = headOf(full);
  if (STOP_FIRING.test(t)) return 'stop_firing';
  if (UNPIN_PERSON.test(t)) return 'unpin_agent';
  if (PIN_PERSON.test(t) || (!asking && SPARE_PERSON.test(t))) return 'pin_agent';
  if (!asking && FIRE_PERSON.test(t)) return 'fire_agent';
  if (ALLOW_FIRING.test(t)) return 'allow_firing';
  if (RESUME_HIRING.test(t)) return 'resume_hiring';
  if (STOP_HIRING.test(t)) return 'stop_hiring';
  return null;
}

/** « ne publie plus de pubs » is a stop, the one way a verb of resuming says the opposite. */
const NOT_PUBLISHED = /\bne\s+publie[rz]?\s+(?:pas|plus|jamais)\b/;

/** « la campagne 2 », « les campagnes 2 et 3 ». */
const CAMPAIGN_NUMBERS = /\bcampagnes?\s+(?:n(?:o|°|umero)?\.?\s*)?(\d+(?:(?:\s*,\s*|\s+et\s+)(?:la\s+)?\d+)*)\b/g;
const numbersIn = (text: string): number[] => uniq([...fold(text).matchAll(CAMPAIGN_NUMBERS)].flatMap((m) => [...m[1]!.matchAll(/\d+/g)].map((d) => Number(d[0]))));

/** « coupe tout sauf le guide du chiot », « arrête tout sans toucher aux guides »: the ads go. « coupe tout sauf les pubs » leaves them out of it. */
function allBut(t: string, full: string): boolean {
  const kept = keptOf(full);
  return !!kept && new RegExp(`\\b${STOP_VERB}\\s+tout$`).test(t) && (!new RegExp(`\\b${ADS_WORD}\\b`).test(kept) || numbersIn(kept).length > 0);
}

/** Money and products. */
function moneyOrder(full: string): OrderAction | null {
  const t = headOf(full);
  if (STOP_SPENDING.test(t) && !/inutiles?|superflues?/.test(t)) return CHANNEL_NAMED.test(full) ? 'stop_ads' : 'stop_spending';
  if (RESUME_ANY.test(t)) return new RegExp(ADS_WORD).test(t) || CHANNEL_NAMED.test(t) ? 'resume_ads' : /lancement|guide/.test(t) ? 'resume_launches' : 'resume_all';
  if (RESUME_ADS.test(t) && !NOT_PUBLISHED.test(t)) return 'resume_ads';
  if (RESUME_LAUNCHES.test(t)) return 'resume_launches';
  if (STOP_ADS.test(t) || ALL_BUT_CHANNEL.test(full) || allBut(t, full)) return ONLY_LOSERS.test(t) ? 'trim_ads' : 'stop_ads';
  if (STOP_LAUNCHES.test(t)) return 'stop_launches';
  if (KILL_PRODUCT.test(t)) return 'kill_product';
  if (OFF_SALE.test(t) || (PAUSE_PRODUCT.test(t) && !PART_OF_GUIDE.test(t))) return 'pause_product';
  if (RESUME_PRODUCT.test(t)) return 'resume_product';
  if (RAISE_BUDGET.test(t)) return 'raise_budget';
  return null;
}

/** Where an order ends: the « ne » of « ne touche pas à la marge et vire Tom » says nothing of Tom. */
const CLAUSE_BREAK = /[,;:!?\n—–]+\s*|\.(?:\s+|$)|\s+(?:et|mais|puis)\s+|(?<!\bn(?:e\s+|')\S+)\s+ni\s+/i; // « ne coupe ni… » is one negation, « ne vire pas Sarah ni Tom » a list

/** Words said in passing, between two commas: they end no clause. */
const COURTESY = /^(?:s'il (?:te|vous) plait|stp|svp|merci(?: beaucoup)?|je (?:t'en|vous en) prie)$/;
/** A verb the comma cut from what it acts on: « lève, stp, le gel des embauches » lifts the freeze, it does not declare one. */
const BARE_VERB = new RegExp(`^(?:leve[rz]?|annule[rz]?|degele[rz]?|debloque[rz]?|${STOP_VERB}|${BACK_VERB})(?:[\\s-]+(?:moi|nous))?$`);
/** A clause with a verb of its own is its own order: « stop, vire Tom ». */
const OPENS_ORDER = new RegExp(`^(?:${FIRE_VERB}|${STOP_VERB}|${BACK_VERB}|garde[rsz]?|protege[rsz]?)\\b`);

function clausesOf(text: string): string[] {
  const out: string[] = [];
  for (const c of text.split(CLAUSE_BREAK)) {
    const said = fold(c).trim();
    if (!said || COURTESY.test(said)) continue;
    const last = out.at(-1);
    if (last !== undefined && BARE_VERB.test(fold(last).trim()) && !OPENS_ORDER.test(said)) out[out.length - 1] = `${last} ${c}`;
    else out.push(c);
  }
  return out;
}

/** A person's name alone, what follows « vire Sarah et ». A word of any other kind is no name, and its order stays unread. */
const NAME_ALONE = /^\p{L}[\p{L}'-]*(?:\s+\p{L}\.?)?$/u;

export interface SaidOrder { action: OrderAction; text: string; person?: string } // person: named in a list, the verb is in the clause before

/** « vire Sarah, Tom et Léa » is a list: an « et » and a name close it. « vire Sarah, Tom » speaks to Tom, « vire Sarah, Tom et lance un guide » too, and a firing is not undone. */
const LIST_CLOSES = /^(?:\s*,\s*[^,]+?)*?\s+(?:et|ni)\s+\p{L}[\p{L}'-]*(?:\s+\p{L}\.?)?\s*(?:[,;:!?.\n]|$)/iu;
function inList(whole: string, name: string): boolean {
  const at = whole.indexOf(name);
  return at >= 0 && (/(?:^|\s)(?:et|ni)\s+$/i.test(whole.slice(0, at)) || LIST_CLOSES.test(whole.slice(at + name.length)));
}

/** The orders of one sentence's clauses that nobody refused. `whole` is what the rules that span clauses read. */
function liveOrders(clauses: readonly string[], whole: string, asking: boolean): SaidOrder[] {
  const t = fold(whole).trim();
  const team: SaidOrder[] = [];
  for (const [i, c] of clauses.entries()) {
    const action = teamOrder(fold(c).trim(), asking);
    const last = team.at(-1);
    if (action) team.push({ action, text: c });
    else if (last?.action.endsWith('_agent') && last.text === clauses[i - 1] && NAME_ALONE.test(c.trim()) && inList(whole, c.trim())) team.push({ action: last.action, text: c, person: c.trim() });
  }
  if (team.length) {
    const rest = clauses.filter((c) => !team.some((o) => o.text === c)).join(', ');
    const money = moneyOrder(fold(rest).trim());
    const once = team.filter((o, i) => o.action.endsWith('_agent') || team.findIndex((x) => x.action === o.action) === i);
    return money ? [{ action: money, text: rest }, ...once] : once;
  }
  // No clause speaks of staff alone: « coupe les pubs et les embauches », « lève le gel des pubs et des embauches ».
  const staff = teamOrder(t, asking);
  const money = moneyOrder(t);
  if (!staff) return money ? [{ action: money, text: whole }] : [];
  return money && money !== 'resume_all' ? [{ action: money, text: whole }, { action: staff, text: whole }] : [{ action: staff, text: whole }]; // what names its target never lifts every hold
}

/**
 * What the founder orders, read before anything looks for keywords: « coupe toutes les pubs » is not a request about pubs.
 * One sentence can hold several orders and each one runs, money first: a stop is never lost to a word about staff. A
 * clause about staff is read alone, so its words mean nothing to the money rules (« lève le gel des embauches »).
 * What he refuses goes first: « ne coupe pas les pubs » must never reach the rules that read « coupe » and « pubs ».
 */
export function ordersIn(text: string): SaidOrder[] {
  const { clauses, whole, asking } = spoken(text);
  const { orders, asks } = splitRequest(clauses, asking);
  return asks.length ? orders : saidOrders(clauses, whole, asking);
}

/** The polite way of giving an order, its verb right after: « tu peux couper les pubs ? », not « tu peux me dire si on coupe les pubs ? ». Only a stop reads it so: a stop must not be lost to a question mark, a lift waits for a plain word. */
const POLITE_ASK = new RegExp(`^(?:(?:bon|ok|alors|donc|stp|svp)[\\s,]+)*(?:tu\\s+peux|peux[\\s-]tu|tu\\s+pourrais|pourrais[\\s-]tu|vous\\s+pouvez|pouvez[\\s-]vous|vous\\s+pourriez|pourriez[\\s-]vous)\\s+(?:(?:me|nous|juste|vite|stp|svp|\\S+ment)\\s+)*(?:${UNDONE_INFINITIVE}|mettre|ne\\s+plus)\\b`);
const POLITE_STOPS: readonly OrderAction[] = ['stop_ads', 'stop_spending', 'stop_launches', 'trim_ads'];

/** His sentences less his questions: « faut-il reprendre les pubs ? » lifts nothing, « tu as coupé les pubs ? » stops nothing. */
function stated(text: string): string {
  return text.split(/(?<=[.!?\n])\s+/).filter((sentence) => {
    const t = fold(sentence).trim();
    if (!/\?[?!.\s]*$/.test(t)) return true;
    const order = POLITE_ASK.test(t) ? moneyOrder(t) : null;
    return !!order && POLITE_STOPS.includes(order);
  }).join(' ');
}

/** The forms of the order verbs that fold like the imperative. Only an auxiliary tells them apart: « à couper » keeps its r, « j'ai coupé » has lost its accent. */
const PARTICIPLE = '(?:coupe|arrete|stoppe|gele|desactive|bloque|tue|supprime|abandonne|enterre|retire|enleve|relance|reactive|redemarre|rallume|republie|publie|degele|debloque|leve|annule|double|triple|multiplie|augmente|monte|booste|vire|licencie|garde|protege|epingle)';
/** What he reports: « j'ai coupé les pubs », « hier on a coupé les pubs ». */
const TOLD = new RegExp(`\\b(?:ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient)(?:[\\s-]+(?:tu|il|elle|on|nous|vous|ils|elles))?(?:\\s+(?:deja|bien|encore|aussi|donc|pas|jamais|plus|tout|\\S+ment))*\\s+${PARTICIPLE}\\b`);

/** What may hold an order: the clauses of what he stated, without what he only reports. */
function spoken(text: string): { clauses: string[]; whole: string; asking: boolean } {
  const said = stated(text);
  const all = clausesOf(said);
  const clauses = all.filter((c) => !TOLD.test(fold(c).trim()));
  return { clauses, whole: clauses.length === all.length ? said : clauses.join(', '), asking: fold(text).includes('?') };
}

function saidOrders(clauses: readonly string[], whole: string, asking: boolean): SaidOrder[] {
  const refused = clauses.filter((c) => {
    const said = fold(c).trim();
    return NEGATED.test(said) && !!(moneyOrder(said) ?? teamOrder(said, asking));
  });
  const live = clauses.filter((c) => !refused.includes(c));
  return [...liveOrders(live, refused.length ? live.join(', ') : whole, asking), ...refused.map((c): SaidOrder => ({ action: 'negated', text: c }))];
}

export const orderAction = (text: string): OrderAction | null => ordersIn(text)[0]?.action ?? null;

/** How a clause opens when it asks for work. Anything else beside an order is a comment on it: « coupe la pub, ça coûte trop cher ». */
const REQUEST_OPENS = new RegExp(`^(?:(?:ensuite|aussi|alors|apres|et)\\s+)?(?:(?:je\\s+veux|je\\s+voudrais|j'aimerais|il\\s+faut|tu\\s+peux|on\\s+va)\\s+)?(?:${ASK_VERB}|analyse[rz]?|reponds?|repondre|baisse[rz]?|change[rz]?|optimise[rz]?|ameliore[rz]?|corrige[rz]?|reecris|teste[rz]?|verifie[rz]?|regarde[rz]?|cherche[rz]?|trouve[rz]?|rembourse[rz]?|negocie[rz]?|contacte[rz]?|poste[rz]?)\\b`);

/**
 * The clauses that ask for work, and the orders of the others: an order reads its own clauses, or the subject of the request would
 * become its target. `asks` is empty unless both are there.
 */
function splitRequest(clauses: readonly string[], asking: boolean): { orders: SaidOrder[]; asks: string[] } {
  const asks = clauses.filter((c) => REQUEST_OPENS.test(fold(c).trim()) && !saidOrders([c], c, asking).length);
  const said = clauses.filter((c) => !asks.includes(c));
  const orders = asks.length ? saidOrders(said, said.join(', '), asking) : [];
  return orders.length ? { orders, asks } : { orders: [], asks: [] };
}

/** A request without the limit on it: « lance un guide sans couper les pubs » is about no subject called pubs. */
function withoutLimit(text: string): string {
  const t = text.normalize('NFC');
  const at = fold(t).search(new RegExp(`(?:^|\\s)${LIMIT}\\b`));
  if (at < 0) return text;
  const rest = t.slice(at + 1).search(/[,;:!?.\n]|\s(?:et|mais|puis)\s/i);
  return `${t.slice(0, at)}${rest < 0 ? '' : t.slice(at + 1 + rest)}`.trim();
}

/** The request said beside an order, or under a limit alone, '' when there is none: « coupe les pubs et lance un guide sur le sommeil ». */
export function requestBeside(text: string): string {
  const { clauses, whole, asking } = spoken(text);
  const { asks } = splitRequest(clauses, asking);
  if (asks.length) return asks.map(withoutLimit).join(', ');
  const plain = withoutLimit(text);
  return plain === text || saidOrders(clauses, whole, asking).length ? '' : plain;
}

/** Words of the order itself: what is left names the product. */
const ORDER_WORDS = new Set(`arrete arreter arretez stoppe stopper stop coupe couper coupez suspends suspendre suspendez gele geler desactive eteins bloque mets met mettez mettre
  pause ordre nouvel jusqu tue tuer kill supprime supprimer abandonne abandonner enterre retire retirer enleve enlever sors sortez vendre vends vendez vente proposer boutique
  catalogue ligne hors remets remettre remettez reprends reprendre reprenez relance relancer reactive redemarre rallume republie publie publier leve annule definitivement
  depense depenser lancer lance lancement double triple multiplie augmente monte booste budget`.split(/\s+/).map((w) => canon(stemOf(w))));

const CHANNEL_STEMS = new Set(Object.keys(CHANNEL_WORDS).map(stemOf));

const channelWordsIn = (t: string): ChannelId[] => uniq([...t.matchAll(new RegExp(CHANNEL_NAMED, 'g'))].map((m) => CHANNEL_WORDS[m[0]]!));

/** The channels an order is about, [] for all of them. « coupe tout sauf TikTok » names every other one, opened or not: he said so. */
function channelsIn(text: string): ChannelId[] {
  const [said = '', ...rest] = fold(text).split(SPARED);
  const spared = channelWordsIn(rest.join(' '));
  const named = channelWordsIn(said).filter((ch) => !spared.includes(ch));
  return named.length || !spared.length ? named : CHANNEL_IDS.filter((ch) => !spared.includes(ch));
}

/** The product an order speaks of: the one of the niche it names, else, for a product order, the only one there is. */
function orderTarget(ctx: RuntimeCtx, text: string): { product: Product | null; topic: string } {
  const about = topicOf(text, true).filter((w) => !OPERATIONS.has(w) && !ORDER_WORDS.has(w) && !CHANNEL_STEMS.has(w));
  if (!about.length) return { product: null, topic: '' };
  const named = scored(visibleNiches(ctx, trendQuery(text, about)), about).filter((s) => s.strongHits > 0);
  for (const n of named) {
    const product = productInNiche(ctx, n.nicheId);
    if (product) return { product, topic: '' };
  }
  // Words around the order (« ça coûte trop cher ») name no product unless the founder says he means one.
  return { product: null, topic: named.length || new RegExp(`\\b${PRODUCT_NOUN}\\b`).test(fold(text)) ? topicWords(text, about) : '' };
}

const plain = (s: string): string => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** The full name he wrote (« Léa B. » before « Léa »), else a first name only one person carries. */
function named<T extends { name: string }>(people: readonly T[], word: string, text: string): T | undefined {
  const said = ` ${plain(text)} `;
  const key = plain(word);
  const whole = people.filter((p) => plain(p.name).startsWith(key) && said.includes(` ${plain(p.name)} `)).sort((a, b) => b.name.length - a.name.length);
  const first = people.filter((p) => plain(p.name).split(' ')[0] === key);
  return whole[0] ?? (first.length === 1 ? first[0] : undefined);
}

/**
 * The person an order names. A word the company does not know is a name only when it is written as one: « garde
 * Zorglub » is said back to him, « garde confiance » is no order at all.
 */
function orderPerson(ctx: RuntimeCtx, text: string, asked: PersonOrder, person?: string, target?: AgentId): FounderOrder | null {
  const t = fold(text).trim();
  const word = person ? fold(person).split(/\s+/)[0]! : [UNPIN_PERSON, SPARE_PERSON, PIN_PERSON, FIRE_PERSON].map((re) => re.exec(t)?.slice(1).find(Boolean)).find(Boolean) ?? '';
  const agent = named(ctx.world.company.agents, word, text);
  if (agent && person && agent.id === target) return null; // the name in a list is the one he is talking to
  if (agent) return { action: asked, agent };
  const spoken = text.split(/[^\p{L}\p{N}'-]+/u).find((w) => fold(w) === word) ?? word;
  if (!/^\p{Lu}/u.test(spoken) || asksForProduct(text)) return null;
  return { action: 'no_agent', asked, name: spoken, left: named(ctx.world.company.org?.alumni ?? [], word, text) ?? null };
}

/** The number a campaign keeps for life, the one the Publicité tab prints. Starts at 1. */
export const campaignNumber = (c: Campaign, index: number): number => (c.seq ?? index) + 1;

/** The campaigns he named by number, null when he named none: an order on one of them never reaches the others. */
function campaignOrders(ctx: RuntimeCtx, text: string, asked: 'stop_ads' | 'resume_ads'): FounderOrder[] | null {
  const numbers = numbersIn(text);
  if (!numbers.length) return null;
  const { campaigns } = ctx.world.company;
  return numbers.map((number): FounderOrder => {
    const campaign = campaigns.find((c, i) => campaignNumber(c, i) === number);
    return campaign ? { action: asked === 'stop_ads' ? 'stop_campaign' : 'resume_campaign', campaign, number } : { action: 'no_campaign', asked, number };
  });
}

/** What « sauf » leaves running: the campaigns he numbered, or every campaign of the guide he named. A number nobody carries comes back in `missing`. */
function sparedBy(ctx: RuntimeCtx, text: string): { spared: Campaign[]; missing: number[] } {
  const kept = keptOf(text);
  if (!kept) return { spared: [], missing: [] };
  const { campaigns } = ctx.world.company;
  const numbers = numbersIn(kept);
  const at = (number: number): Campaign | undefined => campaigns.find((c, i) => campaignNumber(c, i) === number);
  if (numbers.length) return { spared: numbers.flatMap((n) => at(n) ?? []), missing: numbers.filter((n) => !at(n)) };
  const { product } = orderTarget(ctx, kept);
  return { spared: product ? campaigns.filter((c) => c.productId === product.id) : [], missing: [] };
}

function readOrder(ctx: RuntimeCtx, { action, text: full, person }: SaidOrder, target?: AgentId): FounderOrder | FounderOrder[] | 'trim_ads' | null {
  const w = ctx.world;
  const holds = activeHolds(w);
  const text = headOf(full);
  switch (action) {
    case 'trim_ads': return 'trim_ads';
    case 'negated': return { action, text: full };
    case 'stop_spending': case 'stop_launches': case 'raise_budget': case 'stop_firing': case 'allow_firing': case 'stop_hiring': return { action, product: null };
    case 'pin_agent': case 'unpin_agent': case 'fire_agent': return orderPerson(ctx, text, action, person, target);
    case 'resume_hiring': return hiringHold(w) ? { action, product: null } : null;
    case 'resume_launches': return launchHold(w) ? { action, product: null } : null;
    case 'resume_all': return holds.length ? { action, product: null } : null;
    case 'stop_ads': case 'resume_ads': {
      const { spared, missing } = sparedBy(ctx, full);
      if (missing.length) return missing.map((number) => ({ action: 'no_campaign', asked: action, number }));
      const numbered = campaignOrders(ctx, text, action);
      if (numbered) return numbered;
      const { product, topic } = orderTarget(ctx, text);
      if (action === 'resume_ads' && !holds.some((h) => h.kind === 'ads')) return null;
      const channels = channelsIn(full);
      return topic ? { action: 'no_target', asked: action, topic } : { action, product, ...(channels.length ? { channels } : {}), ...(spared.length ? { spared } : {}) };
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
  const heldBy = (it: DayPlanItem) => (PAID_AD_TASKS.includes(it.kind) ? adsHold(ctx.world, str(it.input.productId) ?? null, channelOf(it.input as { channel?: ChannelId })) : null);
  const free = route.items.filter((it) => !heldBy(it));
  if (free.length === route.items.length) return route;
  return free.length ? { ...route, items: free } : { kind: 'held', reason: heldBy(route.items[0]!)!.reason };
}

export function routeMission(ctx: RuntimeCtx, text: string, items: DayPlanItem[], target?: AgentId): MissionRoute {
  const read = ordersIn(text).flatMap((said) => readOrder(ctx, said, target));
  const orders = read.filter((o): o is FounderOrder => !!o && o !== 'trim_ads');
  const trim = read.includes('trim_ads');
  const beside = requestBeside(text);
  // A vague clause beside an order asks nothing: the order is what he said.
  const request = beside && (asksForProduct(beside) || !items.every((it) => it.input.vague === true)) ? beside : '';
  if (trim && !request) {
    const [channel] = channelsIn(text);
    const route = tasksRoute(ctx, [{ kind: 'optimize_ads', title: KIND_META.optimize_ads.label, dept: KIND_META.optimize_ads.dept, priority: 1, input: channel ? { channel } : {}, why: `Le fondateur a demandé : « ${short(text, 120)} »` }], false, null);
    return orders.length ? { ...route, orders } : route;
  }
  if (trim) orders.push({ action: 'trim_ads', channel: channelsIn(text)[0] ?? null });
  if (orders.length && !request) return { kind: 'order', orders };
  const route = askedRoute(ctx, request || text, items);
  const held = route.kind === 'tasks' ? respectHolds(ctx, route) : route;
  return orders.length ? { ...held, orders } : held;
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
  const done = (m.gone?.done ?? 0) + tasks.filter((t) => t.status === 'done').length;
  const total = (m.gone?.tasks ?? 0) + tasks.length;
  const stage = tasks.find((t) => t.status === 'in_progress' || t.status === 'review') ?? tasks.find((t) => t.status === 'awaiting_founder' || t.status === 'pending');
  if (m.status === 'failed') return `${head} : échouée, ${oneLine((m.outcome ?? 'aucun résultat').split(/(?<=[.!?])\s/)[0]!)}`;
  if (m.status === 'done') return `${head} : terminée${product ? `, résultat « ${short(product.title, 60)} » ${STATUS_FR[product.status]}` : ''}${m.outcome && !product ? `, ${oneLine(m.outcome)}` : ''}`;
  const facts = [
    product ? `produit « ${short(product.title, 60)} » ${STATUS_FR[product.status]}` : m.nicheId ? `niche « ${short(nicheName(ctx, m.nicheId), 60)} », produit pas encore créé` : '',
    total ? `${done}/${total} tâches terminées` : '',
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
