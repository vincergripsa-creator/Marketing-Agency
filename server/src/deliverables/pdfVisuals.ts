/**
 * Vector infographics for the PDF (pdfkit drawing calls only, no glyph icons):
 * timeline, bar_chart, checklist_card, quote, steps_diagram, icon_grid, do_dont, and the fillable grid.
 * Every visual is laid out first (height known) then drawn, so the caller can keep it on one page.
 */
import type { VisualSpec } from '../shared.js';
import { darken, ensureContrast, lighten, mix, readableOn, type Palette } from './color.js';
import { normalizeKey, sanitizePdfText, type StdFont } from './text.js';

export interface PdfTheme {
  p: Palette;
  title: StdFont; body: StdFont; bold: StdFont; italic: StdFont;
  ink: string; muted: string; primaryInk: string; accentInk: string; line: string; card: string;
}

export interface VisualLayout { height: number; draw(x: number, y: number): void }

type Doc = PDFKit.PDFDocument;

const NO_BREAK = 10_000; // `height` option: stops pdfkit from ever adding a page inside a measured box

export function measure(doc: Doc, text: string, font: StdFont, size: number, width: number, lineGap = 2): number {
  if (!text) return 0;
  doc.font(font).fontSize(size);
  return doc.heightOfString(text, { width, lineGap });
}

export function put(
  doc: Doc, text: string, x: number, y: number,
  o: { font: StdFont; size: number; color: string; width: number; align?: 'left' | 'center' | 'right' | 'justify'; lineGap?: number; spacing?: number },
): void {
  if (!text) return;
  doc.font(o.font).fontSize(o.size).fillColor(o.color)
    .text(text, x, y, { width: o.width, align: o.align ?? 'left', lineGap: o.lineGap ?? 2, height: NO_BREAK, characterSpacing: o.spacing ?? 0 });
}

// ───────────────────────────── small vector icons (24×24 box, stroked) ─────────────────────────────

type IconName =
  | 'clock' | 'heart' | 'check' | 'star' | 'bulb' | 'chat' | 'calendar' | 'shield' | 'leaf' | 'moon' | 'coin' | 'target'
  | 'people' | 'phone' | 'bolt' | 'book' | 'home' | 'paw' | 'cup' | 'sun' | 'smile' | 'pin';

const ICON_PATHS: Record<IconName, string[]> = {
  clock: ['M12 3 A9 9 0 1 1 11.99 3Z', 'M12 7 V12 L15.5 14.5'],
  heart: ['M12 20 C5 15 3 11.5 3 8.5 C3 6 5 4 7.5 4 C9.5 4 11 5.2 12 6.8 C13 5.2 14.5 4 16.5 4 C19 4 21 6 21 8.5 C21 11.5 19 15 12 20Z'],
  check: ['M12 3 A9 9 0 1 1 11.99 3Z', 'M8 12.5 L11 15.5 L16.5 9'],
  star: ['M12 3 L14.7 8.6 L20.8 9.4 L16.4 13.6 L17.5 19.7 L12 16.8 L6.5 19.7 L7.6 13.6 L3.2 9.4 L9.3 8.6Z'],
  bulb: ['M9.5 18 H14.5 M10.5 21 H13.5', 'M12 3 C8.6 3 6 5.6 6 9 C6 11.3 7.3 12.8 8.5 14 C9.2 14.7 9.5 15.4 9.5 16 V18 H14.5 V16 C14.5 15.4 14.8 14.7 15.5 14 C16.7 12.8 18 11.3 18 9 C18 5.6 15.4 3 12 3Z'],
  chat: ['M4 5 H20 V16 H10.5 L6 20 V16 H4Z', 'M8 9.5 H16 M8 12.5 H13'],
  calendar: ['M4 6 H20 V20 H4Z', 'M4 10.5 H20 M8.5 3.5 V7.5 M15.5 3.5 V7.5', 'M8 14 H10 M14 14 H16 M8 17 H10'],
  shield: ['M12 3 L19 6 V11 C19 15.5 16 19 12 21 C8 19 5 15.5 5 11 V6Z', 'M9 12 L11.2 14.2 L15.2 10'],
  leaf: ['M5 19 C5 10 11 5 20 4 C19 13 14 19 5 19Z', 'M5 19 L13.5 10.5'],
  moon: ['M19.5 14.5 A8 8 0 1 1 9.5 4.5 A6.5 6.5 0 0 0 19.5 14.5Z'],
  coin: ['M12 3 A9 9 0 1 1 11.99 3Z', 'M15.3 8.6 A4.6 4.6 0 1 0 15.3 15.4', 'M7.5 11 H13 M7.5 13.4 H12.4'],
  target: ['M12 3 A9 9 0 1 1 11.99 3Z', 'M12 7 A5 5 0 1 1 11.99 7Z', 'M12 10.5 A1.5 1.5 0 1 1 11.99 10.5Z'],
  people: ['M9 5 A3 3 0 1 1 8.99 5Z', 'M3.5 19.5 C3.5 16 6 14 9 14 C12 14 14.5 16 14.5 19.5', 'M17 6.5 A2.5 2.5 0 1 1 16.99 6.5Z', 'M15.8 13.7 C18.6 13.5 20.5 15.5 20.5 18.5'],
  phone: ['M8 3 H16 C16.8 3 17.5 3.7 17.5 4.5 V19.5 C17.5 20.3 16.8 21 16 21 H8 C7.2 21 6.5 20.3 6.5 19.5 V4.5 C6.5 3.7 7.2 3 8 3Z', 'M11 18 H13'],
  bolt: ['M13 2.5 L5.5 13 H11 L10 21.5 L18.5 10 H13Z'],
  book: ['M4 5.5 C6.5 4.5 9.5 4.5 12 6.5 C14.5 4.5 17.5 4.5 20 5.5 V19 C17.5 18 14.5 18 12 20 C9.5 18 6.5 18 4 19Z', 'M12 6.5 V20'],
  home: ['M3.5 11 L12 4 L20.5 11', 'M6 9.5 V20 H18 V9.5', 'M10 20 V14.5 H14 V20'],
  paw: ['M12 13 C15 13 17.5 16 16.5 18.3 C15.8 19.8 14 19.4 12 19.4 C10 19.4 8.2 19.8 7.5 18.3 C6.5 16 9 13 12 13Z', 'M6.5 9 A1.8 2.2 0 1 1 6.49 9Z', 'M10 6 A1.8 2.2 0 1 1 9.99 6Z', 'M14 6 A1.8 2.2 0 1 1 13.99 6Z', 'M17.5 9 A1.8 2.2 0 1 1 17.49 9Z'],
  cup: ['M5 9 H16 V14 C16 17 13.5 19 10.5 19 C7.5 19 5 17 5 14Z', 'M16 10.5 H18 C19.4 10.5 20 11.4 20 12.5 C20 13.7 19.1 14.5 18 14.5 H16', 'M8.5 3.5 C8 4.5 9 5.5 8.5 6.5 M12 3.5 C11.5 4.5 12.5 5.5 12 6.5'],
  sun: ['M12 8 A4 4 0 1 1 11.99 8Z', 'M12 2.5 V4.5 M12 19.5 V21.5 M2.5 12 H4.5 M19.5 12 H21.5 M5.3 5.3 L6.7 6.7 M17.3 17.3 L18.7 18.7 M5.3 18.7 L6.7 17.3 M17.3 6.7 L18.7 5.3'],
  pin: ['M12 21 C8.2 16.6 5.5 13 5.5 9.6 A6.5 6.5 0 0 1 18.5 9.6 C18.5 13 15.8 16.6 12 21Z', 'M12 7.2 A2.4 2.4 0 1 1 11.99 7.2Z'],
  smile: ['M12 3 A9 9 0 1 1 11.99 3Z', 'M8.5 14 C9.5 15.5 10.7 16.2 12 16.2 C13.3 16.2 14.5 15.5 15.5 14', 'M9 9.5 V10.2 M15 9.5 V10.2'],
};

