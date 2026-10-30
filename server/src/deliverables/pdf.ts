/**
 * The real A4 guide (pdfkit, standard fonts only): cover from the store SVG, "what you get" page,
 * clickable table of contents, introduction, chapters with step boxes / example callouts / checklists /
 * vector infographics, a bonus chapter and the "La suite est ici" upsell page. Footers and running heads
 * are drawn in a final pass over the buffered pages.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import type { ChapterContent, DesignSpec, PdfContent, Product } from '../shared.js';
import { contrast, darken, ensureContrast, isDark, lighten, mix, readableOn } from './color.js';
import { normalizeDesign } from './design.js';
import { renderCoverSvg } from './cover.js';
import { motifSvg, sparklePath } from './motifs.js';
import { drawCheckbox, drawCheckMark, drawIcon, layoutVisual, measure, put, type PdfTheme } from './pdfVisuals.js';
import { hashString, sanitizePdfText, truncate, wrapText, type StdFont } from './text.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = { top: 66, bottom: 72, left: 60, right: 60 };
const CW = PAGE_W - M.left - M.right;
const BODY_SIZE = 10.6;
const BODY_GAP = 3.6;

type Doc = PDFKit.PDFDocument;

interface Theme extends PdfTheme { bandA: string; bandB: string; bandFg: string; calloutBg: string }

interface TocEntry { kind: 'intro' | 'chapter' | 'bonus' | 'final'; label: string; title: string; page: number; dest: string }

interface PageMeta { section: string; opener: boolean }

const S = sanitizePdfText;
const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined) : []);
const pad2 = (k: number) => String(k).padStart(2, '0');

function themeFor(d: DesignSpec): Theme {
  const p = d.palette;
  const body = d.bodyFont as StdFont;
  const serif = body === 'Times-Roman';
  const ink = ensureContrast(p.ink, '#ffffff', 12);
  const bandA = darken(p.primary, 0.06);
  const bandB = mix(p.primary, p.secondary, 0.38);
  return {
    p,
    title: d.titleFont as StdFont,
    body,
    bold: serif ? 'Times-Bold' : 'Helvetica-Bold',
    italic: serif ? 'Times-Italic' : 'Helvetica-Oblique',
    ink,
    muted: mix(ink, '#ffffff', 0.4),
    primaryInk: ensureContrast(p.primary, '#ffffff', 4.8),
    accentInk: ensureContrast(darken(p.accent, 0.1), '#ffffff', 3.6),
    line: mix(p.primary, '#ffffff', 0.75),
    card: mix(p.soft, '#ffffff', 0.2),
    bandA, bandB,
    bandFg: readableOn(mix(bandA, bandB, 0.5), ink),
    calloutBg: mix(mix(p.soft, '#ffffff', 0.3), p.accent, 0.1),
  };
}

/** Pushes a decorative colour lighter (on dark bands) or darker (on light bands) until it reads well. */
function tone(c: string, bg: string, light: boolean, min = 3.2): string {
  let x = c;
  for (let i = 0; i < 12 && contrast(x, bg) < min; i++) x = light ? lighten(x, 0.15) : darken(x, 0.15);
  return x;
}

const fontCallback = (family: string, bold: boolean, italic: boolean): string => {
  const f = (family || '').toLowerCase();
  if (/courier|monospace/.test(f)) return bold ? 'Courier-Bold' : italic ? 'Courier-Oblique' : 'Courier';
  if (/georgia|times|serif/.test(f.replace('sans-serif', ''))) return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  return bold && italic ? 'Helvetica-BoldOblique' : bold ? 'Helvetica-Bold' : italic ? 'Helvetica-Oblique' : 'Helvetica';
};

class GuideWriter {
  readonly metas: PageMeta[] = [];
  readonly toc: TocEntry[] = [];
  readonly warnings: string[] = [];
  private section = '';
  private nextOpener = false;

  constructor(readonly doc: Doc, readonly t: Theme, readonly design: DesignSpec, readonly brand: string, readonly title: string) {
    doc.on('pageAdded', () => {
      this.metas.push({ section: this.section, opener: this.nextOpener });
      this.nextOpener = false;
    });
  }

  get bottom(): number { return PAGE_H - M.bottom; }
  get pageIndex(): number { return this.metas.length - 1; }

  newPage(section: string, opener = true): void {
    this.section = section;
    this.nextOpener = opener;
    this.doc.addPage({ size: 'A4', margins: M });
    this.doc.x = M.left;
    this.doc.y = M.top;
  }

  ensure(h: number): void {
    if (this.doc.y + h > this.bottom) this.newPage(this.section, false);
  }

