/**
 * The ads, drawn in the guide's own art language (design plan D206, D208). One SVG per scene: the style's art plate, the
 * real cover in the first seconds, the real pages where a scene points at the guide, bold captions with the key word lit,
 * every text inside the platform's safe zones, and the labels the law asks for. `renderAdCut` re-lays the same scenes out
 * for the feeds; a single image wears one of four looks the research supports, picked from the hook, never at random.
 * Plain SVG of paths: no font to install, no canvas, no ffmpeg, the same bytes on every machine.
 */
import { SAFE_ZONES, STYLE_INFO, type AdCreative, type AdRatio, type AdScene, type DesignSpec, type HookStyle, type InkSet, type Product, type Review } from '../shared.js';
import { compositionOf, drawPlate, styleOf } from './art/styles/index.js';
import { bestOn, capHeight } from './art/styles/common.js';
import { drawShape, motifShape } from './art/shapes.js';
import { contrast, ensureContrast, luminance, mix, rgba } from './color.js';
import { COVER_H, COVER_W, coverScene, type CoverMeta } from './cover.js';
import { normalizeDesign } from './design.js';
import { advance, faceOf, fitDisplay, isStdFont, loadVoice, sanitizeFor, wrapFace, type FaceName } from './fonts.js';
import type { PagePlan } from './layout/paginate.js';
import { layoutPdf } from './pdf.js';
import { circleD, Scene, toSvg, type Op } from './scene.js';
import { escapeHtml as h, escapeXml as x, hashString, slugify, stripEmoji } from './text.js';
import { reviewQuote, roleOf, type SceneRole } from './videoCut.js';
import type { Voice } from './voices.js';

// ───────────────────────────── frames and their safe zones ─────────────────────────────

const W = 360;
const H = 640;

type Ratio = Exclude<AdRatio, 'text'>;
type Channel = 'tiktok' | 'meta' | 'pinterest';
interface Zone { x0: number; x1: number; y0: number; y1: number }
interface Box { x: number; y: number; w: number; h: number }

/** A frame: its size, where text may sit (`zones`), the column safe at every height (`safe`), its unit (`u`, 1 on the master). */
export interface AdFrame { ratio: Ratio; w: number; h: number; zones: Zone[]; safe: Box; u: number; channel: Channel }

/** In pixels of 1080 × 1920. TikTok's in-feed layer, Reels' (in shares of the height) and Shorts' where they are tighter. */
const TIKTOK = { top: 240, bottom: 660, side: 120, rail: 180, railFrom: 840 } as const;
const REELS = { top: 0.14, bottom: 0.35 } as const;

/** The 9:16 master, 360 × 640: zone A above the right rail, zone B beside it. */
export function masterFrame(): AdFrame {
  const k = W / 1080;
  const top = Math.max(TIKTOK.top, REELS.top * 1920, SAFE_ZONES.shorts.insets.top) * k;
  const bottom = (1920 - Math.max(TIKTOK.bottom, REELS.bottom * 1920, SAFE_ZONES.shorts.insets.bottom)) * k;
  const side = TIKTOK.side * k;
  const rail = TIKTOK.railFrom * k;
  const railX = (1080 - Math.max(TIKTOK.rail, SAFE_ZONES.shorts.insets.right)) * k;
  return {
    ratio: '9:16', w: W, h: H, u: 1, channel: 'tiktok',
    zones: [{ x0: side, x1: W - side, y0: top, y1: rail }, { x0: side, x1: railX, y0: rail, y1: bottom }],
    safe: { x: side, y: top, w: railX - side, h: bottom - top },
  };
}

/** Feed sizes. Pinterest's pin is its own 1000 × 1500. */
const CUTS: Record<Exclude<Ratio, '9:16'>, { zone: { w: number; h: number; insets: { top: number; right: number; bottom: number; left: number } }; w: number; channel: Channel }> = {
  '4:5': { zone: SAFE_ZONES.meta_feed, w: 432, channel: 'meta' },
  '1:1': { zone: SAFE_ZONES.square, w: 540, channel: 'meta' },
  '2:3': { zone: SAFE_ZONES.pinterest, w: 1000, channel: 'pinterest' },
};

export function cutFrame(ratio: Ratio): AdFrame {
  if (ratio === '9:16') return masterFrame();
  const { zone: { w, h, insets }, w: fw, channel } = CUTS[ratio];
  const k = fw / w;
  const z = { x0: insets.left * k, x1: (w - insets.right) * k, y0: insets.top * k, y1: (h - insets.bottom) * k };
  return { ratio, w: fw, h: Math.round(h * k), zones: [z], safe: { x: z.x0, y: z.y0, w: z.x1 - z.x0, h: z.y1 - z.y0 }, u: fw / W, channel };
}

/** A box is safe when each of its heights sits in a zone wide enough for it. */
export function insideZones(f: Pick<AdFrame, 'zones'>, b: Box, eps = 0.6): boolean {
  let at = b.y;
  const bottom = b.y + b.h;
  for (const z of [...f.zones].sort((p, q) => p.y0 - q.y0)) {
    if (z.y1 <= at || z.y0 > at + eps) continue;
    if (b.x < z.x0 - eps || b.x + b.w > z.x1 + eps) return false;
    at = z.y1;
    if (at >= bottom - eps) return true;
  }
  return false;
}

/** The widest text box that stays safe from `top` to `bottom`. */
function bandAt(f: AdFrame, top: number, bottom: number): Box {
  const zs = f.zones.filter((z) => z.y1 > top && z.y0 < bottom);
  const x0 = Math.max(...zs.map((z) => z.x0));
  const x1 = Math.min(...zs.map((z) => z.x1));
  return { x: x0, y: top, w: x1 - x0, h: bottom - top };
}

const wide = (f: AdFrame): boolean => f.w / f.h > 0.9;

// ───────────────────────────── labels and words ─────────────────────────────

export const FORMAT_LABEL: Record<AdCreative['format'], string> = {
  faceless_voiceover: 'Voix off sans visage',
  text_slideshow: 'Diaporama texte',
  ugc_avatar: 'Narrateur animé',
  carousel: 'Carrousel',
  static_image: 'Image fixe',
  search_text: 'Annonce Search',
};

const HOOK_LABEL: Record<HookStyle, string> = {
  question: 'Question', contrarian: 'À contre-courant', story: 'Histoire', stat: 'Chiffre choc', pov: 'POV',
  mistake: 'Erreur à éviter', before_after: 'Avant / après', listicle: 'Liste',
};

/** The mentions of D208: the ad says it is one, an illustrated narrator says it is drawn, a synthetic voice says it is one. */
export const AD_LABEL = 'Publicité';
export const DRAWN_LABEL = 'Personnage illustré';
export const VOICE_LABEL = 'Voix de synthèse';
const CHANNEL_NAME: Record<Channel, string> = { tiktok: 'TikTok', meta: 'Facebook & Instagram', pinterest: 'Pinterest' };

/** « lien en bio » is TikTok's: a feed has its button under the image, a pin opens the page itself. */
const LINK_LINE: Record<Channel, string> = { tiktok: 'lien en bio', meta: 'lien sous la publication', pinterest: 'lien sur l’épingle' };

function forChannel(text: string, ch: Channel): string {
  if (ch === 'tiktok') return text;
  return text.replace(/(?:\(\s*)?(?:le\s+)?lien\s+(?:est\s+)?(?:en|dans\s+(?:la|ma))\s+bio(?:\s*\))?/giu, LINK_LINE[ch]);
}

/** « Télécharge le guide (lien en bio) » → « Télécharge le guide »; « Swipe jusqu’au bout et… » says nothing on the last card. */
function buttonLabel(cta: string): string {
  const said = stripEmoji(cta || 'Télécharge le guide').replace(/\s*\([^)]*\)\s*$/, '').replace(/^swipe\b.*?\bet\s+/i, '').trim();
  return said ? said.charAt(0).toLocaleUpperCase('fr-FR') + said.slice(1) : 'Télécharge le guide';
}

const clean = (s: string | null | undefined): string => stripEmoji(s ?? '').replace(/\s+/g, ' ').trim();

/** On screen: the scene's text, or the buyer's own words when the voice reads a review. */
function screenOf(s: AdScene | undefined): string {
  const quote = s ? reviewQuote(s.voiceover ?? '') : null;
  return quote ? `« ${clean(quote)} »` : clean(s?.onScreenText);
}

function durationOf(s: AdScene): number {
  const d = Number(s?.durationSec);
  return Number.isFinite(d) && d > 0 ? Math.min(15, Math.max(1, d)) : 3;
}

/** Words a sentence does not lean on: the light goes to another one. */
const FLAT = /^(?:avec|dans|pour|sans|sous|tout|tous|toute|toutes|cette|vous|votre|notre|elle|elles|mais|donc|alors|comme|plus|très|bien|être|avoir|fait|faire|quand|parce|depuis|encore|même|c’est|qu’il|qu’on|après|avant|guide|enfin|toujours|jamais|chaque|leurs?|entre|vers|chez|voilà|celle|celui|ceux|cela|ça|aussi)$/iu;

