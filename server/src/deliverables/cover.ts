/**
 * Store / PDF cover: a self-contained 600×848 SVG (A4 ratio) with a vector illustration,
 * big auto-fitted title, subtitle, audience pill and brand footer. Four layouts that really differ.
 */
import type { DesignSpec } from '../shared.js';
import { darken, isDark, lighten, mix, readableOn, ensureContrast, type Palette } from './color.js';
import { cssFontStack, normalizeDesign } from './design.js';
import { placeMotif, sparklePath } from './motifs.js';
import { decoRng, escapeXml, fitText, hashString, n, stripEmoji, textWidth, wrapText, type StdFont } from './text.js';

export const COVER_W = 600;
export const COVER_H = 848;

const SANS = cssFontStack('Helvetica');

interface CoverCtx {
  title: string; subtitle: string; audience: string; brand: string;
  d: DesignSpec; p: Palette; uid: string;
  titleFont: StdFont; titleStack: string; titleScale: number;
}

interface TextBlock { lines: string[]; size: number; lineHeight: number; height: number }

/** Beyond this length a cover title is cut (at a word boundary); below it the FULL title is always shown. */
export const COVER_TITLE_MAX_CHARS = 140;

/** Word-boundary cut with an ellipsis, only for titles longer than COVER_TITLE_MAX_CHARS. */
const CUT_DANGLING = /\s+(?:de|d['’]|du|des|la|le|les|l['’]|en|à|au|aux|pour|par|sur|et|ou|un|une|avec|sans|dans)$/i;

function capTitle(title: string): string {
  if (title.length <= COVER_TITLE_MAX_CHARS) return title;
  const cut = title.slice(0, COVER_TITLE_MAX_CHARS - 1);
  const sp = cut.lastIndexOf(' ');
  let head = (sp > 80 ? cut.slice(0, sp) : cut).replace(/[\s,;:.…–—-]+$/, '');
  // never end on « … vivant en » nor double an ellipsis already present in the title
  for (let k = 0; k < 4 && CUT_DANGLING.test(head); k++) head = head.replace(CUT_DANGLING, '').replace(/[\s,;:.…–—-]+$/, '');
  return `${head}…`;
}

/**
 * The cover shows the WHOLE title: the biggest size that fits in 4 lines; a long title gets a smaller
 * size and up to 6 lines instead of an ellipsis. Only titles beyond ~140 characters are cut.
 */
export function titleBlock(c: Pick<CoverCtx, 'title' | 'titleFont' | 'titleScale'>, maxWidth: number, max: number, min = 28): TextBlock {
  const text = capTitle(c.title || 'Guide pratique');
  const fitsIn4 = wrapText(text, maxWidth, c.titleFont, min, c.titleScale).length <= 4;
  const fit = fitsIn4
    ? fitText(text, { maxWidth, maxLines: 4, font: c.titleFont, max, min, scale: c.titleScale })
    : fitText(text, { maxWidth, maxLines: 6, font: c.titleFont, max: min - 1, min: Math.max(16, Math.round(min * 0.62)), scale: c.titleScale });
  const lineHeight = Math.round(fit.size * (fit.lines.length > 4 ? 1.08 : 1.1));
  return { lines: fit.lines, size: fit.size, lineHeight, height: lineHeight * fit.lines.length };
}

function bodyBlock(text: string, maxWidth: number, size: number, maxLines: number, bold = false): TextBlock {
  const font: StdFont = bold ? 'Helvetica-Bold' : 'Helvetica';
  const fit = fitText(text, { maxWidth, maxLines, font, max: size, min: Math.max(11, size - 4), scale: 1.05 });
  const lineHeight = Math.round(fit.size * 1.32);
  return { lines: text ? fit.lines : [], size: fit.size, lineHeight, height: text ? lineHeight * fit.lines.length : 0 };
}

function textLines(
  b: TextBlock, x: number, top: number,
  o: { fill: string; family: string; weight?: string; anchor?: 'start' | 'middle' | 'end'; spacing?: number; italic?: boolean },
): string {
  const anchor = o.anchor ?? 'start';
  return b.lines.map((line, k) => {
    // baseline ≈ top of the line box + 0.8 × font size
    const y = top + k * b.lineHeight + b.size * 0.82 + (b.lineHeight - b.size) / 2;
    return `<text x="${n(x)}" y="${n(y)}" font-family="${o.family}" font-size="${b.size}" font-weight="${o.weight ?? 'normal'}"${o.italic ? ' font-style="italic"' : ''} fill="${o.fill}" text-anchor="${anchor}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}>${escapeXml(line)}</text>`;
  }).join('');
}

