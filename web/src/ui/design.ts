// Looks as the founder reads them (design plan D207): French labels from shared/design.ts, never a raw id. Pure, unit-tested.
import { ART_STYLES, HERO_INFO, PAGE_HEROES, PAGE_TEMPLATES, STYLE_INFO, TEMPLATE_INFO } from '../../../shared/design';
import type { ArtStyle, BanditArm, DesignLogEntry, Experiment, PageHero, PageTemplate, Product, VisualTaste } from '../../../shared/types';

export type LookKind = 'style' | 'template' | 'hero';
export const LOOK_KINDS: readonly LookKind[] = ['style', 'template', 'hero'];
/** The bandit of each kind, keyed `<dimension>:<nicheId>` (D203). */
export const LOOK_DIM: Record<LookKind, string> = { style: 'cover_style', template: 'page_template', hero: 'page_hero' };
export const LOOK_TITLE: Record<LookKind, string> = { style: 'Style de couverture', template: 'Gabarit de page', hero: 'Visuel de page' };
export const LOOK_ARMS: Record<LookKind, readonly string[]> = { style: ART_STYLES, template: PAGE_TEMPLATES, hero: PAGE_HEROES };
const INFO: Record<LookKind, Record<string, { label: string; blurb: string }>> = { style: STYLE_INFO, template: TEMPLATE_INFO, hero: HERO_INFO };
const KIND_OF_DIM: Record<string, LookKind> = { cover_style: 'style', page_template: 'template', page_hero: 'hero' };

/** A page with no template is the V1 page (D202). */
export const V1_PAGE = { label: 'Classique', blurb: 'La page d’origine, la même pour tous les guides : elle date d’avant les gabarits.' };
/** No style is the V1 look, which is Bauhaus (D200). */
export const V1_STYLE_NOTE = 'Ce guide date d’avant le choix des looks : il porte le Bauhaus de la V1.';

/** The retro scores a look's day as the promise bandit: conversion over 8 %, refunds taken off (D204). */
export const LOOK_CVR_SCALE = 0.08;

/** A colour per art direction for its chip: a hint of the look, not one of its inks. */
export const STYLE_INK: Record<ArtStyle, string> = {
  bauhaus: '#e63946', typo: '#0f172a', grille: '#2563eb', pop: '#f59e0b', trait: '#0ea5e9', collage: '#a16207', aura: '#c084fc', riso: '#ec4899',
};

export const lookKindOfDim = (dim: string): LookKind | null => KIND_OF_DIM[dim] ?? null;