const ICON_KEYWORDS: [IconName, string[]][] = [
  ['pin', ['voyage', 'vacances', 'valise', 'trajet', 'sortie', 'deplacement', 'lieu']],
  ['shield', ['rhume', 'malad', 'fievre', 'otite', 'vaccin']],
  ['smile', ['dent', 'sourire']],
  ['moon', ['sommeil', 'nuit', 'dormir', 'sieste', 'coucher', 'reveil', 'endorm']],
  ['clock', ['heure', 'temps', 'minute', 'horaire', 'duree', 'rythme', 'attendre', 'chrono']],
  ['cup', ['pause', 'cafe', 'boire', 'repas', 'manger', 'biberon', 'tetee', 'gouter', 'collation']],
  ['calendar', ['jour', 'semaine', 'planning', 'calendrier', 'mois', 'date', 'agenda']],
  ['chat', ['parler', 'dire', 'communic', 'message', 'mot', 'phrase', 'question', 'echange']],
  ['people', ['famille', 'parent', 'equipe', 'enfant', 'couple', 'ensemble', 'groupe', 'client']],
  ['heart', ['calme', 'amour', 'calin', 'tendresse', 'douceur', 'rassur', 'emotion', 'confiance']],
  ['shield', ['securite', 'proteg', 'risque', 'garantie', 'prudence', 'sur ']],
  ['coin', ['argent', 'prix', 'euro', 'budget', 'cout', 'econom', 'epargne', 'payer']],
  ['target', ['objectif', 'but', 'cible', 'priorite', 'resultat']],
  ['phone', ['ecran', 'telephone', 'appli', 'app ', 'notification', 'smartphone']],
  ['bolt', ['energie', 'rapide', 'vite', 'motivation', 'boost']],
  ['book', ['lire', 'livre', 'apprendre', 'histoire', 'lecture', 'cours', 'reviser']],
  ['home', ['maison', 'chambre', 'piece', 'lit', 'environnement', 'rangement']],
  ['paw', ['chien', 'chiot', 'chat', 'animal', 'laisse', 'croquette']],
  ['sun', ['matin', 'lumiere', 'soleil', 'jour ', 'dehors']],
  ['leaf', ['nature', 'plante', 'bio', 'naturel', 'jardin']],
  ['bulb', ['astuce', 'idee', 'conseil', 'truc', 'secret']],
  ['smile', ['bonheur', 'sourire', 'joie', 'plaisir', 'fierte']],
  ['check', ['ok', 'valid', 'reussi', 'fait', 'termine']],
];

const ICON_FALLBACK: IconName[] = ['star', 'bulb', 'check', 'heart', 'target', 'clock'];

