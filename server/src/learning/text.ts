/** French text helpers: accent folding, tokenising for search, safe file names, number formatting, labels. */
import type { AdFormat, DeptId, HookStyle, Lesson, TaskKind } from '../shared.js';

const COMBINING = /[̀-ͯ]/g;

/** Lowercase + accents removed + ligatures expanded ("Cœur" → "coeur"). */
export function fold(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

/** Same as fold() but keeps exactly one UTF-16 unit per input unit, so offsets map back to the original text. */
export function foldSameLength(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const f = c.normalize('NFD').replace(COMBINING, '').toLowerCase();
    if (f.length === 1) out += f;
    else {
      const l = c.toLowerCase();
      out += l.length === 1 ? l : c;
    }
  }
  return out;
}

const STOPWORDS = new Set(
  (
    'le la les un une des de du d l au aux et ou en dans sur pour par avec sans ce cet cette ces se sa son ses ' +
    'leur leurs mon ma mes ton ta tes notre nos votre vos il elle ils elles on nous vous je tu me te lui y a est ' +
    'sont etre ete avoir ont as ai qui que quoi dont quand comment pourquoi ne pas plus moins tres tout tous toute ' +
    'toutes mais donc or ni car si comme fait faire peut peu bien aussi alors deja encore entre vers chez selon c s ' +
    'n qu j m t cela ca celui celle ceux ici the and of to is it est-ce sera etait avait'
  ).split(/\s+/),
);

const SUFFIXES = [
  'issements', 'issement', 'ations', 'ation', 'ements', 'ement', 'ments', 'ment', 'euses', 'euse', 'eurs', 'eur',
  'trices', 'trice', 'ites', 'ite', 'iques', 'ique', 'ables', 'able', 'ibles', 'ible', 'istes', 'iste', 'ismes',
  'isme', 'ives', 'ive', 'ees', 'ee', 'er', 'ez', 'es', 'e',
];

/** Very light French stemmer (plural + frequent derivational suffixes). Applied to index AND queries. */
export function stem(token: string): string {
  let t = token;
  if (/^\d+$/.test(t)) return t;
  if (t.length > 3 && (t.endsWith('s') || t.endsWith('x'))) t = t.slice(0, -1);
  if (t.length <= 5) return t;
  for (const suf of SUFFIXES) {
    if (t.endsWith(suf) && t.length - suf.length >= 4) return t.slice(0, -suf.length);
  }
  return t;
}

/** Search tokens: folded, stopwords dropped, stemmed. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of fold(s).split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

export function tokenSet(s: string): Set<string> {
  return new Set(tokenize(s));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** ASCII slug for file names: "Ne jamais écrire « garanti »" → "ne-jamais-ecrire-garanti". */
export function slugify(s: string, max = 60): string {
  const slug = fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'note';
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Readable file name that is valid on Windows and inside [[wikilinks]] (accents and spaces kept). */
export function safeFileName(name: string, max = 90): string {
  let s = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/g, '')
    .trim();
  if (!s) s = 'note';
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  return s;
}

export function pad3(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(3, '0');
}

export function shorten(s: string, max: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}

export function unique<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

export function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function safeDiv(a: number, b: number): number {
  return b > 0 && Number.isFinite(a) && Number.isFinite(b) ? a / b : 0;
}

export function round(n: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(finite(n) * p) / p;
}

// ───────────────────────────── French number formatting ─────────────────────────────

const formatters = new Map<number, Intl.NumberFormat>();
function nf(digits: number): Intl.NumberFormat {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f;
}

export function fmtNum(n: number, digits = 0): string {
  return nf(digits).format(finite(n));
}

export function fmtEur(n: number, digits = 2): string {
  return `${nf(digits).format(finite(n))} €`;
}

/** fraction → "3,1 %" */
export function fmtPct(fraction: number, digits = 1): string {
  return `${nf(digits).format(finite(fraction) * 100)} %`;
}

export function fmtRatio(n: number): string {
  return nf(2).format(finite(n));
}