/** Rounded pill with 1-2 lines of text, anchored on its centre (cx) or left edge. */
function pill(
  text: string, x: number, y: number,
  o: { fill: string; color: string; maxWidth: number; size?: number; anchor?: 'middle' | 'start'; stroke?: string; bold?: boolean; maxLines?: number },
): { svg: string; height: number; width: number } {
  if (!text) return { svg: '', height: 0, width: 0 };
  const size = o.size ?? 16;
  const font: StdFont = o.bold === false ? 'Helvetica' : 'Helvetica-Bold';
  const padX = size * 1.1;
  const maxLines = o.maxLines ?? 2;
  const all = wrapText(text, o.maxWidth - padX * 2, font, size, 1.06);
  const lines = all.slice(0, maxLines);
  if (all.length > maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s,;.]+$/, '')}…`;
  const lh = Math.round(size * 1.3);
  const textW = Math.max(...lines.map((l) => textWidth(l, font, size) * 1.06));
  const w = Math.min(o.maxWidth, textW + padX * 2);
  const h = lh * lines.length + size * 0.9;
  const left = o.anchor === 'start' ? x : x - w / 2;
  const tx = o.anchor === 'start' ? left + padX : x;
  const anchor = o.anchor === 'start' ? 'start' : 'middle';
  let svg = `<rect x="${n(left)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(h / 2, 22))}" fill="${o.fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="1.5"` : ''}/>`;
  lines.forEach((l, k) => {
    const by = y + size * 0.45 + k * lh + size * 0.86 + (lh - size) / 2;
    svg += `<text x="${n(tx)}" y="${n(by)}" font-family="${SANS}" font-size="${size}" font-weight="${o.bold === false ? 'normal' : 'bold'}" fill="${o.color}" text-anchor="${anchor}">${escapeXml(l)}</text>`;
  });
  return { svg, height: h, width: w };
}

function guideLabel(x: number, y: number, color: string, bg: string | null, anchor: 'middle' | 'start' = 'middle'): string {
  const label = 'GUIDE PDF';
  const size = 13;
  const w = textWidth(label, 'Helvetica-Bold', size) * 1.05 + label.length * 2.4 + 28;
  const left = anchor === 'middle' ? x - w / 2 : x;
  const tx = anchor === 'middle' ? x : x + 14;
  const box = bg
    ? `<rect x="${n(left)}" y="${n(y)}" width="${n(w)}" height="28" rx="14" fill="${bg}"/>`
    : `<rect x="${n(left)}" y="${n(y)}" width="${n(w)}" height="28" rx="14" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.85"/>`;
  return `${box}<text x="${n(tx)}" y="${n(y + 18.5)}" font-family="${SANS}" font-size="${size}" font-weight="bold" letter-spacing="2.4" fill="${color}" text-anchor="${anchor}">${label}</text>`;
}

function brandFooter(c: CoverCtx, y: number, color: string, anchor: 'middle' | 'start' = 'middle', x = COVER_W / 2): string {
  const brand = (c.brand || 'Pixel Agency').toUpperCase();
  const size = 14;
  const tw = textWidth(brand, 'Helvetica-Bold', size) * 1.05 + brand.length * 2;
  const markW = 20;
  const total = markW + 10 + tw;
  const left = anchor === 'middle' ? x - total / 2 : x;
  // pixel logo: 2×2 squares (Pixel Agency)
  const s = 8;
  const mark = `<rect x="${n(left)}" y="${n(y - 15)}" width="${s}" height="${s}" rx="1.5" fill="${c.p.accent}"/>`
    + `<rect x="${n(left + s + 3)}" y="${n(y - 15)}" width="${s}" height="${s}" rx="1.5" fill="${color}" opacity="0.85"/>`
    + `<rect x="${n(left)}" y="${n(y - 15 + s + 3)}" width="${s}" height="${s}" rx="1.5" fill="${color}" opacity="0.85"/>`
    + `<rect x="${n(left + s + 3)}" y="${n(y - 15 + s + 3)}" width="${s}" height="${s}" rx="1.5" fill="${c.p.accent}" opacity="0.6"/>`;
  return `${mark}<text x="${n(left + markW + 10)}" y="${n(y)}" font-family="${SANS}" font-size="${size}" font-weight="bold" letter-spacing="2" fill="${color}">${escapeXml(brand)}</text>`;
}