export function iconFor(label: string, index: number): IconName {
  const key = ` ${normalizeKey(label)} `;
  for (const [icon, words] of ICON_KEYWORDS) if (words.some((w) => key.includes(w))) return icon;
  return ICON_FALLBACK[index % ICON_FALLBACK.length];
}

/** Draws a stroked icon centred on (cx, cy) with the given box size. */
export function drawIcon(doc: Doc, name: IconName, cx: number, cy: number, size: number, color: string, width = 1.8): void {
  const k = size / 24;
  doc.save();
  doc.translate(cx - size / 2, cy - size / 2).scale(k);
  doc.lineWidth(width / k).lineCap('round').lineJoin('round').strokeColor(color);
  for (const d of ICON_PATHS[name] ?? ICON_PATHS.star) doc.path(d).stroke();
  doc.restore();
}

export function drawCheckMark(doc: Doc, cx: number, cy: number, r: number, bg: string, fg = '#ffffff'): void {
  doc.save();
  doc.circle(cx, cy, r).fill(bg);
  doc.lineWidth(Math.max(1.2, r * 0.28)).lineCap('round').lineJoin('round').strokeColor(fg)
    .moveTo(cx - r * 0.45, cy + r * 0.02).lineTo(cx - r * 0.1, cy + r * 0.38).lineTo(cx + r * 0.48, cy - r * 0.35).stroke();
  doc.restore();
}

export function drawCross(doc: Doc, cx: number, cy: number, r: number, bg: string, fg = '#ffffff'): void {
  doc.save();
  doc.circle(cx, cy, r).fill(bg);
  const a = r * 0.36;
  doc.lineWidth(Math.max(1.2, r * 0.26)).lineCap('round').strokeColor(fg)
    .moveTo(cx - a, cy - a).lineTo(cx + a, cy + a).moveTo(cx + a, cy - a).lineTo(cx - a, cy + a).stroke();
  doc.restore();
}

export function drawCheckbox(doc: Doc, x: number, y: number, s: number, color: string, checked = false): void {
  doc.save();
  doc.lineWidth(1.3).strokeColor(color).roundedRect(x, y, s, s, 2.5).stroke();
  if (checked) {
    doc.lineWidth(1.8).lineCap('round').lineJoin('round').strokeColor(color)
      .moveTo(x + s * 0.22, y + s * 0.52).lineTo(x + s * 0.43, y + s * 0.74).lineTo(x + s * 0.8, y + s * 0.28).stroke();
  }
  doc.restore();
}

function arrow(doc: Doc, x1: number, y: number, x2: number, color: string): void {
  doc.save();
  doc.lineWidth(2).strokeColor(color).lineCap('round').moveTo(x1, y).lineTo(x2 - 5, y).stroke();
  doc.polygon([x2 - 7, y - 4.5], [x2, y], [x2 - 7, y + 4.5]).fill(color);
  doc.restore();
}

// ───────────────────────────── frame shared by every visual ─────────────────────────────

const PAD = 16;

function frame(doc: Doc, t: PdfTheme, title: string, width: number, contentH: number, bodyDraw: (x: number, y: number) => void, kind: string): VisualLayout {
  const titleText = sanitizePdfText(title);
  const titleH = titleText ? measure(doc, titleText, t.bold, 11.5, width - PAD * 2 - 26) : 0;
  const head = titleText ? Math.max(18, titleH) + 12 : 0;
  const height = PAD + head + contentH + PAD;
  return {
    height,
    draw(x, y) {
      doc.save();
      doc.roundedRect(x, y, width, height, 10).fill(t.card);
      doc.roundedRect(x, y, width, height, 10).lineWidth(0.8).strokeColor(mix(t.card, t.p.primary, 0.25)).stroke();
      doc.restore();
      if (titleText) {
        doc.save();
        doc.circle(x + PAD + 9, y + PAD + 9, 9).fill(t.p.primary);
        doc.restore();
        drawIcon(doc, kindIcon(kind), x + PAD + 9, y + PAD + 9, 11, readableOn(t.p.primary, t.ink), 2);
        put(doc, titleText, x + PAD + 26, y + PAD + 2 + (titleH < 18 ? (18 - titleH) / 2 - 2 : 0), { font: t.bold, size: 11.5, color: t.primaryInk, width: width - PAD * 2 - 26 });
      }
      bodyDraw(x + PAD, y + PAD + head);
    },
  };
}

function kindIcon(kind: string): IconName {
  switch (kind) {
    case 'timeline': return 'clock';
    case 'bar_chart': return 'target';
    case 'checklist_card': return 'check';
    case 'quote': return 'chat';
    case 'steps_diagram': return 'bolt';
    case 'icon_grid': return 'bulb';
    default: return 'star';
  }
}

// ───────────────────────────── the 7 visual types ─────────────────────────────