/** French label of a look. No key: Bauhaus for a style, « Classique » for a page. An unknown key keeps its word, capitalised. */
export function lookLabel(kind: LookKind, key: string | null | undefined): string {
  if (!key) return kind === 'style' ? STYLE_INFO.bauhaus.label : kind === 'template' ? V1_PAGE.label : '';
  return INFO[kind][key]?.label ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

export function lookBlurb(kind: LookKind, key: string | null | undefined): string {
  if (!key) return kind === 'style' ? STYLE_INFO.bauhaus.blurb : kind === 'template' ? V1_PAGE.blurb : '';
  return INFO[kind][key]?.blurb ?? '';
}

export const isStyle = (k: unknown): k is ArtStyle => typeof k === 'string' && (ART_STYLES as readonly string[]).includes(k);

/** What a guide wears today, from the card a light snapshot keeps as well as from the whole guide. Null style: nothing drawn yet. */
export interface Look { style: ArtStyle | null; template: PageTemplate | null; hero: PageHero | null; page: boolean }

export function lookOf(p: Pick<Product, 'design' | 'salesPage' | 'designLog' | 'files'>): Look {
  const drawn = !!(p.design || p.files?.cover || p.designLog?.length);
  return {
    style: p.design?.style ?? p.designLog?.at(-1)?.style ?? (drawn ? 'bauhaus' : null),
    template: p.salesPage?.template ?? null,
    hero: p.salesPage?.hero ?? null,
    page: !!(p.salesPage || p.files?.salesPage),
  };
}

/** A refresh's log entry starts with this word (D204). */
export const isRefresh = (e: Pick<DesignLogEntry, 'why'>): boolean => /^Refonte\b/.test(String(e.why ?? '').trim());

/** One version of a guide as its history shows it: its cover, its look, and every change of look it went through. */
export interface LookVersion { version: number; day: number | null; style: ArtStyle; template: PageTemplate | null; hero: PageHero | null; entries: DesignLogEntry[]; refresh: boolean }

/**
 * The guide's looks, version by version, oldest first. A version keeps the look of its last entry; a page test that changed the page
 * is one more entry of the same version. A guide with no log is older than looks: each version wore the V1 look.
 */
export function versionsOf(p: Pick<Product, 'designLog' | 'version' | 'createdDay' | 'design' | 'salesPage'>): LookVersion[] {
  const log = p.designLog ?? [];
  if (!log.length) {
    return Array.from({ length: Math.max(1, p.version || 1) }, (_, i) => ({
      version: i + 1, day: i === 0 ? p.createdDay ?? null : null, style: p.design?.style ?? 'bauhaus', template: i + 1 === p.version ? p.salesPage?.template ?? null : null,
      hero: i + 1 === p.version ? p.salesPage?.hero ?? null : null, entries: [], refresh: false,
    }));
  }
  const out: LookVersion[] = [];
  let page: { template: PageTemplate | null; hero: PageHero | null } = { template: null, hero: null };
  for (const e of log) {
    if (e.template || e.hero) page = { template: e.template ?? null, hero: e.hero ?? null };
    const last = out.at(-1);
    if (last && last.version === e.version) {
      Object.assign(last, { style: e.style, ...page });
      last.entries.push(e);
      last.refresh ||= isRefresh(e);
    } else out.push({ version: e.version, day: e.day, style: e.style, ...page, entries: [e], refresh: isRefresh(e) });
  }
  const last = out.at(-1)!;
  // a version that kept its look writes no entry: today's cover still closes the strip
  if (last.version < p.version) {
    out.push({ version: p.version, day: null, style: p.design?.style ?? last.style, template: p.salesPage?.template ?? last.template, hero: p.salesPage?.hero ?? last.hero, entries: [], refresh: false });
  }
  return out;
}

// ───────────────────────────── the gallery ─────────────────────────────

/** What a tile wore: the server's `TileLook` (api/views.ts), its guide's style, and for a page its template and hero. */
export interface TileLook { style: ArtStyle; template?: PageTemplate; hero?: PageHero; version?: number }
type TileRef = { kind: string; path: string; title: string; day: number };

const PAGE_TILES: ReadonlySet<string> = new Set(['sales_page', 'page_preview']);
const AD_TILES: ReadonlySet<string> = new Set(['ad_storyboard', 'ad_preview', 'ad_video']);
const LOOK_TILES: ReadonlySet<string> = new Set(['pdf', 'cover', ...PAGE_TILES, ...AD_TILES]);
/** The gallery's style filter rides in `kinds` as `style:<id>` (api/views.ts STYLE_FILTER). */
export const STYLE_FILTER = 'style:';

/** « files/prd_1/v3/cover.svg », else « Couverture « … » (v3) ». */
export function versionIn(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = /\/v(\d+)\//.exec(t ?? '') ?? /\(v(\d+)\b/.exec(t ?? '');
    if (m) return Number(m[1]);
  }
  return null;
}

