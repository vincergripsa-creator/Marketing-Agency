/**
 * Pagination as a pure function over measured blocks (pdf §8.2): no pdfkit, no clock, no RNG. Heights are known, so a call is
 * arithmetic, and a designer can try every layout for free. Pages stop being half empty because figures float: what does not
 * fit lets the text behind it move up, and opens the next page. Then `layoutOf` lets the page before give lines, or whole blocks,
 * to the last page of a section, and the art of the guide closes what is left: a body page is full, or it ends the section on purpose.
 */
import { FIGURE_FOOT, lineOf, type Block, type ChecklistBlock, type ExampleBlock, type FigureBlock, type HeadingBlock, type NoteBlock, type ParaBlock, type QuoteBlock, type SheetBlock, type StepsBlock } from './blocks.js';
import { BODY_BOTTOM, BODY_H, GRID, LAST_PAGE, PAGE_AIM, PAGE_AIR, PAGE_BREATH, PAGE_FULL } from './grid.js';

/** `top` keeps the head of a first page free: the introduction has art there. `trim` is what the paragraphs of every page but the last give up to it. `last` is what the last page aims for. */
export interface LayoutParams { space: number; figureSlot: 'early' | 'late'; railFirst: boolean; notesFill: boolean; top?: number; trim?: number; last?: number }

export type Placed =
  | { t: 'para'; block: ParaBlock; from: number; to: number; y: number }
  | { t: 'rows'; block: StepsBlock | ChecklistBlock; from: number; to: number; y: number; air?: number }
  | { t: 'block'; block: HeadingBlock | ExampleBlock | FigureBlock; y: number }
  | { t: 'rail'; block: NoteBlock | QuoteBlock; y: number }
  | { t: 'sheet'; block: SheetBlock; part: number }
  | { t: 'notes'; y: number; h: number; label?: string }
  | { t: 'end'; y: number; h: number; rows: number; cols: number };

export interface PagePlan { kind: 'text' | 'opener' | 'sheet' | 'figure' | 'memo' | 'final' | 'toc' | 'promise'; chapter: number | null; items: Placed[]; fill: number }

const RAIL_GAP = 21.6;
const RAIL_CLEAR = 9;          // the least a rail keeps from the rule of a full-width block under it
const MIN_NOTES = 43.2;        // less than three ruled lines is no room to write
const CHECK_SIDE = 2;          // a checklist breaks with at least this many rows on each side
const MAX_ROW_AIR = 12.6;      // what a row of steps can take without reading as a gap
const MAX_BREAK_AIR = GRID.baseline; // what a heading can take above it: more and the spacing changes from page to page
const END_GAP = 21.6;          // between the last line of a section and the art that closes it
const END_H = GRID.full;       // a square of art at most: more and the close outweighs the text it closes
const END_COLS = [6, 5, 7, 8]; // tiles across the text: the size of a tile is what lets a band of whole tiles fit its page

const isRail = (b: Block): b is NoteBlock | QuoteBlock => b.t === 'note' || b.t === 'quote';
const heightsOf = (b: StepsBlock | ChecklistBlock): number[] => (b.t === 'steps' ? b.items : b.rows).map((r) => r.h);
const isList = (b: Block | undefined): b is StepsBlock | ChecklistBlock => b?.t === 'steps' || b?.t === 'checklist';
const sum = (hs: number[]): number => hs.reduce((a, h) => a + h, 0);

function endOf(item: Placed): number {
  switch (item.t) {
    case 'para': return item.y + (item.to - item.from) * lineOf(item.block);
    // a row keeps its air over it, a box under it: the air under the last one is paper, like the padding of a figure
    case 'rows': return item.y + heightsOf(item.block).slice(item.from, item.to).reduce((a, h) => a + h + (item.air ?? 0), 0) - (item.air ?? 0) / (item.block.t === 'steps' ? 2 : 1);
    // the padding of a figure is paper: `fill` means ink
    case 'block': return item.y + item.block.h - (item.block.t === 'figure' ? FIGURE_FOOT : 0);
    case 'rail': return item.y + item.block.h;
    case 'notes': case 'end': return item.y + item.h;
    case 'sheet': return item.block.parts[item.part]!.end;
  }
}