function dotsGrid(x: number, y: number, cols: number, rows: number, gap: number, color: string, opacity: number): string {
  let out = '';
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) out += `<circle cx="${n(x + k * gap)}" cy="${n(y + r * gap)}" r="2.2"/>`;
  return `<g fill="${color}" opacity="${opacity}">${out}</g>`;
}

function sparkles(seed: number, count: number, color: string, box: { x: number; y: number; w: number; h: number }, opacity = 0.7): string {
  const rnd = decoRng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = box.x + rnd() * box.w;
    const y = box.y + rnd() * box.h;
    const r = 3 + rnd() * 6;
    out += i % 2 ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 0.3)}"/>` : `<path d="${sparklePath(x, y, r)}"/>`;
  }
  return `<g fill="${color}" opacity="${opacity}">${out}</g>`;
}

// ───────────────────────────── layouts ─────────────────────────────

function centered(c: CoverCtx): string {
  const { p, uid } = c;
  const dark = isDark(p.bg);
  const bottom = dark ? mix(p.bg, p.primary, 0.65) : mix(p.bg, p.secondary, 0.35);
  const mid = mix(p.bg, bottom, 0.5);
  const fg = readableOn(mid, p.ink);
  const muted = fg === '#ffffff' ? lighten(p.secondary, 0.55) : mix(p.ink, p.bg, 0.25);

  const title = titleBlock(c, 512, 60);
  const sub = bodyBlock(c.subtitle, 470, 20, 3);
  const pillProbe = pill(c.audience ? `Pour : ${c.audience}` : '', 0, 0, { fill: '', color: '', maxWidth: 470, size: 15 });
  const textH = title.height + 26 + sub.height + (sub.height ? 26 : 0) + pillProbe.height;
  const artTop = 104;
  const textBottom = 772;
  const artSize = Math.max(170, Math.min(330, textBottom - textH - artTop - 40));
  const textTop = artTop + artSize + 26;

  let y = textTop;
  let s = `<defs><linearGradient id="${uid}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`
    + `<radialGradient id="${uid}glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${lighten(p.accent, 0.5)}" stop-opacity="0.55"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="${COVER_W}" height="${COVER_H}" fill="url(#${uid}bg)"/>`
    + `<circle cx="560" cy="60" r="150" fill="${p.secondary}" opacity="0.14"/><circle cx="30" cy="560" r="120" fill="${p.accent}" opacity="0.10"/>`
    + dotsGrid(470, 120, 5, 4, 16, fg, 0.18) + dotsGrid(40, 300, 3, 5, 16, fg, 0.12)
    + sparkles(c.d.seed + 7, 10, fg, { x: 20, y: 70, w: 560, h: 300 }, 0.35)
    + `<circle cx="300" cy="${n(artTop + artSize / 2)}" r="${n(artSize * 0.62)}" fill="url(#${uid}glow)"/>`
    + guideLabel(300, 40, fg, null)
    + placeMotif(c.d.motif, p, `${uid}m`, 300 - artSize / 2, artTop, artSize, c.d.seed % 7);
  s += textLines(title, 300, y, { fill: fg, family: c.titleStack, weight: 'bold', anchor: 'middle' });
  y += title.height + 12;
  s += `<rect x="270" y="${n(y)}" width="60" height="6" rx="3" fill="${p.accent}"/>`;
  y += 22;
  if (sub.height) { s += textLines(sub, 300, y, { fill: muted, family: SANS, anchor: 'middle' }); y += sub.height + 22; }
  const aud = pill(c.audience ? `Pour : ${c.audience}` : '', 300, Math.min(y, 760 - pillProbe.height), { fill: p.accent, color: readableOn(p.accent, p.ink), maxWidth: 470, size: 15 });
  s += aud.svg;
  s += `<path d="M0 ${COVER_H - 70} Q150 ${COVER_H - 96} 300 ${COVER_H - 74} T600 ${COVER_H - 80} V${COVER_H} H0Z" fill="${darken(bottom, 0.12)}" opacity="0.55"/>`;
  s += brandFooter(c, COVER_H - 30, fg);
  return s;
}