/** The server's `lookAt`, on what the snapshot keeps of a guide: the look at a version or on a day, today's for its current version. */
export function lookAt(p: Pick<Product, 'design' | 'salesPage' | 'designLog' | 'version'>, at: { version: number } | { day: number }, page = false): TileLook {
  const log = p.designLog ?? [];
  const fits = 'version' in at ? (e: DesignLogEntry) => e.version <= at.version : (e: DesignLogEntry) => e.day <= at.day;
  const now = 'version' in at ? at.version >= p.version : !log.some((e) => e.day > at.day);
  const worn = log.findLast(fits);
  const paged = log.findLast((e) => fits(e) && !!(e.template || e.hero));
  const style = (now ? p.design?.style : undefined) ?? worn?.style ?? 'bauhaus';
  const template = page ? (now ? p.salesPage?.template : undefined) ?? paged?.template : undefined;
  const hero = page ? (now ? p.salesPage?.hero : undefined) ?? paged?.hero : undefined;
  const version = 'version' in at ? at.version : worn?.version;
  return { style, ...(template ? { template } : {}), ...(hero ? { hero } : {}), ...(version ? { version } : {}) };
}

/** A tile's look when the server did not say it. An ad wears its guide's look of the day it was made. */
export function tileLookOf(t: TileRef, p: Pick<Product, 'design' | 'salesPage' | 'designLog' | 'version'> | undefined, adDay?: number): TileLook | undefined {
  if (!p || !LOOK_TILES.has(t.kind)) return undefined;
  if (AD_TILES.has(t.kind)) return lookAt(p, { day: adDay ?? t.day });
  const version = versionIn(t.path, t.title);
  return lookAt(p, version === null ? { day: t.day } : { version }, PAGE_TILES.has(t.kind));
}

/** The cover of a version sits beside its guide: files/<id>/v<n>/cover.svg, each render writes its own. */
export function coverPathOf(p: Pick<Product, 'id' | 'files'>, version: number): string {
  const now = p.files?.cover;
  return now && /\/v\d+\//.test(now) ? now.replace(/\/v\d+\//, `/v${version}/`) : `files/${p.id}/v${version}/cover.svg`;
}

// ───────────────────────────── page tests ─────────────────────────────

export const isPageTest = (e: Pick<Experiment, 'dimension'>): boolean => e.dimension === 'page_template';

export function pageTestsOf(experiments: readonly Experiment[] | undefined, productId: string): Experiment[] {
  return (experiments ?? []).filter((e) => isPageTest(e) && e.productId === productId);
}

/** The variant a page test shows on a day: the two alternate from its first day, the guide's own page first (D204). */
export function variantOn(e: Pick<Experiment, 'day' | 'variants'>, day: number): string | undefined {
  const n = e.variants.length;
  return n ? e.variants[(((day - e.day) % n) + n) % n] : undefined;
}

// ───────────────────────────── the bandits ─────────────────────────────

/** An arm as the bandit holds it: its posterior mean, the conversion that mean stands for, and the days of sales behind it. */
export interface ArmRead { key: string; label: string; mean: number; cvr: number; pulls: number }
export interface NicheLooks { nicheId: string; kinds: Partial<Record<LookKind, ArmRead[]>>; days: number }

export const isLookBandit = (key: string): boolean => !!lookKindOfDim(key.split(':')[0] ?? '');

export function armReads(kind: LookKind, arms: readonly BanditArm[]): ArmRead[] {
  return arms.map((a) => {
    const mean = a.alpha + a.beta > 0 ? a.alpha / (a.alpha + a.beta) : 0;
    return { key: a.key, label: lookLabel(kind, a.key), mean, cvr: mean * LOOK_CVR_SCALE, pulls: a.pulls };
  }).sort((x, y) => y.mean - x.mean || y.pulls - x.pulls || x.key.localeCompare(y.key));
}

