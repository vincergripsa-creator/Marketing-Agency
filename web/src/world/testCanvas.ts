// Headless canvas for the world tests: a fake document.createElement('canvas') whose 2D context really paints over a
// Uint8ClampedArray, so getSheet, every bake and the whole buildLayout run in vitest under Node. Importing this file
// installs it. Paths (arc, fill, stroke...) are stubs, the pixel art never needs them: fillPoly and blob use fillRect.
// Transforms are translate and scale only, which is all the world bakes with. Never imported by the app.

type Rgba = readonly [number, number, number, number];

const CLEAR: Rgba = [0, 0, 0, 0];
const colours = new Map<string, Rgba>();

function parseColour(css: string): Rgba {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(css)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [at(0), at(2), at(4), full.length === 8 ? at(6) : 255];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(css)?.[1];
  if (fn) {
    const [r = 0, g = 0, b = 0, a = 1] = fn.split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, Math.round(a * 255)];
  }
  return CLEAR; // named colours and anything else paint nothing: the world only writes hex and rgba
}

function colourOf(style: unknown): Rgba {
  if (typeof style !== 'string') return CLEAR; // gradients are stubs
  let c = colours.get(style);
  if (!c) colours.set(style, (c = parseColour(style)));
  return c;
}

/** Source-over on straight alpha. */
function blend(d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  if (a >= 255) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
    return;
  }
  const sa = a / 255;
  const da = (d[i + 3]! / 255) * (1 - sa);
  const out = sa + da;
  d[i] = (r * sa + d[i]! * da) / out;
  d[i + 1] = (g * sa + d[i + 1]! * da) / out;
  d[i + 2] = (b * sa + d[i + 2]! * da) / out;
  d[i + 3] = out * 255;
}

interface FakeImage { data: Uint8ClampedArray; width: number; height: number }

export class FakeCanvas {
  readonly style: Record<string, string> = {}; // the engine sets its cursor here
  private w = 300;
  private h = 150;
  private buffer: Uint8ClampedArray | null = null; // lazy: most of a big composite stays out of the tests' way
  private ctx: FakeContext2D | null = null;

  get width(): number {
    return this.w;
  }
  set width(v: number) {
    this.w = Math.max(0, Math.floor(v));
    this.buffer = null;
  }
  get height(): number {
    return this.h;
  }
  set height(v: number) {
    this.h = Math.max(0, Math.floor(v));
    this.buffer = null;
  }

  /** RGBA bytes, top-left first, `null` until something was painted. */
  get painted(): Uint8ClampedArray | null {
    return this.buffer;
  }

  pixels(): Uint8ClampedArray {
    return (this.buffer ??= new Uint8ClampedArray(this.w * this.h * 4));
  }

  getContext(_kind?: string, _opts?: unknown): FakeContext2D {
    return (this.ctx ??= new FakeContext2D(this));
  }
}

export class FakeContext2D {
  fillStyle: unknown = '#000000';
  strokeStyle: unknown = '#000000';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  private m = { a: 1, d: 1, e: 0, f: 0 };
  private stack: { a: number; d: number; e: number; f: number; fillStyle: unknown; globalAlpha: number }[] = [];

  constructor(readonly canvas: FakeCanvas) {}

