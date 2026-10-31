/**
 * Pagination as a pure function over measured blocks (pdf §8.2): no pdfkit, no clock, no RNG. Heights are known, so a call is
 * arithmetic, and a designer can try every layout for free. Pages stop being half empty because figures float: what does not
 * fit lets the text behind it move up, and opens the next page.
 */
import { lineOf, type Block, type ChecklistBlock, type ExampleBlock, type FigureBlock, type HeadingBlock, type NoteBlock, type ParaBlock, type QuoteBlock, type SheetBlock, type StepsBlock } from './blocks.js';
import { BODY_BOTTOM, BODY_H, GRID, MIN_PAGE_FILL, SHORT_PAGE } from './grid.js';

/** `top` keeps the head of a first page free: the introduction has art there. */
export interface LayoutParams { space: number; figureSlot: 'early' | 'late'; railFirst: boolean; notesFill: boolean; top?: number }

export type Placed =
  | { t: 'para'; block: ParaBlock; from: number; to: number; y: number }
  | { t: 'rows'; block: StepsBlock | ChecklistBlock; from: number; to: number; y: number }
  | { t: 'block'; block: HeadingBlock | ExampleBlock | FigureBlock; y: number }
  | { t: 'rail'; block: NoteBlock | QuoteBlock; y: number }
  | { t: 'sheet'; block: SheetBlock; part: number }
  | { t: 'notes'; y: number; h: number };

export interface PagePlan { kind: 'text' | 'opener' | 'sheet' | 'figure' | 'memo' | 'final' | 'toc' | 'promise'; chapter: number | null; items: Placed[]; fill: number }

const RAIL_GAP = 21.6;
const MIN_NOTES = 43.2;        // less than three ruled lines is no room to write
const CHECK_SIDE = 2;          // a checklist breaks with at least this many rows on each side

const isRail = (b: Block): b is NoteBlock | QuoteBlock => b.t === 'note' || b.t === 'quote';
const heightsOf = (b: StepsBlock | ChecklistBlock): number[] => (b.t === 'steps' ? b.items : b.rows).map((r) => r.h);

function endOf(item: Placed): number {
  switch (item.t) {
    case 'para': return item.y + (item.to - item.from) * lineOf(item.block);
    case 'rows': return item.y + heightsOf(item.block).slice(item.from, item.to).reduce((a, h) => a + h, 0);
    case 'block': case 'rail': return item.y + item.block.h;
    case 'notes': return item.y + item.h;
    default: return BODY_BOTTOM;
  }
}

/** Where the column and the rail stopped, notes included at half their height: they cannot buy a full page. */
function fillOf(items: Placed[]): number {
  const solid = items.filter((i) => i.t !== 'notes');
  const end = Math.max(GRID.top, ...solid.map(endOf));
  const notes = items.reduce((a, i) => a + (i.t === 'notes' ? i.h : 0), 0);
  return Math.min(1, (end - GRID.top + notes / 2) / BODY_H);
}

/** What the block after a heading must leave on the page, so that the heading never stands alone. */
function keepWith(b: Block | undefined): number {
  if (!b) return 0;
  switch (b.t) {
    case 'para': return (b.lines.length <= 4 ? b.lines.length : 3) * lineOf(b);
    case 'steps': return b.items[0]?.h ?? 0;
    case 'checklist': return b.rows.slice(0, CHECK_SIDE).reduce((a, r) => a + r.h, 0);
    case 'example': return b.h;
    default: return 0;
  }
}

class Flow {
  readonly pages: PagePlan[] = [];
  private items: Placed[] = [];
  private y: number;
  private railEnd = 0;           // the rail is taken down to there: a full-width block starts below it
  private anchor: number;        // top of the block a rail element hangs on
  private held = false;          // the block before this one was a heading
  private figures: FigureBlock[] = [];
  private rail: (NoteBlock | QuoteBlock)[] = [];

  constructor(private readonly p: LayoutParams, private readonly cut: { page: number; by: number } | null) {
    this.y = p.top ?? GRID.top;
    this.anchor = this.y;
  }

  private get bottom(): number {
    return BODY_BOTTOM - (this.cut?.page === this.pages.length ? this.cut.by : 0);
  }

  private get room(): number { return this.bottom - this.y; }

  private close(): void {
    if (!this.items.length) return;
    const only = this.items.filter((i) => i.t !== 'rail');
    const kind = only.length && only.every((i) => i.t === 'block' && i.block.t === 'figure') ? 'figure' : 'text';
    this.pages.push({ kind, chapter: null, items: this.items, fill: fillOf(this.items) });
    this.items = [];
  }

