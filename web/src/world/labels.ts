// Floating island labels ("Recherche · 3 agents · 2 en cours") and agent name tags, drawn in screen space.
import { FONT_PIXEL, FONT_UI, measure, roundRect } from './text';
import { shade } from './palette';

export interface LabelRect { id: string; x: number; y: number; w: number; h: number }

/** Pill anchored by its bottom-centre at (x, y). Returns its rect for hit-testing. */
export function drawIslandLabel(
  g: CanvasRenderingContext2D, id: string, x: number, y: number, title: string, sub: string, color: string,
  glyph: string, state: 'normal' | 'hover' | 'selected', busy: number,
): LabelRect {
  const tf = `700 12px ${FONT_UI}`;
  const sf = `500 10px ${FONT_UI}`;
  const tw = Math.max(measure(g, tf, title), measure(g, sf, sub));
  const w = Math.ceil(tw + 46);
  const h = 34;
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - h);
  g.save();
  g.shadowColor = 'rgba(40,30,80,0.18)';
  g.shadowBlur = state === 'normal' ? 8 : 14;
  g.shadowOffsetY = 2;
  g.fillStyle = state === 'selected' ? '#ffffff' : 'rgba(255,255,255,0.9)';
  roundRect(g, x0, y0, w, h, 10);
  g.fill();
  g.restore();
  if (state !== 'normal') {
    g.strokeStyle = state === 'selected' ? color : 'rgba(120,110,170,0.5)';
    g.lineWidth = state === 'selected' ? 2 : 1;
    roundRect(g, x0 + 0.5, y0 + 0.5, w - 1, h - 1, 10);
    g.stroke();
  }
  // coloured badge
  g.fillStyle = color;
  roundRect(g, x0 + 7, y0 + 7, 20, 20, 6);
  g.fill();
  g.fillStyle = shade(color, 0.25);
  roundRect(g, x0 + 7, y0 + 7, 20, 7, 4);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = `10px ${FONT_PIXEL}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, x0 + 17, y0 + 17.5);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#231d3a';
  g.font = tf;
  g.fillText(title, x0 + 34, y0 + 15);
  g.fillStyle = '#6f6888';
  g.font = sf;
  // tiny live dot
  if (busy > 0) {
    g.fillStyle = '#22c55e';
    g.beginPath();
    g.arc(x0 + 37, y0 + 25, 2.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#6f6888';
    g.fillText(sub, x0 + 43, y0 + 28);
  } else g.fillText(sub, x0 + 34, y0 + 28);
  // pointer
  g.fillStyle = state === 'selected' ? '#ffffff' : 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.moveTo(x - 5, y0 + h - 0.5);
  g.lineTo(x + 5, y0 + h - 0.5);
  g.lineTo(x, y0 + h + 5);
  g.closePath();
  g.fill();
  return { id, x: x0, y: y0, w, h: h + 5 };
}

/** Small pill without badge for places (Cerveau, Café). */
export function drawPlaceTag(g: CanvasRenderingContext2D, x: number, y: number, title: string, sub: string, color: string): void {
  const tf = `700 11px ${FONT_UI}`;
  const sf = `500 9px ${FONT_UI}`;
  const w = Math.ceil(Math.max(measure(g, tf, title), measure(g, sf, sub)) + 26);
  const h = 30;
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y - h);
  g.fillStyle = 'rgba(255,255,255,0.86)';
  roundRect(g, x0, y0, w, h, 9);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x0 + 10, y0 + 11, 3.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#231d3a';
  g.font = tf;
  g.fillText(title, x0 + 18, y0 + 14);
  g.fillStyle = '#6f6888';
  g.font = sf;
  g.fillText(sub, x0 + 9, y0 + 25);
}

/** Dark name tag under an agent's feet. */
export function drawNameTag(g: CanvasRenderingContext2D, x: number, y: number, name: string, role: string, color: string, strong: boolean): void {
  const nf = `700 11px ${FONT_UI}`;
  const rf = `500 10px ${FONT_UI}`;
  const roleText = role ? ` · ${role}` : '';
  const nw = measure(g, nf, name);
  const rw = roleText ? measure(g, rf, roleText) : 0;
  const w = Math.ceil(nw + rw + 22);
  const h = 20;
  const x0 = Math.round(x - w / 2);
  const y0 = Math.round(y);
  g.fillStyle = strong ? 'rgba(30,24,52,0.92)' : 'rgba(30,24,52,0.78)';
  roundRect(g, x0, y0, w, h, 10);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x0 + 9, y0 + 10, 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = nf;
  g.textBaseline = 'middle';
  g.fillText(name, x0 + 16, y0 + 10.5);
  if (roleText) {
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = rf;
    g.fillText(roleText, x0 + 16 + nw, y0 + 10.5);
  }
  g.textBaseline = 'alphabetic';
}
