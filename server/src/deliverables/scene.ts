import { advance, faceOf, isStdFont, type FaceName } from './fonts.js';
import { escapeXml, hashString } from './text.js';

/** One drawing, two back-ends: pdfkit with real selectable text, SVG with glyph paths that need no font. No gradient, no filter, no image. */
export type Op =
  | { k: 'path'; d: string; fill?: string; stroke?: string; sw?: number; op?: number; cap?: 'round' | 'butt'; dash?: [number, number] }
  | { k: 'clip'; d: string; ops: Op[] }
  | { k: 'text'; s: string; x: number; y: number; font: FaceName; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; track?: number; op?: number };

type Stroke = { stroke?: string; sw?: number; op?: number; cap?: 'round' | 'butt'; dash?: [number, number] };
type TextOp = Extract<Op, { k: 'text' }>;

/** What the art evaluator reads back from a field: the ground of each tile, the kind drawn on it. */
export interface SceneMeta { grounds: number[][]; kinds: number[] }

/** Rounds a coordinate to 2 decimals: enough for print, and identical bytes on every render. */
export const n = (v: number): string => String(Math.round(v * 100) / 100);

const K = 0.5523; // control-point distance of a quarter circle

export function circleD(cx: number, cy: number, r: number): string {
  const c = r * K;
  return `M${n(cx - r)} ${n(cy)}C${n(cx - r)} ${n(cy - c)} ${n(cx - c)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}C${n(cx + c)} ${n(cy - r)} ${n(cx + r)} ${n(cy - c)} ${n(cx + r)} ${n(cy)}C${n(cx + r)} ${n(cy + c)} ${n(cx + c)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}C${n(cx - c)} ${n(cy + r)} ${n(cx - r)} ${n(cy + c)} ${n(cx - r)} ${n(cy)}Z`;
}

export function ellipseD(cx: number, cy: number, rx: number, ry: number, rotDeg = 0): string {
  const a = (rotDeg * Math.PI) / 180;
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  const P = (x: number, y: number) => `${n(cx + x * cs - y * sn)} ${n(cy + x * sn + y * cs)}`;
  return `M${P(-rx, 0)}C${P(-rx, -ry * K)} ${P(-rx * K, -ry)} ${P(0, -ry)}C${P(rx * K, -ry)} ${P(rx, -ry * K)} ${P(rx, 0)}C${P(rx, ry * K)} ${P(rx * K, ry)} ${P(0, ry)}C${P(-rx * K, ry)} ${P(-rx, ry * K)} ${P(-rx, 0)}Z`;
}

export class Scene {
  ops: Op[] = [];
  meta: SceneMeta | null = null;

  constructor(public w: number, public h: number) {}

  path(d: string, fill?: string, o: Stroke = {}): this {
    this.ops.push({ k: 'path', d, ...(fill ? { fill } : {}), ...o });
    return this;
  }