function split(c: CoverCtx): string {
  const { p, uid } = c;
  const topA = darken(p.primary, 0.12);
  const topB = mix(p.primary, p.secondary, 0.35);
  const topFg = readableOn(mix(topA, topB, 0.5), p.ink);
  const bottomBg = isDark(p.bg) ? p.soft : p.bg;
  const bottomFg = ensureContrast(p.ink, bottomBg, 7);

  const title = titleBlock(c, 504, 62);
  const sub = bodyBlock(c.subtitle, 470, 20, 3);
  const titleTop = 128;
  const divider = Math.max(430, Math.min(560, titleTop + title.height + 24 + sub.height + 56));
  const artSize = Math.max(220, Math.min(285, COVER_H - divider - 30));
  const artX = COVER_W - artSize - 22;
  const artY = divider - artSize * 0.22;
  const colW = artX - 48 - 12;

  let s = `<defs><linearGradient id="${uid}top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${topA}"/><stop offset="1" stop-color="${topB}"/></linearGradient></defs>`
    + `<rect width="${COVER_W}" height="${COVER_H}" fill="${bottomBg}"/>`
    + `<path d="M0 0 H${COVER_W} V${divider} Q${COVER_W * 0.72} ${divider + 46} ${COVER_W * 0.42} ${divider + 6} T0 ${divider + 24}Z" fill="url(#${uid}top)"/>`
    + `<circle cx="${COVER_W - 40}" cy="70" r="120" fill="${p.accent}" opacity="0.16"/><circle cx="${COVER_W - 90}" cy="40" r="46" fill="${p.secondary}" opacity="0.25"/>`
    + dotsGrid(COVER_W - 150, COVER_H - 66, 6, 3, 16, p.primary, 0.16)
    + sparkles(c.d.seed + 3, 8, topFg, { x: 330, y: 20, w: 250, h: 120 }, 0.45)
    + guideLabel(48, 52, readableOn(p.accent, p.ink), p.accent, 'start')
    + `<rect x="48" y="${n(titleTop - 18)}" width="44" height="5" rx="2.5" fill="${p.accent}"/>`;
  s += textLines(title, 48, titleTop, { fill: topFg, family: c.titleStack, weight: 'bold' });
  let y = titleTop + title.height + 20;
  if (sub.height) s += textLines(sub, 48, y, { fill: topFg === '#ffffff' ? lighten(p.secondary, 0.6) : mix(p.ink, topA, 0.2), family: SANS });
  s += `<circle cx="${n(artX + artSize / 2)}" cy="${n(artY + artSize / 2)}" r="${n(artSize * 0.5)}" fill="${p.secondary}" opacity="0.22"/>`;
  s += placeMotif(c.d.motif, p, `${uid}m`, artX, artY, artSize, c.d.seed % 7);
  y = divider + 56;
  const aud = pill(c.audience ? `Pour : ${c.audience}` : '', 48, y, { fill: p.primary, color: readableOn(p.primary, p.ink), maxWidth: colW, size: 14, anchor: 'start', maxLines: 3 });
  s += aud.svg;
  y += aud.height + (aud.height ? 30 : 0);
  const features = ['Méthode pas à pas', 'Checklists prêtes à cocher', 'Exemples concrets'];
  for (const f of features) {
    if (y > COVER_H - 80) break;
    const line = fitText(f, { maxWidth: colW - 22, maxLines: 1, font: 'Helvetica-Bold', max: 15, min: 11, scale: 1.05 });
    s += `<circle cx="56" cy="${n(y - 5)}" r="8" fill="${p.accent}"/><path d="M52 ${n(y - 5)} l3 3 l5 -6" fill="none" stroke="${readableOn(p.accent, p.ink)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<text x="72" y="${n(y)}" font-family="${SANS}" font-size="${line.size}" font-weight="bold" fill="${mix(bottomFg, bottomBg, 0.15)}">${escapeXml(line.lines[0] ?? f)}</text>`;
    y += 28;
  }
  s += brandFooter(c, COVER_H - 34, bottomFg, 'start', 48);
  return s;
}