/** The word that carries the light: a figure first (with its unit), else the longest word the sentence leans on. */
export function keyWords(words: readonly string[]): number[] {
  const bare = (w: string): string => w.replace(/[^\p{L}\p{N}’']/gu, '');
  const digit = words.findIndex((w) => /\d/.test(w));
  if (digit >= 0) return /^\p{L}{2,}/u.test(bare(words[digit + 1] ?? '')) && !FLAT.test(bare(words[digit + 1] ?? '')) ? [digit, digit + 1] : [digit];
  let best = -1;
  words.forEach((w, i) => {
    const b = bare(w);
    if (b.length >= 5 && !FLAT.test(b) && (best < 0 || b.length > bare(words[best]!).length)) best = i;
  });
  return best < 0 ? [] : [best];
}

// ───────────────────────────── faces ─────────────────────────────

const CAPTION: FaceName = 'montserrat-latin-800-normal';
const SEMI: FaceName = 'montserrat-latin-600-normal';
const UI: FaceName = 'inter-700-normal';
const UI_TEXT: FaceName = 'inter-500-normal';
const STD: Record<string, FaceName> = { [CAPTION]: 'Helvetica-Bold', [SEMI]: 'Helvetica-Bold', [UI]: 'Helvetica-Bold', [UI_TEXT]: 'Helvetica' };

/** A face that does not load gives way to its standard one: a frame is never lost for a missing file. */
function faceSafe(face: FaceName): FaceName {
  if (isStdFont(face)) return face;
  try {
    faceOf(face);
    return face;
  } catch {
    return STD[face] ?? (/(?:700|800|900|bold)/i.test(face) ? 'Helvetica-Bold' : 'Helvetica');
  }
}

// ───────────────────────────── the ad's materials ─────────────────────────────

interface Skin {
  paper: string; ink: string;
  pop: string; popInk: string;         // the button
  marker: string;                      // behind a key word, under dark text
  light: string;                       // a key word on a dark ground
  star: string;
}

interface Cover { art: Prepared; w: number; h: number; sticker: { u: number; v: number } }

interface GuidePage { scene: Scene; kind: PagePlan['kind']; chapter: number | null; label: string | null }
interface Guide { pages: GuidePage[]; total: number; chapters: number; sheets: number; bonus: string | null }

interface Kit {
  creative: AdCreative; product: Product; d: DesignSpec; inks: InkSet; v: Voice; brand: string; handle: string;
  scenes: AdScene[]; skin: Skin; cover: Cover | null; guide: Guide | null; seed: number; display: FaceName; italic: FaceName;
  caption: FaceName; ui: FaceName; uiText: FaceName; semi: FaceName;
}

/** How much colour a hex holds, 0..255. */
function chroma(c: string): number {
  const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return Math.max(...v) - Math.min(...v);
}

const loudest = (pool: readonly string[]): string | undefined => [...pool].sort((a, b) => chroma(b) - chroma(a))[0];

function skinOf(d: DesignSpec): Skin {
  const inks = d.inks!;
  const p = d.palette;
  const pool = [inks.b, inks.a, p.accent, inks.c, p.primary];
  // white reads on the button as the ink stands: a yellow darkened until it does comes out olive
  const pop = loudest(pool.filter((c) => contrast(c, '#ffffff') >= 3.1)) ?? ensureContrast(inks.b, '#ffffff', 3.1);
  const marker = loudest([inks.c, inks.b, p.accent, mix(inks.b, '#ffffff', 0.35), mix(inks.a, '#ffffff', 0.55)]
    .filter((c) => contrast(c, '#111111') >= 6 && contrast(c, '#ffffff') >= 1.18)) ?? '#ffe14d';
  const light = loudest([inks.c, p.accent, inks.b, mix(inks.c, '#ffffff', 0.3)].filter((c) => contrast(c, inks.ink) >= 4.5)) ?? '#ffe14d';
  return { paper: inks.paper, ink: inks.ink, pop, popInk: '#ffffff', marker, light, star: '#f6b400' };
}

const LRU = 6;
const covers = new Map<string, Cover | null>();
const guides = new Map<string, Guide | null>();

function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  if (cache.has(key)) {
    const v = cache.get(key)!;
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const v = make();
  cache.set(key, v);
  if (cache.size > LRU) cache.delete(cache.keys().next().value!);
  return v;
}

/**
 * Corners a sticker may take on any cover, the usual first: high right on the art, low right, then the left ones, then on
 * the book's corner itself, half off the cover, as a sticker on a printed book often sits.
 */
const STICKER_SPOTS: readonly { u: number; v: number }[] = [
  { u: 0.82, v: 0.2 }, { u: 0.82, v: 0.86 }, { u: 0.8, v: 0.5 }, { u: 0.18, v: 0.2 }, { u: 0.18, v: 0.86 }, { u: 0.97, v: 0.95 }, { u: 0.97, v: 0.05 },
];

/**
 * Where a sticker lands on a cover, in shares of it: the spot its style reports (D200), as long as the sticker stays off the
 * title and its deck; else the first corner that does. `reach`: the sticker's radius, in the cover's units.
 */
export function coverSticker(meta: Pick<CoverMeta, 'sticker' | 'lines'>, reach = 160): { u: number; v: number } {
  const title = meta.lines.filter((l) => l.size >= 20);
  const clear = (p: { u: number; v: number }): boolean => title.every((l) => {
    const left = l.anchor === 'end' ? l.x - l.width : l.x;
    const [x, y] = [p.u * COVER_W, p.v * COVER_H];
    return !(x + reach > left && x - reach < left + l.width && y + reach > l.y - l.size && y - reach < l.y + l.size * 0.3);
  });
  const own = meta.sticker;
  return own && clear(own) ? own : STICKER_SPOTS.find(clear) ?? own ?? STICKER_SPOTS[0]!;
}

/** The guide's own cover, as the shop shows it: drawn once per ad, its small print as bars (it never reads at this size). */
function coverOf(product: Product, d: DesignSpec, brand: string): Cover | null {
  const input = { title: product?.title ?? '', subtitle: product?.content?.subtitle || product?.subtitle || '', audience: product?.audience ?? '', design: d, brand };
  return remember(covers, String(hashString(JSON.stringify(input))), () => {
    try {
      const { scene, meta } = coverScene(input);
      return { art: prepare(scene, { precision: 1, greek: 11 }), w: scene.w, h: scene.h, sticker: coverSticker(meta) };
    } catch {
      return null;
    }
  });
}

/** Every page of the guide as the PDF prints it, laid out once per version: the same layout, the same effort. */
function guideOf(product: Product, d: DesignSpec, brand: string): Guide | null {
  const content = product?.content;
  if (!content?.chapters?.length) return null;
  const effort = product.visual?.effort;
  const key = String(hashString(JSON.stringify([product.title, product.audience, product.subtitle, content, d, brand, effort ?? null])));
  return remember(guides, key, () => {
    try {
      const laid = layoutPdf({ product: { ...product, design: d }, content, design: d, brand, ...(effort ? { effort } : {}) });
      const pages = laid.pages.map((p, k) => ({ scene: p.scene, kind: laid.plans[k]?.kind ?? 'text', chapter: laid.plans[k]?.chapter ?? null, label: p.preview }));
      return {
        pages,
        total: product.pdfFacts?.pages ?? pages.length,
        chapters: content.chapters.length,
        sheets: product.pdfFacts?.sheets ?? pages.filter((p) => p.kind === 'sheet').length,
        bonus: clean(content.bonus?.title).replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '') || null,
      };
    } catch {
      return null;
    }
  });
}

function kitOf(input: { creative: AdCreative; product: Product; design: DesignSpec; brand: string }): Kit {
  const creative = input.creative;
  const brand = clean(input.brand) || 'Pixel Agency';
  const d = normalizeDesign(input.design ?? input.product?.design);
  const { voice } = loadVoice(d.voice!);
  return {
    creative, product: input.product, d, inks: d.inks!, v: voice, brand,
    handle: `@${slugify(brand, 24).replace(/-/g, '.')}`,
    scenes: (creative?.scenes ?? []).filter(Boolean),
    skin: skinOf(d),
    cover: coverOf(input.product, d, brand),
    guide: guideOf(input.product, d, brand),
    seed: d.artSeed ?? d.seed,
    display: faceSafe(voice.display), italic: faceSafe(voice.displayIt),
    caption: faceSafe(CAPTION), semi: faceSafe(SEMI), ui: faceSafe(UI), uiText: faceSafe(UI_TEXT),
  };
}

// ───────────────────────────── SVG pieces ─────────────────────────────

const r2 = (v: number): string => String(Math.round(v * 100) / 100);

/** What a stand-alone SVG holds, to nest it in a frame. */
function innerOf(svg: string): string {
  return svg.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

type TextOp = Extract<Op, { k: 'text' }>;

const leftOf = (o: TextOp): number => {
  if (!o.anchor || o.anchor === 'start') return o.x;
  const w = advance(o.font, o.s, o.size, o.track ?? 0);
  return o.anchor === 'middle' ? o.x - w / 2 : o.x - w;
};

/**
 * Letters drawn once and placed where the text needs them: a frame pays for its « e » once, not forty times. The same
 * shaping as the PDF (fontkit, kerning, ligatures); a line keeps its words in `aria-label`. Ids name the face and the glyph,
 * so two frames inlined in one page share them without a clash.
 */
class Glyphs {
  private defs = new Map<string, string>();

  private idOf(face: FaceName, glyph: { id: number; path: { commands: { command: string; args: number[] }[] } }): string {
    const id = `g${(hashString(face) % 46656).toString(36)}_${glyph.id.toString(36)}`;
    if (this.defs.has(id)) return id;
    let d = '';
    for (const c of glyph.path.commands) {
      d += ({ moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' } as Record<string, string>)[c.command] ?? '';
      for (let j = 0; j < c.args.length; j += 2) d += `${j ? ' ' : ''}${Math.round(c.args[j]!)} ${Math.round(-c.args[j + 1]!)}`;
    }
    this.defs.set(id, d ? `<path id="${id}" d="${d}"/>` : '');
    return id;
  }

  /** One line of text at its place, `dx, dy` of the group it sits in added. Under `greek`, a bar of its width. */
  line(o: TextOp, dx = 0, dy = 0, greek = 0): string {
    const x0 = leftOf(o) + dx;
    const y = o.y + dy;
    const op = o.op !== undefined ? ` opacity="${o.op}"` : '';
    if (o.size < greek) {
      const w = advance(o.font, o.s, o.size, o.track ?? 0);
      const bar = o.size * 0.5;
      return `<path d="M${r2(x0)} ${r2(y - bar)}h${r2(w)}v${r2(bar)}h${r2(-w)}Z" fill="${o.fill}" opacity="0.35"/>`;
    }
    if (isStdFont(o.font)) {
      const family = o.font.startsWith('Times') ? 'Times, serif' : 'Helvetica, Arial, sans-serif';
      return `<text aria-label="${x(o.s)}" x="${r2(x0)}" y="${r2(y)}" font-family="${family}" font-size="${r2(o.size)}"${/Bold/.test(o.font) ? ' font-weight="bold"' : ''}${/Italic|Oblique/.test(o.font) ? ' font-style="italic"' : ''} fill="${o.fill}"${op}>${x(o.s)}</text>`;
    }
    const { font, unitsPerEm } = faceOf(o.font);
    const run = font.layout(o.s);
    const k = o.size / unitsPerEm;
    const track = (o.track ?? 0) / k;
    let pen = 0;
    let uses = '';
    run.glyphs.forEach((g, i) => {
      const at = run.positions[i]!;
      const id = this.idOf(o.font, g as unknown as { id: number; path: { commands: { command: string; args: number[] }[] } });
      if (this.defs.get(id)) uses += `<use href="#${id}" x="${Math.round(pen + at.xOffset)}"${at.yOffset ? ` y="${Math.round(-at.yOffset)}"` : ''}/>`;
      pen += at.xAdvance + track;
    });
    return `<g aria-label="${x(o.s)}" fill="${o.fill}"${op} transform="matrix(${Number(k.toPrecision(5))} 0 0 ${Number(k.toPrecision(5))} ${r2(x0)} ${r2(y)})">${uses}</g>`;
  }

  svg(): string {
    return [...this.defs.values()].join('');
  }
}

/** A drawing ready to place: its shapes already SVG, its lines waiting for the frame's glyph sheet. */
type Prepared = readonly (string | { op: TextOp; dx: number; dy: number; greek: number })[];

/**
 * A scene cut for the glyph sheet, in its own order: shapes through `toSvg`, lines kept as text. A clip keeps its text as
 * `toSvg` draws it; a group passes its offset on. `greek`: text under this size becomes bars of its real width.
 */
function prepare(sc: Scene, o: { precision?: 1 | 2; greek?: number } = {}): Prepared {
  const out: (string | { op: TextOp; dx: number; dy: number; greek: number })[] = [];
  const greek = o.greek ?? 0;
  const shapes = (ops: Op[]): string => {
    const tmp = new Scene(sc.w, sc.h);
    tmp.ops = ops;
    return innerOf(toSvg(tmp, { precision: o.precision ?? 1, greekBelow: greek }));
  };
  const walk = (ops: readonly Op[], dx: number, dy: number): void => {
    let run: Op[] = [];
    const flush = (): void => {
      if (!run.length) return;
      out.push(dx || dy ? `<g transform="translate(${r2(dx)} ${r2(dy)})">${shapes(run)}</g>` : shapes(run));
      run = [];
    };
    for (const op of ops) {
      if (op.k === 'text') { flush(); out.push({ op, dx, dy, greek }); continue; }
      if (op.k === 'group' && textOps(op.ops).length) { flush(); walk(op.ops, dx + op.x, dy + op.y); continue; }
      run.push(op);
    }
    flush();
  };
  walk(sc.ops, 0, 0);
  return out;
}

const emit = (p: Prepared, G: Glyphs): string => p.map((c) => (typeof c === 'string' ? c : G.line(c.op, c.dx, c.dy, c.greek))).join('');

/** Text ops of a page in reading order, wherever they sit. */
function textOps(ops: readonly Op[], out: TextOp[] = []): TextOp[] {
  for (const o of ops) {
    if (o.k === 'text') out.push(o);
    else if (o.k === 'group' || o.k === 'clip') textOps(o.ops, out);
  }
  return out;
}

/** `inner` drawn in its own `w0 × h0` units, its top-left on (x, y) at scale k, turned `rot` degrees round its centre. */
function placed(inner: string, w0: number, h0: number, x0: number, y0: number, k: number, rot = 0): string {
  const cx = x0 + (w0 * k) / 2;
  const cy = y0 + (h0 * k) / 2;
  return `<g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(rot)}) translate(${r2((-w0 * k) / 2)} ${r2((-h0 * k) / 2)}) scale(${(Math.round(k * 10000) / 10000)})">${inner}</g>`;
}

/** A soft shadow without a filter: three rounded shapes, each wider and fainter. In the piece's own units. */
function shadowOf(w: number, h: number, r: number, dx: number, dy: number, alpha = 0.22): string {
  return [0, 1, 2].map((k) => {
    const g = k * Math.max(w, h) * 0.018;
    return `<rect x="${r2(dx - g)}" y="${r2(dy - g)}" width="${r2(w + 2 * g)}" height="${r2(h + 2 * g)}" rx="${r2(r + g)}" fill="#000" opacity="${r2(alpha * [0.55, 0.3, 0.15][k]!)}"/>`;
  }).join('');
}

/** The printed guide: its cover over a block of pages, a spine in shade, a sheen. Centre (cx, cy), `w` wide. */
function bookSvg(L: Layers, k: Kit, cx: number, cy: number, w: number, rot = 0, o: { shadow?: number } = {}): string {
  const c = k.cover;
  if (!c) return '';
  const s = w / c.w;
  const edge = mix(k.inks.paper, '#000000', 0.18);
  const body = shadowOf(c.w, c.h, 14, 16, 26, o.shadow ?? 0.3)
    + `<rect x="9" y="7" width="${c.w}" height="${c.h}" rx="10" fill="${edge}"/><rect x="5" y="3.5" width="${c.w}" height="${c.h}" rx="10" fill="#fbf8f2"/>`
    + `<g clip-path="url(#bkclip)">${emit(c.art, L.G)}<rect width="34" height="${c.h}" fill="url(#bkspine)"/><rect width="${c.w}" height="${c.h}" fill="url(#bkgloss)"/></g>`;
  return placed(body, c.w, c.h, cx - w / 2, cy - (c.h * s) / 2, s, rot);
}

/** The defs the book needs, in the book's own units: once per frame. */
const BOOK_DEFS = '<clipPath id="bkclip"><rect width="600" height="848" rx="10"/></clipPath>'
  + '<linearGradient id="bkspine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.3"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
  + '<linearGradient id="bkgloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0.25" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff" stop-opacity="0.2"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient>';

/** A real page on the desk: white paper, its shadow, turned. */
function sheetSvg(L: Layers, page: Prepared, pw: number, ph: number, cx: number, cy: number, w: number, rot = 0, shadow = 0.22): string {
  const s = w / pw;
  const id = `pg${(hashString(`${pw}x${ph}`) % 1e6).toString(36)}`;
  const body = shadowOf(pw, ph, 6, 8, 14, shadow) + `<clipPath id="${id}"><rect width="${r2(pw)}" height="${r2(ph)}" rx="4"/></clipPath><rect width="${r2(pw)}" height="${r2(ph)}" rx="4" fill="#ffffff"/><g clip-path="url(#${id})">${emit(page, L.G)}</g>`;
  return placed(body, pw, ph, cx - w / 2, cy - (ph * s) / 2, s, rot);
}

/** Layers in order: SVG strings as they are, scenes of shapes and lines through the frame's glyph sheet. */
class Layers {
  private parts: (string | Scene)[] = [];
  constructor(readonly f: AdFrame, readonly G: Glyphs = new Glyphs(), readonly ledger: TextBox[] | null = null) {}
  svg(s: string): void { if (s) this.parts.push(s); }
  /** The scene to draw shapes and text into, above everything so far. */
  get s(): Scene {
    const last = this.parts[this.parts.length - 1];
    if (last instanceof Scene) return last;
    const sc = new Scene(this.f.w, this.f.h);
    this.parts.push(sc);
    return sc;
  }
  body(): string {
    return this.parts.map((p) => {
      if (typeof p === 'string') return p;
      if (this.ledger) for (const { o, dx, dy } of placedText(p.ops)) this.ledger.push(textBox(o, dx, dy));
      return emit(prepare(p, { precision: 2 }), this.G);
    }).join('');
  }
}

/** A line of the ad's own text and the box its ink takes: what a test reads to prove the safe zones. Pictures hold none. */
export interface TextBox extends Box { text: string }

const textBox = (o: TextOp, dx: number, dy: number): TextBox => ({
  text: o.s, x: leftOf(o) + dx, y: o.y + dy - o.size * 0.92, w: advance(o.font, o.s, o.size, o.track ?? 0), h: o.size * 1.16,
});

/** The style's own art in a box (D200): the plate a film stands on, clipped to the box. */
function plate(L: Layers, k: Kit, box: Box, o: { seed: number; cols?: number; hero?: { c: number; r: number; s: number } | null }): void {
  const cols = o.cols ?? 4;
  const u = box.w / cols;
  const rows = Math.max(1, Math.ceil(box.h / u));
  const sc = new Scene(L.f.w, L.f.h);
  drawPlate(k.d, sc, { x: box.x, y: box.y, u, cols, rows, inks: k.inks, motif: k.d.motif, seed: o.seed, hero: o.hero === undefined ? { c: Math.max(0, cols - 3), r: Math.max(0, rows - 3), s: Math.min(3, cols) } : o.hero, role: 'film' });
  const id = `pl${(hashString(`${box.x}|${box.y}|${box.w}|${box.h}`) % 1e6).toString(36)}`;
  L.svg(`<clipPath id="${id}"><rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.w)}" height="${r2(box.h)}"/></clipPath><g clip-path="url(#${id})">${innerOf(toSvg(sc, { precision: 1 }))}</g>`);
}

/** A flat ground and a veil, to keep the art without fighting the words. */
function veil(L: Layers, box: Box, color: string, alpha: number): void {
  L.s.rect(box.x, box.y, box.w, box.h, color, { op: alpha });
}

// ───────────────────────────── text ─────────────────────────────

interface Fitted { size: number; lines: string[]; face: FaceName }

/** The biggest size that fits `width × height` on at most `lines` lines; a long text keeps shrinking, never cut. */
function fitText(text: string, face: FaceName, width: number, height: number, o: { max: number; min: number; lines: number; leading: number }): Fitted {
  const t = sanitizeFor(face, text);
  for (let min = o.min; min >= 5; min = Math.floor(min * 0.8)) {
    const fit = fitDisplay(t, face, { width, max: Math.max(min, o.max), min, maxLines: Math.max(o.lines, min < o.min ? 12 : o.lines), maxHeight: height, leading: o.leading });
    const widest = Math.max(0, ...fit.lines.map((l) => advance(face, l, fit.size)));
    if (widest <= width + 0.5 && fit.lines.length * fit.size * o.leading <= height + 0.5) return { ...fit, face };
  }
  const size = 5;
  return { size, lines: wrapFace(t, face, size, width), face };
}

const capOf = (face: FaceName): number => {
  try { return capHeight(face); } catch { return 0.7; }
};

interface TextStyle {
  face: FaceName; max: number; min: number; lines: number; leading?: number;
  align?: 'left' | 'center'; valign?: 'top' | 'middle' | 'bottom';
  ink: string; hot?: string | null;          // a key word in another ink (on a dark or colour ground)
  marker?: string | null;                     // or on a band of colour
  box?: { fill: string; ink: string; op?: number } | null; // TikTok's text with a background
  track?: number;
}

/** Sets `text` in `area`: TikTok's boxed lines or plain type, the key word lit. Returns the box the ink takes. */
function setText(s: Scene, text: string, area: Box, st: TextStyle): Box {
  const t = clean(text);
  if (!t) return { x: area.x, y: area.y, w: 0, h: 0 };
  const leading = st.leading ?? (st.box ? 1.18 : 1.08);
  const padX = st.box ? 0.4 : 0;
  const fit = fitText(t, st.face, area.w - 2 * padX * st.max, area.h, { max: st.max, min: st.min, lines: st.lines, leading });
  const { size, lines, face } = fit;
  const pad = padX * size;
  const cap = capOf(face);
  const lineH = size * leading;
  const blockH = lines.length * lineH;
  const top = st.valign === 'bottom' ? area.y + area.h - blockH : st.valign === 'middle' ? area.y + (area.h - blockH) / 2 : area.y;
  const words = lines.join(' ').split(' ');
  const lit = new Set(st.hot || st.marker ? keyWords(words) : []);
  let wi = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  lines.forEach((line, row) => {
    const width = advance(face, line, size, st.track ?? 0);
    const x0 = st.align === 'left' ? area.x + pad : area.x + (area.w - width) / 2;
    const base = top + row * lineH + (lineH + cap * size) / 2 - size * 0.02;
    minX = Math.min(minX, x0 - pad);
    maxX = Math.max(maxX, x0 + width + pad);
    if (st.box) {
      const bh = lineH + 0.6;
      s.path(roundRect(x0 - pad, top + row * lineH - 0.3, width + 2 * pad, bh, Math.min(size * 0.3, bh / 2)), st.box.fill, st.box.op === undefined ? {} : { op: st.box.op });
    }
    const ws = line.split(' ');
    let cx = x0;
    const runs: { text: string; x: number; hot: boolean }[] = [];
    ws.forEach((w, j) => {
      const hot = lit.has(wi + j);
      const last = runs[runs.length - 1];
      if (last && last.hot === hot) last.text += ` ${w}`;
      else runs.push({ text: w, x: cx, hot });
      cx += advance(face, `${w} `, size, st.track ?? 0) + (st.track ?? 0);
    });
    wi += ws.length;
    const ink = st.box ? st.box.ink : st.ink;
    if (st.marker && runs.some((r) => r.hot)) {
      for (const r of runs.filter((q) => q.hot)) {
        const rw = advance(face, r.text, size, st.track ?? 0);
        s.path(roundRect(r.x - size * 0.12, base - cap * size - size * 0.16, rw + size * 0.24, cap * size + size * 0.34, size * 0.14), st.marker);
      }
      s.text(line, x0, base, face, size, ink, st.track ? { track: st.track } : {});
    } else if (st.hot && runs.some((r) => r.hot)) {
      for (const r of runs) s.text(r.text, r.x, base, face, size, r.hot ? st.hot : ink, st.track ? { track: st.track } : {});
    } else {
      s.text(line, x0, base, face, size, ink, st.track ? { track: st.track } : {});
    }
  });
  return { x: minX, y: top, w: maxX - minX, h: blockH };
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  const c = q * 0.4477;
  const P = (v: number): string => r2(v);
  return `M${P(x + q)} ${P(y)}H${P(x + w - q)}C${P(x + w - c)} ${P(y)} ${P(x + w)} ${P(y + c)} ${P(x + w)} ${P(y + q)}V${P(y + h - q)}C${P(x + w)} ${P(y + h - c)} ${P(x + w - c)} ${P(y + h)} ${P(x + w - q)} ${P(y + h)}H${P(x + q)}C${P(x + c)} ${P(y + h)} ${P(x)} ${P(y + h - c)} ${P(x)} ${P(y + h - q)}V${P(y + q)}C${P(x)} ${P(y + c)} ${P(x + c)} ${P(y)} ${P(x + q)} ${P(y)}Z`;
}

/** A pill of small type: the mentions, a chip. Returns its width. */
function pill(s: Scene, text: string, x: number, y: number, o: { face: FaceName; size: number; fill: string; ink: string; op?: number; track?: number; anchor?: 'start' | 'end' }): number {
  const t = sanitizeFor(o.face, text);
  const tw = advance(o.face, t, o.size, o.track ?? 0);
  const ph = o.size * 1.9;
  const pw = tw + o.size * 1.5;
  const x0 = o.anchor === 'end' ? x - pw : x;
  s.path(roundRect(x0, y, pw, ph, ph / 2), o.fill, o.op === undefined ? {} : { op: o.op });
  s.text(t, x0 + o.size * 0.75, y + ph / 2 + capOf(o.face) * o.size / 2, o.face, o.size, o.ink, o.track ? { track: o.track } : {});
  return pw;
}

/** The mentions every frame carries, top left of the safe zone. Returns the bottom of their row. */
function mentions(L: Layers, k: Kit, tags: readonly string[], dark: boolean): number {
  const f = L.f;
  const size = 7.6 * f.u;
  let x0 = f.safe.x;
  let y = f.safe.y;
  const rowH = size * 1.9;
  const fill = dark ? '#ffffff' : '#111111';
  const ink = dark ? '#111111' : '#ffffff';
  for (const tag of tags) {
    const pw = advance(k.ui, sanitizeFor(k.ui, tag), size) + size * 1.5;
    if (x0 > f.safe.x && x0 + pw > f.safe.x + f.safe.w) { x0 = f.safe.x; y += rowH + 3 * f.u; }
    pill(L.s, tag, x0, y, { face: k.ui, size, fill, ink, op: 0.82 });
    x0 += pw + 4 * f.u;
  }
  return y + rowH;
}

function tagsOf(k: Kit, scene: AdScene | undefined): string[] {
  const format = k.creative.format;
  const voiced = (format === 'faceless_voiceover' || format === 'ugc_avatar') && clean(scene?.voiceover).length > 0;
  return [AD_LABEL, ...(format === 'ugc_avatar' ? [DRAWN_LABEL] : []), ...(voiced ? [VOICE_LABEL] : [])];
}

/** A clean bar of the ad's scenes, at the top edge of the safe zone. */
function progress(L: Layers, i: number, count: number, dark: boolean): void {
  const f = L.f;
  if (count < 2) return;
  const z = f.zones[0]!;
  const gap = 3 * f.u;
  const seg = (z.x1 - z.x0 - gap * (count - 1)) / count;
  const y = f.safe.y - 7 * f.u;
  const ink = dark ? '#ffffff' : '#111111';
  for (let j = 0; j < count; j++) L.s.path(roundRect(z.x0 + j * (seg + gap), y, seg, 2.6 * f.u, 1.3 * f.u), ink, { op: j <= i ? 0.92 : 0.3 });
}

/** A carousel's dots, at the foot of the safe zone. */
function dots(L: Layers, k: Kit, i: number, count: number, dark: boolean): void {
  const f = L.f;
  if (count < 2) return;
  const gap = 9.5 * f.u;
  const cx = f.safe.x + f.safe.w / 2;
  const y = f.safe.y + f.safe.h - 5 * f.u;
  const x0 = cx - (gap * (count - 1)) / 2;
  for (let j = 0; j < count; j++) {
    const on = j === i;
    L.s.path(circleD(x0 + j * gap, y, (on ? 3.3 : 2.4) * f.u), on ? (dark ? k.skin.light : k.skin.pop) : dark ? '#ffffff' : '#111111', on ? {} : { op: 0.35 });
  }
}

/** The button of the last frame. Returns its box. */
function button(L: Layers, k: Kit, label: string, cx: number, y: number, maxW: number): Box {
  const f = L.f;
  const t = sanitizeFor(k.caption, label);
  let size = 13 * f.u;
  while (size > 8 * f.u && advance(k.caption, t, size) + size * 3.4 > maxW) size -= 0.5 * f.u;
  const bw = Math.min(maxW, advance(k.caption, t, size) + size * 3.4);
  const bh = size * 2.7;
  const x0 = cx - bw / 2;
  const s = L.s;
  s.path(roundRect(x0, y + 2.5 * f.u, bw, bh, bh / 2), '#000000', { op: 0.25 });
  s.path(roundRect(x0, y, bw, bh, bh / 2), k.skin.pop);
  s.text(t, x0 + size * 1.2, y + bh / 2 + (capOf(k.caption) * size) / 2, k.caption, size, k.skin.popInk);
  // the arrow that says where to go: down to the platform's own link
  const ax = x0 + bw - size * 1.25;
  const ay = y + bh / 2;
  const a = size * 0.42;
  s.path(`M${r2(ax - a * 0.1)} ${r2(ay - a)}V${r2(ay + a * 0.8)}M${r2(ax - a * 0.8)} ${r2(ay + a * 0.1)}L${r2(ax - a * 0.1)} ${r2(ay + a * 0.85)}L${r2(ax + a * 0.6)} ${r2(ay + a * 0.1)}`, undefined, { stroke: k.skin.popInk, sw: size * 0.17, cap: 'round' });
  return { x: x0, y, w: bw, h: bh };
}

/** A round sticker, its edge cut in points: a price, a gift. */
function burst(s: Scene, cx: number, cy: number, r: number, fill: string, lines: { text: string; face: FaceName; size: number; ink: string }[], rot = -10): void {
  const pts: string[] = [];
  const a0 = (rot * Math.PI) / 180;
  for (let i = 0; i < 28; i++) {
    const rr = i % 2 ? r * 0.88 : r;
    const a = a0 + (i / 28) * Math.PI * 2;
    pts.push(`${i ? 'L' : 'M'}${r2(cx + Math.cos(a) * rr)} ${r2(cy + Math.sin(a) * rr)}`);
  }
  s.path(`${pts.join('')}Z`, '#000000', { op: 0.18 });
  s.path(`${pts.map((p) => p.replace(/(-?[\d.]+) (-?[\d.]+)/, (_m, px: string, py: string) => `${r2(Number(px) - r * 0.04)} ${r2(Number(py) - r * 0.07)}`)).join('')}Z`, fill);
  const total = lines.reduce((sum, l) => sum + l.size * 1.05, 0);
  let y = cy - r * 0.07 - total / 2;
  for (const l of lines) {
    y += l.size * 1.05;
    s.text(sanitizeFor(l.face, l.text), cx - r * 0.04, y - l.size * 0.2, l.face, l.size, l.ink, { anchor: 'middle' });
  }
}

/** Five stars, the share of the last one filled as the rating says. */
function stars(s: Scene, x: number, y: number, size: number, rating: number, fill: string, empty: string): number {
  const pts = (cx: number, cy: number, r: number): string => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.46 : r;
      d += `${i ? 'L' : 'M'}${r2(cx + Math.cos(a) * rr)} ${r2(cy + Math.sin(a) * rr)}`;
    }
    return `${d}Z`;
  };
  const gap = size * 1.18;
  for (let i = 0; i < 5; i++) {
    const cx = x + size / 2 + i * gap;
    const share = Math.max(0, Math.min(1, rating - i));
    s.path(pts(cx, y, size / 2), empty);
    if (share >= 0.99) s.path(pts(cx, y, size / 2), fill);
    else if (share > 0.01) s.clip(`M${r2(cx - size / 2)} ${r2(y - size / 2)}h${r2(size * share)}v${r2(size)}h${r2(-size * share)}Z`, (c) => c.path(pts(cx, y, size / 2), fill));
  }
  return 5 * gap;
}

// ───────────────────────────── real pages ─────────────────────────────

const foldText = (s: string): string => s.normalize('NFKC').replace(/[’ʼ‘]/g, '\'').toLowerCase().replace(/[\s  ]+/g, '');

/** The words of a line the marker covers: indices in its string, and the offset of the group the line sits in. */
interface Span { from: number; to: number; dx: number; dy: number }
interface Hit { page: GuidePage; ops: Map<TextOp, Span>; at: { size: number } }

/** Text ops with the offset of the groups they sit in. */
function placedText(ops: readonly Op[], dx = 0, dy = 0, out: { o: TextOp; dx: number; dy: number }[] = []): { o: TextOp; dx: number; dy: number }[] {
  for (const o of ops) {
    if (o.k === 'text') out.push({ o, dx, dy });
    else if (o.k === 'group') placedText(o.ops, dx + o.x, dy + o.y, out);
    else if (o.k === 'clip') placedText(o.ops, dx, dy, out);
  }
  return out;
}

/** Where the guide prints `needle`: the fullest page that holds it, never an opener when another page does. */
function findLine(g: Guide, needle: string): Hit | null {
  const words = clean(needle).replace(/^\s*\d+\s*[.)]\s*/, '').replace(/[.…!?]+$/, '').split(' ');
  for (let take = words.length; take >= Math.min(words.length, 3); take--) {
    const wanted = foldText(words.slice(0, take).join(' '));
    if (wanted.length < 10) break;
    let best: Hit | null = null;
    let bestScore = -Infinity;
    for (const page of g.pages) {
      if (page.kind === 'toc') continue;
      const ops = placedText(page.scene.ops).filter((p) => p.o.size < 16);
      let chars = '';
      const owner: { o: TextOp; dx: number; dy: number }[] = [];
      const index: number[] = [];
      for (const p of ops) {
        let j = 0;
        for (const ch of p.o.s) {
          for (const c of foldText(ch)) { chars += c; owner.push(p); index.push(j); }
          j += ch.length;
        }
      }
      const from = chars.indexOf(wanted);
      if (from < 0) continue;
      const score = chars.length - (page.kind === 'opener' ? 1e5 : 0);
      if (score <= bestScore) continue;
      const hit = new Map<TextOp, Span>();
      for (let c = from; c < from + wanted.length; c++) {
        const { o, dx, dy } = owner[c]!;
        const span = hit.get(o);
        const end = index[c]! + 1;
        if (span) span.to = Math.max(span.to, end);
        else hit.set(o, { from: index[c]!, to: end, dx, dy });
      }
      bestScore = score;
      best = { page, ops: hit, at: { size: owner[from]!.o.size } };
    }
    if (best) return best;
  }
  return null;
}

/** Where a span of a line starts and ends, in the page's units. */
function spanX(o: TextOp, span: Span): [number, number] {
  const x0 = leftOf(o);
  const track = o.track ?? 0;
  return [x0 + (span.from ? advance(o.font, o.s.slice(0, span.from), o.size, track) + track : 0), x0 + advance(o.font, o.s.slice(0, span.to), o.size, track)];
}

/**
 * A page as a picture: small text as bars of its real width, as the shop's previews show it, except the lines the ad points
 * at, which stay words on a marker. A marker is drawn under its line, over the page.
 */
function pageInner(p: GuidePage, marked: ReadonlyMap<TextOp, Span> = new Map(), marker = '#ffe14d'): Prepared {
  if (!marked.size) {
    const known = plain.get(p.scene);
    if (known) return known;
  }
  return pageOps(p, marked, marker, 11, !marked.size);
}

/** A page seen small, in a fan or a grid: every line a bar, the page's drawings kept. */
function thumbInner(p: GuidePage): Prepared {
  return thumbs.get(p.scene) ?? pageOps(p, new Map(), HIGHLIGHTER, 40, false, true);
}

function pageOps(p: GuidePage, marked: ReadonlyMap<TextOp, Span>, marker: string, keepFrom: number, keep: boolean, thumb = false): Prepared {
  const greek = (ops: readonly Op[]): Op[] => ops.flatMap((o): Op[] => {
    if (o.k === 'group' || o.k === 'clip') return [{ ...o, ops: greek(o.ops) }];
    if (o.k !== 'text') return [o];
    const span = marked.get(o);
    if (span) {
      const [x0, x1] = spanX(o, span);
      return [{ k: 'path', d: roundRect(x0 - o.size * 0.18, o.y - o.size * 0.86, x1 - x0 + o.size * 0.36, o.size * 1.16, o.size * 0.16), fill: marker }, o];
    }
    if (o.size >= keepFrom) return [o];
    const w = advance(o.font, o.s, o.size, o.track ?? 0);
    const bar = o.size * (thumb ? 0.62 : 0.5);
    return [{ k: 'path', d: `M${r2(leftOf(o))} ${r2(o.y - bar)}h${r2(w)}v${r2(bar)}h${r2(-w)}Z`, fill: o.fill, op: thumb && o.size >= 11 ? 0.85 : 0.35 }];
  });
  const sc = new Scene(p.scene.w, p.scene.h);
  sc.ops = greek(p.scene.ops);
  const out = prepare(sc, { precision: 1 });
  if (keep) plain.set(p.scene, out);
  if (thumb) thumbs.set(p.scene, out);
  return out;
}

/** Pages as the shop's previews show them, drawn once per layout: the scene object is the key, a new layout a new key. */
const plain = new WeakMap<Scene, Prepared>();
const thumbs = new WeakMap<Scene, Prepared>();

/** Pages to fan out or to lay in a grid: one of each kind the shop shows, the art-heavy opener last. */
function showcase(g: Guide, count: number): GuidePage[] {
  const order: PagePlan['kind'][] = ['sheet', 'text', 'figure', 'memo', 'opener'];
  const picked: GuidePage[] = [];
  for (const kind of order) {
    const page = g.pages.find((p) => p.kind === kind && p.label) ?? g.pages.find((p) => p.kind === kind);
    if (page && !picked.includes(page)) picked.push(page);
  }
  for (const p of g.pages) if (picked.length < count && p.kind === 'text' && !picked.includes(p)) picked.push(p);
  return picked.slice(0, count);
}

/**
 * The words a scene points at on the page: what it says on screen when the page prints it (the marker then covers the
 * words the viewer reads), else the line the film's editor marks, else the guide's first step.
 */
function needlesOf(k: Kit, i: number): string[] {
  const said = clean(k.scenes[i]?.onScreenText).replace(/^\s*\d+\s*[.)]\s*/, '');
  const beat = k.creative.cut?.beats?.find((b) => b.scene === i && b.proof?.needle);
  const first = clean(k.product?.content?.chapters?.[0]?.steps?.[0]);
  return [said.length >= 12 ? said : '', beat?.proof?.needle ?? '', first].filter(Boolean);
}

