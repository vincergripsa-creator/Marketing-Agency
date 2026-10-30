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
import type { ChapterContent, DesignSpec, PdfContent, Product, VisualSpec } from '../shared.js';
import { contrast, darken, ensureContrast, isDark, lighten, mix, readableOn } from './color.js';
import { familyOfText, normalizeDesign, professionalFor } from './design.js';
import { renderCoverSvg } from './cover.js';
import { motifSvg, sparklePath } from './motifs.js';
import { drawCheckbox, drawCheckMark, drawIcon, GRID_WRITE_ROW, gridModel, layoutVisual, measure, put, type PdfTheme } from './pdfVisuals.js';
import { hashString, normalizeKey, sanitizePdfText, textWidth, truncate, wrapText, type StdFont } from './text.js';

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

/** The callout says what the text is: the writers announce a made-up case (« Exemple type : ») and it is never called real. */
function exampleParts(text: string | null | undefined): { label: string; text: string } {
  const s = S(text ?? '');
  const m = /^(exemple type|mise en situation)\s*:\s*/iu.exec(s);
  if (!m) return { label: 'Exemple type', text: s };
  const rest = s.slice(m[0].length);
  return { label: m[1]!, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/** Line height (pt) a sheet gets when the page has room for handwriting: more on a page of its own, more when it is short. */
const gridRowTarget = (rows: number, ownPage: boolean): number => (ownPage ? 38 : rows <= 8 ? 34 : rows <= 16 ? 30 : 26);

/** Checklist card spacing (pt): head = title band, row = gap after each item, pad = card bottom, after = gap below the card. */
const CHECK_NORMAL = { head: 50, row: 10, pad: 8, after: 18 };
const CHECK_TIGHT = { head: 40, row: 6, pad: 6, after: 10 };

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
    // the heading always travels with its first step box (never alone at the bottom of a page)
    const firstH = Math.max(42, measure(doc, clean[0]!, t.body, 10.4, CW - 62, 3) + 24);
    this.subheading('Étape par étape', Math.max(60, firstH + 24)); // 6 + 9 pt around the heading, 8 pt under the box
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
    const { label, text: s } = exampleParts(text);
    if (!s) return;
    const { doc, t } = this;
    const textW = CW - 44;
    const th = measure(doc, s, t.italic, 10.8, textW, 3.4);
    const h = th + 52;
    if (h > this.bottom - M.top - 20) { this.subheading(label); this.para(s, { font: t.italic }); return; }
    this.ensure(h + 14);
    doc.y += 4;
    const y = doc.y;
    doc.save();
    doc.roundedRect(M.left, y, CW, h, 10).fill(t.calloutBg);
    doc.rect(M.left, y + 10, 4, h - 20).fill(t.p.accent);
    doc.restore();
    put(doc, '”', M.left + CW - 58, y - 2, { font: 'Times-Bold', size: 72, color: lighten(t.p.accent, 0.4), width: 50, align: 'right' });
    drawIcon(doc, 'chat', M.left + 26, y + 21, 15, t.accentInk, 1.9);
    this.label(label, M.left + 40, y + 17, t.accentInk, 8.5);
    put(doc, s, M.left + 22, y + 38, { font: t.italic, size: 10.8, color: t.ink, width: textW, lineGap: 3.4 });
    doc.y = y + h + 16;
  }

  checklist(items: string[], title = 'Votre checklist', tight = false): void {
    const clean = this.checklistItems(items);
    if (clean.length === 0) return;
    const { doc, t } = this;
    const g = tight ? CHECK_TIGHT : CHECK_NORMAL;
    const textW = CW - 64;
    const hs = clean.map((s) => Math.max(13, measure(doc, s, t.body, 10.4, textW, 2.5)));
    const total = g.head + hs.reduce((a, h) => a + h + g.row, 0) + g.pad;
    const fitsOnPage = total <= this.bottom - M.top - 20;
    this.ensure(fitsOnPage ? total + 12 : 120);
    let y = doc.y + 4;
    if (fitsOnPage) {
      doc.save();
      doc.roundedRect(M.left, y, CW, total, 10).fill('#ffffff');
      doc.roundedRect(M.left, y, CW, total, 10).lineWidth(1.2).dash(4, { space: 3 }).strokeColor(lighten(t.p.primary, 0.45)).stroke().undash();
      doc.restore();
    }
    drawCheckMark(doc, M.left + 28, y + (tight ? 20 : 24), 10, t.p.primary, readableOn(t.p.primary, t.ink));
    put(doc, S(title), M.left + 46, y + (tight ? 13 : 17), { font: t.bold, size: 12.5, color: t.primaryInk, width: CW - 60 });
    y += g.head - 2;
    clean.forEach((s, k) => {
      if (!fitsOnPage && y + hs[k] > this.bottom) { this.newPage(this.section, false); y = doc.y; }
      drawCheckbox(doc, M.left + 22, y, 12, t.p.primary, false);
      put(doc, s, M.left + 44, y + 0.5, { font: t.body, size: 10.4, color: t.ink, width: textW, lineGap: 2.5 });
      y += hs[k] + g.row;
    });
    doc.y = y + (fitsOnPage ? g.after : 10);
  }

  /** Vertical space the example callout consumes (0 when there is none). */
  exampleNeed(text: string | null | undefined): number {
    const s = exampleParts(text).text;
    if (!s) return 0;
    const th = measure(this.doc, s, this.t.italic, 10.8, CW - 44, 3.4);
    return th + 52 + 20;
  }

  checklistItems(items: string[]): string[] {
    return items.map((s) => S(s).replace(/^\s*[-•*]\s*/, '')).filter(Boolean);
  }

  /** Vertical space of the checklist card, normal or tight spacing. */
  checklistNeed(items: string[], tight = false): number {
    const clean = this.checklistItems(items);
    if (clean.length === 0) return 0;
    const hs = clean.map((s) => Math.max(13, measure(this.doc, s, this.t.body, 10.4, CW - 64, 2.5)));
    const g = tight ? CHECK_TIGHT : CHECK_NORMAL;
    return 4 + g.head + hs.reduce((a, h) => a + h + g.row, 0) + g.pad + g.after;
  }

  visualNeed(v: ChapterContent['visual']): number {
    const layout = layoutVisual(this.doc, v, CW, this.t);
    return layout && layout.height <= this.bottom - M.top - 10 ? layout.height + 22 : 0;
  }

  /**
   * End of a chapter: visual → example → checklist. The last block never lands alone on a near-empty
   * page: the checklist is tightened when that is enough, else the block before it moves to the next
   * page too, so that page carries at least MIN_PAGE_FILL of content.
   */
  chapterTail(ch: ChapterContent): void {
    const items = arr(ch?.checklist);
    // a sheet to print closes the chapter: it may take a page of its own without stranding the checklist
    const sheet = ch?.visual?.type === 'grid' ? ch.visual : null;
    const blocks = [
      { need: sheet ? 0 : this.visualNeed(ch?.visual ?? null), draw: () => this.visual(ch?.visual ?? null) },
      { need: this.exampleNeed(ch?.example), draw: () => this.example(ch?.example) },
    ].filter((b) => b.need > 0);
    const ck = this.checklistNeed(items);
    const room = this.bottom - this.doc.y;
    const before = blocks.reduce((a, b) => a + b.need, 0);
    let tight = false;
    let moveFrom = -1;
    if (ck > 0 && before + ck > room) {
      if (before + this.checklistNeed(items, true) <= room) tight = true;
      else {
        // where would the natural flow break, and what would the next page hold?
        let acc = 0;
        let split = blocks.length;
        for (let i = 0; i < blocks.length; i++) { acc += blocks[i]!.need; if (acc > room) { split = i; break; } }
        const tail = blocks.slice(split).reduce((a, b) => a + b.need, 0) + ck;
        const pageH = this.bottom - M.top;
        // the closing checklist alone on a page (or any tail under MIN_PAGE_FILL) takes the block before it along
        const aloneChecklist = split === blocks.length;
        if ((aloneChecklist || tail < pageH * MIN_PAGE_FILL) && split > 0 && this.doc.y - M.top > pageH * 0.3) moveFrom = split - 1;
      }
    }
    blocks.forEach((b, i) => {
      if (i === moveFrom) this.newPage(this.section, false);
      b.draw();
    });
    this.checklist(items, 'Votre checklist', tight);
    if (sheet) this.grid(sheet);
  }

  /**
   * A sheet the reader prints: it stays whole on one page whenever it can (it moves to the next page rather than
   * break), a longer one repeats its header, and blank lines get taller when the page has room for handwriting.
   */
  grid(v: VisualSpec): void {
    const { doc, t } = this;
    const m = gridModel(doc, v, CW, t);
    if (!m) return;
    const count = m.rows.length;
    const roomOf = () => this.bottom - doc.y - 8;
    if (m.heightOf(0, count, true) > roomOf()) this.newPage(this.section, false);
    for (let from = 0; from < count;) {
      const first = from === 0;
      const target = gridRowTarget(count, doc.y <= M.top);
      const to = m.fit(from, roomOf(), first);
      const writable = m.rows.slice(from, to).filter((r) => r.writable).length;
      const spare = roomOf() - m.heightOf(from, to, first);
      const grow = writable ? Math.max(0, Math.min(target - GRID_WRITE_ROW, spare / writable)) : 0;
      doc.y = m.draw(M.left, doc.y + 4, from, to, first, grow) + 16;
      doc.x = M.left;
      from = to;
      if (from < count) this.newPage(this.section, false);
    }
  }

  visual(v: ChapterContent['visual']): void {
    const { doc, t } = this;
    if (v?.type === 'grid') { this.grid(v); return; }
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
      section: isBonus ? `Bonus · ${title.replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '')}` : `Chapitre ${n} · ${title}`,
      dest,
      bonus: isBonus,
    });
    this.toc[this.toc.length - 1].page = this.pageIndex + 1;
    if (isBonus) this.bonusNote();
    if (ch?.intro) this.lead(ch.intro);
    for (const p of arr(ch?.paragraphs)) this.para(p);
    this.steps(arr(ch?.steps));
    this.chapterTail(ch);
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
      const s = `Bonus offert : ${S(content.bonus.title).replace(/^bonus\s*(?:offert\s*)?[:—–-]\s*/i, '')}`;
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