function badge(c: CoverCtx): string {
  const { p, uid } = c;
  const dark = isDark(p.bg);
  const bg2 = dark ? mix(p.bg, p.primary, 0.5) : mix(p.bg, p.soft, 0.6);
  const fg = readableOn(p.bg, p.ink);
  const cardBg = dark ? lighten(p.bg, 0.94) : '#ffffff';
  const cardFg = ensureContrast(p.ink, cardBg, 8);

  const title = titleBlock(c, 468, 52, 26);
  const sub = bodyBlock(c.subtitle, 452, 17, 3);
  const cardH = 44 + title.height + (sub.height ? 18 + sub.height : 0) + 40;
  const cardTop = Math.min(500, COVER_H - 128 - cardH);
  const ringR = Math.max(110, Math.min(160, (cardTop - 104) / 2));
  const ringCy = 84 + ringR;

  // rosette seal
  let seal = '';
  const cx = 492;
  const cy = 96;
  const pts: string[] = [];
  for (let k = 0; k < 32; k++) {
    const r = k % 2 ? 50 : 58;
    const a = (Math.PI * 2 * k) / 32;
    pts.push(`${n(cx + r * Math.cos(a))},${n(cy + r * Math.sin(a))}`);
  }
  const sealFg = readableOn(p.accent, p.ink);
  seal = `<polygon points="${pts.join(' ')}" fill="${p.accent}"/><circle cx="${cx}" cy="${cy}" r="42" fill="none" stroke="${sealFg}" stroke-width="1.5" stroke-dasharray="2 4" opacity="0.6"/>`
    + `<text x="${cx}" y="${cy - 6}" font-family="${SANS}" font-size="12" font-weight="bold" letter-spacing="1.5" fill="${sealFg}" text-anchor="middle">MÉTHODE</text>`
    + `<text x="${cx}" y="${cy + 12}" font-family="${SANS}" font-size="12" font-weight="bold" letter-spacing="1.5" fill="${sealFg}" text-anchor="middle">PAS À PAS</text>`;

  let s = `<defs><radialGradient id="${uid}bg" cx="0.5" cy="0.3" r="0.8"><stop offset="0" stop-color="${bg2}"/><stop offset="1" stop-color="${p.bg}"/></radialGradient></defs>`
    + `<rect width="${COVER_W}" height="${COVER_H}" fill="url(#${uid}bg)"/>`
    + `<rect x="22" y="22" width="${COVER_W - 44}" height="${COVER_H - 44}" rx="18" fill="none" stroke="${fg}" stroke-width="1.5" opacity="0.25"/>`
    + sparkles(c.d.seed + 11, 14, fg, { x: 40, y: 40, w: 520, h: cardTop - 60 }, 0.3)
    + `<circle cx="300" cy="${n(ringCy)}" r="${n(ringR + 16)}" fill="none" stroke="${p.accent}" stroke-width="2" stroke-dasharray="1 9" stroke-linecap="round"/>`
    + `<circle cx="300" cy="${n(ringCy)}" r="${n(ringR)}" fill="${dark ? lighten(p.primary, 0.08) : p.soft}"/>`
    + `<circle cx="300" cy="${n(ringCy)}" r="${n(ringR)}" fill="none" stroke="${p.primary}" stroke-width="5" opacity="0.9"/>`
    + placeMotif(c.d.motif, p, `${uid}m`, 300 - ringR * 0.78, ringCy - ringR * 0.78, ringR * 1.56, c.d.seed % 7)
    + seal
    + guideLabel(300, 36, fg, null);
  // title card
  s += `<rect x="58" y="${n(cardTop + 8)}" width="484" height="${n(cardH)}" rx="20" fill="${darken(p.bg, 0.35)}" opacity="0.25"/>`
    + `<rect x="58" y="${n(cardTop)}" width="484" height="${n(cardH)}" rx="20" fill="${cardBg}"/>`
    + `<rect x="58" y="${n(cardTop)}" width="484" height="8" rx="4" fill="${p.accent}"/>`;
  let y = cardTop + 30;
  s += textLines(title, 300, y, { fill: cardFg, family: c.titleStack, weight: 'bold', anchor: 'middle' });
  y += title.height + 18;
  if (sub.height) s += textLines(sub, 300, y, { fill: mix(cardFg, cardBg, 0.3), family: SANS, anchor: 'middle' });
  // audience ribbon
  const ribbonY = cardTop + cardH - 18;
  const aud = pill(c.audience ? `Pour : ${c.audience}` : '', 300, ribbonY, { fill: p.primary, color: readableOn(p.primary, p.ink), maxWidth: 440, size: 14 });
  s += aud.svg;
  s += brandFooter(c, COVER_H - 46, fg);
  return s;
}