function hitOf(k: Kit, i: number): Hit | null {
  if (!k.guide) return null;
  for (const needle of needlesOf(k, i)) {
    const hit = findLine(k.guide, needle);
    if (hit) return hit;
  }
  return null;
}

// ───────────────────────────── reviews ─────────────────────────────

const RISKY = /(?<![\p{L}])garanti(?:e|es|s)?(?![\p{L}])|100[\s  ]*%|à coup sûr|sans effort|miracle|gu[ée]ri|soign|du jour au lendemain|devenir riche|argent facile/iu;

/** What a review says of the shop rather than of the guide: a link, an e-mail, a refund. It sells nothing the guide holds. */
const ABOUT_THE_SHOP = /\b(?:lien|liens|r[ée]ponse|r[ée]pondu|livraison|t[ée]l[ée]charg\w*|mails?|e-mails?|rembours\w*|support|service client|commande|paiement|bug)\b/iu;

/**
 * A buyer's good review the shop shows, about the guide itself, short enough for an image, free of any claim the platform
 * refuses. Never one made up: no review, no review card. The fullest of the best marks, then the most recent.
 */
export function quotableReview(p: Product | null | undefined): Review | null {
  const pool = (p?.stats?.reviews ?? []).slice(-30).filter((r) => r && r.rating >= 4 && clean(r.text).length >= 16 && clean(r.text).length <= 120
    && !RISKY.test(r.text) && !ABOUT_THE_SHOP.test(r.text));
  const fit = (r: Review): number => Math.abs(clean(r.text).length - 72);
  return [...pool].sort((a, b) => b.rating - a.rating || fit(a) - fit(b) || b.day - a.day || a.id.localeCompare(b.id))[0] ?? null;
}

const rating1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const reviewCount = (p: Product): number => p.stats?.ratingCount ?? p.stats?.reviews?.length ?? 0;
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
const VERIFIED = 'Acheteur vérifié · avis laissé après sa commande';

// ───────────────────────────── the scenes ─────────────────────────────