function timeline(doc: Doc, v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const size = 9.5;
  if (labels.length <= 5) {
    const count = labels.length;
    const seg = inner / count;
    const labelW = seg - 8;
    // « Phase : action » (VisualSpec convention): the phase in bold, the action under it
    const parts = labels.map((l) => {
      const m = /^(.{2,32}?)\s*:\s+(.+)$/u.exec(l);
      return m ? { phase: m[1]!, action: m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1) } : { phase: '', action: l };
    });
    const phaseH = parts.map((p) => (p.phase ? measure(doc, p.phase, t.bold, size, labelW) + 2 : 0));
    const heights = parts.map((p, k) => phaseH[k]! + measure(doc, p.action, t.body, size, labelW));
    const contentH = 24 + 14 + Math.max(...heights) + 4;
    return frame(doc, t, v.title, width, contentH, (x, y) => {
      const lineY = y + 12;
      const xs = labels.map((_, k) => x + seg * k + seg / 2);
      doc.save();
      doc.lineWidth(3).strokeColor(lighten(t.p.primary, 0.55)).moveTo(xs[0], lineY).lineTo(xs[xs.length - 1], lineY).stroke();
      doc.restore();
      xs.forEach((cx, k) => {
        doc.save();
        doc.circle(cx, lineY, 12).fill(k === xs.length - 1 ? t.p.accent : t.p.primary);
        doc.restore();
        const numColor = readableOn(k === xs.length - 1 ? t.p.accent : t.p.primary, t.ink);
        put(doc, String(k + 1), cx - 12, lineY - 5.5, { font: 'Helvetica-Bold', size: 10, color: numColor, width: 24, align: 'center' });
        const p = parts[k]!;
        if (p.phase) put(doc, p.phase, cx - labelW / 2, lineY + 22, { font: t.bold, size, color: t.primaryInk, width: labelW, align: 'center' });
        put(doc, p.action, cx - labelW / 2, lineY + 22 + phaseH[k]!, { font: t.body, size, color: t.ink, width: labelW, align: 'center' });
      });
    }, 'timeline');
  }
  // vertical timeline for long sequences
  const textW = inner - 34;
  const heights = labels.map((l) => Math.max(16, measure(doc, l, t.body, size + 0.5, textW)));
  const contentH = heights.reduce((s, h) => s + h + 12, 0);
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    let cy = y;
    const top = y + 8;
    const bottom = y + contentH - heights[heights.length - 1] - 12 + 8;
    doc.save();
    doc.lineWidth(2.5).strokeColor(lighten(t.p.primary, 0.55)).moveTo(x + 10, top).lineTo(x + 10, bottom).stroke();
    doc.restore();
    labels.forEach((l, k) => {
      doc.save();
      doc.circle(x + 10, cy + 8, 9).fill(k === labels.length - 1 ? t.p.accent : t.p.primary);
      doc.restore();
      put(doc, String(k + 1), x + 1, cy + 3.5, { font: 'Helvetica-Bold', size: 8.5, color: readableOn(k === labels.length - 1 ? t.p.accent : t.p.primary, t.ink), width: 18, align: 'center' });
      put(doc, l, x + 34, cy + 1, { font: t.body, size: size + 0.5, color: t.ink, width: textW });
      cy += heights[k] + 12;
    });
  }, 'timeline');
}

function barChart(doc: Doc, v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const labelW = Math.min(170, inner * 0.38);
  const trackX = labelW + 12;
  const valueW = 40;
  const trackW = inner - trackX - valueW;
  const values = labels.map((_, k) => {
    const raw = Number(v.values?.[k]);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
  });
  const maxV = Math.max(0, ...values.map((x) => x ?? 0));
  const rows = labels.map((l) => Math.max(16, measure(doc, l, t.body, 9.5, labelW)));
  const contentH = 14 + rows.reduce((s, h) => s + h + 10, 0);
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    // scale ticks
    [0, 50, 100].forEach((tick) => {
      const tx = x + trackX + (trackW * tick) / 100;
      put(doc, `${tick}`, tx - 15, y - 1, { font: t.body, size: 7, color: t.muted, width: 30, align: 'center' });
      doc.save();
      doc.lineWidth(0.5).strokeColor(mix(t.card, t.p.primary, 0.25)).dash(2, { space: 3 }).moveTo(tx, y + 10).lineTo(tx, y + contentH - 4).stroke().undash();
      doc.restore();
    });
    let cy = y + 14;
    labels.forEach((l, k) => {
      const h = rows[k];
      put(doc, l, x, cy + (h > 16 ? 0 : 2), { font: t.body, size: 9.5, color: t.ink, width: labelW });
      const barY = cy + h / 2 - 6;
      doc.save();
      doc.roundedRect(x + trackX, barY, trackW, 12, 6).fill(mix(t.card, t.p.primary, 0.12));
      const val = values[k];
      if (val !== null && val > 0) {
        const isMax = val === maxV;
        const grad = doc.linearGradient(x + trackX, 0, x + trackX + trackW, 0);
        grad.stop(0, isMax ? t.p.accent : lighten(t.p.primary, 0.25)).stop(1, isMax ? darken(t.p.accent, 0.15) : t.p.primary);
        doc.roundedRect(x + trackX, barY, Math.max(12, (trackW * val) / 100), 12, 6).fill(grad);
      }
      doc.restore();
      // values are a 0..100 index (VisualSpec convention), not a percentage of anything
      put(doc, val === null ? '–' : `${Math.round(val)}`, x + trackX + trackW + 6, barY + 1.5, { font: t.bold, size: 9.5, color: t.primaryInk, width: valueW - 6, align: 'right' });
      cy += h + 10;
    });
  }, 'bar_chart');
}