function minimal(c: CoverCtx): string {
  const { p, uid } = c;
  const bg = isDark(p.bg) ? p.soft : mix(p.bg, '#ffffff', 0.35);
  const ink = ensureContrast(p.ink, bg, 9);
  const muted = mix(ink, bg, 0.35);
  const accentInk = ensureContrast(p.primary, bg, 3.2);

  const title = titleBlock(c, 488, 66, 30);
  const sub = bodyBlock(c.subtitle, 440, 19, 3);
  const top = 150;
  const artSize = 250;
  const artY = Math.max(top + title.height + sub.height + 110, COVER_H - artSize - 120);

  let s = `<rect width="${COVER_W}" height="${COVER_H}" fill="${bg}"/>`
    + `<rect x="0" y="0" width="14" height="${COVER_H}" fill="${p.primary}"/>`
    + `<rect x="36" y="36" width="${COVER_W - 72}" height="${COVER_H - 72}" fill="none" stroke="${ink}" stroke-width="1" opacity="0.18"/>`
    + `<text x="56" y="84" font-family="${SANS}" font-size="13" font-weight="bold" letter-spacing="3" fill="${accentInk}">GUIDE PDF</text>`
    + `<rect x="56" y="96" width="34" height="2" fill="${accentInk}"/>`
    + `<text x="${COVER_W - 56}" y="84" font-family="${SANS}" font-size="13" letter-spacing="1.5" fill="${muted}" text-anchor="end">${escapeXml(c.brand || 'Pixel Agency')}</text>`;
  s += textLines(title, 56, top, { fill: ink, family: c.titleStack, weight: 'bold' });
  let y = top + title.height + 18;
  s += `<rect x="56" y="${n(y)}" width="88" height="7" fill="${p.accent}"/>`;
  y += 30;
  if (sub.height) s += textLines(sub, 56, y, { fill: muted, family: SANS });
  s += `<circle cx="${n(COVER_W - 56 - artSize / 2 + 20)}" cy="${n(artY + artSize / 2)}" r="${n(artSize * 0.48)}" fill="${p.secondary}" opacity="0.28"/>`;
  s += `<circle cx="${n(COVER_W - 56 - artSize / 2 - 70)}" cy="${n(artY + artSize * 0.2)}" r="22" fill="${p.accent}" opacity="0.5"/>`;
  s += placeMotif(c.d.motif, p, `${uid}m`, COVER_W - 56 - artSize + 20, artY, artSize, c.d.seed % 7);
  const audLines = c.audience ? wrapText(`Pour : ${c.audience}`, 230, 'Helvetica-Bold', 14, 1.06).slice(0, 4) : [];
  const audTop = COVER_H - 104 - audLines.length * 19;
  s += audLines.length ? `<rect x="56" y="${n(audTop - 4)}" width="4" height="${n(audLines.length * 19 + 2)}" fill="${p.accent}"/>` : '';
  s += audLines.map((l, k) => `<text x="70" y="${n(audTop + 10 + k * 19)}" font-family="${SANS}" font-size="14" font-weight="bold" fill="${ink}">${escapeXml(l)}</text>`).join('');
  s += brandFooter(c, COVER_H - 60, muted, 'start', 56);
  return s;
}

const LAYOUT_FNS = { centered, split, badge, minimal } as const;

/** 600×848 self-contained SVG cover (no external fonts or images). */
export function renderCoverSvg(input: { title: string; subtitle: string; audience: string; design: DesignSpec; brand: string }): string {
  const d = normalizeDesign(input?.design);
  const title = stripEmoji(input?.title ?? '').replace(/\s+/g, ' ').trim();
  const subtitle = stripEmoji(input?.subtitle ?? '').replace(/\s+/g, ' ').trim();
  const audience = stripEmoji(input?.audience ?? '').replace(/\s+/g, ' ').trim();
  const brand = stripEmoji(input?.brand ?? '').trim() || 'Pixel Agency';
  const uid = `cv${hashString(`${title}|${d.seed}|${d.motif}|${d.coverLayout}`).toString(36).slice(0, 6)}`;
  const titleFont = d.titleFont as StdFont;
  const ctx: CoverCtx = {
    title, subtitle, audience, brand, d, p: d.palette, uid,
    titleFont, titleStack: cssFontStack(d.titleFont), titleScale: titleFont.startsWith('Times') ? 1.24 : titleFont.startsWith('Courier') ? 1.02 : 1.05,
  };
  const body = (LAYOUT_FNS[d.coverLayout] ?? centered)(ctx);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COVER_W} ${COVER_H}" width="${COVER_W}" height="${COVER_H}" role="img" aria-label="${escapeXml(title)}">`
    + `<title>${escapeXml(title)}</title><desc>${escapeXml(subtitle)}</desc>${body}</svg>`;
}