interface FrameOpts { progress: boolean; ledger?: TextBox[] }

const dark = (c: string): boolean => luminance(c) < 0.3;

/** The ground of a frame: the plate over the whole frame, veiled where the words go. */
function artGround(L: Layers, k: Kit, i: number, veilAlpha = 0, veilInk = '#000000'): void {
  const f = L.f;
  plate(L, k, { x: 0, y: 0, w: f.w, h: f.h }, { seed: k.seed + i * 101 });
  if (veilAlpha > 0) veil(L, { x: 0, y: 0, w: f.w, h: f.h }, veilInk, veilAlpha);
}

/** Captions of the voiced formats: TikTok's white boxes, black type, the key word on a marker. */
const boxed = (k: Kit, u: number, max = 21): TextStyle => ({ face: k.caption, max: max * u, min: 10 * u, lines: 5, ink: '#111111', marker: k.skin.marker, box: { fill: '#ffffff', ink: '#111111' } });

/** The hook: the guide's art, the words up top, the real cover under them from the first frame. */
function hookFrame(L: Layers, k: Kit, i: number): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, i, 0.12);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 8 * f.u;
  if (wide(f)) {
    setText(L.s, screenOf(k.scenes[i]), { x: S.x, y: top, w: S.w * 0.56, h: S.y + S.h - top }, { ...boxed(k, f.u, 24), valign: 'middle', align: 'left' });
    L.svg(bookSvg(L, k, S.x + S.w * 0.8, f.h * 0.54, S.w * 0.36, 5));
    return 'L’accroche en grand à gauche, la couverture du guide à droite';
  }
  const area = bandAt(f, top, top + S.h * 0.46);
  const text = setText(L.s, screenOf(k.scenes[i]), area, { ...boxed(k, f.u, 23), valign: 'top' });
  const room = S.y + S.h - (text.y + text.h);
  const bw = Math.min(S.w * 0.62, Math.max(S.w * 0.44, (room + (f.h - S.y - S.h) * 0.55) / 1.45));
  L.svg(bookSvg(L, k, S.x + S.w * 0.5 + 6 * f.u, text.y + text.h + 12 * f.u + (bw * 1.413) / 2, bw, 4));
  return 'L’accroche en gros en haut, la couverture du guide dessous';
}

/** The words people use, in a speech bubble on the guide's paper, its art in a band at the foot. */
function painFrame(L: Layers, k: Kit, i: number): string {
  const f = L.f;
  const S = f.safe;
  L.s.rect(0, 0, f.w, f.h, k.inks.paper);
  plate(L, k, { x: 0, y: f.h * 0.72, w: f.w, h: f.h * 0.28 }, { seed: k.seed + i * 101, hero: null });
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), false) + 12 * f.u;
  const said = screenOf(k.scenes[i]);
  const quote = /^\s*«/.test(said);
  const beat = k.creative.cut?.beats?.find((b) => b.scene === i);
  const echoes = (beat?.items ?? []).map(clean).filter((t) => t && !said.includes(t)).slice(0, 2);
  const s = L.s;
  const area = bandAt(f, top, S.y + S.h);
  const label = quote ? 'On l’entend tout le temps' : 'Ça vous parle ?';
  const pad = 18 * f.u;
  // the echoes take what they need under the bubble; the bubble takes the rest, as big as its words go
  const echoSize = 10.5 * f.u;
  const echoLines = echoes.map((e) => wrapFace(sanitizeFor(k.uiText, `« ${e} »`), k.uiText, echoSize, area.w - 54 * f.u).slice(0, 2));
  const echoH = echoLines.reduce((a, l) => a + l.length * echoSize * 1.3 + 22 * f.u, 0);
  const room = area.h - 22 * f.u - echoH - 2 * pad - 18 * f.u;
  const set = fitText(said, k.italic, area.w - 2 * pad, room, { max: 30 * f.u, min: 12 * f.u, lines: 6, leading: 1.12 });
  const bh = set.lines.length * set.size * 1.12 + 2 * pad;
  const block = 22 * f.u + bh + 18 * f.u + echoH;
  const y0 = area.y + Math.max(0, (area.h - block) * 0.38);
  s.text(sanitizeFor(k.ui, label.toLocaleUpperCase('fr-FR')), area.x + 2 * f.u, y0 + 8 * f.u, k.ui, 8.4 * f.u, ensureContrast(k.inks.a, k.inks.paper, 4.5), { track: 1.4 * f.u });
  const bubbleTop = y0 + 22 * f.u;
  s.path(roundRect(area.x + 2 * f.u, bubbleTop + 4 * f.u, area.w, bh, 22 * f.u), '#000000', { op: 0.12 });
  s.path(roundRect(area.x, bubbleTop, area.w, bh, 22 * f.u), '#ffffff');
  s.path(`M${r2(area.x + 30 * f.u)} ${r2(bubbleTop + bh - 1)}l${r2(-6 * f.u)} ${r2(18 * f.u)}l${r2(26 * f.u)} ${r2(-18 * f.u)}Z`, '#ffffff');
  setText(s, said, { x: area.x + pad, y: bubbleTop + pad, w: area.w - 2 * pad, h: bh - 2 * pad }, { face: k.italic, max: set.size, min: set.size, lines: 6, leading: 1.12, ink: k.inks.ink, hot: ensureContrast(k.skin.pop, '#ffffff', 4.5), align: 'left', valign: 'middle' });
  let y = bubbleTop + bh + 22 * f.u;
  echoLines.forEach((lines, j) => {
    const eh = lines.length * echoSize * 1.3 + 14 * f.u;
    const ex = area.x + (j % 2 ? 26 : 10) * f.u;
    s.path(roundRect(ex, y, area.w - 36 * f.u, eh, 13 * f.u), '#ffffff', { op: 0.88 });
    lines.forEach((l, m) => s.text(l, ex + 12 * f.u, y + 7 * f.u + echoSize * 0.95 + m * echoSize * 1.3, k.uiText, echoSize, mix(k.inks.ink, '#ffffff', 0.2)));
    y += eh + 8 * f.u;
  });
  if (!echoes.length && k.cover && !wide(f)) L.svg(bookSvg(L, k, S.x + S.w * 0.78, Math.min(f.h * 0.78, y + 70 * f.u), S.w * 0.3, 8, { shadow: 0.22 }));
  return echoes.length ? 'Les mots des clients dans une bulle, d’autres phrases vraies dessous' : 'La phrase des clients dans une bulle, sur le papier du guide';
}

/** Captions over paper: black boxes, white type, the key word in the guide's light ink. */
const boxedDark = (k: Kit, u: number, max = 20): TextStyle => ({ face: k.caption, max: max * u, min: 10 * u, lines: 5, ink: '#ffffff', hot: k.skin.light, box: { fill: '#111111', ink: '#ffffff' } });

/** The highlighter on a page: yellow, as on every desk. */
const HIGHLIGHTER = '#ffe14d';

/** Where the marked lines of a page sit, in its own units. */
function hitBox(hit: Hit): Box {
  const spans = [...hit.ops].map(([o, span]) => ({ o, span, x: spanX(o, span).map((v) => v + span.dx) }));
  const x0 = Math.min(...spans.map((s) => s.x[0]!));
  const x1 = Math.max(...spans.map((s) => s.x[1]!));
  const y0 = Math.min(...spans.map((s) => s.o.y + s.span.dy - s.o.size));
  const y1 = Math.max(...spans.map((s) => s.o.y + s.span.dy + s.o.size * 0.3));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The real page close up, as a phone films it: its marked line big enough to read, the rest of the page bleeding out of
 * the frame. `at`: the height of the frame the line sits on. Returns the line's box in the frame.
 */
function closeUp(L: Layers, k: Kit, hit: Hit, at: number, o: { size?: number; left?: number } = {}): Box {
  const f = L.f;
  const S = f.safe;
  const p = hit.page;
  const box = hitBox(hit);
  const size = (o.size ?? 17) * f.u;
  // the marked words read big, and stay whole in the safe zone as long as they can still be read
  const fitW = (S.w - 8 * f.u) / box.w;
  const s = Math.max((f.w * 1.08) / p.scene.w, Math.min(size / hit.at.size, Math.max(fitW, (13.5 * f.u) / hit.at.size)));
  const fits = box.w * s <= S.w - 8 * f.u;
  const x0 = fits ? (o.left ?? S.x + 6 * f.u) : S.x + (S.w - box.w * s) / 2;
  const y0 = at - (box.h * s) / 2;
  const cx = x0 - box.x * s + (p.scene.w * s) / 2;
  const cy = y0 - box.y * s + (p.scene.h * s) / 2;
  L.s.rect(0, 0, f.w, f.h, mix(k.inks.paper, '#000000', 0.06));
  L.svg(sheetSvg(L, pageInner(p, hit.ops, HIGHLIGHTER), p.scene.w, p.scene.h, cx, cy, p.scene.w * s, -1.2, 0.2));
  return { x: x0, y: y0, w: box.w * s, h: box.h * s };
}

/** The real page the voice talks about, close up, its line under the marker; the step said up top. */
function pageFrame(L: Layers, k: Kit, i: number): string | null {
  const f = L.f;
  const S = f.safe;
  const hit = hitOf(k, i);
  if (!hit) return null;
  closeUp(L, k, hit, S.y + S.h * (wide(f) ? 0.64 : 0.7));
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), false) + 8 * f.u;
  const area = bandAt(f, top, top + S.h * 0.36);
  setText(L.s, screenOf(k.scenes[i]), area, { ...boxedDark(k, f.u, 19), valign: 'top' });
  return 'Vraie page du guide en gros plan, la ligne de l’étape surlignée au marqueur';
}

/** The step when no page holds it: its number huge in the guide's colour, the step under it. */
function stepCard(L: Layers, k: Kit, i: number): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, i, 0);
  const card = { x: S.x - 4 * f.u, y: S.y + 26 * f.u, w: S.w + 8 * f.u, h: S.h - 30 * f.u };
  L.s.path(roundRect(card.x, card.y + 4 * f.u, card.w, card.h, 20 * f.u), '#000000', { op: 0.18 });
  L.s.path(roundRect(card.x, card.y, card.w, card.h, 20 * f.u), k.inks.paper);
  mentions(L, k, tagsOf(k, k.scenes[i]), true);
  const said = screenOf(k.scenes[i]);
  const num = /^\s*(\d+)\s*[.)]/.exec(said)?.[1] ?? '1';
  const rest = said.replace(/^\s*\d+\s*[.)]\s*/, '');
  const numSize = 74 * f.u;
  L.s.text(num, card.x + 18 * f.u, card.y + 18 * f.u + capOf(k.display) * numSize, k.display, numSize, ensureContrast(k.skin.pop, k.inks.paper, 3));
  setText(L.s, rest, { x: card.x + 18 * f.u, y: card.y + 30 * f.u + capOf(k.display) * numSize, w: card.w - 36 * f.u, h: card.h - 48 * f.u - capOf(k.display) * numSize }, { face: k.caption, max: 22 * f.u, min: 10 * f.u, lines: 6, ink: k.inks.ink, marker: k.skin.marker, align: 'left', valign: 'top' });
  return 'Fiche de l’étape : le numéro en très grand, l’étape dessous';
}

/** A buyer's own words: stars, the quote, how the shop checks it, over the guide's art. */
function reviewFrame(L: Layers, k: Kit, i: number, quote: string): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, i, 0.08);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 10 * f.u;
  const s = L.s;
  const card = { x: S.x - 2 * f.u, y: top, w: S.w + 4 * f.u, h: 0 };
  const pad = 16 * f.u;
  const set = fitText(`« ${quote} »`, k.italic, card.w - 2 * pad, S.h * 0.5, { max: 22 * f.u, min: 11 * f.u, lines: 6, leading: 1.14 });
  const review = (k.product?.stats?.reviews ?? []).find((r) => clean(r.basis ?? r.text).includes(quote) || quote.includes(clean(r.basis ?? r.text)));
  const rating = review?.rating ?? null;
  const headH = rating ? 22 * f.u : 0;
  card.h = pad + headH + set.lines.length * set.size * 1.14 + 10 * f.u + 26 * f.u + pad;
  s.path(roundRect(card.x, card.y + 5 * f.u, card.w, card.h, 18 * f.u), '#000000', { op: 0.2 });
  s.path(roundRect(card.x, card.y, card.w, card.h, 18 * f.u), '#ffffff');
  if (rating) stars(s, card.x + pad, card.y + pad + 8 * f.u, 14 * f.u, rating, k.skin.star, '#e6e1d6');
  setText(s, `« ${quote} »`, { x: card.x + pad, y: card.y + pad + headH, w: card.w - 2 * pad, h: set.lines.length * set.size * 1.14 }, { face: k.italic, max: set.size, min: set.size, lines: 8, leading: 1.14, ink: '#1b1b1f', align: 'left' });
  const vy = card.y + card.h - pad - 4 * f.u;
  s.path(circleD(card.x + pad + 5 * f.u, vy - 3.5 * f.u, 5.5 * f.u), '#1f9d63');
  s.path(`M${r2(card.x + pad + 2.4 * f.u)} ${r2(vy - 3.6 * f.u)}l${r2(2 * f.u)} ${r2(2.1 * f.u)}l${r2(3.6 * f.u)} ${r2(-4 * f.u)}`, undefined, { stroke: '#ffffff', sw: 1.5 * f.u, cap: 'round' });
  s.text(sanitizeFor(k.uiText, VERIFIED), card.x + pad + 14 * f.u, vy, k.uiText, 8.4 * f.u, '#4a4a52');
  if (k.cover && !wide(f)) L.svg(bookSvg(L, k, S.x + S.w * 0.74, Math.min(f.h - 60 * f.u, card.y + card.h + 70 * f.u), S.w * 0.36, 6));
  return 'Carte d’avis d’un acheteur : étoiles, ses mots, la mention de vérification';
}

/** A fact of the research, on a card in the guide's colour. */
function factFrame(L: Layers, k: Kit, i: number): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, i, 0);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 10 * f.u;
  const s = L.s;
  const ground = k.inks.ink;
  const card = { x: S.x - 2 * f.u, y: top, w: S.w + 4 * f.u, h: S.y + S.h - top - 6 * f.u };
  s.path(roundRect(card.x, card.y + 5 * f.u, card.w, card.h, 20 * f.u), '#000000', { op: 0.22 });
  s.path(roundRect(card.x, card.y, card.w, card.h, 20 * f.u), ground);
  s.text(sanitizeFor(k.ui, 'REPÈRE'), card.x + 18 * f.u, card.y + 26 * f.u, k.ui, 9 * f.u, k.skin.light, { track: 2 * f.u });
  setText(s, screenOf(k.scenes[i]), { x: card.x + 18 * f.u, y: card.y + 38 * f.u, w: card.w - 36 * f.u, h: card.h - 56 * f.u }, { face: k.display, max: 30 * f.u, min: 12 * f.u, lines: 6, ink: '#ffffff', hot: k.skin.light, align: 'left', valign: 'middle', leading: 1.06 });
  return 'Carte « repère » à la couleur du guide, le chiffre en grand';
}

/** The gift the guide holds: real pages fanned behind the book, the sticker on it. */
function bonusFrame(L: Layers, k: Kit, i: number): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, i, 0.1);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 8 * f.u;
  const area = bandAt(f, top, top + S.h * 0.3);
  const text = setText(L.s, screenOf(k.scenes[i]), area, { ...boxed(k, f.u, 20), valign: 'top' });
  const bw = wide(f) ? S.w * 0.34 : S.w * 0.5;
  const cy = Math.max(text.y + text.h + 30 * f.u + (bw * 1.413) / 2, S.y + S.h * 0.62);
  const cx = S.x + S.w / 2 + 4 * f.u;
  const fan = k.guide ? showcase(k.guide, 3) : [];
  fan.forEach((p, j) => {
    const dir = [-1, 1, 0][j]!;
    L.svg(sheetSvg(L, thumbInner(p), p.scene.w, p.scene.h, cx + dir * bw * 0.52, cy - (dir === 0 ? bw * 0.22 : bw * 0.08), bw * 0.92, dir * 11, 0.22));
  });
  L.svg(bookSvg(L, k, cx, cy + bw * 0.08, bw, -3));
  const c = k.cover;
  if (c) {
    const r = 26 * f.u;
    const bx = Math.min(cx + bw * 0.38, S.x + S.w - r);
    burst(L.s, bx, cy - bw * 0.62, r, k.skin.light, [{ text: 'BONUS', face: k.caption, size: 11 * f.u, ink: '#111111' }, { text: 'OFFERT', face: k.ui, size: 7 * f.u, ink: '#111111' }]);
  }
  return fan.length ? 'Vraies pages du guide en éventail derrière le livre, sticker « bonus offert »' : 'Le livre du guide, sticker « bonus offert »';
}

