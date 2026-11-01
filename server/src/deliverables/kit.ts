/**
 * The two small PDFs cut from a guide: the lead magnet given for an address, 3 to 5 pages, and the kit sold at checkout, its
 * sheets and checklists ready to print. The guide's voice, inks and art, and like the guide they read no clock and no RNG:
 * same content, same bytes. Pages are laid out here: `layoutGuide` holds a whole guide's front and back matter.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import PDFDocument from 'pdfkit';
import type { ChapterContent, DesignSpec, EmailStep, PdfContent, Product, SalesPage, VisualSpec } from '../shared.js';
import { field } from './art/field.js';
import { coverScene, splitTitle } from './cover.js';
import { familyOfText, normalizeDesign, professionalFor } from './design.js';
import { fitDisplay, loadVoice, registerVoice, sanitizeFor } from './fonts.js';
import { arr, CHECK_INDENT, CHECK_LINE, MIN_SHEET_NOTES, SHEET_BAND, SHEET_NOTES_GAP, sheetBlock, sheetTop, STEP_INDENT, textKey } from './layout/blocks.js';
import { BODY_BOTTOM, GRID } from './layout/grid.js';
import { drawNotes } from './pages/render.js';
import { linesOf, setLines, themeFor, tickBox, type PdfTheme } from './pdfVisuals.js';
import { Scene, toPdf, toSvg } from './scene.js';
import { escapeHtml, frenchNbsp, sanitizePdfText } from './text.js';
import type { Voice } from './voices.js';

const { W, H, left: L, full: FULL } = GRID;
const U = W / 6;               // the tile of the art, as in a guide
const TOP_BAND = 2 * U;
const MEASURE = GRID.column + 60;
/** Fixed: same content gives the same bytes. */
const CREATED = new Date(Date.UTC(2026, 0, 1));
const NO_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };

const S = sanitizePdfText;

interface Printed { scene: Scene; scale: number; outline: string | null }

interface RenderInput { product: Product; content: PdfContent; design: DesignSpec; brand: string; outFile: string }

/** Text the reader meets on a page, as a guide numbers it. */
const stepText = (s: string): string => S(s).replace(/^\s*\d+\s*[.)]\s*/, '');

