// Screen-space text helpers (labels, bubbles): fonts, cached measurements, wrapping, rounded rects.

export const FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_PIXEL = '"Silkscreen", "Press Start 2P", ui-monospace, "SF Mono", Consolas, monospace';

/** Every face the canvas draws with. A canvas does not wait for a font: it draws its fallback that frame and nothing says so. */
const CANVAS_FACES = ['10px "Silkscreen"', '500 11px "Inter"', '600 13px "Inter"', '700 12px "Inter"'];
/** A font that never comes must not leave the world blank. */
const FONTS_WAIT_MS = 1500;

const widths = new Map<string, number>();

if (typeof document !== 'undefined' && document.fonts) {
  // pixel fonts arrive asynchronously: forget measurements taken with the fallback font
  document.fonts.addEventListener?.('loadingdone', () => widths.clear());
}

/** Resolves once the canvas can draw in its own fonts, or after `waitMs`. It never rejects: a font missing is a fallback, not a crash. */
export function canvasFontsReady(fonts: Pick<FontFaceSet, 'load'> | undefined = typeof document === 'undefined' ? undefined : document.fonts, waitMs = FONTS_WAIT_MS): Promise<void> {
  if (!fonts?.load) return Promise.resolve();
  const loaded = Promise.allSettled(CANVAS_FACES.map((face) => fonts.load(face)));
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    void loaded.then(() => {
      clearTimeout(timer);
      widths.clear();
      resolve();
    });
  });
}

export function measure(g: CanvasRenderingContext2D, font: string, text: string): number {
  const k = `${font}|${text}`;
  let w = widths.get(k);
  if (w === undefined) {
    g.font = font;
    w = g.measureText(text).width;
    if (widths.size > 4000) widths.clear();
    widths.set(k, w);
  }
  return w;
}

/** Greedy word wrap with ellipsis on the last allowed line. */
export function wrap(g: CanvasRenderingContext2D, font: string, text: string, maxW: number, maxLines: number): string[] {
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(g, font, next) <= maxW || !line) {
      line = next;
      if (!lines.length && measure(g, font, line) > maxW) {
        // single very long word: hard cut
        while (line.length > 1 && measure(g, font, `${line}…`) > maxW) line = line.slice(0, -1);
      }
    } else {
      lines.push(line);
      line = words[i];
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (i < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && measure(g, font, `${last}…`) > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
  }
  return lines;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

export function upperFr(s: string): string {
  return (s || '').toLocaleUpperCase('fr-FR');
}