/** The design bandits of `company.bandits`, by niche, most measured first. */
export function designBandits(bandits: Record<string, BanditArm[]> | undefined): NicheLooks[] {
  const byNiche = new Map<string, NicheLooks>();
  for (const [key, arms] of Object.entries(bandits ?? {})) {
    const [dim = '', nicheId = ''] = key.split(':');
    const kind = lookKindOfDim(dim);
    if (!kind || !nicheId || !Array.isArray(arms) || !arms.length) continue;
    let n = byNiche.get(nicheId);
    if (!n) byNiche.set(nicheId, n = { nicheId, kinds: {}, days: 0 });
    n.kinds[kind] = armReads(kind, arms);
    n.days = Math.max(n.days, arms.reduce((s, a) => s + a.pulls, 0));
  }
  return [...byNiche.values()].sort((a, b) => b.days - a.days || a.nicheId.localeCompare(b.nicheId));
}

/** The arm the bandit believes in most. One no guide wore yet stands on the research's convention alone: `measured` says which. */
export function favouriteOf(arms: readonly ArmRead[] | undefined): { arm: ArmRead; measured: boolean } | null {
  const arm = arms?.[0];
  return arm ? { arm, measured: arm.pulls > 0 } : null;
}

/** The market's true multiplier of each arm (god mode only, D201), and its best arm. */
export function truthOf(taste: VisualTaste | undefined, kind: LookKind): { values: Record<string, number>; best: string | null } | null {
  const values = taste ? (kind === 'style' ? taste.style : kind === 'template' ? taste.page : taste.hero) as Record<string, number> | undefined : undefined;
  if (!values) return null;
  const best = Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { values, best };
}

// ───────────────────────────── the feed ─────────────────────────────

const LAYOUT_LABEL: Record<string, string> = { split: 'Affiche', centered: 'Affiche', badge: 'Affiche', minimal: 'Épurée' };
const MOTIF_LABEL: Record<string, string> = {
  moon: 'lune', sun: 'soleil', leaf: 'feuille', coin: 'pièce', heart: 'cœur', bolt: 'éclair', book: 'livre', chart: 'graphique', home: 'maison', paw: 'patte',
  dumbbell: 'haltère', sparkle: 'étincelle', brush: 'pinceau', pot: 'pot',
};
const CUE_KIND: Record<string, LookKind> = { style: 'style', gabarit: 'template', template: 'template', visuel: 'hero', héros: 'hero', hero: 'hero' };

/** Any look's label for a bare key (« aura », « proof »), null for anything else. */
function anyLabel(key: string): string | null {
  for (const kind of LOOK_KINDS) if (INFO[kind][key]) return INFO[kind][key]!.label;
  return null;
}

/**
 * A line of the feed with its design ids put in words: a layout, a motif, a palette's hex code, a bandit key, a style or a template
 * named by its id. Only where an id can stand: after its cue word or alone between guillemets, never a word of the sentence (« il aura »).
 */
export function readableLine(text: string): string {
  if (!text) return text;
  return text
    .replace(/,?\s*palette #[0-9a-fA-F]{3,8}\b/g, '')
    .replace(/\bcouverture (split|centered|badge|minimal)\b/g, (_, k: string) => `couverture « ${LAYOUT_LABEL[k]} »`)
    .replace(/\bmotif (moon|sun|leaf|coin|heart|bolt|book|chart|home|paw|dumbbell|sparkle|brush|pot)\b/g, (_, k: string) => `motif ${MOTIF_LABEL[k]}`)
    .replace(/\b(cover_style|page_template|page_hero)(?::[\w-]+)?/g, (_, d: string) => LOOK_TITLE[KIND_OF_DIM[d]!].toLowerCase())
    .replace(/«\s*([a-z]+)\s*»/g, (m, k: string) => { const label = anyLabel(k); return label ? `« ${label} »` : m; })
    .replace(/\b(style|gabarit|template|visuel|héros|hero) ([a-z]+)\b/g, (m, cue: string, k: string) => {
      const label = INFO[CUE_KIND[cue]!][k]?.label;
      return label ? `${cue === 'template' ? 'gabarit' : cue === 'hero' ? 'visuel' : cue} « ${label} »` : m;
    });
}