/** The end: the guide in the light, where to get it, its price of the day on the cover's own sticker spot. */
function endFrame(L: Layers, k: Kit, i: number): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, i, 0.2);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 8 * f.u;
  const said = forChannel(screenOf(k.scenes[i]) || 'Guide PDF — lien en bio', f.channel);
  const label = buttonLabel(k.creative.cta);
  const btnH = 13 * f.u * 2.7;
  const btnY = S.y + S.h - btnH - 4 * f.u;
  if (wide(f)) {
    setText(L.s, said, { x: S.x, y: top, w: S.w * 0.55, h: btnY - top - 10 * f.u }, { ...boxed(k, f.u, 22), align: 'left', valign: 'middle' });
    L.svg(bookSvg(L, k, S.x + S.w * 0.8, f.h * 0.48, S.w * 0.36, 3));
    button(L, k, label, S.x + S.w * 0.28, btnY, S.w * 0.56);
    price(L, k, S.x + S.w * 0.8, f.h * 0.48, S.w * 0.36);
    return 'Couverture du guide, la phrase de fin, le bouton et le prix du jour';
  }
  const area = bandAt(f, top, top + S.h * 0.26);
  const text = setText(L.s, said, area, { ...boxed(k, f.u, 22), valign: 'top' });
  const bw = Math.min(S.w * 0.6, (btnY - (text.y + text.h) - 4 * f.u) / 1.2);
  const cy = text.y + text.h + 8 * f.u + (bw * 1.413) / 2;
  L.svg(bookSvg(L, k, S.x + S.w / 2, cy, bw, -3));
  price(L, k, S.x + S.w / 2, cy, bw, btnY - 4 * f.u);
  button(L, k, label, S.x + S.w / 2, btnY, S.w);
  return 'Couverture du guide en grand, le bouton et la flèche vers le lien, le prix du jour';
}

/** The price of the day, on the spot the cover keeps for a sticker: on its art, never on its title. */
function price(L: Layers, k: Kit, cx: number, cy: number, w: number, floor = Infinity): void {
  const value = Number(k.product?.price);
  const c = k.cover;
  if (!c || !(value > 0)) return;
  const f = L.f;
  const hgt = (w * c.h) / c.w;
  const r = Math.max(19 * f.u, w * 0.17);
  const sx = Math.min(cx - w / 2 + c.sticker.u * w, f.safe.x + f.safe.w - r);
  const sy = Math.min(cy - hgt / 2 + c.sticker.v * hgt, floor - r * 1.05); // never under the button
  const label = Number.isInteger(value) ? `${value} €` : `${value.toFixed(2).replace('.', ',')} €`;
  burst(L.s, sx, sy, r, k.skin.pop, [{ text: label, face: k.caption, size: r * 0.5, ink: k.skin.popInk }], 12);
}

// ───────────────────────────── the narrator ─────────────────────────────

const SKINS = ['#f2d0b8', '#e8b796', '#c68e6a', '#8d5b3e'] as const;
type Pose = 'talk' | 'sigh' | 'point' | 'show';

/**
 * The narrator of `ugc_avatar`: a flat figure cut from the guide's own inks, and it looks like one. Never photoreal, never a
 * claimed customer (D208): the frame says « Personnage illustré ». Drawn in a 200 × 250 box, the head round on (100, 92).
 * `show` raises a hand to the guide held beside the face; `point` points up to the button. The look follows the hook, never a draw.
 */
function narrator(s: Scene, k: Kit, box: Box, pose: Pose, o: { ground?: string } = {}): void {
  const u = box.w / 200;
  const key = hashString(k.creative?.hook ?? 'pub');
  const skin = SKINS[key % SKINS.length]!;
  const shade = mix(skin, '#5a2f1f', 0.24);
  const hair = mix(k.inks.ink, '#1a0f0a', 0.45);
  const shirt = o.ground && contrast(k.inks.a, o.ground) < 1.6 ? k.inks.b : k.inks.a;
  const P = (px: number, py: number): string => `${r2(box.x + px * u)} ${r2(box.y + py * u)}`;
  const C = (px: number, py: number, r: number, fill: string, op?: number): void => { s.path(circleD(box.x + px * u, box.y + py * u, r * u), fill, op === undefined ? {} : { op }); };
  const style = (key >> 3) % 3;
  if (style === 1) s.path(`M${P(52, 122)}C${P(40, 54)} ${P(72, 32)} ${P(100, 32)}C${P(128, 32)} ${P(160, 54)} ${P(148, 122)}C${P(147, 140)} ${P(120, 146)} ${P(100, 140)}C${P(80, 146)} ${P(53, 140)} ${P(52, 122)}Z`, hair); // a bob, behind the face
  // shoulders down past the foot of any window, the collar, the neck, the head, the ears
  s.path(`M${P(8, 340)}L${P(8, 250)}C${P(10, 180)} ${P(46, 160)} ${P(100, 158)}C${P(154, 160)} ${P(190, 180)} ${P(192, 250)}L${P(192, 340)}Z`, shirt);
  s.path(`M${P(76, 162)}Q${P(100, 190)} ${P(124, 162)}Z`, mix(shirt, '#000000', 0.22));
  s.path(roundRect(box.x + 86 * u, box.y + 118 * u, 28 * u, 48 * u, 12 * u), shade);
  C(54, 98, 9.5, skin);
  C(146, 98, 9.5, skin);
  C(100, 92, 46, skin);
  if (style === 0) s.path(`M${P(52, 96)}C${P(44, 40)} ${P(98, 26)} ${P(124, 38)}C${P(150, 44)} ${P(158, 70)} ${P(150, 100)}C${P(140, 74)} ${P(116, 62)} ${P(86, 66)}C${P(70, 68)} ${P(58, 80)} ${P(52, 96)}Z`, hair);
  else if (style === 1) s.path(`M${P(54, 100)}C${P(50, 52)} ${P(80, 40)} ${P(100, 40)}C${P(124, 40)} ${P(152, 52)} ${P(146, 100)}C${P(134, 72)} ${P(118, 62)} ${P(100, 62)}C${P(82, 62)} ${P(66, 72)} ${P(54, 100)}Z`, hair);
  else {
    C(100, 34, 19, hair);
    s.path(`M${P(54, 98)}C${P(52, 52)} ${P(80, 42)} ${P(100, 42)}C${P(122, 42)} ${P(150, 52)} ${P(146, 98)}C${P(136, 72)} ${P(120, 64)} ${P(100, 64)}C${P(80, 64)} ${P(64, 72)} ${P(54, 98)}Z`, hair);
  }
  // the face: brows, eyes, nose, cheeks, mouth
  const ink = '#2a211e';
  const eyeY = 98;
  if (pose === 'sigh') {
    s.path(`M${P(75, eyeY)}q${r2(7 * u)} ${r2(5 * u)} ${r2(14 * u)} 0M${P(111, eyeY)}q${r2(7 * u)} ${r2(5 * u)} ${r2(14 * u)} 0`, undefined, { stroke: ink, sw: 3.2 * u, cap: 'round' });
    s.path(`M${P(74, 84)}l${r2(16 * u)} ${r2(3 * u)}M${P(126, 84)}l${r2(-16 * u)} ${r2(3 * u)}`, undefined, { stroke: hair, sw: 3.2 * u, cap: 'round' });
    s.path(`M${P(90, 124)}q${r2(10 * u)} ${r2(-4 * u)} ${r2(20 * u)} 0`, undefined, { stroke: '#8a3f35', sw: 3.4 * u, cap: 'round' });
  } else {
    C(82, eyeY, 5, ink);
    C(118, eyeY, 5, ink);
    C(83.6, eyeY - 1.8, 1.5, '#ffffff');
    C(119.6, eyeY - 1.8, 1.5, '#ffffff');
    const lift = pose === 'show' || pose === 'point' ? 3 : 0;
    s.path(`M${P(72, 85 - lift)}q${r2(10 * u)} ${r2(-7 * u)} ${r2(20 * u)} 0M${P(108, 85 - lift)}q${r2(10 * u)} ${r2(-7 * u)} ${r2(20 * u)} 0`, undefined, { stroke: hair, sw: 3.2 * u, cap: 'round' });
    s.path(`M${P(87, 117)}q${r2(13 * u)} ${r2(17 * u)} ${r2(26 * u)} 0Z`, '#6b2a25');
    s.path(`M${P(93, 118.5)}q${r2(7 * u)} ${r2(3 * u)} ${r2(14 * u)} 0Z`, '#ffffff');
  }
  s.path(`M${P(100, 102)}q${r2(-4 * u)} ${r2(8 * u)} ${r2(1 * u)} ${r2(9 * u)}`, undefined, { stroke: shade, sw: 2.6 * u, cap: 'round' });
  C(69, 113, 7.5, '#e2766a', 0.25);
  C(131, 113, 7.5, '#e2766a', 0.25);
  if (pose === 'point') {
    s.path(`M${P(158, 250)}C${P(166, 214)} ${P(176, 188)} ${P(182, 164)}`, undefined, { stroke: shirt, sw: 24 * u, cap: 'round' });
    C(183, 156, 11.5, skin);
    s.path(`M${P(186, 148)}L${P(192, 122)}`, undefined, { stroke: skin, sw: 7.5 * u, cap: 'round' });
  }
}

/** The arm that holds the guide up beside the face: from the shoulder up to the book's lower corner. */
function showArm(s: Scene, k: Kit, box: Box, hand: { x: number; y: number }, shirt: string): void {
  const u = box.w / 200;
  const skin = SKINS[hashString(k.creative?.hook ?? 'pub') % SKINS.length]!;
  s.path(`M${r2(box.x + 160 * u)} ${r2(box.y + 196 * u)}C${r2(box.x + 182 * u)} ${r2(box.y + 222 * u)} ${r2(hand.x + 26 * u)} ${r2(hand.y + 40 * u)} ${r2(hand.x)} ${r2(hand.y + 6 * u)}`, undefined, { stroke: shirt, sw: 26 * u, cap: 'round' });
  s.path(`M${r2(hand.x)} ${r2(hand.y + 10 * u)}L${r2(hand.x - 2 * u)} ${r2(hand.y - 4 * u)}`, undefined, { stroke: skin, sw: 22 * u, cap: 'round' });
}

/** The thumb over the front of the book: it is held, not floating. */
function showThumb(s: Scene, k: Kit, box: Box, hand: { x: number; y: number }): void {
  const u = box.w / 200;
  const skin = SKINS[hashString(k.creative?.hook ?? 'pub') % SKINS.length]!;
  s.path(`M${r2(hand.x - 6 * u)} ${r2(hand.y + 4 * u)}L${r2(hand.x + 10 * u)} ${r2(hand.y - 10 * u)}`, undefined, { stroke: mix(skin, '#000000', 0.12), sw: 11 * u, cap: 'round' });
  s.path(`M${r2(hand.x - 6 * u)} ${r2(hand.y + 3 * u)}L${r2(hand.x + 9 * u)} ${r2(hand.y - 11 * u)}`, undefined, { stroke: skin, sw: 9 * u, cap: 'round' });
}

/**
 * A window the narrator talks from: the guide's paper, a shelf of colour, its motif on the wall. The face stays in the safe
 * zone, the shoulders go down to the window's foot. Returns where the held guide stands.
 */
function narratorCard(L: Layers, k: Kit, card: Box, pose: Pose, o: { book?: boolean } = {}): { cx: number; cy: number; w: number } {
  const f = L.f;
  const ground = mix(k.inks.paper, k.inks.c, 0.35);
  const r = Math.min(22 * f.u, card.w * 0.12);
  const d = roundRect(card.x, card.y, card.w, card.h, r);
  L.s.path(roundRect(card.x, card.y + 5 * f.u, card.w, card.h, r), '#000000', { op: 0.2 });
  const room = new Scene(f.w, f.h);
  room.rect(card.x, card.y, card.w, card.h, ground);
  room.rect(card.x, card.y + card.h * 0.66, card.w, card.h * 0.34, mix(ground, k.inks.ink, 0.1));
  drawShape(room, motifShape(k.d.motif), { x: card.x + card.w * (o.book ? 0.06 : 0.64), y: card.y + card.h * 0.06, w: card.w * 0.3, h: card.w * 0.3 }, { body: mix(ground, k.inks.a, 0.22), holes: ground, lines: ground });
  const visible = Math.min(card.h, f.safe.y + f.safe.h - card.y + 40 * f.u);
  const fw = Math.min(card.w * (o.book ? 0.86 : 0.96), (visible / 250) * 200 * 1.3);
  const u = fw / 200;
  const headY = Math.min(card.y + card.h - 60 * u, Math.max(card.y + 66 * u, f.safe.y + f.safe.h * 0.62));
  const fig = { x: card.x + (o.book ? card.w * 0.02 : (card.w - fw) / 2), y: headY - 92 * u, w: fw, h: fw * 1.25 };
  const shirt = contrast(k.inks.a, ground) < 1.6 ? k.inks.b : k.inks.a;
  narrator(room, k, fig, pose, { ground });
  const id = `nc${(hashString(`${card.x}|${card.y}|${card.w}|${card.h}`) % 1e6).toString(36)}`;
  L.svg(`<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${emit(prepare(room, { precision: 2 }), L.G)}`
    + (o.book ? showBook(L, k, card, fig, shirt) : '') + '</g>');
  return heldBook(card, fig);
}

/** Where the held guide stands in a window: beside the face, the way a creator shows what they talk about. */
function heldBook(card: Box, fig: Box): { cx: number; cy: number; w: number } {
  const u = fig.w / 200;
  const w = Math.min(card.w * 0.4, fig.w * 0.5);
  return { cx: Math.min(card.x + card.w - w * 0.56, fig.x + 196 * u), cy: fig.y + 100 * u, w };
}

function showBook(L: Layers, k: Kit, card: Box, fig: Box, shirt: string): string {
  const { cx, cy, w } = heldBook(card, fig);
  const hand = { x: cx - w * 0.34, y: cy + w * 0.6 };
  const arm = new Scene(L.f.w, L.f.h);
  showArm(arm, k, fig, hand, shirt);
  const thumb = new Scene(L.f.w, L.f.h);
  showThumb(thumb, k, fig, hand);
  return emit(prepare(arm, { precision: 2 }), L.G) + bookSvg(L, k, cx, cy, w, 7, { shadow: 0.25 }) + emit(prepare(thumb, { precision: 2 }), L.G);
}

function narratorFrame(L: Layers, k: Kit, i: number, role: SceneRole): string {
  const f = L.f;
  const S = f.safe;
  const said = screenOf(k.scenes[i]);
  const hit = (role === 'step' || role === 'proof') && !reviewQuote(k.scenes[i]?.voiceover ?? '') ? hitOf(k, i) : null;
  if (role === 'end' && !wide(f)) {
    artGround(L, k, i, 0.1);
    const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 8 * f.u;
    const text = setText(L.s, forChannel(said || 'Guide PDF — lien en bio', f.channel), bandAt(f, top, top + S.h * 0.26), { ...boxed(k, f.u, 20), valign: 'top' });
    const cardTop = text.y + text.h + 10 * f.u;
    const card = { x: S.x - 6 * f.u, y: cardTop, w: S.w + 12 * f.u, h: f.h - cardTop + 30 * f.u };
    const held = narratorCard(L, k, card, 'show', { book: true });
    price(L, k, held.cx, held.cy, held.w, S.y + S.h - 13 * f.u * 2.7 - 8 * f.u);
    button(L, k, buttonLabel(k.creative.cta), S.x + S.w / 2, S.y + S.h - 13 * f.u * 2.7 - 4 * f.u, S.w);
    return 'Le narrateur illustré montre le guide et son prix du jour, le bouton vers le lien';
  }
  if (role === 'end') return endFrame(L, k, i);
  if (hit) {
    // a creator's green screen: the real page behind, the narrator in a window in front of it
    const at = S.y + S.h * (wide(f) ? 0.5 : 0.52);
    closeUp(L, k, hit, at, { size: 13.5 });
    const top = mentions(L, k, tagsOf(k, k.scenes[i]), false) + 8 * f.u;
    setText(L.s, said, bandAt(f, top, top + S.h * 0.3), { ...boxedDark(k, f.u, 18), valign: 'top' });
    const pip = { x: S.x, y: S.y + S.h - 118 * f.u, w: 98 * f.u, h: 118 * f.u };
    narratorCard(L, k, pip, 'talk');
    return 'Le narrateur illustré en incrustation devant une vraie page du guide, la ligne surlignée';
  }
  artGround(L, k, i, 0.06);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), true) + 8 * f.u;
  // on a square the words take the left column and the window the right one; on a tall frame the window goes under the words
  const text = wide(f)
    ? setText(L.s, said, { x: S.x, y: top, w: S.w * 0.5, h: S.y + S.h - top }, { ...boxed(k, f.u, 20), align: 'left', valign: 'middle' })
    : setText(L.s, said, bandAt(f, top, top + S.h * 0.34), { ...boxed(k, f.u, 20), valign: 'top' });
  const cardTop = text.y + text.h + 10 * f.u;
  const card = wide(f)
    ? { x: S.x + S.w * 0.54, y: top, w: S.w * 0.46, h: f.h - top + 30 * f.u }
    : { x: S.x - 6 * f.u, y: cardTop, w: S.w + 12 * f.u, h: f.h - cardTop + 30 * f.u };
  const show = role === 'hook' || role === 'bonus';
  narratorCard(L, k, card, role === 'pain' ? 'sigh' : show ? 'show' : 'talk', { book: show });
  if (role === 'bonus') burst(L.s, card.x + card.w - 34 * f.u, card.y + 30 * f.u, 25 * f.u, k.skin.light, [{ text: 'BONUS', face: k.caption, size: 10.5 * f.u, ink: '#111111' }, { text: 'OFFERT', face: k.ui, size: 6.8 * f.u, ink: '#111111' }]);
  return role === 'hook' ? 'Le narrateur illustré montre le guide à côté de son visage, l’accroche au-dessus'
    : role === 'pain' ? 'Le narrateur illustré soupire, la phrase des clients au-dessus'
      : role === 'bonus' ? 'Le narrateur illustré montre le guide, sticker « bonus offert »'
        : 'Le narrateur illustré parle, ses mots en sous-titres au-dessus';
}