  private next(): void {
    this.close();
    this.y = GRID.top;
    this.anchor = GRID.top;
    this.railEnd = 0;
    while (this.figures[0] && this.figures[0].h <= this.room) this.figure(this.figures.shift()!);
    for (const b of this.rail.splice(0)) this.railBlock(b);
  }

  /** A full-width block never runs under the rail. */
  private clearRail(): void {
    if (this.railEnd > this.y) this.y = this.railEnd + this.p.space;
  }

  private para(b: ParaBlock): void {
    const lh = lineOf(b);
    const first = b.drop ? b.dropLines! : this.held ? 3 : 2;
    const count = b.lines.length;
    let at = 0;
    while (at < count) {
      const fit = Math.floor((this.room + 0.01) / lh);
      const left = count - at;
      if (left <= fit) {
        this.lines(b, at, count);
        break;
      }
      let take = Math.min(fit, left - 2);                  // two lines at least go over: no widow
      if (at === 0 && take < Math.min(first, count)) take = 0; // two at least stay: no orphan
      if (take > 0) this.lines(b, at, at + take);
      at += take;
      if (take === 0 && !this.items.length) { this.lines(b, at, count); break; }
      this.next();
    }
    this.y += this.p.space;
  }

  private lines(b: ParaBlock, from: number, to: number): void {
    this.anchor = this.y;
    this.items.push({ t: 'para', block: b, from, to, y: this.y });
    this.y += (to - from) * lineOf(b);
  }

  private rows(b: StepsBlock | ChecklistBlock): void {
    const hs = heightsOf(b);
    const side = b.t === 'checklist' ? CHECK_SIDE : 1;
    for (let at = 0; at < hs.length;) {
      this.clearRail();
      let to = at;
      let y = this.y;
      while (to < hs.length && y + hs[to]! <= this.bottom) y += hs[to++]!;
      if (to < hs.length) {
        if (hs.length - to < side) to = hs.length - side;
        if (at === 0 && to < side) to = 0;
      }
      if (to > at) {
        this.items.push({ t: 'rows', block: b, from: at, to, y: this.y });
        this.y += hs.slice(at, to).reduce((a, h) => a + h, 0);
        at = to;
      }
      if (at < hs.length) {
        if (!this.items.length) { this.items.push({ t: 'rows', block: b, from: at, to: at + 1, y: this.y }); this.y += hs[at]!; at += 1; }
        this.next();
      }
    }
    this.y += this.p.space;
  }

  private heading(b: HeadingBlock, follows: Block | undefined): void {
    this.clearRail();
    if (b.h + keepWith(follows) > this.room && this.items.length) { this.next(); this.clearRail(); }
    this.items.push({ t: 'block', block: b, y: this.y });
    this.anchor = this.y;
    this.y += b.h;
  }

  private example(b: ExampleBlock): void {
    if (b.h > this.room && this.items.length) this.next();
    this.items.push({ t: 'block', block: b, y: this.y });
    this.anchor = this.y;
    this.y += b.h + this.p.space;
  }

  private figure(b: FigureBlock): void {
    this.items.push({ t: 'block', block: b, y: this.y });
    this.anchor = this.y;
    this.y += b.h + this.p.space;
  }

  private float(b: FigureBlock): void {
    this.clearRail();
    if (!this.figures.length && b.h <= this.room) this.figure(b);
    else this.figures.push(b);
  }

  private railBlock(b: NoteBlock | QuoteBlock): void {
    const y = Math.max(this.anchor, this.railEnd ? this.railEnd + RAIL_GAP : 0);
    if (y + b.h > this.bottom) { this.rail.push(b); return; }
    this.items.push({ t: 'rail', block: b, y });
    this.railEnd = y + b.h;
  }

  private sheet(b: SheetBlock): void {
    this.flushFigures();
    this.close();
    b.parts.forEach((_, part) => this.pages.push({ kind: 'sheet', chapter: null, items: [{ t: 'sheet', block: b, part }], fill: 1 }));
    this.y = GRID.top;
    this.anchor = GRID.top;
    this.railEnd = 0;
  }

  private flushFigures(): void {
    while (this.figures.length) {
      if (this.figures[0]!.h <= this.room || !this.items.length) this.figure(this.figures.shift()!);
      else this.next();
    }
    if (this.rail.length) this.next();
  }