export function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n)} ${Math.abs(n) >= 2 ? many : one}`;
}

// ───────────────────────────── Labels ─────────────────────────────

export const HOOK_LABELS: Record<HookStyle, string> = {
  question: 'question',
  contrarian: 'contre-pied',
  story: 'histoire',
  stat: 'chiffre choc',
  pov: 'POV',
  mistake: 'erreur à éviter',
  before_after: 'avant / après',
  listicle: 'liste',
};

export const FORMAT_LABELS: Record<AdFormat, string> = {
  faceless_voiceover: 'voix off sans visage',
  text_slideshow: 'diaporama texte',
  ugc_avatar: 'narrateur animé',
  carousel: 'carrousel',
  static_image: 'image fixe',
  search_text: 'annonce Search',
};

export const TOPIC_TAGS: Record<Lesson['topic'], string> = {
  ads: 'pub',
  pricing: 'prix',
  product: 'produit',
  support: 'support',
  niche: 'niche',
  finance: 'finance',
  process: 'process',
  partnership: 'partenariat',
};

/** Matches the department playbook notes linked from "00 - Accueil" ([[Playbook Growth]]…). */
export const DEPT_PLAYBOOK_LABELS: Record<DeptId, string> = {
  direction: 'Direction',
  recherche: 'Recherche',
  studio: 'Studio',
  creation: 'Création',
  growth: 'Growth',
  boutique: 'Boutique',
  support: 'Support',
  analyse: 'Analyse',
  finance: 'Finance',
  rh: 'RH',
  partenariats: 'Partenariats',
  video: 'Vidéo',
  crm: 'Communauté',
};

export const TASK_LABELS: Record<TaskKind, string> = {
  plan_day: 'plan du jour',
  scan_trends: 'veille des tendances',
  mine_pains: 'écoute client',
  scan_competitors: 'analyse concurrence',
  pick_opportunity: "choix d'opportunité",
  red_team: 'Red Team',
  write_titles: 'titres',
  write_outline: 'plan du guide',
  write_pdf: 'rédaction du PDF',
  humanize_pdf: 'humanisation',
  fact_check: 'fact-check',
  design_cover: 'couverture',
  render_pdf: 'mise en page PDF',
  write_sales_page: 'page de vente',
  set_price: 'fixation du prix',
  publish_product: 'mise en ligne',
  design_upsell: 'upsell',
  write_ad_hooks: 'hooks pub',
  produce_ad: 'production de pub',
  launch_campaign: 'lancement de campagne',
  optimize_ads: 'optimisation des pubs',
  post_organic: 'post organique',
  reply_inbox: 'réponses clients',
  handle_refund: 'remboursements',
  find_creators: 'recherche de créateurs',
  negotiate_deal: 'négociation créateur',
  daily_report: 'rapport du jour',
  run_experiment: 'expérience',
  budget_review: 'revue budgétaire',
  reconcile_ledger: 'rapprochement du grand livre',
  weekly_pnl: 'P&L hebdomadaire',
  follow_missions: 'suivi des missions',
  retro: 'rétro',
  performance_review: 'revue RH',
  headcount_review: 'revue des effectifs',
  recruit: 'recrutement',
  league_review: 'clôture de saison',
  open_channel: 'ouverture de canal',
  adapt_creative: 'adaptation de créa',
  write_search_ads: 'annonces Search',
  reconcile_channels: 'rapprochement des canaux',
  allocate_channels: 'répartition entre canaux',
  write_lead_magnet: 'aimant à prospects',
  write_email_sequence: 'séquence e-mail',
  send_broadcast: 'envoi à la liste',
  design_bump: 'offre à la commande',
  portfolio_review: 'revue du portefeuille',
};

export const DIMENSION_LABELS: Record<string, string> = {
  hook_style: 'Style de hook',
  ad_format: 'Format pub',
  price: 'Prix',
  hype: 'Niveau de promesse',
  sales_hype: 'Niveau de promesse',
  support_tone: 'Ton du support',
  niche: 'Niche',
};