function checklistCard(doc: Doc, v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const cols = labels.length > 5 && inner > 380 ? 2 : 1;
  const colW = (inner - (cols - 1) * 16) / cols;
  const textW = colW - 22;
  const heights = labels.map((l) => Math.max(13, measure(doc, l, t.body, 10, textW)));
  const perCol = Math.ceil(labels.length / cols);
  const colHeights = Array.from({ length: cols }, (_, c) => heights.slice(c * perCol, (c + 1) * perCol).reduce((s, h) => s + h + 9, 0));
  const contentH = Math.max(...colHeights);
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    for (let c = 0; c < cols; c++) {
      let cy = y;
      for (let k = c * perCol; k < Math.min(labels.length, (c + 1) * perCol); k++) {
        drawCheckbox(doc, x + c * (colW + 16), cy, 12, t.p.primary, false); // the reader ticks it, not the author
        put(doc, labels[k], x + c * (colW + 16) + 22, cy + 0.5, { font: t.body, size: 10, color: t.ink, width: textW });
        cy += heights[k] + 9;
      }
    }
  }, 'checklist_card');
}

function quote(doc: Doc, v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const text = labels[0] ?? '';
  const author = labels[1] ?? '';
  const extra = labels.slice(2);
  const textW = inner - 60;
  const textH = measure(doc, text, t.italic, 13, textW, 3);
  const authorH = author ? measure(doc, author, t.bold, 9.5, textW) + 8 : 0;
  const extraH = extra.length ? 26 : 0;
  const contentH = Math.max(40, textH) + authorH + extraH + 6;
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    put(doc, '“', x, y - 10, { font: 'Times-Bold', size: 64, color: lighten(t.p.accent, 0.1), width: 50 });
    put(doc, text, x + 44, y + 2, { font: t.italic, size: 13, color: t.ink, width: textW, lineGap: 3 });
    let cy = y + Math.max(40, textH) + 6;
    if (author) {
      doc.save();
      doc.rect(x + 44, cy + 5, 18, 1.5).fill(t.p.accent);
      doc.restore();
      put(doc, author, x + 68, cy, { font: t.bold, size: 9.5, color: t.muted, width: textW - 24 });
      cy += authorH;
    }
    if (extra.length) {
      let tx = x + 44;
      doc.font(t.bold).fontSize(8.5);
      for (const tag of extra.slice(0, 4)) {
        const w = doc.widthOfString(tag) + 16;
        if (tx + w > x + inner) break;
        doc.save();
        doc.roundedRect(tx, cy + 4, w, 17, 8.5).fill(mix(t.card, t.p.primary, 0.14));
        doc.restore();
        put(doc, tag, tx, cy + 8.5, { font: t.bold, size: 8.5, color: t.primaryInk, width: w, align: 'center' });
        tx += w + 6;
      }
    }
  }, 'quote');
}

function stepsDiagram(doc: Doc, v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const perRow = labels.length <= 4 ? labels.length : labels.length <= 6 ? 3 : 4;
  const gap = 22;
  const boxW = (inner - (perRow - 1) * gap) / perRow;
  const rows: string[][] = [];
  for (let k = 0; k < labels.length; k += perRow) rows.push(labels.slice(k, k + perRow));
  const rowHeights = rows.map((r) => Math.max(...r.map((l) => measure(doc, l, t.body, 9.5, boxW - 16))) + 34);
  const contentH = rowHeights.reduce((s, h) => s + h, 0) + (rows.length - 1) * 18 + 8;
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    let cy = y + 8;
    let idx = 0;
    rows.forEach((row, r) => {
      const h = rowHeights[r];
      row.forEach((l, k) => {
        const bx = x + k * (boxW + gap);
        doc.save();
        doc.roundedRect(bx, cy, boxW, h, 8).fill('#ffffff');
        doc.roundedRect(bx, cy, boxW, h, 8).lineWidth(1.2).strokeColor(lighten(t.p.primary, 0.35)).stroke();
        doc.circle(bx + boxW / 2, cy, 11).fill(idx === labels.length - 1 ? t.p.accent : t.p.primary);
        doc.restore();
        put(doc, String(idx + 1), bx + boxW / 2 - 11, cy - 5, { font: 'Helvetica-Bold', size: 10, color: readableOn(idx === labels.length - 1 ? t.p.accent : t.p.primary, t.ink), width: 22, align: 'center' });
        put(doc, l, bx + 8, cy + 17, { font: t.body, size: 9.5, color: t.ink, width: boxW - 16, align: 'center' });
        if (k < row.length - 1) arrow(doc, bx + boxW + 3, cy + h / 2, bx + boxW + gap - 3, t.p.accent);
        idx++;
      });
      cy += h + 18;
    });
  }, 'steps_diagram');
}

function iconGrid(doc: Doc, v: VisualSpec, labels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const cols = labels.length <= 4 ? labels.length : labels.length % 4 === 0 ? 4 : 3;
  const cellW = inner / cols;
  const rows: string[][] = [];
  for (let k = 0; k < labels.length; k += cols) rows.push(labels.slice(k, k + cols));
  const rowHeights = rows.map((r) => 44 + Math.max(...r.map((l) => measure(doc, l, t.body, 9.5, cellW - 14))) + 10);
  const contentH = rowHeights.reduce((s, h) => s + h, 0);
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    let cy = y;
    let idx = 0;
    rows.forEach((row, r) => {
      row.forEach((l, k) => {
        const cx = x + k * cellW + cellW / 2;
        const tint = [t.p.primary, t.p.accent, t.p.secondary][idx % 3];
        doc.save();
        doc.circle(cx, cy + 18, 18).fill(mix('#ffffff', tint, 0.2));
        doc.restore();
        drawIcon(doc, iconFor(l, idx), cx, cy + 18, 20, darken(tint, 0.25), 1.9);
        put(doc, l, cx - cellW / 2 + 7, cy + 44, { font: t.body, size: 9.5, color: t.ink, width: cellW - 14, align: 'center' });
        idx++;
      });
      cy += rowHeights[r];
    });
  }, 'icon_grid');
}