// ───────────────────────────── slides and cards ─────────────────────────────

/** Grounds of a slideshow, in turn: the guide's ink, its paper, its main colour. */
function slideGround(k: Kit, i: number): { ground: string; ink: string; hot: string } {
  const g = [k.inks.ink, k.inks.paper, ensureContrast(k.inks.a, '#ffffff', 3)][i % 3]!;
  const ink = bestOn(g, [k.inks.paper, k.inks.ink, '#ffffff', '#111111']);
  const hot = [k.skin.light, k.skin.pop, k.inks.c, k.inks.b].filter((c) => contrast(c, g) >= 3)[0] ?? ink;
  return { ground: g, ink, hot };
}

function slideFrame(L: Layers, k: Kit, i: number, role: SceneRole, card: boolean): string {
  const f = L.f;
  const S = f.safe;
  const { ground, ink, hot } = slideGround(k, i);
  L.s.rect(0, 0, f.w, f.h, ground);
  const band = card ? f.h * 0.2 : f.h * 0.16;
  if (card) plate(L, k, { x: 0, y: 0, w: f.w, h: Math.max(band, S.y - 4 * f.u) }, { seed: k.seed + i * 101, cols: 4, hero: null });
  else plate(L, k, { x: 0, y: f.h - band, w: f.w, h: band }, { seed: k.seed + i * 101, cols: 4, hero: null });
  const onDark = dark(ground);
  const top = mentions(L, k, tagsOf(k, k.scenes[i]), card ? true : onDark) + (card ? Math.max(0, band - S.y) + 10 * f.u : 14 * f.u);
  const said = role === 'end' ? forChannel(screenOf(k.scenes[i]), f.channel) : screenOf(k.scenes[i]);
  const s = L.s;
  // the slideshow's band of art closes the frame under its words; a card keeps the foot for its dots and its arrow
  const bottom = card ? S.y + S.h - 22 * f.u : Math.min(S.y + S.h - 4 * f.u, f.h - band - 10 * f.u);
  const area = { ...bandAt(f, top, bottom) };
  let desc = '';
  if (role === 'hook') {
    if (wide(f)) {
      setText(s, said, { ...area, w: area.w * 0.6 }, { face: k.display, max: 40 * f.u, min: 14 * f.u, lines: 5, ink, hot, align: 'left', valign: 'middle', leading: 1.02 });
      L.svg(bookSvg(L, k, S.x + S.w * 0.82, f.h * 0.52, S.w * 0.34, 6));
    } else {
      const t = setText(s, said, { ...area, h: area.h * 0.52 }, { face: k.display, max: 40 * f.u, min: 14 * f.u, lines: 5, ink, hot, align: 'left', valign: 'top', leading: 1.02 });
      const bw = Math.max(S.w * 0.4, Math.min(S.w * 0.56, (f.h * 0.8 - (t.y + t.h) - 16 * f.u) / 1.413));
      L.svg(bookSvg(L, k, S.x + S.w * 0.6, t.y + t.h + 16 * f.u + (bw * 1.413) / 2, bw, 6));
    }
    desc = card ? 'Carte 1 : l’accroche en très grand, la couverture du guide dessous' : 'Slide 1 : l’accroche en très grand sur la couleur du guide, sa couverture dessous';
  } else if (role === 'pain') {
    const qs = 72 * f.u;
    s.text('«', area.x, area.y + qs * 0.62, k.display, qs, hot);
    setText(s, said.replace(/^\s*«\s*|\s*»\s*$/g, ''), { x: area.x, y: area.y + qs * 0.5, w: area.w, h: area.h - qs * 0.5 }, { face: k.italic, max: 36 * f.u, min: 12 * f.u, lines: 6, ink, align: 'left', valign: 'middle', leading: 1.08 });
    desc = card ? 'Carte 2 : la phrase qu’on lit partout, en grande citation' : 'Slide 2 : la phrase des clients en grande citation';
  } else if (role === 'step') {
    const num = /^\s*(\d+)\s*[.)]/.exec(said)?.[1] ?? '1';
    const ns = 86 * f.u;
    s.text(num, area.x, area.y + capOf(k.display) * ns, k.display, ns, hot);
    const hit = hitOf(k, i);
    const textTop = area.y + capOf(k.display) * ns + 14 * f.u;
    const t = setText(s, said.replace(/^\s*\d+\s*[.)]\s*/, ''), { x: area.x, y: textTop, w: area.w, h: (area.y + area.h - textTop) * (hit && !wide(f) ? 0.5 : 1) }, { face: k.caption, max: 24 * f.u, min: 10 * f.u, lines: 6, ink, hot, align: 'left', valign: 'top' });
    if (hit && !wide(f)) {
      // the page that prints the step, its line under the marker: the slide shows where it comes from
      const p = hit.page;
      const pw = Math.min(area.w * 0.78, (f.h * 0.86 - (t.y + t.h) - 18 * f.u) / 1.414);
      L.svg(sheetSvg(L, pageInner(p, hit.ops, HIGHLIGHTER), p.scene.w, p.scene.h, area.x + area.w * 0.56, t.y + t.h + 18 * f.u + (pw * 1.414) / 2, pw, -3, 0.3));
    }
    desc = hit && !wide(f)
      ? `${card ? 'Carte 3' : 'Slide 3'} : le numéro de l’étape en très grand, la vraie page du guide qui l’imprime, surlignée`
      : `${card ? 'Carte 3' : 'Slide 3'} : le numéro de l’étape en très grand, l’étape dessous`;
  } else if (role === 'proof') {
    const quote = reviewQuote(k.scenes[i]?.voiceover ?? '');
    if (quote) {
      const review = (k.product?.stats?.reviews ?? []).find((r) => clean(r.basis ?? r.text).includes(clean(quote)));
      if (review) stars(s, area.x, area.y + 8 * f.u, 15 * f.u, review.rating, k.skin.star, rgba(ink, 0.25));
      setText(s, `« ${clean(quote)} »`, { x: area.x, y: area.y + 26 * f.u, w: area.w, h: area.h - 52 * f.u }, { face: k.italic, max: 28 * f.u, min: 11 * f.u, lines: 6, ink, align: 'left', valign: 'middle', leading: 1.1 });
      s.text(sanitizeFor(k.uiText, VERIFIED), area.x, area.y + area.h - 8 * f.u, k.uiText, 8.4 * f.u, mix(ink, ground, 0.2));
      desc = card ? 'Carte 4 : l’avis d’un acheteur, ses étoiles et sa vérification' : 'Slide 4 : l’avis d’un acheteur, étoiles et vérification';
    } else {
      s.text(sanitizeFor(k.ui, 'REPÈRE'), area.x, area.y + 10 * f.u, k.ui, 9 * f.u, hot, { track: 2 * f.u });
      setText(s, said, { x: area.x, y: area.y + 22 * f.u, w: area.w, h: area.h - 22 * f.u }, { face: k.display, max: 34 * f.u, min: 12 * f.u, lines: 6, ink, hot, align: 'left', valign: 'middle', leading: 1.04 });
      desc = card ? 'Carte 4 : un repère en une phrase, le chiffre en couleur' : 'Slide 4 : un repère en une ligne, le chiffre en couleur';
    }
  } else if (role === 'bonus') {
    const p = k.guide ? showcase(k.guide, 1)[0] : undefined;
    const t = setText(s, said, { ...area, h: area.h * 0.4 }, { face: k.display, max: 34 * f.u, min: 12 * f.u, lines: 4, ink, hot, align: 'left', valign: 'top', leading: 1.04 });
    if (p) {
      const pw = Math.min(area.w * 0.62, (f.h * 0.82 - (t.y + t.h) - 20 * f.u) / 1.414);
      const pcx = area.x + area.w * 0.58;
      const pcy = t.y + t.h + 20 * f.u + (pw * 1.414) / 2;
      L.svg(sheetSvg(L, pageInner(p), p.scene.w, p.scene.h, pcx, pcy, pw, 4, 0.3));
      burst(L.s, pcx - pw * 0.46, pcy - pw * 0.56, 28 * f.u, k.skin.light, [{ text: 'BONUS', face: k.caption, size: 11.5 * f.u, ink: '#111111' }, { text: 'OFFERT', face: k.ui, size: 7.4 * f.u, ink: '#111111' }]);
    }
    desc = card ? 'Carte 5 : le bonus offert, une vraie page du guide en aperçu' : 'Slide 5 : le bonus offert, une vraie page du guide en aperçu';
  } else {
    const label = buttonLabel(k.creative.cta);
    const btnH = 13 * f.u * 2.7;
    const btnY = area.y + area.h - btnH;
    const tArea = { ...area, h: area.h * 0.3 };
    const t = setText(s, said, tArea, { face: k.display, max: 30 * f.u, min: 12 * f.u, lines: 3, ink, hot, align: 'left', valign: 'top', leading: 1.04 });
    const bw = Math.min(area.w * 0.56, (btnY - (t.y + t.h) - 12 * f.u) / 1.413);
    L.svg(bookSvg(L, k, area.x + area.w / 2, t.y + t.h + 6 * f.u + (bw * 1.413) / 2, bw, -3));
    price(L, k, area.x + area.w / 2, t.y + t.h + 6 * f.u + (bw * 1.413) / 2, bw, btnY - 4 * f.u);
    button(L, k, label, area.x + area.w / 2, btnY, area.w);
    desc = card ? 'Carte finale : la couverture du guide, le prix du jour et le bouton' : 'Slide finale : la couverture du guide, le prix du jour et le bouton';
  }
  return desc;
}

/** A card of a deck: where it stands, and an arrow until the last one. */
function deckMarks(L: Layers, k: Kit, i: number, count: number, ground: string): void {
  const f = L.f;
  const S = f.safe;
  const onDark = dark(ground);
  dots(L, k, i, count, onDark);
  const s = L.s;
  const ink = onDark ? '#ffffff' : '#111111';
  s.text(`${i + 1}/${count}`, S.x + S.w, S.y + 8 * f.u, k.ui, 8.5 * f.u, ink, { anchor: 'end' });
  if (i < count - 1) {
    const ax = S.x + S.w - 4 * f.u;
    const ay = S.y + S.h - 5 * f.u;
    s.path(`M${r2(ax - 16 * f.u)} ${r2(ay)}H${r2(ax)}M${r2(ax - 6 * f.u)} ${r2(ay - 6 * f.u)}L${r2(ax)} ${r2(ay)}L${r2(ax - 6 * f.u)} ${r2(ay + 6 * f.u)}`, undefined, { stroke: ink, sw: 2.2 * f.u, cap: 'round' });
  }
}

// ───────────────────────────── one frame ─────────────────────────────

function svgOf(f: AdFrame, scene: AdScene | undefined, i: number, desc: string, L: Layers): string {
  // the frame is named after what it shows: the buyer's words where the voice reads them, the channel's own way to the link
  const said = forChannel(screenOf(scene), f.channel) || `Scène ${i + 1}`;
  const body = L.body();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}" role="img" aria-label="${x(`Scène ${i + 1} : ${said}`)}">`
    + `<title>${x(said)}</title><desc>${x(desc)}</desc><defs>${BOOK_DEFS}${L.G.svg()}</defs>${body}</svg>`;
}

function frameOf(k: Kit, f: AdFrame, i: number, o: FrameOpts): string {
  const L = new Layers(f, undefined, o.ledger ?? null);
  const count = k.scenes.length;
  const role = roleOf(k.scenes[i]!, i, count);
  const format = k.creative.format;
  let desc: string;
  if (format === 'text_slideshow' || format === 'carousel') {
    desc = slideFrame(L, k, i, role, format === 'carousel');
    if (format === 'carousel') deckMarks(L, k, i, count, slideGround(k, i).ground);
  } else if (format === 'ugc_avatar') {
    desc = narratorFrame(L, k, i, role);
  } else {
    desc = role === 'hook' ? hookFrame(L, k, i)
      : role === 'pain' ? painFrame(L, k, i)
        : role === 'step' ? (pageFrame(L, k, i) ?? stepCard(L, k, i))
          : role === 'bonus' ? bonusFrame(L, k, i)
            : role === 'end' ? endFrame(L, k, i)
              : reviewQuote(k.scenes[i]?.voiceover ?? '') ? reviewFrame(L, k, i, clean(reviewQuote(k.scenes[i]!.voiceover)!))
                : (k.creative.cut?.beats?.some((b) => b.scene === i && b.proof) ? pageFrame(L, k, i) : null) ?? factFrame(L, k, i);
  }
  const svg = svgOf(f, k.scenes[i], i, desc, L);
  return o.progress && format !== 'carousel' && f.ratio === '9:16' ? withProgress(svg, f, i, count) : svg;
}

/** The bar of the ad's scenes over a finished frame: the last layer, nothing of it to shape. */
function withProgress(svg: string, f: AdFrame, i: number, count: number): string {
  const L = new Layers(f);
  progress(L, i, count, true);
  return svg.replace(/<\/svg>$/, `${L.body()}</svg>`);
}

// ───────────────────────────── a single image ─────────────────────────────

export type StaticLook = 'offer' | 'text' | 'review' | 'inside';

/** What each look is, for the founder. */
export const STATIC_LOOK_LABEL: Record<StaticLook, string> = {
  offer: 'L’offre d’abord', text: 'Texte seul', review: 'Carte d’avis', inside: 'Ce qu’il y a dedans',
};

/** The look a hook calls for (research: text-only and offer-first statics lead, then product with text). */
const LOOK_BY_HOOK: Record<HookStyle, StaticLook> = {
  question: 'text', contrarian: 'text', pov: 'text', story: 'review',
  mistake: 'offer', stat: 'offer', before_after: 'inside', listicle: 'inside',
};

/** Picked from the hook, never at random: a review card needs a real review, a look inside needs real pages. */
export function staticLookOf(creative: Pick<AdCreative, 'hookStyle'>, product: Product | null | undefined, hasPages: boolean): StaticLook {
  const wanted = LOOK_BY_HOOK[creative.hookStyle] ?? 'offer';
  if (wanted === 'review' && !quotableReview(product)) return 'text';
  if (wanted === 'inside' && !hasPages) return 'offer';
  return wanted;
}

/** The title's promise, the guide's own words: what follows its colon, else its subtitle. */
function promiseOf(p: Product): string {
  const t = clean(p?.title);
  const m = /^.{12,}?\s(?::|—|–)\s(.+)$/su.exec(t);
  const said = m ? m[1]! : clean(p?.content?.subtitle || p?.subtitle);
  return said ? said.charAt(0).toLocaleUpperCase('fr-FR') + said.slice(1) : '';
}

function ratingLine(p: Product): { rating: number; text: string } | null {
  const n = reviewCount(p);
  const r = Number(p?.stats?.rating);
  return n > 0 && r > 0 ? { rating: r, text: `${rating1(r)}/5 · ${plural(n, 'avis vérifié', 'avis vérifiés')}` } : null;
}

function staticFrame(k: Kit, f: AdFrame, ledger: TextBox[] | null = null): string {
  const L = new Layers(f, undefined, ledger);
  const look = staticLookOf(k.creative, k.product, !!k.guide?.pages.length);
  const hook = clean(k.scenes[0]?.onScreenText) || clean(k.creative.hook);
  const desc = look === 'text' ? staticText(L, k, hook) : look === 'review' ? staticReview(L, k, hook) : look === 'inside' ? staticInside(L, k, hook) : staticOffer(L, k, hook);
  return svgOf(f, k.scenes[0], 0, `${STATIC_LOOK_LABEL[look]} : ${desc}`, L);
}

/** The foot every image shares: the button, and on a pin the facts of the file. */
function staticFoot(L: Layers, k: Kit, bottom: number): number {
  const f = L.f;
  const S = f.safe;
  const label = forChannel(buttonLabel(k.creative.cta), f.channel);
  const bh = 13 * f.u * 2.7;
  const y = bottom - bh;
  button(L, k, label, S.x + S.w / 2, y, wide(f) ? S.w * 0.6 : S.w);
  return y;
}