/** Lowercase, accent-free, straight apostrophes — to compare texts (« Le chiot… » vs « le chiot… »). */
function keyOf(s: string): string {
  return normalizeKey(S(s)).replace(/[’`´]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Typesetting parameters of the introduction (normal, or compact to keep its last box on the page). */
interface IntroStyle { lead: number; leadGap: number; leadAfter: number; body: number; gap: number; after: number; boxBody: number }
const INTRO_NORMAL: IntroStyle = { lead: 12.6, leadGap: 4.2, leadAfter: 12, body: BODY_SIZE, gap: BODY_GAP, after: 8, boxBody: 10.8 };
const INTRO_COMPACT: IntroStyle = { lead: 11.8, leadGap: 3.4, leadAfter: 8, body: 10.2, gap: 3, after: 5, boxBody: 10.2 };

/** A page holding less than this share of content because of one leftover block is a layout bug. */
export const MIN_PAGE_FILL = 0.25;

export interface IntroPlan { compact: boolean; quote: boolean; breakBefore: number }

/**
 * Layout decision for the introduction: heights (pt) of its paragraphs, the pull-quote and the
 * « À la fin de ce guide » box at the normal size, the compact total (no quote), the space left on
 * the first page and the page body height. Never leaves the box (+ quote) alone on a near-empty page:
 * tighten the spacing when that is enough, else start the next page earlier (breakBefore = index of the
 * first paragraph moved to it) so that it holds at least MIN_PAGE_FILL of content.
 */
export function planIntro(normal: { parts: number[]; quote: number; box: number }, compactTotal: number, avail: number, pageH: number): IntroPlan {
  const total = normal.parts.reduce((a, b) => a + b, 0) + normal.quote + normal.box;
  if (total <= avail) return { compact: false, quote: true, breakBefore: -1 };
  if (compactTotal <= avail) return { compact: true, quote: false, breakBefore: -1 };
  const spill = total - avail;
  if (spill >= pageH * MIN_PAGE_FILL) return { compact: false, quote: true, breakBefore: -1 };
  let acc = normal.quote + normal.box;
  for (let k = normal.parts.length - 1; k > 0; k--) {
    acc += normal.parts[k]!;
    if (acc >= pageH * MIN_PAGE_FILL) return { compact: false, quote: true, breakBefore: k };
  }
  return { compact: false, quote: true, breakBefore: normal.parts.length > 1 ? 1 : -1 };
}


function introPage(w: GuideWriter, product: Product, content: PdfContent): void {
  const { doc, t } = w;
  w.toc.push({ kind: 'intro', label: 'Introduction', title: 'Le point de départ', page: 0, dest: 'introduction' });
  w.band({ label: 'Introduction', number: null, title: 'Le point de départ', section: 'Introduction', dest: 'introduction' });
  w.toc[w.toc.length - 1].page = w.pageIndex + 1;
  const intro = arr(content.introduction).map(S).filter(Boolean);
  const paragraphs = intro.length ? intro : [S(product.problem)].filter(Boolean);
  const promise = S(content.promise);
  // pull-quote of the problem, unless the text already says it or it IS the promise / the title (upsell guides)
  const problem = S(product.problem);
  const pk = keyOf(problem);
  const showQuote = !!problem && pk.length > 0
    && !paragraphs.some((p) => keyOf(p).includes(pk))
    && !keyOf(promise).includes(pk) && !pk.includes(keyOf(promise) || '\u0000')
    && !keyOf(content.title).includes(pk);

  const measureAll = (st: IntroStyle, quote: boolean) => {
    const parts = paragraphs.map((p, k) => (k === 0
      ? measure(doc, p, t.body, st.lead, CW, st.leadGap) + st.leadAfter
      : measure(doc, p, t.body, st.body, CW, st.gap) + st.after));
    const q = quote ? measure(doc, problem, t.italic, 13, CW - 70, 3.5) + 30 + 22 : 0;
    const box = promise ? measure(doc, promise, t.body, st.boxBody, CW - 40, 3) + 52 + 14 : 0;
    return { parts, q, box, total: parts.reduce((a, b) => a + b, 0) + q + box };
  };
  const avail = w.bottom - doc.y - 6;
  const pageH = w.bottom - M.top;
  const normal = measureAll(INTRO_NORMAL, showQuote);
  const plan = planIntro({ parts: normal.parts, quote: normal.q, box: normal.box }, measureAll(INTRO_COMPACT, false).total, avail, pageH);
  const st = plan.compact ? INTRO_COMPACT : INTRO_NORMAL;
  const quote = showQuote && plan.quote;
  const breakBefore = plan.breakBefore;
  paragraphs.forEach((p, k) => {
    if (k === breakBefore) w.newPage('Introduction', false);
    if (k === 0) w.para(p, { size: st.lead, color: t.primaryInk, gap: st.leadGap, after: st.leadAfter });
    else w.para(p, { size: st.body, gap: st.gap, after: st.after });
  });
  if (quote) {
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
  if (promise) {
    const head = 'À la fin de ce guide';
    const ph = measure(doc, promise, t.body, st.boxBody, CW - 40, 3) + 52;
    w.ensure(ph + 10);
    const y = doc.y;
    doc.save();
    doc.roundedRect(M.left, y, CW, ph, 10).fill(mix('#ffffff', t.p.primary, 0.1));
    doc.restore();
    drawCheckMark(doc, M.left + 26, y + 24, 9, t.p.primary, readableOn(t.p.primary, t.ink));
    put(doc, head, M.left + 42, y + 17, { font: t.bold, size: 12, color: t.primaryInk, width: CW - 60 });
    put(doc, promise, M.left + 20, y + 40, { font: t.body, size: st.boxBody, color: t.ink, width: CW - 40, lineGap: 3 });
    doc.y = y + ph + 14;
  }
}

export interface FinalWording {
  heading: string; subtitle: string; paragraphs: string[];
  cta: string | null;   // null: no button (nothing to link to)
  dest: string | null;  // inside the guide, when there is no shop page to link to
  under: string;
}

/** A sentence about a guide that does not exist yet: it was true when the text was written, not any more once one is linked. */
const FUTURE_GUIDE = /si un guide|prochain guide|guide suivant|en préparation|vous serez prévenu|vous en serez informé/iu;
/** A sentence selling a next guide: without one in the shop, it promises something the reader cannot get. */
const SELLS_GUIDE = /prochain guide|guide suivant|en préparation|vous serez prévenu|sur notre boutique|disponible sur|déjà disponible/iu;

const sentencesOf = (text: string): string[] => S(text).split(/\n+/).flatMap((p) => p.split(/(?<=[.!?…])\s+(?=[«\p{Lu}])/u)).map((s) => s.trim()).filter(Boolean);

/**
 * The last page, true for the catalogue of the day whatever the stored text says: that text is written with the
 * guide, and a follow-up may have been linked (or killed) since. Guillemets of a title become “ ” inside the button's.
 */
export function finalWording(content: Pick<PdfContent, 'nextStep'>, upsell: { title: string; url: string } | null | undefined, plan: { dest: string; label: string } | null): FinalWording {
  const next = content.nextStep ?? { title: '', text: '', upsellProductId: null };
  const title = S(upsell?.title ?? '').replace(/^la\s+suite\s+est\s+ici\s*(?:[:—–-]\s*)?/i, '').trim();
  const stored = S(next.text);
  if (!title) {
    const kept = sentencesOf(stored).filter((s) => !SELLS_GUIDE.test(s));
    return {
      heading: 'Votre prochaine étape', subtitle: '',
      paragraphs: kept.length ? [kept.join(' ')] : ['Il reste une chose à faire : ouvrir le plan à la première ligne, et noter ce qui change.'],
      cta: plan?.label ?? null, dest: plan?.dest ?? null, under: '',
    };
  }
  // absolute store URL, or a run-relative one ("/runs/<id>/files/…/sales-page.html") resolved by the viewer
  const rawUrl = String(upsell?.url ?? '').trim();
  const url = /^https?:\/\//i.test(rawUrl) || /^\.{0,2}\/(?!\/)/.test(rawUrl) ? rawUrl : null;
  const plain = title.replace(/«\s*/g, '“').replace(/\s*»/g, '”');
  const named = keyOf(stored).includes(keyOf(title));
  const body = named ? stored.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [[
    ...sentencesOf(stored).filter((s) => !FUTURE_GUIDE.test(s)),
    'Si vous voulez aller plus loin, ce guide traite un autre point, à part, dans le même format.',
  ].join(' ')];
  return {
    heading: 'La suite est ici', subtitle: title, paragraphs: body,
    cta: url ? `Découvrir « ${plain} »` : null, dest: null,
    under: url ? (/^https?:/i.test(url) ? url.replace(/^https?:\/\//i, '') : 'Disponible sur notre boutique') : '',
  };
}

const CTA_FONT: StdFont = 'Helvetica-Bold';
const CTA_ARROW_ROOM = 84;

/** Pill sized to its text: 14 pt on one or two lines, smaller and on three lines at most for a long title. Returns its box. */
function ctaButton(w: GuideWriter, label: string): { x: number; y: number; w: number; h: number } {
  const { doc, t } = w;
  const textRoom = CW - CTA_ARROW_ROOM;
  const wrap = (size: number) => wrapText(label, textRoom, CTA_FONT, size);
  let size = 14;
  while (size > 11 && wrap(size).length > 2) size -= 1;
  const lines = wrap(size);
  const lh = size * 1.28;
  const bw = Math.min(CW, Math.max(300, Math.max(...lines.map((l) => textWidth(l, CTA_FONT, size))) + CTA_ARROW_ROOM));
  const bh = Math.max(56, lines.length * lh + 26);
  w.ensure(bh + 60);
  doc.y += 8;
  const bx = M.left + (CW - bw) / 2;
  const by = doc.y;
  doc.save();
  doc.roundedRect(bx + 2, by + 5, bw, bh, 28).fillOpacity(0.18).fill(darken(t.p.accent, 0.5));
  doc.fillOpacity(1);
  doc.roundedRect(bx, by, bw, bh, 28).fill(t.p.accent);
  doc.restore();
  const fg = readableOn(t.p.accent, t.ink);
  const top = by + (bh - lines.length * lh) / 2 + (lh - size) / 2;
  lines.forEach((line, k) => put(doc, line, bx + 18, top + k * lh, { font: CTA_FONT, size, color: fg, width: bw - CTA_ARROW_ROOM + 4, align: 'center', lineGap: 0 }));
  doc.save();
  doc.lineWidth(2.4).lineCap('round').lineJoin('round').strokeColor(fg)
    .moveTo(bx + bw - 40, by + bh / 2).lineTo(bx + bw - 26, by + bh / 2)
    .moveTo(bx + bw - 31, by + bh / 2 - 5).lineTo(bx + bw - 26, by + bh / 2).lineTo(bx + bw - 31, by + bh / 2 + 5).stroke();
  doc.restore();
  return { x: bx, y: by, w: bw, h: bh };
}

/** The plan to go back to when no follow-up guide exists: the last chapter that holds a sheet. */
function planTarget(content: PdfContent): { dest: string; label: string } | null {
  const chapters = arr(content.chapters);
  if (!chapters.length) return null;
  const at = chapters.map((c) => c.visual?.type === 'grid').lastIndexOf(true);
  return at >= 0 ? { dest: `chapitre-${at + 1}`, label: 'Je reviens à mon plan' } : { dest: 'chapitre-1', label: 'Je reviens au premier chapitre' };
}

function finalPage(w: GuideWriter, content: PdfContent, product: Product, upsell: { title: string; url: string } | null | undefined): void {
  const { doc, t } = w;
  const say = finalWording(content, upsell, planTarget(content));
  w.toc.push({ kind: 'final', label: 'Et après ?', title: say.heading, page: 0, dest: 'la-suite' });
  w.newPage(say.heading, true);
  doc.addNamedDestination('la-suite');
  w.toc[w.toc.length - 1].page = w.pageIndex + 1;

  const headW = CW - 150;
  const headH = measure(doc, say.heading, t.title, 36, headW);
  const subY = 86 + headH + 10;
  const subH = say.subtitle ? measure(doc, say.subtitle, t.body, 15, headW, 3) : 0;
  const bandH = Math.max(270, subY + subH + 40);
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
  put(doc, say.heading, M.left, 86, { font: t.title, size: 36, color: t.bandFg, width: headW });
  if (say.subtitle) put(doc, say.subtitle, M.left, subY, { font: t.body, size: 15, color: t.bandFg, width: headW, lineGap: 3 });
  doc.x = M.left;
  doc.y = bandH + 30;

  say.paragraphs.forEach((p, k) => w.para(p, k === 0 ? { size: 11.6, gap: 4 } : {}));

  // big CTA button: to the next guide's shop page, or back to the plan
  if (say.cta) {
    const box = ctaButton(w, say.cta);
    const link = String(upsell?.url ?? '').trim();
    if (say.dest) doc.goTo(box.x, box.y, box.w, box.h, say.dest);
    else doc.link(box.x, box.y, box.w, box.h, link);
    if (say.under) put(doc, S(say.under), M.left, box.y + box.h + 10, { font: t.body, size: 9, color: t.muted, width: CW, align: 'center' });
    doc.y = box.y + box.h + 40;
  }

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
  const thanks = `Merci de votre confiance. Si ce guide vous a aidé, dites-le-nous : chaque retour nous aide à l’améliorer pour la prochaine version. — L’équipe ${S(w.brand)}`;
  w.para(thanks, { font: t.italic, size: 10.4, color: t.muted, after: 10 });
  const family = w.design.family ?? familyOfText(`${product.title} ${product.audience} ${product.problem}`);
  const disclaimer = `Ce guide est fourni à titre informatif et pédagogique. Il ne remplace pas l’avis ${professionalFor(family)}, adapté à votre situation. Version ${Math.max(1, Math.trunc(product.version || 1))}.`;
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