  save(): void {
    this.stack.push({ ...this.m, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.m = { a: s.a, d: s.d, e: s.e, f: s.f };
    this.fillStyle = s.fillStyle;
    this.globalAlpha = s.globalAlpha;
  }
  translate(x: number, y: number): void {
    this.m.e += this.m.a * x;
    this.m.f += this.m.d * y;
  }
  scale(x: number, y: number): void {
    this.m.a *= x;
    this.m.d *= y;
  }
  setTransform(a = 1, _b = 0, _c = 0, d = 1, e = 0, f = 0): void {
    this.m = { a, d, e, f };
  }
  resetTransform(): void {
    this.m = { a: 1, d: 1, e: 0, f: 0 };
  }

  /** Device rectangle of a user-space one, clipped to the canvas. */
  private device(x: number, y: number, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
    const { a, d, e, f } = this.m;
    const xa = Math.round(a * x + e);
    const xb = Math.round(a * (x + w) + e);
    const ya = Math.round(d * y + f);
    const yb = Math.round(d * (y + h) + f);
    return {
      x0: Math.max(0, Math.min(xa, xb)), x1: Math.min(this.canvas.width, Math.max(xa, xb)),
      y0: Math.max(0, Math.min(ya, yb)), y1: Math.min(this.canvas.height, Math.max(ya, yb)),
    };
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b, a] = colourOf(this.fillStyle);
    const alpha = a * this.globalAlpha;
    if (alpha <= 0) return;
    const q = this.device(x, y, w, h);
    const d = this.canvas.pixels();
    const W = this.canvas.width;
    for (let py = q.y0; py < q.y1; py++) for (let px = q.x0; px < q.x1; px++) blend(d, (py * W + px) * 4, r, g, b, alpha);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    if (!this.canvas.painted) return;
    const q = this.device(x, y, w, h);
    const d = this.canvas.pixels();
    const W = this.canvas.width;
    for (let py = q.y0; py < q.y1; py++) d.fill(0, (py * W + q.x0) * 4, (py * W + q.x1) * 4);
  }

  createImageData(w: number, h: number): FakeImage {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }

  getImageData(x: number, y: number, w: number, h: number): FakeImage {
    const img = this.createImageData(w, h);
    const src = this.canvas.painted;
    if (!src) return img;
    const W = this.canvas.width;
    for (let py = 0; py < h; py++) {
      const sy = y + py;
      if (sy < 0 || sy >= this.canvas.height) continue;
      const from = Math.max(0, x);
      const to = Math.min(W, x + w);
      if (to > from) img.data.set(src.subarray((sy * W + from) * 4, (sy * W + to) * 4), (py * w + (from - x)) * 4);
    }
    return img;
  }

  /** Raw copy, like the real one: no transform, no blending. */
  putImageData(img: FakeImage, x: number, y: number): void {
    const d = this.canvas.pixels();
    const W = this.canvas.width;
    for (let py = 0; py < img.height; py++) {
      const dy = y + py;
      if (dy < 0 || dy >= this.canvas.height) continue;
      const from = Math.max(0, -x);
      const to = Math.min(img.width, W - x);
      if (to > from) d.set(img.data.subarray((py * img.width + from) * 4, (py * img.width + to) * 4), (dy * W + x + from) * 4);
    }
  }

  /** (src, dx, dy), (src, dx, dy, dw, dh) or (src, sx, sy, sw, sh, dx, dy, dw, dh), nearest neighbour. */
  drawImage(src: FakeCanvas, ...n: number[]): void {
    const s = src.painted;
    if (!s) return;
    const [sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0] =
      n.length === 2 ? [0, 0, src.width, src.height, n[0], n[1], src.width, src.height]
      : n.length === 4 ? [0, 0, src.width, src.height, n[0], n[1], n[2], n[3]]
      : n;
    const { a, d: my, e, f } = this.m;
    const xa = a * dx + e;
    const xb = a * (dx + dw) + e;
    const ya = my * dy + f;
    const yb = my * (dy + dh) + f;
    const q = this.device(dx, dy, dw, dh);
    const out = this.canvas.pixels();
    const W = this.canvas.width;
    for (let py = q.y0; py < q.y1; py++) {
      const v = Math.floor(sy + ((py + 0.5 - ya) / (yb - ya)) * sh);
      if (v < 0 || v >= src.height) continue;
      for (let px = q.x0; px < q.x1; px++) {
        const u = Math.floor(sx + ((px + 0.5 - xa) / (xb - xa)) * sw);
        if (u < 0 || u >= src.width) continue;
        const i = (v * src.width + u) * 4;
        blend(out, (py * W + px) * 4, s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]! * this.globalAlpha);
      }
    }
  }

  // ── stubs
  createRadialGradient(): { addColorStop(offset: number, colour: string): void } {
    return { addColorStop: () => undefined };
  }
  createLinearGradient(): { addColorStop(offset: number, colour: string): void } {
    return { addColorStop: () => undefined };
  }
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  arc(): void {}
  ellipse(): void {}
  rect(): void {}
  roundRect(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  setLineDash(): void {}
  fillText(): void {}
  strokeText(): void {}
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
}

/** Idempotent, and it leaves a real DOM alone. */
export function installTestCanvas(): void {
  const scope = globalThis as { document?: unknown };
  scope.document ??= {
    createElement(tag: string): FakeCanvas {
      if (tag !== 'canvas') throw new Error(`testCanvas: no <${tag}>`);
      return new FakeCanvas();
    },
  };
}

/** Number of pixels of a canvas with alpha above `min`. */
export function opaquePixels(c: HTMLCanvasElement, min = 0): number {
  const d = (c as unknown as FakeCanvas).painted;
  if (!d) return 0;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > min) n++;
  return n;
}

installTestCanvas();