  run(blocks: Block[]): PagePlan[] {
    blocks.forEach((b, i) => {
      if (isRail(b)) { this.railBlock(b); return; }
      switch (b.t) {
        case 'para': this.para(b); break;
        case 'h2': this.heading(b, blocks.slice(i + 1).find((x) => !isRail(x))); break;
        case 'steps': case 'checklist': this.rows(b); break;
        case 'example': this.example(b); break;
        case 'figure': this.float(b); break;
        case 'sheet': this.sheet(b); break;
      }
      this.held = b.t === 'h2';
    });
    this.flushFigures();
    this.close();
    return this.pages;
  }
}

/** A figure comes after the text that needs it or at the end of the method; rail elements spread out or open the chapter. */
function arrange(blocks: Block[], p: LayoutParams): Block[] {
  let out = blocks;
  if (p.figureSlot === 'late') {
    const figures = out.filter((b) => b.t === 'figure');
    const rest = out.filter((b) => b.t !== 'figure');
    const at = rest.findIndex((b) => b.t === 'h2' && /checklist/i.test(b.text));
    const stop = at >= 0 ? at : rest.findIndex((b) => b.t === 'sheet');
    out = stop >= 0 ? [...rest.slice(0, stop), ...figures, ...rest.slice(stop)] : [...rest, ...figures];
  }
  if (p.railFirst) {
    const rail = out.filter(isRail);
    const rest = out.filter((b) => !isRail(b));
    const at = rest.findIndex((b) => b.t === 'para') + 1;
    out = [...rest.slice(0, at), ...rail, ...rest.slice(at)];
  }
  return out;
}

const textPages = (pages: PagePlan[]): PagePlan[] => pages.filter((p) => p.kind === 'text' || p.kind === 'figure');

/** Share of the page really printed on, whatever ruled notes were added after. */
const solidFill = (p: PagePlan): number => fillOf(p.items.filter((i) => i.t !== 'notes'));

/** The page a chapter's text ends on gets ruled lines down to the folio: useful on a printed sheet. */
function addNotes(pages: PagePlan[]): void {
  const last = textPages(pages).at(-1);
  if (!last || last.fill >= SHORT_PAGE) return;
  const y = Math.max(...last.items.map(endOf)) + GRID.baseline;
  const h = BODY_BOTTOM - y;
  if (h < MIN_NOTES) return;
  last.items.push({ t: 'notes', y, h });
  last.fill = fillOf(last.items);
}

/** Pure: no pdfkit, no clock, no RNG. */
export function paginate(blocks: Block[], params: LayoutParams): PagePlan[] {
  const flow = arrange(blocks, params);
  let pages = new Flow(params, null).run(flow);
  // a last page under the floor takes lines from the page before it, so that nothing leftover sits alone
  let by = 0;
  for (let tries = 0; tries < 3; tries++) {
    const text = textPages(pages);
    const last = text.at(-1);
    const before = text.at(-2);
    if (!last || !before || solidFill(last) >= MIN_PAGE_FILL) break;
    by += (MIN_PAGE_FILL - solidFill(last)) * BODY_H + GRID.baseline;
    pages = new Flow(params, { page: pages.indexOf(before), by }).run(flow);
  }
  if (params.notesFill) addNotes(pages);
  return pages;
}

const SPACES = [10.8, 9, 7.2, 12.6, 14.4, 5.4];

/** The layouts to fall back on, the plainest first: 6 spacings, figure early or late, rail spread or first. */
export const LAYOUTS: readonly LayoutParams[] = SPACES.flatMap((space) => (['early', 'late'] as const).flatMap((figureSlot) => [false, true].map((railFirst) => ({ space, figureSlot, railFirst, notesFill: false }))));

/**
 * The plainest layout whose last page holds up. If none does, ruled notes close the section. Talent buys no search here:
 * pdf §18 set a stop rule on the `layouts` lever and best of 24 moved `interior` by 1.1 to 1.6 points on the four fixtures, under
 * the 3 it asked, so that field of `DesignEffort` stays a label and talent acts through covers, taste and finish.
 */
export function layoutOf(blocks: Block[], top?: number): PagePlan[] {
  const base = top === undefined ? {} : { top };
  for (const p of LAYOUTS) {
    const pages = paginate(blocks, { ...p, ...base });
    const last = textPages(pages).at(-1);
    if (!last || last.fill >= SHORT_PAGE) return pages;
  }
  return paginate(blocks, { ...LAYOUTS[0]!, ...base, notesFill: true });
}