/** « L’offre d’abord »: the book big, the price of the day on its sticker spot, the rating, the promise, the button. */
function staticOffer(L: Layers, k: Kit, hook: string): string {
  const f = L.f;
  const S = f.safe;
  artGround(L, k, 0, 0.12);
  const top = mentions(L, k, [AD_LABEL], true) + 8 * f.u;
  const footY = staticFoot(L, k, S.y + S.h);
  const p = k.product;
  const rate = ratingLine(p);
  const promise = promiseOf(p);
  const s = L.s;
  if (wide(f)) {
    const colW = S.w * 0.56;
    const t = setText(s, hook, { x: S.x, y: top, w: colW, h: (footY - top) * 0.5 }, { ...boxed(k, f.u, 22), align: 'left', valign: 'top' });
    let y = t.y + t.h + 12 * f.u;
    if (rate) { y += 8 * f.u; stars(s, S.x, y, 12 * f.u, rate.rating, k.skin.star, '#ffffff'); pill(s, rate.text, S.x + 72 * f.u, y - 9 * f.u, { face: k.ui, size: 8 * f.u, fill: '#ffffff', ink: '#111111' }); y += 18 * f.u; }
    if (promise) setText(s, promise, { x: S.x, y, w: colW, h: footY - y - 8 * f.u }, { face: k.caption, max: 12 * f.u, min: 8 * f.u, lines: 3, ink: '#111111', box: { fill: '#ffffff', ink: '#111111', op: 0.92 }, align: 'left', valign: 'top' });
    const bw = S.w * 0.36;
    L.svg(bookSvg(L, k, S.x + S.w * 0.8, f.h * 0.47, bw, 5));
    price(L, k, S.x + S.w * 0.8, f.h * 0.47, bw);
    return 'l’accroche, la note et la promesse à gauche, le guide et son prix du jour à droite, le bouton';
  }
  const pin = f.channel === 'pinterest';
  const t = setText(s, hook, bandAt(f, top, top + S.h * (pin ? 0.2 : 0.26)), { ...boxed(k, f.u, pin ? 26 : 22), valign: 'top' });
  let y = footY - 8 * f.u;
  if (promise) {
    const b = setText(s, promise, { x: S.x, y: y - 40 * f.u, w: S.w, h: 40 * f.u }, { face: k.caption, max: 12 * f.u, min: 8 * f.u, lines: 2, ink: '#111111', box: { fill: '#ffffff', ink: '#111111', op: 0.92 }, valign: 'bottom' });
    y = b.y - 8 * f.u;
  }
  if (rate) {
    const sw = 5 * 12 * f.u * 1.18;
    const tw = advance(k.ui, rate.text, 8.5 * f.u) + 8.5 * f.u * 1.5;
    const x0 = S.x + (S.w - sw - tw - 8 * f.u) / 2;
    s.path(roundRect(x0 - 8 * f.u, y - 20 * f.u, sw + tw + 22 * f.u, 22 * f.u, 11 * f.u), '#ffffff', { op: 0.94 });
    stars(s, x0, y - 9 * f.u, 12 * f.u, rate.rating, k.skin.star, '#e3ded2');
    s.text(sanitizeFor(k.ui, rate.text), x0 + sw + 6 * f.u, y - 9 * f.u + capOf(k.ui) * 4.25 * f.u, k.ui, 8.5 * f.u, '#111111');
    y -= 28 * f.u;
  } else {
    pill(s, 'Nouveau', S.x + S.w / 2 - 24 * f.u, y - 20 * f.u, { face: k.ui, size: 8.5 * f.u, fill: k.skin.light, ink: '#111111' });
    y -= 28 * f.u;
  }
  const room = y - (t.y + t.h) - 10 * f.u;
  const bw = Math.min(S.w * 0.66, room / 1.413);
  const cy = t.y + t.h + 6 * f.u + room / 2;
  L.svg(bookSvg(L, k, S.x + S.w / 2, cy, bw, -4));
  price(L, k, S.x + S.w / 2, cy, bw, y + 6 * f.u);
  return 'l’accroche en haut, le guide en grand et son prix du jour, la note, la promesse, le bouton';
}

/** « Texte seul »: one strong sentence on a note, the way people write to themselves; the guide signs it small. */
function staticText(L: Layers, k: Kit, hook: string): string {
  const f = L.f;
  const S = f.safe;
  const ground = mix(k.inks.paper, k.inks.c, 0.18);
  L.s.rect(0, 0, f.w, f.h, ground);
  plate(L, k, { x: 0, y: f.h * 0.84, w: f.w, h: f.h * 0.16 }, { seed: k.seed + 7, hero: null });
  const top = mentions(L, k, [AD_LABEL], false) + 10 * f.u;
  const footY = staticFoot(L, k, S.y + S.h);
  const s = L.s;
  const note = { x: S.x - 2 * f.u, y: top, w: S.w + 4 * f.u, h: footY - top - 14 * f.u };
  s.path(roundRect(note.x, note.y + 5 * f.u, note.w, note.h, 16 * f.u), '#000000', { op: 0.14 });
  s.path(roundRect(note.x, note.y, note.w, note.h, 16 * f.u), '#fffdf6');
  // the notes app: its bar, its date line, ruled paper
  const bar = 24 * f.u;
  s.text(sanitizeFor(k.ui, '‹ Notes'), note.x + 12 * f.u, note.y + 16 * f.u, k.ui, 9 * f.u, '#d9a21b');
  s.path(`M${r2(note.x)} ${r2(note.y + bar)}H${r2(note.x + note.w)}`, undefined, { stroke: '#ece6d6', sw: 1 * f.u });
  for (let y = note.y + bar + 26 * f.u; y < note.y + note.h - 12 * f.u; y += 22 * f.u) s.path(`M${r2(note.x + 12 * f.u)} ${r2(y)}H${r2(note.x + note.w - 12 * f.u)}`, undefined, { stroke: '#f1ecdf', sw: 0.8 * f.u });
  const coverW = wide(f) ? 70 * f.u : 64 * f.u;
  const textBox = { x: note.x + 16 * f.u, y: note.y + bar + 14 * f.u, w: note.w - 32 * f.u, h: note.h - bar - 30 * f.u - coverW * 0.6 };
  setText(s, hook, textBox, { face: k.caption, max: 30 * f.u, min: 12 * f.u, lines: 7, ink: '#16161a', marker: '#ffe27a', align: 'left', valign: 'top', leading: 1.16 });
  L.svg(bookSvg(L, k, note.x + note.w - coverW * 0.62, note.y + note.h - coverW * 0.72, coverW, 7, { shadow: 0.2 }));
  return 'une phrase forte sur une note de téléphone, la couverture du guide en petit';
}

/** « Carte d’avis »: a real review, its stars, how the shop checks it; the rating of all the others; the guide beside it. */
function staticReview(L: Layers, k: Kit, hook: string): string {
  const f = L.f;
  const S = f.safe;
  const review = quotableReview(k.product)!;
  artGround(L, k, 3, 0.08);
  const top = mentions(L, k, [AD_LABEL], true) + 8 * f.u;
  const footY = staticFoot(L, k, S.y + S.h);
  const s = L.s;
  const t = setText(s, hook, bandAt(f, top, top + S.h * 0.18), { ...boxed(k, f.u, 18), valign: 'top' });
  const card = { x: S.x - 2 * f.u, y: t.y + t.h + 12 * f.u, w: S.w + 4 * f.u, h: 0 };
  const pad = 16 * f.u;
  const quote = `« ${clean(review.text)} »`;
  const room = (footY - card.y) * 0.62;
  const set = fitText(quote, k.italic, card.w - 2 * pad, room, { max: 24 * f.u, min: 11 * f.u, lines: 6, leading: 1.14 });
  card.h = pad + 22 * f.u + set.lines.length * set.size * 1.14 + 36 * f.u + pad;
  s.path(roundRect(card.x, card.y + 5 * f.u, card.w, card.h, 18 * f.u), '#000000', { op: 0.2 });
  s.path(roundRect(card.x, card.y, card.w, card.h, 18 * f.u), '#ffffff');
  stars(s, card.x + pad, card.y + pad + 8 * f.u, 15 * f.u, review.rating, k.skin.star, '#e6e1d6');
  setText(s, quote, { x: card.x + pad, y: card.y + pad + 22 * f.u, w: card.w - 2 * pad, h: set.lines.length * set.size * 1.14 }, { face: k.italic, max: set.size, min: set.size, lines: 8, leading: 1.14, ink: '#1b1b1f', align: 'left' });
  const vy = card.y + card.h - pad - 14 * f.u;
  s.path(circleD(card.x + pad + 5 * f.u, vy - 3.5 * f.u, 5.5 * f.u), '#1f9d63');
  s.path(`M${r2(card.x + pad + 2.4 * f.u)} ${r2(vy - 3.6 * f.u)}l${r2(2 * f.u)} ${r2(2.1 * f.u)}l${r2(3.6 * f.u)} ${r2(-4 * f.u)}`, undefined, { stroke: '#ffffff', sw: 1.5 * f.u, cap: 'round' });
  s.text(sanitizeFor(k.uiText, VERIFIED), card.x + pad + 14 * f.u, vy, k.uiText, 8.2 * f.u, '#4a4a52');
  const rate = ratingLine(k.product);
  if (rate) s.text(sanitizeFor(k.ui, `Note du guide : ${rate.text}`), card.x + pad, vy + 15 * f.u, k.ui, 8.2 * f.u, '#1b1b1f');
  const room2 = footY - (card.y + card.h) - 10 * f.u;
  if (room2 > 60 * f.u) {
    const bw = Math.min(S.w * 0.42, room2 / 1.413);
    L.svg(bookSvg(L, k, S.x + S.w / 2, card.y + card.h + 6 * f.u + room2 / 2, bw, 5));
  }
  return 'l’avis d’un vrai acheteur avec ses étoiles et sa vérification, la note du guide, la couverture';
}

/** « Ce qu’il y a dedans »: a grid of real pages, the counts of the file, the guide. */
function staticInside(L: Layers, k: Kit, hook: string): string {
  const f = L.f;
  const S = f.safe;
  const g = k.guide!;
  L.s.rect(0, 0, f.w, f.h, k.inks.ink);
  plate(L, k, { x: 0, y: 0, w: f.w, h: f.h * 0.12 }, { seed: k.seed + 11, hero: null });
  const top = mentions(L, k, [AD_LABEL], true) + 8 * f.u;
  const footY = staticFoot(L, k, S.y + S.h);
  const s = L.s;
  const t = setText(s, hook, bandAt(f, top, top + S.h * 0.18), { ...boxed(k, f.u, 19), valign: 'top' });
  const counts = [plural(g.total, 'page', 'pages'), plural(g.chapters, 'chapitre', 'chapitres'), ...(g.sheets ? [plural(g.sheets, 'fiche à imprimer', 'fiches à imprimer')] : []), ...(g.bonus ? ['1 bonus'] : [])];
  // the chips, wrapped, under the grid
  const size = 8.6 * f.u;
  const rows: string[][] = [[]];
  let w = 0;
  for (const c of counts) {
    const cw = advance(k.ui, c, size) + size * 1.5 + 5 * f.u;
    if (w + cw > S.w && rows[rows.length - 1]!.length) { rows.push([]); w = 0; }
    rows[rows.length - 1]!.push(c);
    w += cw;
  }
  const chipsH = rows.length * (size * 1.9 + 5 * f.u);
  const gridTop = t.y + t.h + 12 * f.u;
  const gridH = footY - gridTop - chipsH - 16 * f.u;
  const pages = showcase(g, 4);
  const gap = 8 * f.u;
  const cellOf = (c: number): number => Math.min((S.w + 10 * f.u - (c - 1) * gap) / c, (gridH - (Math.ceil(pages.length / c) - 1) * gap) / Math.ceil(pages.length / c) / 1.414);
  const cols = [2, 4].reduce((a, b) => (cellOf(b) > cellOf(a) ? b : a));
  const rowsN = Math.ceil(pages.length / cols);
  const cellW = cellOf(cols);
  const gridW = cols * cellW + (cols - 1) * gap;
  const gridY = gridTop + Math.max(0, (gridH - rowsN * cellW * 1.414 - (rowsN - 1) * gap) / 2);
  pages.forEach((p, j) => {
    const c = j % cols;
    const r = Math.floor(j / cols);
    const cx = S.x + (S.w - gridW) / 2 + c * (cellW + gap) + cellW / 2;
    const cy = gridY + r * (cellW * 1.414 + gap) + (cellW * 1.414) / 2;
    L.svg(sheetSvg(L, thumbInner(p), p.scene.w, p.scene.h, cx, cy, cellW, [-2, 1.5, 1, -1.5][j]!, 0.35));
  });
  // the guide itself over the corner of its pages: what they come from
  const gridH2 = rowsN * cellW * 1.414 + (rowsN - 1) * gap;
  const bw = Math.min(S.w * 0.3, cellW * 0.82);
  const chipsTop = footY - chipsH - 6 * f.u;
  L.svg(bookSvg(L, k, S.x + (S.w - gridW) / 2 + bw * 0.36, Math.min(gridY + gridH2 - bw * 0.52, chipsTop - 8 * f.u - bw * 0.74), bw, -6, { shadow: 0.35 }));
  let y = chipsTop;
  for (const row of rows) {
    const rw = row.reduce((a, c) => a + advance(k.ui, c, size) + size * 1.5 + 5 * f.u, -5 * f.u);
    let x0 = S.x + (S.w - rw) / 2;
    for (const c of row) x0 += pill(s, c, x0, y, { face: k.ui, size, fill: '#ffffff', ink: '#111111' }) + 5 * f.u;
    y += size * 1.9 + 5 * f.u;
  }
  return 'une grille de vraies pages du guide, le nombre de pages, de chapitres et de fiches, le bouton';
}

// ───────────────────────────── the preview ─────────────────────────────

/** The voice-over cut in captions of a few words, as the platform's own captions run: a clause, five words at most. */
function captionChunks(text: string): string[] {
  const words = clean(text).replace(/\s+([:;!?»])/g, ' $1').replace(/«\s+/g, '« ').split(' ').filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (cur.length >= 5 || (cur.length >= 3 && /[.!?,:;»]$/.test(w))) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/** The platform's own glyphs, as masks the page paints white. */
const svgIcon = (d: string): string => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}"/></svg>`).replace(/'/g, '%27')}`;
const ICON = {
  heart: svgIcon('M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z'),
  comment: svgIcon('M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.5 3.4 6L4 21l4.6-2.3c1 .2 2.2.3 3.4.3 5.5 0 10-3.6 10-8s-4.5-8-10-8z'),
  save: svgIcon('M6 2h12v20l-6-4-6 4z'),
  share: svgIcon('M14 4l8 7-8 7v-4c-6 0-9 2-12 6 1-6 4-11 12-12z'),
  home: svgIcon('M12 3 2 11h3v10h5v-6h4v6h5V11h3z'),
  friends: svgIcon('M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 21c0-4 3.6-7 8-7s8 3 8 7zm16.5 0c0-2.4-.9-4.5-2.4-6 3.7.1 6.9 2.6 6.9 6z'),
  inbox: svgIcon('M3 4h18v12h-6l-3 4-3-4H3z'),
  profile: svgIcon('M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm-9 10c0-5 4-8 9-8s9 3 9 8z'),
} as const;

function previewHtml(k: Kit, frames: string[]): string {
  const c = k.creative;
  const scenes = k.scenes;
  const durations = scenes.map(durationOf);
  const total = durations.reduce((s, d) => s + d, 0);
  const subs = scenes.map((s) => captionChunks(s.voiceover ?? ''));
  const review = c.review;
  const badge = review?.status === 'approved' ? ['Validée par la plateforme', 'ok']
    : review?.status === 'rejected' ? [`Refusée${review.reason ? ` : ${review.reason}` : ''}`, 'ko'] : ['En attente de validation', 'wait'];
  const tags = (c.hashtags ?? []).map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1);
  const style = styleOf(k.d);
  const look = STYLE_INFO[k.d.style ?? 'bauhaus'] ?? STYLE_INFO.bauhaus;
  const composition = style.compositions[compositionOf(k.d, style)]?.label ?? '';
  const voiced = c.format === 'faceless_voiceover' || c.format === 'ugc_avatar';
  const mentionsList = [AD_LABEL, ...(c.format === 'ugc_avatar' ? [DRAWN_LABEL] : []), ...(voiced ? [VOICE_LABEL] : [])];
  const staticLook = c.format === 'static_image' ? staticLookOf(c, k.product, !!k.guide?.pages.length) : null;
  const caption = clean(c.caption);
  const accent = k.skin.pop;
  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const frameW = W;
  const zones = masterFrame().zones;
  const zonePct = zones.map((z) => `left:${(z.x0 / frameW) * 100}%;top:${(z.y0 / H) * 100}%;width:${((z.x1 - z.x0) / frameW) * 100}%;height:${((z.y1 - z.y0) / H) * 100}%`);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aperçu — pub simulée · ${h(k.product?.title ?? '')}</title>