// Symbols may stand alone; words need a separator ("À faire : …") so "Faire la sieste…" stays intact.
const DO_PREFIX = /^\s*(?:[+✓✔✅]\s*|(?:à faire|a faire|faire|do|oui|bon réflexe|bon reflexe|à privilégier|a privilegier)\s*[:–—-]\s*)/iu;
const DONT_PREFIX = /^\s*(?:[-✗✘❌×]\s*|(?:à éviter|a eviter|éviter|eviter|don'?t|non|mauvais réflexe|mauvais reflexe|erreur)\s*[:–—-]\s*)/iu;

/** Splits do/don't labels: explicit prefixes ("À faire :", "+", "✓" / "À éviter :", "-", "✗", "Ne pas…"), else halves (first half = à éviter). */
export function splitDoDont(labels: string[], values: number[] = []): { dos: string[]; donts: string[] } {
  const dos: string[] = [];
  const donts: string[] = [];
  const loose: string[] = [];
  labels.forEach((raw, k) => {
    const l = String(raw ?? '');
    if (DONT_PREFIX.test(l)) donts.push(l.replace(DONT_PREFIX, ''));
    else if (DO_PREFIX.test(l)) dos.push(l.replace(DO_PREFIX, ''));
    else if (/^\s*(ne pas|ne jamais|jamais|surtout pas)\b/i.test(l)) donts.push(l);
    else if (values.length === labels.length && (values[k] === 0 || values[k] === 1)) (values[k] === 1 ? dos : donts).push(l);
    else loose.push(l);
  });
  if (loose.length) {
    if (dos.length === 0 && donts.length === 0) {
      // unprefixed lists follow the minds' order: « à éviter » first, then « à faire »
      const half = Math.ceil(loose.length / 2);
      donts.push(...loose.slice(0, half));
      dos.push(...loose.slice(half));
    } else (dos.length <= donts.length ? dos : donts).push(...loose);
  }
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return { dos: clean(dos), donts: clean(donts) };
}

function doDont(doc: Doc, v: VisualSpec, rawLabels: string[], width: number, t: PdfTheme): VisualLayout {
  const inner = width - PAD * 2;
  const split = splitDoDont(rawLabels, v.values);
  const dos = split.dos.map((l) => sanitizePdfText(l)).filter(Boolean);
  const donts = split.donts.map((l) => sanitizePdfText(l)).filter(Boolean);
  const colW = (inner - 14) / 2;
  const textW = colW - 40;
  const good = '#2f9e6e';
  const bad = '#d9534f';
  const hDo = dos.map((l) => Math.max(14, measure(doc, l, t.body, 9.8, textW)));
  const hDont = donts.map((l) => Math.max(14, measure(doc, l, t.body, 9.8, textW)));
  const colH = (hs: number[]) => hs.reduce((s, h) => s + h + 9, 0);
  const contentH = 34 + Math.max(colH(hDo), colH(hDont), 14) + 10;
  return frame(doc, t, v.title, width, contentH, (x, y) => {
    const cols: [string, string[], number[], string, boolean][] = [
      ['À faire', dos, hDo, good, true],
      ['À éviter', donts, hDont, bad, false],
    ];
    cols.forEach(([label, items, hs, color, isDo], c) => {
      const cx = x + c * (colW + 14);
      doc.save();
      doc.roundedRect(cx, y, colW, contentH, 8).fill(mix('#ffffff', color, 0.07));
      doc.roundedRect(cx, y, colW, 26, 8).fill(mix('#ffffff', color, 0.18));
      doc.restore();
      if (isDo) drawCheckMark(doc, cx + 16, y + 13, 8, color); else drawCross(doc, cx + 16, y + 13, 8, color);
      put(doc, label.toUpperCase(), cx + 30, y + 8.5, { font: 'Helvetica-Bold', size: 9.5, color: darken(color, 0.25), width: colW - 40, spacing: 1 });
      let cy = y + 36;
      items.forEach((it, k) => {
        if (isDo) drawCheckMark(doc, cx + 16, cy + 6, 5.5, color); else drawCross(doc, cx + 16, cy + 6, 5.5, color);
        put(doc, it, cx + 28, cy, { font: t.body, size: 9.8, color: t.ink, width: textW + 6 });
        cy += hs[k] + 9;
      });
    });
  }, 'do_dont');
}

// ───────────────────────────── fillable grid ─────────────────────────────

const GRID_PAD_X = 6;
const GRID_PAD_Y = 5;
const GRID_TEXT = 9;
const GRID_HEAD = 8.8;
const GRID_LINE_GAP = 1.5;
/** A line one can really write on with a pen (≈ 8,5 mm); a printed line with a box to tick needs less. */
export const GRID_WRITE_ROW = 24;
const GRID_READ_ROW = 22;
const GRID_BOX = 13;

const TICK_COLUMN = /^(?:fait|fait \?|ok|coché|cochée|à cocher)$/iu;

interface GridRow { label: string; cells: (string | null)[]; h: number; writable: boolean; opensGroup: boolean }

export interface GridModel {
  rows: GridRow[];
  /** Height of rows [from, to[ with the header, and the title on the first part. */
  heightOf(from: number, to: number, withTitle: boolean, extra?: number): number;
  /** Last row (exclusive) that fits under the header in `room` points, one row at least. */
  fit(from: number, room: number, withTitle: boolean): number;
  /** Draws rows [from, to[, each writable row taller by `extra`, and returns the bottom y. */
  draw(x: number, y: number, from: number, to: number, withTitle: boolean, extra: number): number;
}

/** Share of the width per column: names and tick boxes take what they need, text columns twice the blank ones. */
export function gridWidths(doc: Doc, columns: string[], labels: string[], boxes: boolean[], filled: boolean[], width: number, t: PdfTheme): number[] {
  const pad = GRID_PAD_X * 2 + 2;
  doc.font(t.bold).fontSize(GRID_HEAD);
  const longestWord = (s: string): number => Math.max(0, ...s.split(/[\s ]+/).map((w) => doc.widthOfString(w)));
  const min = columns.map((c, i) => Math.max(i === 0 ? 46 : 38, longestWord(c) + pad));
  const widest = Math.max(0, ...labels.map((l) => doc.widthOfString(l)));
  const fixed = columns.map((_, i) => {
    if (boxes[i]) return Math.max(min[i]!, GRID_BOX + pad);
    if (i === 0 && widest > 0) return Math.max(min[0]!, Math.min(widest + pad, width * 0.3));
    return null;
  });
  const out = fixed.slice();
  // a column below its header's longest word takes the room from the others
  for (let pass = 0; pass < columns.length; pass++) {
    const free = width - out.reduce<number>((s, w) => s + (w ?? 0), 0);
    const weight = (i: number) => (filled[i] ? 2.5 : 1);
    const total = columns.reduce((s, _, i) => s + (out[i] === null ? weight(i) : 0), 0);
    if (total === 0) break;
    const short = columns.findIndex((_, i) => out[i] === null && (free * weight(i)) / total < min[i]!);
    if (short < 0) return columns.map((_, i) => out[i] ?? (free * weight(i)) / total);
    out[short] = min[short]!;
  }
  // every column has its size: the first takes what is left, or all of them shrink when the mins overflow
  const sum = out.reduce<number>((s, w) => s + (w ?? 0), 0);
  return out.map((w, i) => (sum < width ? (w ?? 0) + (i === 0 ? width - sum : 0) : ((w ?? 0) * width) / sum));
}

/** Printable table of a VisualSpec of type `grid`: empty cells to fill by hand, unticked boxes, readable headers. */
export function gridModel(doc: Doc, v: VisualSpec, width: number, t: PdfTheme): GridModel | null {
  const g = v.grid;
  const columns = (g?.columns ?? []).map((c) => sanitizePdfText(c));
  const rawRows = g?.rows ?? [];
  if (columns.length < 2 || rawRows.length === 0) return null;
  const labels = rawRows.map((l) => sanitizePdfText(l));
  const cellsOf = (r: number): (string | null)[] => columns.slice(1).map((_, c) => {
    const s = sanitizePdfText(g?.cells?.[r]?.[c] ?? '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
  });
  const grid = rawRows.map((_, r) => cellsOf(r));
  const filled = columns.map((_, i) => i > 0 && grid.some((row) => row[i - 1] !== null));
  const boxes = columns.map((c, i) => i > 0 && TICK_COLUMN.test(c) && !filled[i]);
  const widths = gridWidths(doc, columns, labels, boxes, filled, width, t);
  const textW = (i: number) => widths[i]! - GRID_PAD_X * 2;

  const heads = columns.map((c, i) => measure(doc, c, t.bold, GRID_HEAD, textW(i), GRID_LINE_GAP));
  const headH = Math.max(...heads) + GRID_PAD_Y * 2;
  const grouped = labels.some((l) => !l);
  const rows: GridRow[] = grid.map((cells, r) => {
    const texts = [measure(doc, labels[r]!, t.bold, GRID_TEXT, textW(0), GRID_LINE_GAP), ...cells.map((c, i) => (c ? measure(doc, c, t.body, GRID_TEXT, textW(i + 1), GRID_LINE_GAP) : 0))];
    const writable = cells.some((c, i) => c === null && !boxes[i + 1]) || !labels[r];
    return {
      label: labels[r]!, cells, writable,
      h: Math.max(writable ? GRID_WRITE_ROW : GRID_READ_ROW, Math.max(...texts) + GRID_PAD_Y * 2),
      opensGroup: grouped && r > 0 && !!labels[r],
    };
  });

  const title = sanitizePdfText(v.title ?? '');
  const note = rows.some((r) => r.writable) ? 'À imprimer et à remplir à la main.' : boxes.some(Boolean) ? 'Cochez chaque ligne une fois faite.' : '';
  const titleW = width - 26;
  const titleTextH = title ? measure(doc, title, t.bold, 11.5, titleW) : 0;
  const noteH = note ? 12 : 0;
  const titleH = title || note ? Math.max(18, titleTextH) + noteH + 10 : 0;

  const lineColor = mix(t.p.primary, '#ffffff', 0.55);
  const strongLine = mix(t.p.primary, '#ffffff', 0.2);
  const headBg = mix('#ffffff', t.p.primary, 0.16);
  const headInk = ensureContrast(t.primaryInk, headBg, 4.5);
  const labelBg = mix('#ffffff', t.p.primary, 0.06);

  const rowH = (r: GridRow, extra: number): number => r.h + (r.writable ? extra : 0);
  const heightOf = (from: number, to: number, withTitle: boolean, extra = 0): number =>
    (withTitle ? titleH : 0) + headH + rows.slice(from, to).reduce((s, r) => s + rowH(r, extra), 0);

  return {
    rows,
    heightOf,
    fit(from, room, withTitle) {
      let to = from + 1;
      while (to < rows.length && heightOf(from, to + 1, withTitle) <= room) to += 1;
      return to;
    },
    draw(x, y, from, to, withTitle, extra) {
      let cy = y;
      if (withTitle && titleH > 0) {
        if (title) {
          doc.save();
          doc.circle(x + 9, cy + 9, 9).fill(t.p.primary);
          doc.restore();
          drawIcon(doc, 'calendar', x + 9, cy + 9, 11, readableOn(t.p.primary, t.ink), 2);
          put(doc, title, x + 26, cy + 2, { font: t.bold, size: 11.5, color: t.primaryInk, width: titleW });
        }
        if (note) put(doc, note, x + 26, cy + Math.max(18, titleTextH) + 1, { font: t.italic, size: 8.4, color: t.muted, width: titleW });
        cy += titleH;
      }
      const xs = widths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1]! + w], [x]);
      const part = rows.slice(from, to);
      const totalH = headH + part.reduce((s, r) => s + rowH(r, extra), 0);
      // header
      doc.save();
      doc.rect(x, cy, width, headH).fill(headBg);
      doc.restore();
      columns.forEach((c, i) => {
        const align = boxes[i] ? 'center' : 'left';
        put(doc, c, xs[i]! + GRID_PAD_X, cy + (headH - heads[i]!) / 2, { font: t.bold, size: GRID_HEAD, color: headInk, width: textW(i), align, lineGap: GRID_LINE_GAP });
      });
      const top = cy;
      cy += headH;
      // rows
      for (const r of part) {
        const h = rowH(r, extra);
        if (r.label) {
          doc.save();
          doc.rect(x, cy, widths[0]!, h).fill(labelBg);
          doc.restore();
          put(doc, r.label, x + GRID_PAD_X, cy + GRID_PAD_Y, { font: t.bold, size: GRID_TEXT, color: t.ink, width: textW(0), lineGap: GRID_LINE_GAP });
        }
        r.cells.forEach((cell, c) => {
          const i = c + 1;
          if (boxes[i]) drawCheckbox(doc, xs[i]! + (widths[i]! - GRID_BOX) / 2, cy + (h - GRID_BOX) / 2, GRID_BOX, t.p.primary, false);
          else if (cell) put(doc, cell, xs[i]! + GRID_PAD_X, cy + GRID_PAD_Y, { font: t.body, size: GRID_TEXT, color: t.ink, width: textW(i), lineGap: GRID_LINE_GAP });
        });
        doc.save();
        doc.lineWidth(r.opensGroup ? 1.2 : 0.7).strokeColor(r.opensGroup ? strongLine : lineColor).moveTo(x, cy).lineTo(x + width, cy).stroke();
        doc.restore();
        cy += h;
      }
      // frame and column rules, drawn last so that no fill covers them
      doc.save();
      doc.lineWidth(0.7).strokeColor(lineColor);
      for (const lx of xs.slice(1, -1)) doc.moveTo(lx, top).lineTo(lx, top + totalH).stroke();
      doc.lineWidth(1).strokeColor(strongLine).rect(x, top, width, totalH).stroke();
      doc.moveTo(x, top + headH).lineTo(x + width, top + headH).stroke();
      doc.restore();
      return cy;
    },
  };
}