  rect(x: number, y: number, w: number, h: number, fill?: string, o: Stroke = {}): this {
    return this.path(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`, fill, o);
  }

  circle(cx: number, cy: number, r: number, fill?: string, o: Stroke = {}): this {
    return this.path(circleD(cx, cy, r), fill, o);
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1, o: Pick<Stroke, 'cap' | 'dash'> = {}): this {
    return this.path(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, undefined, { stroke, sw, ...o });
  }

  /** `y` is the alphabetic baseline. */
  text(s: string, x: number, y: number, font: FaceName, size: number, fill: string, o: { anchor?: 'start' | 'middle' | 'end'; track?: number; op?: number } = {}): this {
    this.ops.push({ k: 'text', s, x, y, font, size, fill, ...o });
    return this;
  }

  clip(d: string, build: (s: Scene) => void): this {
    const inner = new Scene(this.w, this.h);
    build(inner);
    this.ops.push({ k: 'clip', d, ops: inner.ops });
    return this;
  }
}

/** Left edge of a text op, whatever its anchor. */
function startX(o: TextOp): number {
  if (!o.anchor || o.anchor === 'start') return o.x;
  const w = advance(o.font, o.s, o.size, o.track ?? 0);
  return o.anchor === 'middle' ? o.x - w / 2 : o.x - w;
}

function emitPdf(doc: PDFKit.PDFDocument, ops: Op[]): void {
  for (const o of ops) {
    doc.save();
    if (o.k === 'clip') {
      doc.path(o.d).clip();
      emitPdf(doc, o.ops);
    } else if (o.k === 'text') {
      if (o.op !== undefined) doc.fillOpacity(o.op);
      // never a second argument to font(): pdfkit forwards it to fontkit as a variation name, and static fonts throw
      doc.font(o.font).fontSize(o.size).fillColor(o.fill);
      doc.text(o.s, startX(o), o.y, { lineBreak: false, baseline: 'alphabetic', characterSpacing: o.track ?? 0 });
    } else {
      if (o.op !== undefined) { doc.fillOpacity(o.op); doc.strokeOpacity(o.op); }
      doc.path(o.d);
      if (o.stroke) {
        doc.lineWidth(o.sw ?? 1).lineCap(o.cap ?? 'butt');
        if (o.dash) doc.dash(o.dash[0], { space: o.dash[1] });
      }
      if (o.fill && o.stroke) doc.fillAndStroke(o.fill, o.stroke);
      else if (o.fill) doc.fill(o.fill);
      else if (o.stroke) doc.stroke(o.stroke);
    }
    doc.restore();
  }
}

/** Draws the scene with its top-left corner at (x, y). The voice of its text must be registered on `doc`. */
export function toPdf(doc: PDFKit.PDFDocument, s: Scene, x = 0, y = 0, scale = 1): void {
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  emitPdf(doc, s.ops);
  doc.restore();
}

const SVG_COMMANDS = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' } as const;

/** Outline of a line of text, from the same shaping as the PDF: kerning and ligatures survive with no font in the viewer. */
function glyphsD(o: TextOp, x: number, num: (v: number) => string): string {
  const { font, unitsPerEm } = faceOf(o.font);
  const run = font.layout(o.s);
  const k = o.size / unitsPerEm;
  let cx = x;
  let d = '';
  run.glyphs.forEach((glyph, i) => {
    const at = run.positions[i]!;
    const px = cx + at.xOffset * k;
    const py = o.y - at.yOffset * k;
    for (const c of glyph.path.commands) {
      d += SVG_COMMANDS[c.command];
      for (let j = 0; j < c.args.length; j += 2) d += `${j ? ' ' : ''}${num(px + c.args[j]! * k)} ${num(py - c.args[j + 1]! * k)}`;
    }
    cx += at.xAdvance * k + (o.track ?? 0);
  });
  return d;
}

function emitSvg(ops: Op[], clips: Map<string, string>, num: (v: number) => string, greekBelow: number): string {
  return ops.map((o) => {
    if (o.k === 'clip') {
      // named after its shape: two covers inlined in one page never share an id
      const id = `c${hashString(o.d).toString(36)}`;
      clips.set(id, o.d);
      return `<g clip-path="url(#${id})">${emitSvg(o.ops, clips, num, greekBelow)}</g>`;
    }
    if (o.k === 'path') {
      return `<path d="${o.d}" fill="${o.fill ?? 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}${o.cap ? ` stroke-linecap="${o.cap}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}${o.op !== undefined ? ` opacity="${o.op}"` : ''}/>`;
    }
    const x = startX(o);
    if (o.size < greekBelow) {
      // a greeked line keeps its width and gives no word away: no aria-label
      const w = advance(o.font, o.s, o.size, o.track ?? 0);
      const bar = o.size * 0.5;
      return `<path d="M${num(x)} ${num(o.y - bar)}h${num(w)}v${num(bar)}h${num(-w)}Z" fill="${o.fill}" opacity="0.35"/>`;
    }
    const opacity = o.op !== undefined ? ` opacity="${o.op}"` : '';
    if (isStdFont(o.font)) {
      // the rescue voice has no outlines to draw, a viewer's own serif or sans stands in
      const family = o.font.startsWith('Times') ? 'Times, serif' : 'Helvetica, Arial, sans-serif';
      return `<text aria-label="${escapeXml(o.s)}" x="${num(x)}" y="${num(o.y)}" font-family="${family}" font-size="${o.size}"${/Bold/.test(o.font) ? ' font-weight="bold"' : ''}${/Italic|Oblique/.test(o.font) ? ' font-style="italic"' : ''} fill="${o.fill}"${opacity}>${escapeXml(o.s)}</text>`;
    }
    return `<path aria-label="${escapeXml(o.s)}" fill="${o.fill}"${opacity} d="${glyphsD(o, x, num)}"/>`;
  }).join('');
}

/** Stand-alone SVG. `greekBelow` turns text under that size into bars of its real width, for previews that must not give the content away. */
export function toSvg(s: Scene, o: { precision?: 1 | 2; greekBelow?: number } = {}): string {
  const factor = 10 ** (o.precision ?? 2);
  const num = (v: number) => String(Math.round(v * factor) / factor);
  const clips = new Map<string, string>();
  const body = emitSvg(s.ops, clips, num, o.greekBelow ?? 0);
  const defs = [...clips].map(([id, d]) => `<clipPath id="${id}"><path d="${d}"/></clipPath>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.w} ${s.h}" width="${s.w}" height="${s.h}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
}