  svg(svg: string, x: number, y: number, w: number, h: number, aspect = 'xMidYMid meet'): boolean {
    try {
      SVGtoPDF(this.doc, svg, x, y, { width: w, height: h, preserveAspectRatio: aspect, fontCallback, warningCallback: (m) => this.warnings.push(m) });
      return true;
    } catch (err) {
      this.warnings.push(`svg: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── text primitives ───

  para(text: string, o: { size?: number; font?: StdFont; color?: string; gap?: number; after?: number; indent?: number; align?: 'left' | 'justify' } = {}): void {
    const s = S(text);
    if (!s) return;
    const { doc, t } = this;
    const size = o.size ?? BODY_SIZE;
    const gap = o.gap ?? BODY_GAP;
    doc.font(o.font ?? t.body).fontSize(size);
    this.ensure((doc.currentLineHeight(true) + gap) * 2.2); // never a lone first line at the bottom of a page
    doc.fillColor(o.color ?? t.ink).text(s, M.left + (o.indent ?? 0), doc.y, { width: CW - (o.indent ?? 0), lineGap: gap, align: o.align ?? 'left' });
    doc.y += o.after ?? 8;
  }

  /** Small accent bar + bold heading, kept with at least a few lines of what follows. */
  subheading(text: string, keepWith = 72): void {
    const s = S(text);
    if (!s) return;
    const { doc, t } = this;
    const h = measure(doc, s, t.bold, 13.5, CW - 14);
    this.ensure(h + keepWith);
    doc.y += 6;
    const y = doc.y;
    doc.save();
    doc.roundedRect(M.left, y + 1, 4, Math.max(14, h - 2), 2).fill(t.p.accent);
    doc.restore();
    put(doc, s, M.left + 13, y, { font: t.bold, size: 13.5, color: t.primaryInk, width: CW - 14 });
    doc.y = y + h + 9;
    doc.x = M.left;
  }

  label(text: string, x: number, y: number, color: string, size = 8.5): void {
    put(this.doc, S(text).toUpperCase(), x, y, { font: 'Helvetica-Bold', size, color, width: CW, spacing: 1.6 });
  }

  // ─── pages & blocks ───

  /** Chapter-style header band; returns nothing, moves doc.y below the band. */
  band(o: { label: string; number: string | null; title: string; section: string; dest: string; bonus?: boolean; art?: boolean }): void {
    const { doc, t } = this;
    this.newPage(o.section, true);
    doc.addNamedDestination(o.dest);
    const title = S(o.title);
    const titleSize = title.length > 70 ? 21 : 24;
    const titleW = CW - 140;
    const titleH = measure(doc, title, t.title, titleSize, titleW, 2);
    const titleY = o.number ? 122 : 80;
    const bandH = Math.max(196, titleY + titleH + 38);

    const a = o.bonus ? darken(t.p.accent, 0.05) : t.bandA;
    const b = o.bonus ? mix(t.p.accent, t.p.primary, 0.35) : t.bandB;
    const fg = o.bonus ? readableOn(mix(a, b, 0.5), t.ink) : t.bandFg;
    doc.save();
    const g = doc.linearGradient(0, 0, PAGE_W, bandH);
    g.stop(0, a).stop(1, b);
    doc.rect(0, 0, PAGE_W, bandH).fill(g);
    doc.circle(PAGE_W - 30, 20, 120).fillOpacity(0.08).fill('#ffffff');
    doc.circle(PAGE_W - 150, bandH + 10, 60).fillOpacity(0.06).fill('#ffffff');
    doc.fillOpacity(1);
    doc.rect(0, bandH, PAGE_W, 4).fill(o.bonus ? t.p.primary : t.p.accent);
    doc.restore();

    const mid = mix(a, b, 0.5);
    const light = fg === '#ffffff';
    const labelColor = tone(light ? lighten(o.bonus ? t.p.primary : t.p.accent, 0.35) : darken(t.p.primary, 0.2), mid, light);
    this.label(o.label, M.left, 50, labelColor, 9);
    if (o.number) put(doc, o.number, M.left - 3, 68, { font: t.title, size: 50, color: tone(light ? lighten(t.p.accent, 0.15) : t.primaryInk, mid, light, 2.6), width: 150 });
    put(doc, title, M.left, titleY, { font: t.title, size: titleSize, color: fg, width: titleW, lineGap: 2 });

    // illustration on the right of the band
    const artSize = 118;
    const ax = PAGE_W - M.right - artSize + 6;
    const ay = Math.max(40, (bandH - artSize) / 2 + 6);
    doc.save();
    doc.circle(ax + artSize / 2, ay + artSize / 2, artSize / 2 + 4).fillOpacity(0.12).fill('#ffffff');
    doc.restore();
    if (o.bonus) this.giftIcon(ax + artSize / 2, ay + artSize / 2 + 4, 70, fg);
    else if (o.art !== false) this.svg(motifSvg(this.design.motif, t.p, `b${hashString(o.dest).toString(36)}`, hashString(o.dest) % 5), ax, ay, artSize, artSize);
    if (o.bonus) this.ribbon('BONUS OFFERT');

    doc.x = M.left;
    doc.y = bandH + 28;
  }

  private giftIcon(cx: number, cy: number, s: number, fg: string): void {
    const { doc, t } = this;
    const box = fg === '#ffffff' ? '#ffffff' : t.p.primary;
    const tie = fg === '#ffffff' ? t.p.primary : t.p.accent;
    doc.save();
    doc.roundedRect(cx - s / 2, cy - s * 0.18, s, s * 0.62, 5).fill(box);
    doc.roundedRect(cx - s * 0.56, cy - s * 0.38, s * 1.12, s * 0.24, 5).fill(mix(box, tie, 0.15));
    doc.rect(cx - s * 0.09, cy - s * 0.38, s * 0.18, s * 0.82).fill(tie);
    doc.lineWidth(s * 0.07).strokeColor(tie).lineCap('round')
      .moveTo(cx, cy - s * 0.38).bezierCurveTo(cx - s * 0.1, cy - s * 0.7, cx - s * 0.42, cy - s * 0.62, cx - s * 0.3, cy - s * 0.42)
      .lineTo(cx, cy - s * 0.38)
      .bezierCurveTo(cx + s * 0.1, cy - s * 0.7, cx + s * 0.42, cy - s * 0.62, cx + s * 0.3, cy - s * 0.42)
      .lineTo(cx, cy - s * 0.38).stroke();
    doc.restore();
  }

  private ribbon(text: string): void {
    const { doc, t } = this;
    const cx = PAGE_W - 46;
    const cy = 46;
    doc.save();
    doc.rotate(45, { origin: [cx, cy] });
    doc.rect(cx - 120, cy - 15, 240, 30).fill(darken(t.p.primary, 0.15));
    doc.rect(cx - 120, cy - 12, 240, 1).fill(t.p.accent);
    doc.rect(cx - 120, cy + 11, 240, 1).fill(t.p.accent);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
    const w = doc.widthOfString(text) + text.length * 1.4;
    doc.text(text, cx - w / 2, cy - 5, { lineBreak: false, characterSpacing: 1.4 });
    doc.restore();
  }

  lead(text: string): void {
    this.para(text, { size: 12.6, color: this.t.primaryInk, gap: 4.2, after: 12 });
  }

  steps(items: string[]): void {
    const clean = items.map((s) => S(s).replace(/^\s*(?:\d+\s*[.)\-–—:]|étape\s*\d+\s*[:.\-–—]?)\s*/i, '')).filter(Boolean);
    if (clean.length === 0) return;
    const { doc, t } = this;
    this.subheading('Étape par étape', 60);
    clean.forEach((s, k) => {
      const textW = CW - 62;
      const th = measure(doc, s, t.body, 10.4, textW, 3);
      const h = Math.max(42, th + 24);
      if (h > this.bottom - M.top - 20) { this.para(`${k + 1}. ${s}`); return; }
      this.ensure(h + 8);
      const y = doc.y;
      doc.save();
      doc.roundedRect(M.left, y, CW, h, 9).fill(t.card);
      doc.roundedRect(M.left, y, 5, h, 2.5).fill(lighten(t.p.primary, 0.3));
      doc.circle(M.left + 30, y + Math.min(h / 2, 22), 13).fill(t.p.primary);
      doc.restore();
      put(doc, String(k + 1), M.left + 17, y + Math.min(h / 2, 22) - 6, { font: 'Helvetica-Bold', size: 12, color: readableOn(t.p.primary, t.ink), width: 26, align: 'center' });
      put(doc, s, M.left + 54, y + (h - th) / 2 + 1, { font: t.body, size: 10.4, color: t.ink, width: textW, lineGap: 3 });
      doc.y = y + h + 8;
    });
    doc.y += 6;
  }

  example(text: string | null | undefined): void {
    const s = S(text ?? '');
    if (!s) return;
    const { doc, t } = this;
    const textW = CW - 44;
    const th = measure(doc, s, t.italic, 10.8, textW, 3.4);
    const h = th + 52;
    if (h > this.bottom - M.top - 20) { this.subheading('Exemple concret'); this.para(s, { font: t.italic }); return; }
    this.ensure(h + 14);
    doc.y += 4;
    const y = doc.y;
    doc.save();
    doc.roundedRect(M.left, y, CW, h, 10).fill(t.calloutBg);
    doc.rect(M.left, y + 10, 4, h - 20).fill(t.p.accent);
    doc.restore();
    put(doc, '”', M.left + CW - 58, y - 2, { font: 'Times-Bold', size: 72, color: lighten(t.p.accent, 0.4), width: 50, align: 'right' });
    drawIcon(doc, 'chat', M.left + 26, y + 21, 15, t.accentInk, 1.9);
    this.label('Exemple concret', M.left + 40, y + 17, t.accentInk, 8.5);
    put(doc, s, M.left + 22, y + 38, { font: t.italic, size: 10.8, color: t.ink, width: textW, lineGap: 3.4 });
    doc.y = y + h + 16;
  }

  checklist(items: string[], title = 'Votre checklist'): void {
    const clean = items.map((s) => S(s).replace(/^\s*[-•*]\s*/, '')).filter(Boolean);
    if (clean.length === 0) return;
    const { doc, t } = this;
    const textW = CW - 64;
    const hs = clean.map((s) => Math.max(13, measure(doc, s, t.body, 10.4, textW, 2.5)));
    const total = 50 + hs.reduce((a, h) => a + h + 10, 0) + 8;
    const fitsOnPage = total <= this.bottom - M.top - 20;
    this.ensure(fitsOnPage ? total + 12 : 120);
    let y = doc.y + 4;
    if (fitsOnPage) {
      doc.save();
      doc.roundedRect(M.left, y, CW, total, 10).fill('#ffffff');
      doc.roundedRect(M.left, y, CW, total, 10).lineWidth(1.2).dash(4, { space: 3 }).strokeColor(lighten(t.p.primary, 0.45)).stroke().undash();
      doc.restore();
    }
    drawCheckMark(doc, M.left + 28, y + 24, 10, t.p.primary, readableOn(t.p.primary, t.ink));
    put(doc, S(title), M.left + 46, y + 17, { font: t.bold, size: 12.5, color: t.primaryInk, width: CW - 60 });
    y += 48;
    clean.forEach((s, k) => {
      if (!fitsOnPage && y + hs[k] > this.bottom) { this.newPage(this.section, false); y = doc.y; }
      drawCheckbox(doc, M.left + 22, y, 12, t.p.primary, false);
      put(doc, s, M.left + 44, y + 0.5, { font: t.body, size: 10.4, color: t.ink, width: textW, lineGap: 2.5 });
      y += hs[k] + 10;
    });
    doc.y = y + (fitsOnPage ? 18 : 10);
  }

  visual(v: ChapterContent['visual']): void {
    const { doc, t } = this;
    const layout = layoutVisual(doc, v, CW, t);
    if (!layout) return;
    const maxH = this.bottom - M.top - 10;
    if (layout.height > maxH) return; // pathological: never break a drawing across pages
    this.ensure(layout.height + 12);
    doc.y += 4;
    const y = doc.y;
    layout.draw(M.left, y);
    doc.y = y + layout.height + 18;
    doc.x = M.left;
  }

  chapter(ch: ChapterContent, index: number | null): void {
    const isBonus = index === null;
    const n = isBonus ? 0 : index + 1;
    const dest = isBonus ? 'bonus' : `chapitre-${n}`;
    const title = S(ch?.title) || (isBonus ? 'Bonus' : `Chapitre ${n}`);
    this.toc.push({ kind: isBonus ? 'bonus' : 'chapter', label: isBonus ? 'Bonus' : `Chapitre ${n}`, title, page: 0, dest });
    this.band({
      label: isBonus ? 'Chapitre bonus' : `Chapitre ${n}`,
      number: isBonus ? null : pad2(n),
      title,
      section: isBonus ? `Bonus · ${title}` : `Chapitre ${n} · ${title}`,
      dest,
      bonus: isBonus,
    });
    this.toc[this.toc.length - 1].page = this.pageIndex + 1;
    if (isBonus) this.bonusNote();
    if (ch?.intro) this.lead(ch.intro);
    for (const p of arr(ch?.paragraphs)) this.para(p);
    this.steps(arr(ch?.steps));
    this.visual(ch?.visual ?? null);
    this.example(ch?.example);
    this.checklist(arr(ch?.checklist));
  }

  private bonusNote(): void {
    const { doc, t } = this;
    const s = 'Ce chapitre est un cadeau : il n’est pas indispensable, mais il fait gagner un temps fou une fois les bases en place.';
    const h = measure(doc, s, t.bold, 10, CW - 60) + 22;
    const y = doc.y;
    doc.save();
    doc.roundedRect(M.left, y, CW, h, 9).fill(mix('#ffffff', t.p.accent, 0.16));
    doc.restore();
    drawIcon(doc, 'star', M.left + 22, y + h / 2, 16, t.accentInk, 2);
    put(doc, s, M.left + 42, y + 11, { font: t.bold, size: 10, color: darken(t.accentInk, 0.2), width: CW - 60 });
    doc.y = y + h + 16;
  }
}

// ───────────────────────────── page builders ─────────────────────────────

function coverPage(w: GuideWriter, product: Product, content: PdfContent): void {
  const { doc, t } = w;
  w.newPage('', true);
  doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(t.p.bg);
  const svg = renderCoverSvg({
    title: S(content.title || product.title),
    subtitle: S(content.subtitle || product.subtitle),
    audience: S(content.audience || product.audience),
    design: w.design,
    brand: S(w.brand),
  });
  if (!w.svg(svg, 0, 0, PAGE_W, PAGE_H, 'xMidYMid slice')) fallbackCover(w, product, content);
}

/** Pure pdfkit cover, used only if svg-to-pdfkit fails. */
function fallbackCover(w: GuideWriter, product: Product, content: PdfContent): void {
  const { doc, t } = w;
  const g = doc.linearGradient(0, 0, 0, PAGE_H);
  g.stop(0, t.p.bg).stop(1, isDark(t.p.bg) ? mix(t.p.bg, t.p.primary, 0.6) : mix(t.p.bg, t.p.secondary, 0.35));
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(g);
  const fg = readableOn(t.p.bg, t.ink);
  doc.save();
  doc.circle(PAGE_W / 2, 250, 150).fillOpacity(0.18).fill(t.p.accent);
  doc.fillOpacity(1);
  doc.path(sparklePath(PAGE_W / 2, 250, 95)).fill(t.p.accent);
  doc.path(sparklePath(PAGE_W / 2 + 120, 150, 26)).fill(t.p.secondary);
  doc.restore();
  put(doc, 'GUIDE PDF', 0, 60, { font: 'Helvetica-Bold', size: 11, color: fg, width: PAGE_W, align: 'center', spacing: 2.5 });
  put(doc, S(content.title || product.title), 50, 450, { font: t.title, size: 34, color: fg, width: PAGE_W - 100, align: 'center', lineGap: 2 });
  put(doc, S(content.subtitle || product.subtitle), 70, 610, { font: t.body, size: 15, color: fg, width: PAGE_W - 140, align: 'center' });
  put(doc, `Pour : ${S(content.audience || product.audience)}`, 70, 700, { font: 'Helvetica-Bold', size: 12, color: fg, width: PAGE_W - 140, align: 'center' });
  put(doc, S(w.brand).toUpperCase(), 0, PAGE_H - 50, { font: 'Helvetica-Bold', size: 11, color: fg, width: PAGE_W, align: 'center', spacing: 2 });
}

function wordCountOf(content: PdfContent): number {
  if (Number.isFinite(content.wordCount) && content.wordCount > 0) return content.wordCount;
  const all = [
    ...arr(content.introduction),
    ...arr(content.chapters).flatMap((c) => [c.intro, ...arr(c.paragraphs), ...arr(c.steps), c.example ?? '', ...arr(c.checklist)]),
  ].join(' ');
  return all.split(/\s+/).filter(Boolean).length;
}

function promisePage(w: GuideWriter, product: Product, content: PdfContent): void {
  const { doc, t } = w;
  w.newPage('', true);
  w.label('Avant de commencer', M.left, M.top - 4, t.accentInk, 9);
  put(doc, 'Ce que vous allez obtenir', M.left, M.top + 12, { font: t.title, size: 26, color: t.ink, width: CW });
  doc.y = M.top + 12 + measure(doc, 'Ce que vous allez obtenir', t.title, 26, CW) + 18;

  // promise card
  const promise = S(content.promise) || S(product.subtitle);
  if (promise) {
    const ph = measure(doc, promise, t.bold, 14, CW - 64, 4) + 40;
    const y = doc.y;
    doc.save();
    const g = doc.linearGradient(M.left, y, M.left + CW, y + ph);
    g.stop(0, t.bandA).stop(1, t.bandB);
    doc.roundedRect(M.left, y, CW, ph, 12).fill(g);
    doc.restore();
    drawIcon(doc, 'target', M.left + 26, y + 26, 20, t.bandFg, 2);
    put(doc, promise, M.left + 46, y + 20, { font: t.bold, size: 14, color: t.bandFg, width: CW - 64, lineGap: 4 });
    doc.y = y + ph + 18;
  }

  // who / problem cards
  const who = S(content.audience || product.audience);
  const problem = S(product.problem);
  const colW = (CW - 14) / 2;
  const cards = [
    { icon: 'people' as const, head: 'Pour qui ?', text: who },
    { icon: 'bulb' as const, head: 'Le problème que l’on règle', text: problem || S(arr(content.introduction)[0] ?? '') },
  ].filter((c) => c.text);
  if (cards.length) {
    const cw = cards.length === 2 ? colW : CW;
    const ch = Math.max(...cards.map((c) => measure(doc, truncate(c.text, 260), t.body, 10.2, cw - 32, 2.6))) + 58;
    w.ensure(ch + 10);
    const y = doc.y;
    cards.forEach((c, k) => {
      const x = M.left + k * (colW + 14);
      doc.save();
      doc.roundedRect(x, y, cw, ch, 10).fill(t.card);
      doc.circle(x + 28, y + 28, 14).fill(mix('#ffffff', t.p.primary, 0.18));
      doc.restore();
      drawIcon(doc, c.icon, x + 28, y + 28, 16, t.primaryInk, 1.9);
      put(doc, c.head, x + 50, y + 22, { font: t.bold, size: 11.5, color: t.primaryInk, width: cw - 60 });
      put(doc, truncate(c.text, 260), x + 16, y + 50, { font: t.body, size: 10.2, color: t.ink, width: cw - 32, lineGap: 2.6 });
    });
    doc.y = y + ch + 20;
  }

  // what's inside
  const chapters = arr(content.chapters);
  if (chapters.length) {
    w.subheading('Dans ce guide, vous allez :', 40);
    for (const ch of chapters.slice(0, 8)) {
      const s = S(ch.title);
      const h = Math.max(15, measure(doc, s, t.body, 10.6, CW - 30));
      w.ensure(h + 8);
      const y = doc.y;
      drawCheckMark(doc, M.left + 8, y + 7, 7, t.p.primary, readableOn(t.p.primary, t.ink));
      put(doc, s, M.left + 24, y, { font: t.body, size: 10.6, color: t.ink, width: CW - 30 });
      doc.y = y + h + 7;
    }
    if (content.bonus?.title) {
      const s = `Bonus offert : ${S(content.bonus.title)}`;
      const h = Math.max(15, measure(doc, s, t.bold, 10.6, CW - 30));
      w.ensure(h + 8);
      const y = doc.y;
      drawIcon(doc, 'star', M.left + 8, y + 7, 14, t.accentInk, 2);
      put(doc, s, M.left + 24, y, { font: t.bold, size: 10.6, color: t.accentInk, width: CW - 30 });
      doc.y = y + h + 7;
    }
    doc.y += 4;
  }

  // key figures
  const steps = chapters.reduce((s, c) => s + arr(c.steps).length, 0);
  const checks = chapters.reduce((s, c) => s + arr(c.checklist).length, 0);
  const minutes = Math.max(5, Math.round(wordCountOf(content) / 200));
  const stats = [
    [String(chapters.length), chapters.length > 1 ? 'chapitres' : 'chapitre'],
    [String(steps), steps > 1 ? 'étapes concrètes' : 'étape concrète'],
    [String(checks), 'points à cocher'],
    [`${minutes} min`, 'de lecture'],
  ];
  w.ensure(74);
  const y = doc.y;
  const sw = (CW - 3 * 10) / 4;
  stats.forEach(([big, small], k) => {
    const x = M.left + k * (sw + 10);
    doc.save();
    doc.roundedRect(x, y, sw, 56, 10).fill(k % 2 ? mix('#ffffff', t.p.accent, 0.16) : mix('#ffffff', t.p.primary, 0.12));
    doc.restore();
    put(doc, big, x, y + 9, { font: t.title, size: 20, color: k % 2 ? t.accentInk : t.primaryInk, width: sw, align: 'center' });
    put(doc, small, x + 4, y + 34, { font: t.body, size: 8.8, color: t.muted, width: sw - 8, align: 'center' });
  });
  doc.y = y + 56 + 16;

  // how to use it
  const how = [
    ['Lisez un chapitre à la fois', 'Chaque chapitre règle une partie précise du problème.'],
    ['Appliquez le jour même', 'Les étapes sont pensées pour être testées tout de suite.'],
    ['Cochez la checklist', 'Passez à la suite seulement quand tout est coché.'],
  ];
  const hw = (CW - 2 * 10) / 3;
  const headHs = how.map(([head]) => measure(doc, head, t.bold, 9.6, hw - 40));
  const textHs = how.map(([, text]) => measure(doc, text, t.body, 8.6, hw - 22));
  const hh = Math.max(...how.map((_, k) => 12 + Math.max(16, headHs[k]) + 8 + textHs[k] + 10));
  if (doc.y + hh + 34 <= w.bottom) {
    w.subheading('Comment utiliser ce guide', 40);
    const hy = doc.y;
    how.forEach(([head, text], k) => {
      const x = M.left + k * (hw + 10);
      doc.save();
      doc.roundedRect(x, hy, hw, hh, 9).lineWidth(1).strokeColor(t.line).stroke();
      doc.circle(x + 18, hy + 18, 10).fill(t.p.accent);
      doc.restore();
      put(doc, String(k + 1), x + 8, hy + 13.5, { font: 'Helvetica-Bold', size: 10, color: readableOn(t.p.accent, t.ink), width: 20, align: 'center' });
      put(doc, head, x + 34, hy + 12 + (headHs[k] < 16 ? 2 : 0), { font: t.bold, size: 9.6, color: t.ink, width: hw - 40 });
      put(doc, text, x + 12, hy + 12 + Math.max(16, headHs[k]) + 8, { font: t.body, size: 8.6, color: t.muted, width: hw - 22 });
    });
    doc.y = hy + hh + 10;
  }
}

function introPage(w: GuideWriter, product: Product, content: PdfContent): void {
  const { doc, t } = w;
  w.toc.push({ kind: 'intro', label: 'Introduction', title: 'Le point de départ', page: 0, dest: 'introduction' });
  w.band({ label: 'Introduction', number: null, title: 'Le point de départ', section: 'Introduction', dest: 'introduction' });
  w.toc[w.toc.length - 1].page = w.pageIndex + 1;
  const intro = arr(content.introduction).map(S).filter(Boolean);
  const paragraphs = intro.length ? intro : [S(product.problem)].filter(Boolean);
  paragraphs.forEach((p, k) => (k === 0 ? w.lead(p) : w.para(p)));
  const problem = S(product.problem);
  if (problem && !paragraphs.some((p) => p.includes(problem))) {
    const qh = measure(doc, problem, t.italic, 13, CW - 70, 3.5) + 30;
    w.ensure(qh + 16);
    const y = doc.y + 4;
    doc.save();
    doc.rect(M.left + 10, y, 3, qh).fill(t.p.accent);
    doc.restore();
    put(doc, '“', M.left + 22, y - 8, { font: 'Times-Bold', size: 46, color: lighten(t.p.accent, 0.1), width: 40 });
    put(doc, problem, M.left + 52, y + 14, { font: t.italic, size: 13, color: t.primaryInk, width: CW - 70, lineGap: 3.5 });
    doc.y = y + qh + 18;
  }
  const promise = S(content.promise);
  if (promise) {
    const head = 'À la fin de ce guide';
    const ph = measure(doc, promise, t.body, 10.8, CW - 40, 3) + 52;
    w.ensure(ph + 10);
    const y = doc.y;
    doc.save();
    doc.roundedRect(M.left, y, CW, ph, 10).fill(mix('#ffffff', t.p.primary, 0.1));
    doc.restore();
    drawCheckMark(doc, M.left + 26, y + 24, 9, t.p.primary, readableOn(t.p.primary, t.ink));
    put(doc, head, M.left + 42, y + 17, { font: t.bold, size: 12, color: t.primaryInk, width: CW - 60 });
    put(doc, promise, M.left + 20, y + 40, { font: t.body, size: 10.8, color: t.ink, width: CW - 40, lineGap: 3 });
    doc.y = y + ph + 14;
  }
}

function finalPage(w: GuideWriter, content: PdfContent, product: Product, upsell: { title: string; url: string } | null | undefined): void {
  const { doc, t } = w;
  const next = content.nextStep ?? { title: '', text: '', upsellProductId: null };
  w.toc.push({ kind: 'final', label: 'Et après ?', title: 'La suite est ici', page: 0, dest: 'la-suite' });
  w.newPage('La suite est ici', true);
  doc.addNamedDestination('la-suite');
  w.toc[w.toc.length - 1].page = w.pageIndex + 1;

  const subtitle = S(next.title);
  const subH = subtitle ? measure(doc, subtitle, t.body, 15, CW - 150, 3) : 0;
  const bandH = Math.max(270, 168 + subH + 40);
  doc.save();
  const g = doc.linearGradient(0, 0, PAGE_W, bandH);
  g.stop(0, t.bandA).stop(1, t.bandB);
  doc.rect(0, 0, PAGE_W, bandH).fill(g);
  doc.circle(70, bandH - 10, 90).fillOpacity(0.07).fill('#ffffff');
  doc.fillOpacity(1);
  doc.rect(0, bandH, PAGE_W, 4).fill(t.p.accent);
  doc.restore();
  w.svg(motifSvg(w.design.motif, t.p, 'fin', 3), PAGE_W - M.right - 150, 60, 150, 150);
  const bandLight = t.bandFg === '#ffffff';
  w.label('Et maintenant ?', M.left, 66, tone(bandLight ? lighten(t.p.accent, 0.35) : t.primaryInk, mix(t.bandA, t.bandB, 0.5), bandLight), 9.5);
  put(doc, 'La suite est ici', M.left, 86, { font: t.title, size: 36, color: t.bandFg, width: CW - 150 });
  if (subtitle) put(doc, subtitle, M.left, 150, { font: t.body, size: 15, color: t.bandFg, width: CW - 150, lineGap: 3 });
  doc.x = M.left;
  doc.y = bandH + 30;

  const paragraphs = S(next.text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  paragraphs.forEach((p, k) => w.para(p, k === 0 ? { size: 11.6, gap: 4 } : {}));

  // big CTA button
  // absolute store URL, or a run-relative one ("/runs/<id>/files/…/sales-page.html") resolved by the viewer
  const rawUrl = String(upsell?.url ?? '').trim();
  const url = /^https?:\/\//i.test(rawUrl) || /^\.{0,2}\/(?!\/)/.test(rawUrl) ? rawUrl : null;
  const cta = upsell?.title ? `Découvrir « ${truncate(S(upsell.title), 46)} »` : 'Je passe à l’étape suivante';
  doc.font('Helvetica-Bold').fontSize(14);
  const bw = Math.min(CW, Math.max(300, doc.widthOfString(cta) + 70));
  const bh = 56;
  w.ensure(bh + 60);
  doc.y += 8;
  const bx = M.left + (CW - bw) / 2;
  const by = doc.y;
  doc.save();
  doc.roundedRect(bx + 2, by + 5, bw, bh, bh / 2).fillOpacity(0.18).fill(darken(t.p.accent, 0.5));
  doc.fillOpacity(1);
  doc.roundedRect(bx, by, bw, bh, bh / 2).fill(t.p.accent);
  doc.restore();
  const ctaFg = readableOn(t.p.accent, t.ink);
  put(doc, cta, bx + 20, by + 21, { font: 'Helvetica-Bold', size: 14, color: ctaFg, width: bw - 64, align: 'center' });
  doc.save();
  doc.lineWidth(2.4).lineCap('round').lineJoin('round').strokeColor(ctaFg)
    .moveTo(bx + bw - 40, by + bh / 2).lineTo(bx + bw - 26, by + bh / 2)
    .moveTo(bx + bw - 31, by + bh / 2 - 5).lineTo(bx + bw - 26, by + bh / 2).lineTo(bx + bw - 31, by + bh / 2 + 5).stroke();
  doc.restore();
  if (url) doc.link(bx, by, bw, bh, url);
  const under = url && /^https?:/i.test(url) ? url.replace(/^https?:\/\//i, '') : 'Disponible sur notre boutique';
  put(doc, S(under), M.left, by + bh + 10, { font: t.body, size: 9, color: t.muted, width: CW, align: 'center' });
  doc.y = by + bh + 40;

  // quick recap of the chapters
  const chapters = arr(content.chapters);
  if (chapters.length) {
    const colW = (CW - 16) / 2;
    const items = chapters.slice(0, 8).map((c) => S(c.title));
    const half = Math.ceil(items.length / 2);
    const colHeights = [items.slice(0, half), items.slice(half)].map((col) => col.reduce((s, it) => s + Math.max(14, measure(doc, it, t.body, 9.6, colW - 40)) + 7, 0));
    const boxH = 46 + Math.max(...colHeights);
    if (doc.y + boxH + 90 <= w.bottom) {
      const y = doc.y;
      doc.save();
      doc.roundedRect(M.left, y, CW, boxH, 10).fill(t.card);
      doc.restore();
      put(doc, 'Ce que vous savez faire maintenant', M.left + 16, y + 14, { font: t.bold, size: 11.5, color: t.primaryInk, width: CW - 32 });
      [items.slice(0, half), items.slice(half)].forEach((col, c) => {
        let cy = y + 38;
        col.forEach((it) => {
          const h = Math.max(14, measure(doc, it, t.body, 9.6, colW - 40));
          drawCheckMark(doc, M.left + 22 + c * (colW + 16), cy + 6, 5.5, t.p.primary, readableOn(t.p.primary, t.ink));
          put(doc, it, M.left + 34 + c * (colW + 16), cy, { font: t.body, size: 9.6, color: t.ink, width: colW - 40 });
          cy += h + 7;
        });
      });
      doc.y = y + boxH + 18;
    }
  }

  // thanks + disclaimer
  const thanks = `Merci de votre confiance. Si ce guide vous a aidé, dites-le nous : chaque retour nous aide à l’améliorer pour la prochaine version. — L’équipe ${S(w.brand)}`;
  w.para(thanks, { font: t.italic, size: 10.4, color: t.muted, after: 10 });
  const disclaimer = `Ce guide est fourni à titre informatif et pédagogique. Il ne remplace pas l’avis d’un professionnel qualifié (médecin, vétérinaire, conseiller financier…) adapté à votre situation. Version ${Math.max(1, Math.trunc(product.version || 1))}.`;
  w.para(disclaimer, { size: 8, color: t.muted, after: 0 });
}

function drawToc(w: GuideWriter, tocPage: number): void {
  const { doc, t } = w;
  doc.switchToPage(tocPage);
  const oldBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  w.label('Sommaire', M.left, M.top - 4, t.accentInk, 9);
  put(doc, 'Au programme', M.left, M.top + 12, { font: t.title, size: 26, color: t.ink, width: CW });
  let y = M.top + 64;
  const entries = w.toc;
  const avail = PAGE_H - M.bottom - y;
  let size = 12;
  const titleW = CW - 120;
  const rowH = (s: number) => entries.reduce((sum, e) => sum + Math.max(1, wrapText(e.title, titleW, t.bold, s).length) * (s + 4) + 24, 0);
  while (size > 9 && rowH(size) > avail) size -= 0.5;
  for (const e of entries) {
    const lines = wrapText(e.title, titleW, t.bold, size);
    const h = Math.max(1, lines.length) * (size + 4) + 14;
    const isChapter = e.kind === 'chapter';
    const chipColor = e.kind === 'bonus' ? t.p.accent : e.kind === 'chapter' ? t.p.primary : mix('#ffffff', t.p.primary, 0.2);
    doc.save();
    doc.circle(M.left + 16, y + h / 2 - 2, 15).fill(chipColor);
    doc.restore();
    if (isChapter) {
      const num = e.label.replace(/\D+/g, '');
      put(doc, pad2(Number(num) || 0), M.left + 1, y + h / 2 - 8, { font: 'Helvetica-Bold', size: 11, color: readableOn(chipColor, t.ink), width: 30, align: 'center' });
    } else {
      drawIcon(doc, e.kind === 'bonus' ? 'star' : e.kind === 'intro' ? 'book' : 'target', M.left + 16, y + h / 2 - 2, 15, e.kind === 'bonus' ? readableOn(chipColor, t.ink) : t.primaryInk, 1.9);
    }
    put(doc, e.label.toUpperCase(), M.left + 44, y - 2, { font: 'Helvetica-Bold', size: 7.5, color: t.muted, width: titleW, spacing: 1.2 });
    let ly = y + 9;
    lines.forEach((line) => {
      doc.font(t.bold).fontSize(size).fillColor(t.ink).text(line, M.left + 44, ly, { lineBreak: false });
      ly += size + 4;
    });
    const last = lines[lines.length - 1] ?? '';
    doc.font(t.bold).fontSize(size);
    const lastW = doc.widthOfString(last);
    const pageStr = String(e.page);
    const numW = doc.widthOfString(pageStr);
    const leaderY = ly - 4 - size * 0.25;
    const fromX = M.left + 44 + lastW + 8;
    const toX = M.left + CW - numW - 8;
    if (toX > fromX) {
      doc.save();
      doc.lineWidth(1).strokeColor(t.line).dash(1, { space: 3 }).moveTo(fromX, leaderY).lineTo(toX, leaderY).stroke().undash();
      doc.restore();
    }
    doc.font(t.bold).fontSize(size).fillColor(t.primaryInk).text(pageStr, M.left + CW - numW, ly - size - 4, { lineBreak: false });
    doc.goTo(M.left, y - 4, CW, h + 4, e.dest);
    y += h + 10;
    doc.save();
    doc.lineWidth(0.5).strokeColor(mix('#ffffff', t.line, 0.6)).moveTo(M.left + 44, y - 5).lineTo(M.left + CW, y - 5).stroke();
    doc.restore();
  }
  doc.page.margins.bottom = oldBottom;
}

function decoratePages(w: GuideWriter): void {
  const { doc, t } = w;
  const range = doc.bufferedPageRange();
  const total = range.count;
  const shortTitle = truncate(S(w.title), 58);
  for (let i = range.start; i < range.start + total; i++) {
    if (i === 0) continue; // cover stays clean
    doc.switchToPage(i);
    const meta = w.metas[i] ?? { section: '', opener: false };
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    // running footer: brand · title · page
    const fy = PAGE_H - 44;
    doc.save();
    doc.lineWidth(0.6).strokeColor(t.line).moveTo(M.left, fy).lineTo(PAGE_W - M.right, fy).stroke();
    doc.rect(M.left, fy - 1.5, 26, 3).fill(t.p.accent);
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(t.primaryInk).text(S(w.brand).toUpperCase(), M.left, fy + 9, { lineBreak: false, characterSpacing: 1.2 });
    doc.font(t.body).fontSize(7.5);
    const tw = doc.widthOfString(shortTitle);
    doc.fillColor(t.muted).text(shortTitle, (PAGE_W - tw) / 2, fy + 9, { lineBreak: false });
    const num = String(i + 1);
    doc.font('Helvetica-Bold').fontSize(9);
    const nw = doc.widthOfString(num);
    doc.fillColor(t.primaryInk).text(num, PAGE_W - M.right - nw, fy + 8, { lineBreak: false });
    // running head on continuation pages
    if (!meta.opener && meta.section) {
      const head = truncate(S(meta.section), 80);
      doc.font(t.body).fontSize(7.5).fillColor(t.muted).text(head, M.left, 32, { lineBreak: false });
      doc.save();
      doc.lineWidth(0.5).strokeColor(t.line).moveTo(M.left, 45).lineTo(PAGE_W - M.right, 45).stroke();
      doc.restore();
    }
    doc.page.margins.bottom = oldBottom;
  }
}

/** Renders the full guide to `outFile` (parent folders created). Resolves with the page count and file size. */
export async function renderPdf(input: {
  product: Product; content: PdfContent; design: DesignSpec; brand: string; outFile: string; upsell?: { title: string; url: string } | null;
}): Promise<{ pages: number; bytes: number }> {
  const { product, outFile } = input;
  const content: PdfContent = input.content ?? (product.content as PdfContent);
  if (!content) throw new Error('renderPdf : contenu du guide manquant');
  const design = normalizeDesign(input.design ?? product.design);
  const brand = (input.brand || 'Pixel Agency').trim();
  const title = S(content.title || product.title) || 'Guide pratique';
  const t = themeFor(design);

  await mkdir(dirname(outFile), { recursive: true });
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: 'A4',
    margins: M,
    compress: true,
    lang: 'fr-FR',
    displayTitle: true,
    info: {
      Title: title,
      Author: brand,
      Subject: S(content.subtitle || product.subtitle),
      Keywords: [S(product.audience), S(product.problem)].filter(Boolean).join(' · '),
      Creator: `${brand} — Studio PDF`,
    },
  });
  const stream = createWriteStream(outFile);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(stream);

  const w = new GuideWriter(doc, t, design, brand, title);
  try {
    coverPage(w, product, content);
    promisePage(w, product, content);
    w.newPage('', true); // table of contents, drawn once page numbers are known
    const tocPage = w.pageIndex;
    introPage(w, product, content);
    arr(content.chapters).forEach((ch, k) => w.chapter(ch, k));
    if (content.bonus && (content.bonus.title || arr(content.bonus.paragraphs).length)) w.chapter(content.bonus, null);
    finalPage(w, content, product, input.upsell);
    drawToc(w, tocPage);
    decoratePages(w);
  } catch (err) {
    doc.end();
    await done.catch(() => undefined);
    throw err;
  }
  const pages = doc.bufferedPageRange().count;
  doc.end();
  await done;
  const { size } = await stat(outFile);
  return { pages, bytes: size };
}