/** The box says it already: « Fait : … » or « … : fait » beside an empty box reads like a bug. */
function tickText(s: string): string {
  const t = S(s).replace(/^\s*[-•*]\s*/, '').replace(/^fait\s*:\s*/iu, '').replace(/\s*:\s*fait\.?$/iu, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ───────────────────────────── running text ─────────────────────────────

/** Pages of text, filled from the top. A block that does not fit opens the next page; past `max` pages, it and all that follows stay out. */
class Flow {
  readonly pages: Scene[] = [];
  private s: Scene | null = null;
  private y = BODY_BOTTOM;
  private shut = false;

  constructor(private readonly t: PdfTheme, private readonly max = Number.POSITIVE_INFINITY) {}

  private room(h: number): Scene | null {
    if (this.shut) return null;
    if (this.s && this.y + h <= BODY_BOTTOM) return this.s;
    if (this.pages.length >= this.max) {
      this.shut = true;
      return null;
    }
    this.s = new Scene(W, H).rect(0, 0, W, H, this.t.page);
    this.pages.push(this.s);
    this.y = GRID.top;
    return this.s;
  }

  /** A section's head, kept with `next` points of what it opens. */
  heading(kicker: string, title: string, next = 72): void {
    const { v, inks } = this.t;
    const fit = fitDisplay(title, v.deck, { width: FULL, max: 21, min: 14, maxLines: 3, leading: 1.15 });
    const leading = fit.size * 1.15;
    const air = this.s && this.y > GRID.top ? 25.2 : 0;
    const h = 34 + fit.lines.length * leading + 10.8;
    const s = this.room(air + h + next);
    if (!s) return;
    const top = this.y > GRID.top ? this.y + air : this.y;
    s.line(L, top, L + FULL, top, inks.ink, 0.9);
    s.text(sanitizeFor(v.labelB, kicker).toUpperCase(), L, top + 18, v.labelB, 8, this.t.bText, { track: 1.6 });
    setLines(s, fit.lines, L, top + 26, { face: v.deck, size: fit.size, leading, fill: inks.ink });
    this.y = top + h;
  }

  para(text: string, italic = false): void {
    const { v, inks } = this.t;
    const face = italic ? v.textIt : v.text;
    const lines = linesOf(text, face, v.body + 0.4, MEASURE);
    if (!lines.length) return;
    const s = this.room(lines.length * 15 + 8);
    if (!s) return;
    this.y += setLines(s, lines, L, this.y, { face, size: v.body + 0.4, leading: 15, fill: inks.ink }) + 8;
  }

  label(text: string): void {
    const { v } = this.t;
    const s = this.room(50);
    if (!s) return;
    this.y += 7.2;
    s.text(sanitizeFor(v.labelB, text).toUpperCase(), L, this.y + 8, v.labelB, 7.8, this.t.aText, { track: 1.4 });
    this.y += 18;
  }

  /** The first sentence stands out: the mistake or the move, then the why. */
  numbered(items: readonly string[]): void {
    const { v, inks, bText } = this.t;
    items.forEach((raw, k) => {
      const text = stepText(raw);
      const cut = /^(.{8,120}?[.!?:])\s+(.+)$/su.exec(text);
      const head = linesOf(cut ? cut[1]! : text, v.textB, v.body + 0.4, FULL - STEP_INDENT);
      const rest = cut ? linesOf(cut[2]!, v.text, v.body + 0.4, FULL - STEP_INDENT) : [];
      const s = this.room((head.length + rest.length) * 15 + 14);
      if (!s) return;
      s.text(String(k + 1), L, this.y + 24, v.display, 26, bText);
      let y = this.y + 4;
      y += setLines(s, head, L + STEP_INDENT, y, { face: v.textB, size: v.body + 0.4, leading: 15, fill: inks.ink });
      y += setLines(s, rest, L + STEP_INDENT, y, { face: v.text, size: v.body + 0.4, leading: 15, fill: inks.ink });
      this.y = y + 10;
    });
  }

  /** The line before the last one keeps room for it: a list never leaves one box alone at the head of a page. */
  ticks(items: readonly string[]): void {
    const { v, inks } = this.t;
    const rows = items.map((raw) => linesOf(tickText(raw), v.text, v.body, FULL - CHECK_INDENT)).filter((lines) => lines.length);
    const tall = (lines: string[] | undefined): number => (lines ? lines.length * CHECK_LINE + 7.2 : 0);
    for (const [k, lines] of rows.entries()) {
      const s = this.room(tall(lines) + (k === rows.length - 2 ? tall(rows[k + 1]) : 0));
      if (!s) return;
      tickBox(s, L, this.y + 2.8, 9, inks.ink);
      lines.forEach((l, j) => s.text(l, L + CHECK_INDENT, this.y + 10.5 + j * CHECK_LINE, v.text, v.body, inks.ink));
      this.y += tall(lines);
    }
  }

  example(text: string): void {
    const { v, inks } = this.t;
    const lines = linesOf(text, v.textIt, v.body, MEASURE - 14);
    const s = lines.length ? this.room(lines.length * GRID.baseline + 16) : null;
    if (!s) return;
    this.y += 6;
    s.line(L + 1, this.y, L + 1, this.y + lines.length * GRID.baseline, inks.b, 2.4);
    this.y += setLines(s, lines, L + 14, this.y - 1, { face: v.textIt, size: v.body, leading: GRID.baseline, fill: inks.ink }) + 10;
  }

  /** A page made to be printed: what the text leaves of the last one is ruled down to its foot. */
  rule(): void {
    const y = this.y + SHEET_NOTES_GAP;
    if (this.s && BODY_BOTTOM - y >= MIN_SHEET_NOTES) drawNotes(this.t, this.s, y, BODY_BOTTOM - y);
  }
}

// ───────────────────────────── pages ─────────────────────────────

/** A sheet as a guide prints it: its ink band, its table, more pages when it is longer than one. */
function sheetPages(visual: VisualSpec, t: PdfTheme, order: number, total: number): Scene[] {
  const b = sheetBlock(visual, t);
  if (!b) return [];
  const { v, inks } = t;
  return b.parts.map(({ from, to, grow, notes }) => {
    const s = new Scene(W, H).rect(0, 0, W, H, inks.paper);
    const band = SHEET_BAND.top + Math.max(1, b.title.length) * SHEET_BAND.line;
    s.rect(0, 0, W, band, inks.ink);
    s.text('À IMPRIMER', L, 30, v.labelB, 8.5, inks.paper, { track: 2 });
    s.text(`Fiche ${order} sur ${total}`, L + FULL, 30, v.label, 9, inks.paper, { anchor: 'end' });
    b.title.forEach((l, k) => s.text(l, L, 54 + k * SHEET_BAND.line, v.deck, SHEET_BAND.size, inks.paper));
    if (b.model.note) s.text(b.model.note, L, band + 19, v.textIt, 9.4, inks.ink);
    b.model.draw(s, L, sheetTop(b.title.length), from, to, grow);
    if (notes) drawNotes(t, s, notes.y, notes.h, notes.label, t.muted);
    return s;
  });
}

/** The art's band, a label and a title: how a guide opens its introduction and closes its last page. */
function bandedPage(t: PdfTheme, design: DesignSpec, seed: number, kicker: string, title: string): { s: Scene; y: number } {
  const { v, inks } = t;
  const s = new Scene(W, H).rect(0, 0, W, H, t.page);
  field(s, { x: 0, y: 0, u: U, cols: 6, rows: 2, inks, motif: design.motif, seed, hero: null });
  s.text(sanitizeFor(v.labelB, kicker).toUpperCase(), L, TOP_BAND + 34, v.labelB, 8.6, t.bText, { track: 1.8 });
  const fit = fitDisplay(title, v.deck, { width: FULL, max: 27, min: 17, maxLines: 3, leading: 1.1 });
  const leading = fit.size * 1.1;
  setLines(s, fit.lines, L, TOP_BAND + 42, { face: v.deck, size: fit.size, leading, fill: inks.ink });
  return { s, y: TOP_BAND + 42 + fit.lines.length * leading + 14.4 };
}

/** The last thing drawn on a page: a text extraction reads the body first, this line after it. */
function folio(s: Scene, t: PdfTheme, brand: string, no: number): void {
  const { v, inks } = t;
  s.text(sanitizeFor(v.labelB, brand).toUpperCase(), L, GRID.folio, v.labelB, 6.8, inks.ink, { track: 1.4 });
  s.text(String(no), L + FULL, GRID.folio, v.deck, 10, inks.ink, { anchor: 'end' });
}

function closing(s: Scene, t: PdfTheme, disclaimer: string): void {
  const lines = linesOf(disclaimer, t.v.text, 8, FULL);
  setLines(s, lines, L, BODY_BOTTOM - lines.length * 10.8, { face: t.v.text, size: 8, leading: 10.8, fill: t.muted });
}

async function print(pages: Printed[], voice: Voice, info: { title: string; subject: string; brand: string; audience: string; problem: string }, outFile: string): Promise<{ pages: number; bytes: number }> {
  await mkdir(dirname(outFile), { recursive: true });
  const doc = new PDFDocument({
    autoFirstPage: false, size: 'A4', margins: NO_MARGINS, compress: true, lang: 'fr-FR', displayTitle: true,
    info: {
      Title: info.title, Author: info.brand, Subject: info.subject, Keywords: [S(info.audience), S(info.problem)].filter(Boolean).join(' · '),
      Creator: `${info.brand} — Studio PDF`, CreationDate: CREATED,
    },
  });
  const stream = createWriteStream(outFile);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(stream);
  registerVoice(doc, voice);
  try {
    for (const page of pages) {
      doc.addPage({ size: 'A4', margins: NO_MARGINS });
      toPdf(doc, page.scene, 0, 0, page.scale);
      if (page.outline) doc.outline.addItem(page.outline);
    }
  } catch (err) {
    doc.end();
    await done.catch(() => undefined);
    throw err;
  }
  doc.end();
  await done;
  const { size } = await stat(outFile);
  return { pages: pages.length, bytes: size };
}

interface Book { design: DesignSpec; t: PdfTheme; voice: Voice; brand: string; title: string; subtitle: string; audience: string; cover: Printed }

function bookOf(input: RenderInput): Book {
  const { product, content } = input;
  const design = normalizeDesign(input.design ?? product.design);
  const { voice } = loadVoice(design.voice!);
  const brand = (input.brand || 'Pixel Agency').trim();
  const title = S(content.title || product.title);
  const subtitle = S(content.subtitle || product.subtitle);
  const audience = S(content.audience || product.audience);
  const scene = coverScene({ title, subtitle, audience, design, brand: S(brand) }).scene;
  return { design, t: themeFor(design, voice), voice, brand, title, subtitle, audience, cover: { scene, scale: W / scene.w, outline: null } };
}

function finish(book: Book, input: RenderInput, body: Printed[]): Promise<{ pages: number; bytes: number }> {
  body.forEach((p, k) => folio(p.scene, book.t, book.brand, k + 2));
  return print([book.cover, ...body], book.voice, { title: book.title || 'Guide pratique', subject: book.subtitle, brand: book.brand, audience: input.product.audience, problem: input.product.problem }, input.outFile);
}

const adviceOf = (product: Product, design: DesignSpec): string => professionalFor(design.family ?? familyOfText(`${product.title} ${product.audience} ${product.problem}`));

/** The checklist without what the steps above it say, whole or cut short: a page never prints the same list twice. */
function unsaid(checklist: string[], steps: readonly string[]): string[] {
  const said = steps.map(textKey);
  return checklist.filter((c) => !said.some((step) => step.startsWith(textKey(tickText(c)))));
}

// ───────────────────────────── the lead magnet ─────────────────────────────

/** Cover, last page and the sheet take three: text gets what is left of the five. */
const MAGNET_TEXT_PAGES = 2;

/** Cover, what the reader came for, a sheet of the guide when it has one to give, the way to the guide. Never more than 5 pages. */
export async function renderLeadMagnet(input: RenderInput): Promise<{ pages: number; bytes: number }> {
  const { content, product } = input;
  const book = bookOf(input);
  const { t, design } = book;
  const seed = design.artSeed ?? design.seed;
  const flow = new Flow(t, MAGNET_TEXT_PAGES);
  for (const p of arr(content.introduction)) flow.para(S(p));
  for (const ch of arr(content.chapters)) {
    flow.heading('Ce qui bloque', S(ch.title));
    if (ch.intro) flow.para(S(ch.intro), true);
    for (const p of arr(ch.paragraphs)) flow.para(S(p));
    flow.numbered(arr(ch.steps));
    if (ch.example) flow.example(S(ch.example));
    if (arr(ch.checklist).length) {
      flow.label('Votre checklist');
      flow.ticks(arr(ch.checklist));
    }
  }
  const body: Printed[] = flow.pages.map((scene, k) => ({ scene, scale: 1, outline: k ? null : 'Ce qui bloque' }));
  const sheet = kitSheets(content)[0];
  if (sheet) body.push(...sheetPages(sheet, t, 1, 1).slice(0, 1).map((scene) => ({ scene, scale: 1, outline: S(sheet.title) })));

  const { s, y } = bandedPage(t, design, seed + 3, 'Et maintenant ?', S(content.nextStep?.title) || book.title);
  const text = linesOf(S(content.nextStep?.text), t.v.text, t.v.body + 0.8, MEASURE);
  setLines(s, text, L, y, { face: t.v.text, size: t.v.body + 0.8, leading: 15.6, fill: t.inks.ink });
  closing(s, t, `Ce document est fourni à titre informatif et pédagogique. Il ne remplace pas l’avis ${adviceOf(product, design)}, adapté à votre situation.`);
  body.push({ scene: s, scale: 1, outline: 'Et maintenant ?' });
  return finish(book, input, body);
}

// ───────────────────────────── the kit ─────────────────────────────

const gridOf = (v: VisualSpec | null | undefined): VisualSpec | null => (v?.type === 'grid' && (v.grid?.columns?.length ?? 0) >= 2 && (v.grid?.rows?.length ?? 0) > 0 ? v : null);

/** Every sheet of a guide, its bonus last, each once. */
export function kitSheets(content: PdfContent): VisualSpec[] {
  const seen = new Set<string>();
  return [...arr(content.chapters), ...(content.bonus ? [content.bonus] : [])].flatMap((ch) => [gridOf(ch.visual), gridOf(ch.figure)]).filter((v): v is VisualSpec => {
    if (!v || seen.has(v.title)) return false;
    seen.add(v.title);
    return true;
  });
}

/** The chapter that only dates the steps of the others: every line of it stands on a sheet, box by box, and a page later it would be read twice. */
function onSheet(ch: ChapterContent, sheets: readonly VisualSpec[]): boolean {
  const cells = textKey(sheets.flatMap((v) => arr(v.grid?.cells).flat()).filter(Boolean).join(' '));
  const steps = arr(ch.steps).map(stepText);
  return steps.length > 0 && steps.every((s) => cells.includes(textKey(s.replace(/^[^:]*:\s*/, ''))));
}

/** What the plan of a kit prints: the guide's chapters and bonus, less what its sheets already hold or what has nothing to tick. */
function planParts(content: PdfContent, sheets: readonly VisualSpec[]): { ch: ChapterContent; kicker: string }[] {
  const parts = [...arr(content.chapters).map((ch) => ({ ch, kicker: 'Étape' })), ...(content.bonus ? [{ ch: content.bonus, kicker: 'Bonus' }] : [])];
  return parts.filter(({ ch }) => (arr(ch.steps).length || arr(ch.checklist).length) && !onSheet(ch, sheets))
    .map((part, k) => ({ ...part, kicker: part.kicker === 'Bonus' ? part.kicker : `Étape ${k + 1}` }));
}

/** The boxes the plan prints: the steps, then what their checklists add. */
const ticksOf = (content: PdfContent): number => planParts(content, kitSheets(content)).reduce((n, { ch }) => {
  const steps = arr(ch.steps).map(stepText);
  return n + steps.length + unsaid(arr(ch.checklist), steps).length;
}, 0);

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

const headOf = (title: string): string => splitTitle(S(title)).head;

/** « Titre » between guillemets, once: a head that quotes a customer holds its own. */
const named = (head: string): string => (head.includes('«') ? head : `« ${head} »`);

/** A kit has no chapters: its parts are « Étape 1 », and the guide's lines follow. */
const inKit = (line: string): string => line.replace(/\bce chapitre\b/g, 'cette étape').replace(/\bCe chapitre\b/g, 'Cette étape');

const withArticleOf = (audience: string): string => S(audience).charAt(0).toLowerCase() + S(audience).slice(1);

/**
 * The kit of a guide, null when the guide has nothing to print. Its own words stop at its title and its introduction, and it
 * keeps the guide's text behind them: a kit is worth what the guide it serves is worth, and that is what its buyers judge.
 * Only the printer leaves the reading out.
 */
export function kitContent(parent: Pick<Product, 'title' | 'audience' | 'content'>): PdfContent | null {
  const guide = parent.content;
  const sheets = guide ? kitSheets(guide) : [];
  if (!guide || !sheets.length) return null;
  const head = headOf(parent.title);
  return {
    ...guide,
    title: `Le kit à imprimer : ${head}`,
    subtitle: `${plural(sheets.length, 'fiche', 'fiches')} et ${plural(ticksOf(guide), 'case à cocher', 'cases à cocher')} pour ${withArticleOf(guide.audience || parent.audience)}`,
    promise: `Tout ce qu’il faut imprimer pour appliquer ${named(head)} : ${plural(sheets.length, 'fiche à remplir', 'fiches à remplir')} et le plan à cocher, étape par étape.`,
    introduction: [`Le guide explique, ce kit se remplit. ${plural(sheets.length, 'fiche', 'fiches')} à imprimer, le plan découpé étape par étape, une checklist par étape : imprimez, remplissez, cochez.`],
    nextStep: { title: S(parent.title), text: 'Tout ce que ce kit fait appliquer est expliqué dans le guide, chapitre par chapitre.', upsellProductId: null },
  };
}

/** A kit is bought in one click at checkout: its page says what is in the box and stops there. */
export function kitOffer(kit: Pick<Product, 'content'>, parent: Pick<Product, 'title' | 'salesPage'>): SalesPage {
  const content = kit.content!;
  const sheets = kitSheets(content);
  return {
    headline: S(content.title), subheadline: S(content.subtitle),
    painBullets: arr((parent.salesPage as SalesPage | null | undefined)?.painBullets),
    solution: `Toutes les fiches, tous les plans et toutes les checklists de ${named(headOf(parent.title))}, réunis pour l’imprimante.`,
    chapterBlurbs: arr(content.chapters).map((ch) => ({ title: S(ch.title), blurb: arr(ch.steps).length ? `Première case : ${inKit(stepText(arr(ch.steps)[0]!)).replace(/^./, (x) => x.toLowerCase())}.` : '' })),
    bonusBlurb: `Avec le bonus du guide : ${S(content.bonus?.title).replace(/^bonus\s*:\s*/i, '')}.`,
    objections: [{ q: 'Faut-il avoir le guide ?', a: 'Oui : le guide explique, le kit se remplit. Il vous est proposé à la commande du guide.' }],
    guarantee: 'Satisfait ou remboursé pendant 14 jours, sans justification.', cta: 'Ajouter le kit à ma commande', hypeLevel: 0.2,
  };
}

/** A kit's shop window: its real pages, each kind once, text under 12 pt as bars, as a guide's (pdf §11.3). */
function kitPreviews(cover: Printed, contents: Printed, sheet: Printed | undefined, plan: Printed | undefined): { label: string; svg: string }[] {
  const pages: [string, Printed | undefined][] = [['Couverture', cover], ['Le contenu du kit', contents], ['Fiche à imprimer', sheet], ['Le plan à cocher', plan]];
  return pages.flatMap(([label, page]) => (page ? [{ label, svg: toSvg(page.scene, { greekBelow: 12, precision: 1 }) }] : []));
}

/** Cover, what is in the box, every sheet, then the plan to tick, step by step. */
export async function renderKit(input: RenderInput): Promise<{ pages: number; bytes: number; previews: { label: string; svg: string }[] }> {
  const { content, product } = input;
  const book = bookOf(input);
  const { t, design } = book;
  const sheets = kitSheets(content);
  const prints = sheets.flatMap((sheet, k) => sheetPages(sheet, t, k + 1, sheets.length).map((scene, part) => ({ scene, scale: 1, outline: part ? null : S(sheet.title) })));

  const flow = new Flow(t);
  for (const { ch, kicker } of planParts(content, sheets)) {
    const steps = arr(ch.steps).map(stepText);
    const checks = unsaid(arr(ch.checklist), steps);
    flow.heading(kicker, S(ch.title));
    flow.ticks(steps.map(inKit));
    if (checks.length) {
      flow.label('Votre checklist');
      flow.ticks(checks.map(inKit));
    }
    if (ch.example) flow.example(inKit(S(ch.example)));
  }
  flow.rule();
  const plan = flow.pages.map((scene, k) => ({ scene, scale: 1, outline: k ? null : 'Le plan à cocher' }));

  const { s, y: top } = bandedPage(t, design, (design.artSeed ?? design.seed) + 1, 'Votre kit', book.title);
  const { v, inks } = t;
  let y = top + setLines(s, linesOf(S(content.promise), v.textIt, 12.2, FULL), L, top, { face: v.textIt, size: 12.2, leading: 17.4, fill: t.aText }) + 21.6;
  const rows = [
    ...sheets.map((sheet, k) => ({ title: S(sheet.title), page: 3 + prints.findIndex((p) => p.outline === S(sheet.title)), kicker: `Fiche ${k + 1}` })),
    ...(plan.length ? [{ title: 'Le plan à cocher, étape par étape', page: 3 + prints.length, kicker: 'Le plan' }] : []),
  ];
  for (const row of rows) {
    s.line(L, y, L + FULL, y, t.hair, 0.5);
    s.text(row.kicker.toUpperCase(), L, y + 15, v.labelB, 6.8, t.muted, { track: 1.2 });
    const lines = linesOf(row.title, v.deck, 11.5, FULL - 110);
    setLines(s, lines, L + 74, y + 6, { face: v.deck, size: 11.5, leading: 14.4, fill: inks.ink });
    s.text(String(row.page), L + FULL, y + 18, v.deck, 11.5, inks.ink, { anchor: 'end' });
    y += Math.max(1, lines.length) * 14.4 + 15;
  }
  s.line(L, y, L + FULL, y, t.hair, 0.5);
  y += 28.8;
  s.text('COMMENT L’UTILISER', L, y, v.labelB, 7.8, t.bText, { track: 1.6 });
  for (const p of arr(content.introduction)) y += setLines(s, linesOf(S(p), v.text, v.body + 0.4, MEASURE), L, y + 8, { face: v.text, size: v.body + 0.4, leading: 15, fill: inks.ink }) + 7.2;
  closing(s, t, `Ce kit accompagne le guide. Il ne remplace pas l’avis ${adviceOf(product, design)}, adapté à votre situation.`);
  const contents = { scene: s, scale: 1, outline: 'Votre kit' };
  const done = await finish(book, input, [contents, ...prints, ...plan]);
  return { ...done, previews: kitPreviews(book.cover, contents, prints[0], plan[0]) };
}

// ───────────────────────────── the sequence, to read ─────────────────────────────

const para = (text: string): string => text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(frenchNbsp(p)).replace(/\n/g, '<br>')}</p>`).join('');

/** The welcome mails as the team reads them, one page with no script: what the gallery opens. */
export function renderSequenceHtml(input: { title: string; steps: readonly Pick<EmailStep, 'day' | 'kind' | 'subject' | 'body'>[]; brand: string }): string {
  const mails = input.steps.map((m) => `<article><header><span>Jour ${m.day} · ${m.kind === 'pitch' ? 'proposition' : 'conseil'}</span><h2>${escapeHtml(frenchNbsp(m.subject))}</h2></header>${para(m.body)}</article>`).join('\n');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>
<style>
:root{color-scheme:light}body{margin:0;background:#f4f1ea;color:#23211d;font:16px/1.55 Georgia,'Times New Roman',serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}h1{font:700 26px/1.2 system-ui,sans-serif;margin:0 0 4px}main>p{margin:0 0 24px;color:#6b665c;font:14px/1.4 system-ui,sans-serif}
article{background:#fff;border:1px solid #e3ddd0;border-radius:6px;padding:20px;margin:0 0 16px}header span{font:600 12px/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#6b665c}
h2{font:600 18px/1.3 system-ui,sans-serif;margin:8px 0 12px}article p{margin:0 0 12px}
</style></head>
<body><main><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.brand)}</p>
${mails}
</main></body></html>
`;
}