/** Lays out a VisualSpec as an infographic card; null when there is nothing to draw. */
export function layoutVisual(doc: Doc, v: VisualSpec | null | undefined, width: number, t: PdfTheme): VisualLayout | null {
  if (!v) return null;
  if (v.type === 'grid') {
    const m = gridModel(doc, v, width, t);
    return m && { height: m.heightOf(0, m.rows.length, true), draw: (x, y) => { m.draw(x, y, 0, m.rows.length, true, 0); } };
  }
  const raw = (Array.isArray(v.labels) ? v.labels : []).map((l) => String(l ?? '')).filter((l) => sanitizePdfText(l).length > 0).slice(0, 12);
  const labels = raw.map((l) => sanitizePdfText(l));
  if (labels.length === 0) return null;
  const spec: VisualSpec = { ...v, title: sanitizePdfText(v.title ?? ''), values: Array.isArray(v.values) ? v.values : [] };
  switch (v.type) {
    case 'timeline': return timeline(doc, spec, labels.slice(0, 8), width, t);
    case 'bar_chart': return barChart(doc, spec, labels.slice(0, 8), width, t);
    case 'checklist_card': return checklistCard(doc, spec, labels, width, t);
    case 'quote': return quote(doc, spec, labels, width, t);
    case 'steps_diagram': return stepsDiagram(doc, spec, labels.slice(0, 8), width, t);
    case 'icon_grid': return iconGrid(doc, spec, labels.slice(0, 9), width, t);
    case 'do_dont': return doDont(doc, spec, raw, width, t);
    default: return checklistCard(doc, spec, labels, width, t);
  }
}