<style>
:root{--bg:#0e0f13;--card:#17181e;--line:#2a2c35;--ink:#f3f3f6;--muted:#9a9cab;--accent:${accent};--ok:#2bb673;--ko:#ef5350;--wait:#e0a526}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:28px 20px 56px;display:grid;gap:32px;align-items:start}
@media (min-width:900px){.wrap{grid-template-columns:auto 1fr;gap:48px;padding-top:40px}.stage{position:sticky;top:24px}}
.stage{display:flex;flex-direction:column;align-items:center;gap:14px}
.phone{position:relative;width:min(88vw,340px);aspect-ratio:9/19.5;border-radius:52px;background:#050507;padding:12px;box-shadow:0 40px 90px rgba(0,0,0,.55),inset 0 0 0 2px #2b2d36,inset 0 0 0 7px #0b0c10}
.screen{position:relative;width:100%;height:100%;border-radius:41px;overflow:hidden;background:#000;display:flex;flex-direction:column}
.island{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:30%;height:26px;border-radius:14px;background:#000;z-index:9}
.video{position:relative;flex:none;width:100%;aspect-ratio:9/16;overflow:hidden}
.nav{flex:1;display:flex;align-items:flex-start;justify-content:space-around;padding-top:9px;color:#fff;font-size:9.5px;font-weight:700;background:#000}
.nav span{display:flex;flex-direction:column;align-items:center;gap:3px;opacity:.75}.nav span.on{opacity:1}
.nav i{width:20px;height:20px;background:currentColor;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}
.nav .plus{width:40px;height:26px;border-radius:8px;background:linear-gradient(90deg,#25f4ee 0 18%,#fff 18% 82%,#fe2c55 82%);color:#111;display:grid;place-items:center;font-size:20px;font-weight:800;opacity:1;margin-top:-2px}
.frame{position:absolute;inset:0;opacity:0;transition:opacity .35s ease}
.frame.on{opacity:1}
.frame svg{width:100%;height:100%;display:block}
.frame.on svg{animation:push var(--d,3s) linear both}
@keyframes push{from{transform:scale(1)}to{transform:scale(1.045)}}
.ui{position:absolute;inset:0;pointer-events:none;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45);z-index:5}
.tabs{position:absolute;top:7.5%;left:0;right:0;display:flex;justify-content:center;gap:16px;font-weight:700;font-size:13px}
.tabs span{opacity:.62}.tabs b{border-bottom:2px solid #fff;padding-bottom:3px}
.rail{position:absolute;right:2.2%;top:47%;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:9.5px;font-weight:700}
.rail i{display:block;width:30px;height:30px;margin:0 auto 2px;background:currentColor;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.rail .av{width:40px;height:40px;border-radius:50%;border:2px solid #fff;background:var(--accent);display:grid;place-items:center;font-size:16px;font-weight:800;position:relative;margin-bottom:6px}
.rail .av::after{content:"+";position:absolute;bottom:-9px;left:50%;transform:translateX(-50%);width:18px;height:18px;border-radius:50%;background:#fe2c55;font-size:14px;line-height:17px;text-align:center}
.disc{width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,#555 0 18%,#111 19% 100%);border:7px solid #222;animation:spin 4s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.meta{position:absolute;left:3.5%;right:21%;bottom:3.2%;font-size:12px;line-height:1.35}
.meta .who{font-weight:800;font-size:14px;margin-bottom:3px}
.meta .cap{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta .tags{font-weight:700}
.meta .spons{display:inline-block;margin-top:4px;font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border-radius:4px;padding:1px 6px}
.meta .cta{margin-top:7px;display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.22);border-radius:6px;padding:7px 10px;font-weight:800;font-size:12.5px;transition:background .5s}
.meta .cta.hot{background:#fe2c55}
.meta .music{margin-top:6px;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scrub{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.25)}
.scrub b{display:block;height:100%;width:0;background:#fff}
.subs{position:absolute;left:7%;right:21%;top:60%;text-align:center;z-index:6;pointer-events:none}
.subs span{display:inline;background:rgba(0,0,0,.72);color:#fff;font-weight:700;font-size:13px;line-height:1.5;padding:2px 7px;border-radius:5px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.zones{position:absolute;inset:0;z-index:7;pointer-events:none;display:none}
.zones div{position:absolute;outline:1.5px dashed rgba(0,255,160,.9);background:rgba(0,255,160,.08)}
body.safe .zones{display:block}
.controls{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.controls button{appearance:none;border:1px solid var(--line);cursor:pointer;font:inherit;font-weight:700;font-size:13.5px;padding:9px 14px;border-radius:999px;background:var(--card);color:var(--ink)}
.controls button.main{background:var(--accent);border-color:transparent;color:#fff}
.controls button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px;align-self:center;min-width:80px;text-align:center}
.panel{display:grid;gap:18px}
.kicker{font-size:11.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
h1{font-size:24px;line-height:1.25;margin:6px 0 0}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}
.card b{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.card p{margin:0;font-size:14.5px}
.card small{display:block;color:var(--muted);margin-top:4px;font-size:12.5px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.chip{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:#262833;color:#e9e9ef}
.status{font-size:12.5px;font-weight:800;padding:4px 10px;border-radius:999px;color:#111}
.status.ok{background:var(--ok)}.status.ko{background:var(--ko);color:#fff}.status.wait{background:var(--wait)}
ol.scenes{list-style:none;margin:0;padding:0;display:grid;gap:8px}
ol.scenes li{display:grid;grid-template-columns:30px 1fr auto;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--line);background:var(--card);cursor:pointer}
ol.scenes li.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
ol.scenes .num{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:#262833;font-weight:800}
ol.scenes li.on .num{background:var(--accent);color:#fff}
ol.scenes .ost{font-weight:800}
ol.scenes .vo{font-size:13.5px;color:#d3d4dc;margin-top:3px}
ol.scenes .vis{font-size:12.5px;color:var(--muted);margin-top:3px}
ol.scenes .dur{font-size:11.5px;font-weight:800;color:var(--muted)}
.note{font-size:12.5px;color:var(--muted)}
label.toggle{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:var(--muted);cursor:pointer}
@media (max-width:520px){.wrap{padding:0 0 40px;gap:18px}.phone{width:100vw;max-width:none;aspect-ratio:9/16;height:auto;border-radius:0;padding:0;box-shadow:none}.screen{border-radius:0}.island,.nav{display:none}.tabs{top:3.5%}.panel{padding:0 16px}}
@media (prefers-reduced-motion:reduce){.frame{transition:none}.frame.on svg,.disc{animation:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="stage">
    <div class="phone" aria-label="Aperçu de la publicité sur ${h(CHANNEL_NAME.tiktok)}">
      <div class="screen" id="screen">
        <div class="island"></div>
        <div class="video">
        ${frames.length
    ? frames.map((fr, i) => `<div class="frame${i === 0 ? ' on' : ''}" data-k="${i}" style="--d:${durations[i]}s">${fr}</div>`).join('\n        ')
    : '<div class="frame on" style="display:grid;place-items:center;color:#fff;font-weight:700;padding:24px;text-align:center">Aucune scène dans ce storyboard pour l’instant.</div>'}
          <div class="zones">${zonePct.map((z) => `<div style="${z}"></div>`).join('')}</div>
          <div class="subs" aria-live="polite"><span id="sub"></span></div>
          <div class="ui">
            <div class="tabs"><span>Abonnements</span><b>Pour toi</b></div>
            <div class="rail">
              <div class="av">${h((k.brand || 'P').charAt(0).toUpperCase())}</div>
              <div><i style="--m:url('${ICON.heart}')"></i>J’aime</div>
              <div><i style="--m:url('${ICON.comment}')"></i>Comm.</div>
              <div><i style="--m:url('${ICON.save}')"></i>Favoris</div>
              <div><i style="--m:url('${ICON.share}')"></i>Partager</div>
              <div class="disc"></div>
            </div>
            <div class="meta">
              <div class="who">${h(k.handle)}</div>
              <div class="cap">${h(caption)} <span class="tags">${h(tags.join(' '))}</span></div>
              <span class="spons">Sponsorisé</span>
              <div class="cta" id="cta"><span>${h(buttonLabel(c.cta))}</span><span>›</span></div>
              <div class="music">♫ son original — ${h(k.brand)}</div>
            </div>
            <div class="scrub"><b id="scrub"></b></div>
          </div>
        </div>
        <div class="nav" aria-hidden="true"><span class="on"><i style="--m:url('${ICON.home}')"></i>Accueil</span><span><i style="--m:url('${ICON.friends}')"></i>Amis</span><span class="plus">+</span><span><i style="--m:url('${ICON.inbox}')"></i>Messages</span><span><i style="--m:url('${ICON.profile}')"></i>Profil</span></div>
      </div>
    </div>
    <div class="controls">
      <button type="button" class="main" id="play" aria-label="Lecture ou pause">⏸ Pause</button>
      <button type="button" id="restart" aria-label="Recommencer">↺ Recommencer</button>
      <span class="time" id="time">0:00 / ${fmt(total)}</span>
    </div>
    <label class="toggle"><input type="checkbox" id="safe"> Montrer les zones sûres</label>
  </div>
  <div class="panel">
    <div>
      <div class="kicker">Aperçu — pub simulée · ${h(CHANNEL_NAME.tiktok)}</div>
      <h1>${h(c.hook || scenes[0]?.onScreenText || k.product?.title || '')}</h1>
    </div>
    <div class="cards">
      <div class="card"><b>Format</b><p>${h(FORMAT_LABEL[c.format] ?? c.format)}</p><small>${h(scenes.length)} scène${scenes.length > 1 ? 's' : ''} · ${h(total)} s${staticLook ? ` · look « ${h(STATIC_LOOK_LABEL[staticLook])} »` : ''}</small></div>
      <div class="card"><b>Accroche</b><p>${h(HOOK_LABEL[c.hookStyle] ?? c.hookStyle)}</p><small>${h(c.hook || '—')}</small></div>
      <div class="card"><b>Look</b><p>${h(look.label)}${composition ? ` · ${h(composition)}` : ''}</p><small>${h(look.blurb)}</small></div>
      <div class="card"><b>Canal</b><p>${h(CHANNEL_NAME.tiktok)} · 9:16</p><small>Textes dans les zones sûres de TikTok, Reels et Shorts.</small></div>
      <div class="card"><b>Mentions</b><div class="chips">${mentionsList.map((m) => `<span class="chip">${h(m)}</span>`).join('')}</div><small>Aucune fausse urgence, aucun avis inventé.</small></div>
      <div class="card"><b>Validation</b><p><span class="status ${badge[1]}">${h(badge[0])}</span></p><small>${h(buttonLabel(c.cta))}</small></div>
    </div>
    <div>
      <div class="kicker" style="margin-bottom:8px">Les scènes</div>
      <ol class="scenes" id="scenes">
        ${scenes.map((s, i) => `<li data-k="${i}"${i === 0 ? ' class="on"' : ''}><span class="num">${i + 1}</span><div><div class="ost">${h(s.onScreenText)}</div>${s.voiceover ? `<div class="vo">Voix : ${h(s.voiceover)}</div>` : ''}${s.visual ? `<div class="vis">Visuel : ${h(s.visual)}</div>` : ''}</div><span class="dur">${h(durations[i])} s</span></li>`).join('\n        ')}
      </ol>
    </div>
    <p class="note">Pub fabriquée par l’agence et diffusée seulement dans le marché virtuel de Pixel Agency. L’interface de la plateforme est imitée pour juger la pub à sa place : aucun compteur n’est affiché.</p>
  </div>
</div>
<script>
(function () {
  var durations = ${JSON.stringify(durations)};
  var subs = ${JSON.stringify(subs).replace(/</g, '\\u003c')};
  var frames = document.querySelectorAll('.frame');
  var items = document.querySelectorAll('#scenes li');
  var sub = document.getElementById('sub');
  var playBtn = document.getElementById('play');
  var timeEl = document.getElementById('time');
  var scrub = document.getElementById('scrub');
  var cta = document.getElementById('cta');
  var total = durations.reduce(function (a, b) { return a + b; }, 0);
  var index = 0, elapsed = 0, playing = true, last = null;
  function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function show(k) {
    index = k;
    for (var i = 0; i < frames.length; i++) {
      var on = i === k;
      frames[i].classList.toggle('on', on);
      if (on) { var svg = frames[i].querySelector('svg'); if (svg) { svg.style.animation = 'none'; void svg.getBoundingClientRect(); svg.style.animation = ''; } }
    }
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('on', j === k);
  }
  function paint() {
    var before = 0; for (var k = 0; k < index; k++) before += durations[k];
    var at = before + elapsed;
    timeEl.textContent = fmt(at) + ' / ' + fmt(total);
    scrub.style.width = (total ? Math.min(100, at / total * 100) : 0) + '%';
    cta.classList.toggle('hot', at > 3);
    var parts = subs[index] || [];
    var piece = parts.length ? parts[Math.min(parts.length - 1, Math.floor(elapsed / (durations[index] || 1) * parts.length))] : '';
    if (sub.textContent !== piece) sub.textContent = piece;
    sub.style.display = piece ? 'inline' : 'none';
  }
  function loop(now) {
    if (last === null) last = now;
    var dt = (now - last) / 1000; last = now;
    if (playing && durations.length) {
      elapsed += dt;
      if (elapsed >= durations[index]) { elapsed = 0; show((index + 1) % durations.length); }
    }
    paint();
    requestAnimationFrame(loop);
  }
  function toggle() { playing = !playing; playBtn.textContent = playing ? '⏸ Pause' : '▶ Lecture'; }
  playBtn.addEventListener('click', toggle);
  document.addEventListener('keydown', function (e) { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); toggle(); } });
  document.getElementById('restart').addEventListener('click', function () { elapsed = 0; show(0); playing = true; playBtn.textContent = '⏸ Pause'; });
  document.getElementById('safe').addEventListener('change', function (e) { document.body.classList.toggle('safe', e.target.checked); });
  for (var i = 0; i < items.length; i++) items[i].addEventListener('click', function () { elapsed = 0; show(Number(this.getAttribute('data-k'))); });
  show(0);
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>
`;
}

// ───────────────────────────── the API ─────────────────────────────

type RenderInput = { creative: AdCreative; product: Product; design: DesignSpec; brand: string };

/** 9:16 SVG frames (one per scene, 360 × 640) and an HTML phone preview that plays them with the voice in captions. */
export function renderAdStoryboard(input: RenderInput): { frames: string[]; previewHtml: string } {
  const k = kitOf(input);
  const f = masterFrame();
  const single = k.creative?.format === 'static_image';
  // the preview plays its own bar: its frames are the files' without theirs, drawn once
  const previewFrames = single ? (k.scenes.length ? [staticFrame(k, f)] : []) : k.scenes.map((_, i) => frameOf(k, f, i, { progress: false }));
  const frames = single || k.creative?.format === 'carousel' ? previewFrames : previewFrames.map((svg, i) => withProgress(svg, f, i, k.scenes.length));
  return { frames, previewHtml: previewHtml(k, previewFrames) };
}

/**
 * The boxes of the ad's own text on each frame of a ratio, as drawn: mentions, captions, buttons, stickers. The cover and the
 * pages are pictures and hold none. What the safe zones are proved on (`insideZones`).
 */
export function adTextBoxes(input: RenderInput & { ratio: Ratio }): { frame: AdFrame; frames: TextBox[][] } {
  const k = kitOf(input);
  const f = cutFrame(input.ratio);
  if (input.creative?.format === 'search_text' || !k.scenes.length) return { frame: f, frames: [] };
  if (input.creative.format === 'static_image') {
    const ledger: TextBox[] = [];
    staticFrame(k, f, ledger);
    return { frame: f, frames: [ledger] };
  }
  return {
    frame: f,
    frames: k.scenes.map((_, i) => {
      const ledger: TextBox[] = [];
      frameOf(k, f, i, { progress: input.ratio === '9:16', ledger });
      return ledger;
    }),
  };
}

/** Still frames of a cut: 432 × 540, 540 × 540, a 1000 × 1500 pin, one per scene. A pin is one frame, an ad with no media has none. */
export function renderAdCut(input: RenderInput & { ratio: Ratio }): { frames: string[] } {
  if (input.creative?.format === 'search_text') return { frames: [] };
  if (input.ratio === '9:16') return { frames: renderAdStoryboard(input).frames };
  const k = kitOf(input);
  const f = cutFrame(input.ratio);
  if (input.creative?.format === 'static_image') return { frames: k.scenes.length ? [staticFrame(k, f)] : [] };
  return { frames: k.scenes.map((_, i) => frameOf(k, f, i, { progress: false })) };
}