const isClose = (i: Placed): boolean => i.t === 'notes' || i.t === 'end';

/** Where the column and the rail stopped, what closes the page at half its height: ruled lines and art cannot buy a full page. */
function fillOf(items: Placed[]): number {
  const solid = items.filter((i) => !isClose(i));
  const end = Math.max(GRID.top, ...solid.map(endOf));
  const closes = items.reduce((a, i) => a + (i.t === 'notes' || i.t === 'end' ? i.h : 0), 0);
  return Math.min(1, (end - GRID.top + closes / 2) / BODY_H);
}

/** What the block after a heading must leave on the page, so that the heading never stands alone. */
function keepWith(b: Block | undefined): number {
  if (!b) return 0;
  switch (b.t) {
    case 'para': return (b.lines.length <= 4 ? b.lines.length : 3) * lineOf(b);
    case 'steps': return b.items[0]?.h ?? 0;
    // a list too short to leave `CHECK_SIDE` rows on each side of a page break moves whole: the heading goes with all of it
    case 'checklist': return b.rows.slice(0, b.rows.length < 2 * CHECK_SIDE ? b.rows.length : CHECK_SIDE).reduce((a, r) => a + r.h, 0);
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
  private listing = false;       // a list is being laid: a figure waits for its last row
  private figures: FigureBlock[] = [];
  private rail: (NoteBlock | QuoteBlock)[] = [];

  /** `cuts` are lines of text a page lets go of. `gives` is what the page that feeds the last one keeps clear: whatever does not stand above it goes over, whole. */
  constructor(private readonly p: LayoutParams, private readonly cuts: readonly number[], private readonly gives: readonly number[] = []) {
    this.y = p.top ?? GRID.top;
    this.anchor = this.y;
  }

  private get foot(): number {
    return BODY_BOTTOM - (this.gives[this.pages.length] ?? 0);
  }

  /** How far a paragraph may run: a cut moves lines of text, never a list, a box or a figure that has the room. */
  private get bottom(): number {
    return Math.min(this.foot, BODY_BOTTOM - (this.cuts[this.pages.length] ?? 0));
  }

  private get room(): number { return this.bottom - this.y; }

  private get free(): number { return this.foot - this.y; }

  /** The page that gives keeps a list whole or lets it go: a page never stops in the middle of one that has the room. */
  private whole(b: StepsBlock | ChecklistBlock): number {
    return this.gives[this.pages.length] ? sum(heightsOf(b)) : 0;
  }

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
    if (!this.listing) this.placeFigures();
    for (const b of this.rail.splice(0)) this.railBlock(b);
  }

  private placeFigures(): void {
    while (this.figures[0] && this.figures[0].h <= this.free) this.figure(this.figures.shift()!);
  }

  /** A full-width block never runs under the rail, nor rests on it. */
  private clearRail(): void {
    if (this.railEnd + RAIL_CLEAR > this.y) this.y = this.railEnd + Math.max(this.p.space, RAIL_CLEAR);
  }

  private para(b: ParaBlock): void {
    const lh = lineOf(b);
    const first = b.drop ? b.dropLines! : this.held ? 3 : 2;
    const count = b.lines.length;
    let at = 0;
    while (at < count) {
      const fit = Math.max(0, Math.floor((this.room + 0.01) / lh));
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
    if (this.items.length && !this.held && this.whole(b) > this.free) this.next();
    this.listing = true;
    for (let at = 0; at < hs.length;) {
      this.clearRail();
      let to = at;
      let y = this.y;
      while (to < hs.length && y + hs[to]! <= BODY_BOTTOM) y += hs[to++]!;
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
    this.listing = false;
    this.y += this.p.space;
    this.placeFigures();
  }

  private heading(b: HeadingBlock, follows: Block | undefined): void {
    this.clearRail();
    const keep = isList(follows) ? Math.max(this.whole(follows), keepWith(follows)) : keepWith(follows);
    if (b.h + keep > (follows?.t === 'para' ? this.room : this.free) && this.items.length) { this.next(); this.clearRail(); }
    this.items.push({ t: 'block', block: b, y: this.y });
    this.anchor = this.y;
    this.y += b.h;
  }

  private example(b: ExampleBlock): void {
    if (b.h > this.free && this.items.length) this.next();
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
    if (!this.figures.length && b.h <= this.free) this.figure(b);
    else this.figures.push(b);
  }

  private railBlock(b: NoteBlock | QuoteBlock): void {
    const y = Math.max(this.anchor, this.railEnd ? this.railEnd + RAIL_GAP : 0);
    if (y + b.h > BODY_BOTTOM) { this.rail.push(b); return; }
    this.items.push({ t: 'rail', block: b, y });
    this.railEnd = y + b.h;
  }

  private sheet(b: SheetBlock): void {
    this.flushFigures();
    this.close();
    b.parts.forEach((p, part) => {
      const items: Placed[] = [{ t: 'sheet', block: b, part }, ...(p.notes ? [{ t: 'notes' as const, ...p.notes }] : [])];
      this.pages.push({ kind: 'sheet', chapter: null, items, fill: fillOf(items) });
    });
    this.y = GRID.top;
    this.anchor = GRID.top;
    this.railEnd = 0;
  }

  private flushFigures(): void {
    while (this.figures.length) {
      if (this.figures[0]!.h <= this.free || !this.items.length) this.figure(this.figures.shift()!);
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
    const at = rest.findIndex((b) => b.t === 'h2' && /checklist|arrêter/i.test(b.text));
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

/** What the art can close: more paper left blank than a band can take, once the page has breathed, is still a hole. */
function closeable(last: PagePlan): boolean {
  const blank = BODY_BOTTOM - Math.max(...last.items.map(endOf));
  return blank - airOf(last, blank).total <= END_H + END_GAP;
}

/** Share of the page really printed on, whatever ruled notes were added after. */
const solidFill = (p: PagePlan): number => fillOf(p.items.filter((i) => !isClose(i)));

const heads = (i: Placed | undefined): boolean => i?.t === 'block' && i.block.t === 'h2';
const columnOf = (page: PagePlan): Placed[] => page.items.filter((i) => i.t !== 'rail');
const opens = (column: Placed[], k: number): boolean => { const item = column[k]!; return k > 0 && item.t === 'block' && item.block.t !== 'example' && !heads(column[k - 1]); };

/** What `need` points of air come to on a page: per row of a list, per section break, and in all. */
function airOf(page: PagePlan, need: number): { row: number; pause: number; total: number } {
  const column = columnOf(page);
  const breaks = column.filter((_, k) => opens(column, k)).length;
  const rows = column.reduce((a, i) => a + (i.t === 'rows' ? i.to - i.from : 0), 0);
  if (need <= 0 || (!rows && !breaks)) return { row: 0, pause: 0, total: 0 };
  const row = Math.min(MAX_ROW_AIR, need / (rows + 2 * breaks));
  const pause = breaks ? Math.min(MAX_BREAK_AIR, (need - rows * row) / breaks) : 0;
  return { row, pause, total: rows * row + breaks * pause };
}

/** How far a page reaches once it has breathed: the page a reader gets, the one a layout is judged on. */
const reachOf = (p: PagePlan): number => solidFill(p) + airOf(p, (PAGE_AIR - solidFill(p)) * BODY_H).total / BODY_H;

/**
 * A short page breathes where a page can: its rows open up, and a section break takes a line of air. Two paragraphs keep
 * their spacing, whatever the page: it is what tells a laid-out book from a filled-out one. A heading stays on what it heads.
 */
function stretch(page: PagePlan, need = (PAGE_AIR - solidFill(page)) * BODY_H): void {
  const { row, pause, total } = airOf(page, need);
  if (!total) return;
  const moved: [top: number, by: number][] = [];
  let by = 0;
  columnOf(page).forEach((item, k, column) => {
    if (item.t !== 'para' && item.t !== 'rows' && item.t !== 'block') return;
    if (opens(column, k)) by += pause;
    moved.push([item.y, by]);
    item.y += by;
    if (item.t === 'rows') {
      item.air = row;
      by += (item.to - item.from) * row;
    }
  });
  // a rail element goes where the block it hangs on went: it stays on its baseline, and two of them never close up
  for (const item of page.items) if (item.t === 'rail') item.y += moved.findLast(([top]) => top <= item.y)?.[1] ?? 0;
  page.fill = fillOf(page.items);
}

/** The band of whole tiles that leaves least of `room` once the page has taken `air`, and of two that leave nothing the one that lets it breathe most. */
function bandOf(room: number, air: number): { rows: number; cols: number; h: number } | null {
  let best: { rows: number; cols: number; h: number } | null = null;
  let left = Infinity;
  for (const cols of END_COLS) {
    const tile = GRID.full / cols;
    for (let rows = Math.floor(Math.min(room, END_H) / tile + 1e-9); rows >= 1; rows--) {
      const spare = Math.max(0, room - rows * tile - air) + (rows * tile) / 1e4; // a hair towards the smaller band
      if (spare < left) { left = spare; best = { rows, cols, h: rows * tile }; }
    }
  }
  return best;
}

/**
 * The page a section ends on, short of a full page, closes on the art of its guide down to its foot: a band of tiles is a
 * close, a blank foot is a hole. Tiles come whole, so the band is the one that fits, the page takes what it leaves, and the
 * art stays `END_GAP` under the text.
 */
function addEnd(pages: PagePlan[]): void {
  const last = textPages(pages).at(-1);
  if (!last) return;
  if (reachOf(last) >= PAGE_BREATH) { stretch(last); return; }
  const room = BODY_BOTTOM - Math.max(...last.items.map(endOf)) - END_GAP;
  const band = bandOf(room, airOf(last, room).total);
  if (!band) return;
  stretch(last, room - band.h);
  last.items.push({ t: 'end', y: BODY_BOTTOM - band.h, ...band });
  last.fill = fillOf(last.items);
}

/** The page a section's text ends on gets ruled lines down to the folio: useful on a printed sheet. */
function addNotes(pages: PagePlan[]): void {
  const last = textPages(pages).at(-1);
  if (!last || last.fill >= PAGE_AIM) return;
  const y = Math.max(...last.items.map(endOf)) + GRID.baseline;
  const h = BODY_BOTTOM - y;
  if (h < MIN_NOTES) return;
  last.items.push({ t: 'notes', y, h });
  last.fill = fillOf(last.items);
}

/**
 * A last page the art cannot close takes from the page before it, line by line, then block by block: an example, or a heading
 * and its list, go over whole. It stops as soon as the art can close it, at the worst with a giver that is still a page. A
 * page that stays full gives on, up to `last`.
 */
function fed(flow: Block[], params: LayoutParams, cuts: number[], pages: PagePlan[]): PagePlan[] {
  const text = textPages(pages);
  const before = text.at(-2);
  const tail = text.at(-1);
  const aim = params.last ?? 0;
  if (!before || !tail || (closeable(tail) && solidFill(tail) >= aim)) return pages;
  const at = pages.indexOf(before);
  let held = closeable(tail) ? pages : null;
  for (let by = GRID.baseline; by <= (1 - PAGE_AIM) * BODY_H - 2 * GRID.baseline; by += GRID.baseline) {
    const gives: number[] = [];
    gives[at] = by;
    const tried = new Flow(params, cuts, gives).run(flow);
    const giver = reachOf(tried[at]!);
    if (giver < PAGE_AIM) break;
    const last = textPages(tried).at(-1)!;
    if (!closeable(last)) continue;
    if (solidFill(last) >= aim && giver >= PAGE_FULL) return tried;
    held ??= tried;
  }
  return held ?? pages;
}

/** Pure: no pdfkit, no clock, no RNG. */
export function paginate(blocks: Block[], params: LayoutParams): PagePlan[] {
  const flow = arrange(blocks, params);
  let pages = new Flow(params, []).run(flow);
  const cuts: number[] = [];
  if (params.trim) {
    const last = textPages(pages).at(-1);
    cuts.push(...pages.slice(0, last ? pages.indexOf(last) : 0).map(() => params.trim!));
    if (cuts.length) pages = new Flow(params, cuts).run(flow);
  }
  pages = fed(flow, params, Array.from(cuts, (c) => c ?? 0), pages);
  if (params.notesFill) {
    textPages(pages).forEach((p) => stretch(p));
    addNotes(pages);
  }
  return pages;
}

/** Two spacings a reader does not tell apart: a chapter never looks tighter than the one before it, the rebalance and the art take up what is left. */
const SPACES = [10.8, 9];

/** The layouts to fall back on, the plainest first: 2 spacings, figure early or late, rail spread or first. */
export const LAYOUTS: readonly LayoutParams[] = SPACES.flatMap((space) => (['early', 'late'] as const).flatMap((figureSlot) => [false, true].map((railFirst) => ({ space, figureSlot, railFirst, notesFill: false }))));

/** Line by line, a few at most: past that the pages that give stop being full, and the art closes the section better than they would. */
const TRIMS = Array.from({ length: 7 }, (_, k) => k * GRID.baseline);

const lowest = (pages: PagePlan[]): number => Math.min(1, ...pages.map(reachOf));

/** Short pages breathe, and the section closes on its art when what is left is worth a band of tiles. */
function finished(pages: PagePlan[]): PagePlan[] {
  textPages(pages).slice(0, -1).forEach((p) => stretch(p));
  addEnd(pages);
  return pages;
}

/**
 * The plainest layout whose every page holds up, the pages before the last ending as little higher as it takes. A last page
 * that stays short is closed on purpose, so the search takes the first layout that gives it `LAST_PAGE`, or the one that gives
 * it most without emptying the pages before, and only a section too short for the art falls back on ruled notes. Talent buys no search here: pdf §18 set a stop
 * rule on the `layouts` lever and best of 24 moved `interior` by 1.1 to 1.6 points on the four fixtures, under the 3 it asked,
 * so that field of `DesignEffort` stays a label and talent acts through covers, taste and finish.
 */
export function layoutOf(blocks: Block[], top?: number): PagePlan[] {
  const base = top === undefined ? {} : { top };
  let best: LayoutParams = LAYOUTS[0]!;
  let most = -1;
  let closable: PagePlan[] | null = null;
  let tail = 0;
  for (const p of LAYOUTS) {
    for (const trim of TRIMS) {
      const tried = { ...p, ...base, trim, last: LAST_PAGE };
      const pages = paginate(blocks, tried);
      const text = textPages(pages);
      const low = lowest(text);
      if (low >= PAGE_AIM) return finished(pages);
      const last = text.at(-1)!;
      const others = lowest(text.slice(0, -1));
      if (others >= PAGE_AIM && closeable(last)) {
        if (others >= PAGE_FULL && solidFill(last) >= LAST_PAGE) return finished(pages);
        const rank = (others >= PAGE_FULL ? 1 : 0) + Math.min(solidFill(last), LAST_PAGE);
        if (rank > tail) { tail = rank; closable = pages; }
      }
      if (low > most) { most = low; best = tried; }
      if (text.length < 2) break; // nothing to give up to itself
    }
  }
  return closable ? finished(closable) : paginate(blocks, { ...best, notesFill: true });
}
