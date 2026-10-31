/**
 * TikTok storyboard: one 9:16 SVG frame per scene (360×640) + a self-contained HTML preview
 * with a phone mockup that plays the scenes with their durations and voice-over subtitles.
 * The other ratios re-lay the same scenes out on their own frame, plain SVG: no canvas, no ffmpeg, every machine.
 */
import { SAFE_ZONES, type AdCreative, type AdRatio, type AdScene, type DesignSpec, type Product } from '../shared.js';
import { darken, isDark, mix, readableOn, rgba } from './color.js';
import { renderCoverSvg } from './cover.js';
import { cssFontStack, normalizeDesign } from './design.js';
import { placeMotif } from './motifs.js';
import { escapeHtml as h, escapeXml as x, fitText, formatCount, hashString, n, slugify, stripEmoji, textWidth, truncate, wrapText } from './text.js';

const W = 360;
const H = 640;
const SANS = cssFontStack('Helvetica');

/** What stays clear of the platform's own layer, in the frame's pixels. The master has none here: it is drawn inside a fake app. */
interface Zone { x0: number; x1: number; y0: number; y1: number }

interface FrameCtx {
  creative: AdCreative; product: Product; d: DesignSpec; brand: string; handle: string;
  scenes: AdScene[]; counts: { likes: number; comments: number; saves: number; shares: number };
  w: number; h: number; zone: Zone | null;
}

type CutRatio = Exclude<AdRatio, 'text' | '9:16'>;

const CUT_SAFE = { '4:5': SAFE_ZONES.meta_feed, '1:1': SAFE_ZONES.square, '2:3': SAFE_ZONES.pinterest } as const;
const CUT_W: Record<CutRatio, number> = { '4:5': 432, '1:1': 540, '2:3': 400 };
const CUT_PAD = 10;            // inside the zone: a stroke and a font wider than its estimate stay in
const CUT_TOP = 26;            // the scene count sits above the text
const CTA_H = 40;
const COVER_RATIO = 848 / 600;

function cutFrame(ratio: CutRatio): Pick<FrameCtx, 'w' | 'h' | 'zone'> {
  const { w, h, insets } = CUT_SAFE[ratio];
  const k = CUT_W[ratio] / w;
  return { w: CUT_W[ratio], h: Math.round(h * k), zone: { x0: insets.left * k, x1: (w - insets.right) * k, y0: insets.top * k, y1: (h - insets.bottom) * k } };
}

const FORMAT_LABEL: Record<AdCreative['format'], string> = {
  faceless_voiceover: 'Voix off sans visage',
  text_slideshow: 'Diaporama texte',
  ugc_avatar: 'Narrateur animé',
  carousel: 'Carrousel',
  static_image: 'Image fixe',
  search_text: 'Annonce Search',
};

const HOOK_LABEL: Record<AdCreative['hookStyle'], string> = {
  question: 'Question', contrarian: 'À contre-courant', story: 'Histoire', stat: 'Chiffre choc', pov: 'POV',
  mistake: 'Erreur à éviter', before_after: 'Avant / après', listicle: 'Liste',
};

function durationOf(s: AdScene): number {
  const d = Number(s?.durationSec);
  return Number.isFinite(d) && d > 0 ? Math.min(15, Math.max(1, d)) : 3;
}

function background(c: FrameCtx, i: number, uid: string): string {
  const p = c.d.palette;
  const { w, h } = c;
  const kx = w / W;
  const ky = h / H;
  const variants: [string, string][] = [
    [darken(p.bg, isDark(p.bg) ? 0 : 0.35), darken(p.primary, 0.1)],
    [darken(p.primary, 0.15), mix(p.primary, p.secondary, 0.55)],
    [darken(p.secondary, 0.35), darken(p.primary, 0.25)],
    [darken(mix(p.primary, p.accent, 0.35), 0.2), darken(p.primary, 0.35)],
  ];
  const [a, b] = variants[i % variants.length];
  const angle = [0, 1, 2, 3][(i + c.d.seed) % 4];
  const coords = [['0', '0', '0', '1'], ['0', '0', '1', '1'], ['1', '0', '0', '1'], ['0', '1', '1', '0']][angle];
  let s = `<linearGradient id="${uid}bg" x1="${coords[0]}" y1="${coords[1]}" x2="${coords[2]}" y2="${coords[3]}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
    + `<radialGradient id="${uid}vig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>`;
  s = `<defs>${s}</defs><rect width="${w}" height="${h}" fill="url(#${uid}bg)"/>`;
  // decorative blobs that move from scene to scene
  const bx = [300, 60, 280, 90][i % 4] * kx;
  const by = [120, 520, 560, 140][i % 4] * ky;
  s += `<circle cx="${n(bx)}" cy="${n(by)}" r="${n(150 * kx)}" fill="${p.accent}" opacity="0.13"/><circle cx="${n(w - bx)}" cy="${n(h - by)}" r="${n(100 * kx)}" fill="${p.secondary}" opacity="0.12"/>`;
  return s;
}

function art(c: FrameCtx, i: number, uid: string, last: boolean): string {
  const p = c.d.palette;
  const kx = c.w / W;
  const ky = c.h / H;
  if (c.creative.format === 'ugc_avatar') {
    // simple creator bust ("talking head" placeholder) in the lower half
    const skin = ['#f2d0b8', '#e0b393', '#c68e6a', '#8d5b3e'][hashString(c.creative.id) % 4];
    const shirt = mix(p.accent, p.primary, 0.3);
    const y0 = last ? 300 : 360;
    const place = c.zone ? ` transform="translate(${n((c.w - W * ky) / 2)} 0) scale(${ky.toFixed(4)})"` : '';
    return `<g${place} opacity="0.95"><ellipse cx="180" cy="${y0 + 250}" rx="150" ry="150" fill="${shirt}"/>`
      + `<rect x="160" y="${y0 + 70}" width="40" height="44" rx="14" fill="${darken(skin, 0.08)}"/>`
      + `<ellipse cx="180" cy="${y0 + 40}" rx="56" ry="64" fill="${skin}"/>`
      + `<path d="M124 ${y0 + 30} C124 ${y0 - 30} 236 ${y0 - 34} 236 ${y0 + 26} C220 ${y0} 160 ${y0 - 4} 124 ${y0 + 30}Z" fill="${darken(p.ink, 0.2)}"/>`
      + `<circle cx="160" cy="${y0 + 44}" r="5" fill="${darken(p.ink, 0.3)}"/><circle cx="200" cy="${y0 + 44}" r="5" fill="${darken(p.ink, 0.3)}"/>`
      + `<path d="M164 ${y0 + 70} Q180 ${y0 + 82} 196 ${y0 + 70}" fill="none" stroke="${darken(skin, 0.4)}" stroke-width="4" stroke-linecap="round"/></g>`;
  }
  const spots = [
    { x: 90, y: 270, s: 180, o: 0.9 },
    { x: 150, y: 290, s: 190, o: 0.85 },
    { x: -20, y: 250, s: 220, o: 0.5 },
    { x: 170, y: 86, s: 190, o: 0.55 },
  ];
  const spot = last ? { x: 196, y: 84, s: 120, o: 0.95 } : spots[i % spots.length];
  return placeMotif(c.d.motif, p, `${uid}m`, spot.x * kx, spot.y * ky, spot.s * Math.min(kx, ky), i, spot.o);
}

/** The master keeps its place left of the fake rail. A cut has no rail: the text takes its zone. */
function textSlot(c: FrameCtx, i: number, last: boolean): { cx: number; width: number; top: number; anchorY: number } {
  const narrated = c.creative.format === 'ugc_avatar';
  if (!c.zone) return { cx: 168, width: 270, top: 96, anchorY: narrated ? (last ? 170 : 200) : i % 2 === 1 ? 228 : 246 };
  const { x0, x1, y0, y1 } = c.zone;
  const anchor = narrated ? 0.26 : last ? 0.34 : 0.46;
  return { cx: (x0 + x1) / 2, width: x1 - x0 - CUT_PAD * 2, top: y0 + CUT_TOP, anchorY: y0 + (y1 - y0) * anchor };
}

function textBlock(c: FrameCtx, text: string, i: number, last: boolean): string {
  const clean = stripEmoji(text).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const pill = c.creative.format === 'text_slideshow' || (c.creative.format === 'carousel' && i === 0);
  const { cx, width, top: floor, anchorY } = textSlot(c, i, last);
  const fit = fitText(clean, { maxWidth: pill ? width - 20 : width, maxLines: 6, font: 'Helvetica-Bold', max: i === 0 ? 31 : 27, min: 17, scale: 1.06 });
  const lh = Math.round(fit.size * (pill ? 1.42 : 1.2));
  const blockH = lh * fit.lines.length;
  const top = Math.max(floor, anchorY - blockH / 2);
  let s = '';
  fit.lines.forEach((line, k) => {
    const baseline = top + k * lh + lh / 2 + fit.size * 0.36;
    const t = x(line);
    if (pill) {
      const w = textWidth(line, 'Helvetica-Bold', fit.size) * 1.06 + 22;
      s += `<rect x="${n(cx - w / 2)}" y="${n(top + k * lh + 2)}" width="${n(w)}" height="${n(lh - 1)}" rx="8" fill="#ffffff"/>`;
      s += `<text x="${cx}" y="${n(baseline)}" font-family="${SANS}" font-size="${fit.size}" font-weight="bold" fill="#111111" text-anchor="middle">${t}</text>`;
    } else {
      s += `<text x="${cx}" y="${n(baseline)}" font-family="${SANS}" font-size="${fit.size}" font-weight="bold" fill="#111111" stroke="#111111" stroke-width="${n(fit.size * 0.24)}" stroke-linejoin="round" text-anchor="middle">${t}</text>`;
      s += `<text x="${cx}" y="${n(baseline)}" font-family="${SANS}" font-size="${fit.size}" font-weight="bold" fill="#ffffff" text-anchor="middle">${t}</text>`;
    }
  });
  return s;
}

function sideUi(c: FrameCtx): string {
  const cx = 324;
  const p = c.d.palette;
  const label = (y: number, v: number) => `<text x="${cx}" y="${y}" font-family="${SANS}" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle" stroke="#000" stroke-opacity="0.25" stroke-width="2">${formatCount(v)}</text>`;
  const initial = x((c.brand || 'P').charAt(0).toUpperCase());
  return `<g>`
    + `<circle cx="${cx}" cy="300" r="21" fill="#ffffff"/><circle cx="${cx}" cy="300" r="19" fill="${p.primary}"/>`
    + `<text x="${cx}" y="306" font-family="${SANS}" font-size="16" font-weight="bold" fill="${readableOn(p.primary)}" text-anchor="middle">${initial}</text>`
    + `<circle cx="${cx}" cy="322" r="9" fill="#fe2c55"/><path d="M${cx - 4} 322 H${cx + 4} M${cx} 318 V326" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`
    // heart
    + `<path d="M${cx} 382 C${cx - 14} 372 ${cx - 17} 364 ${cx - 17} 358 C${cx - 17} 351 ${cx - 12} 347 ${cx - 7} 347 C${cx - 3} 347 ${cx - 1} 349 ${cx} 352 C${cx + 1} 349 ${cx + 3} 347 ${cx + 7} 347 C${cx + 12} 347 ${cx + 17} 351 ${cx + 17} 358 C${cx + 17} 364 ${cx + 14} 372 ${cx} 382Z" fill="#ffffff" opacity="0.95"/>`
    + label(400, c.counts.likes)
    // comment bubble
    + `<path d="M${cx - 16} 424 C${cx - 16} 416 ${cx - 9} 411 ${cx} 411 C${cx + 9} 411 ${cx + 16} 416 ${cx + 16} 424 C${cx + 16} 432 ${cx + 9} 437 ${cx} 437 C${cx - 3} 437 ${cx - 6} 436 ${cx - 8} 435 L${cx - 15} 439 L${cx - 13} 432 C${cx - 15} 430 ${cx - 16} 427 ${cx - 16} 424Z" fill="#ffffff" opacity="0.95"/>`
    + `<circle cx="${cx - 6}" cy="424" r="1.8" fill="#333"/><circle cx="${cx}" cy="424" r="1.8" fill="#333"/><circle cx="${cx + 6}" cy="424" r="1.8" fill="#333"/>`
    + label(456, c.counts.comments)
    // bookmark
    + `<path d="M${cx - 10} 472 H${cx + 10} V498 L${cx} 490 L${cx - 10} 498Z" fill="#ffffff" opacity="0.95"/>`
    + label(514, c.counts.saves)
    // share arrow
    + `<path d="M${cx + 2} 530 L${cx + 16} 542 L${cx + 2} 554 V547 C${cx - 8} 547 ${cx - 13} 550 ${cx - 16} 556 C${cx - 15} 545 ${cx - 9} 538 ${cx + 2} 537Z" fill="#ffffff" opacity="0.95"/>`
    + label(572, c.counts.shares)
    // music disc
    + `<circle cx="${cx}" cy="608" r="17" fill="#222"/><circle cx="${cx}" cy="608" r="11" fill="${p.accent}"/><circle cx="${cx}" cy="608" r="3" fill="#222"/>`
    + `</g>`;
}

function topBar(c: FrameCtx, i: number, progress: boolean): string {
  const count = c.scenes.length;
  let s = '';
  if (progress && count > 0) {
    if (c.creative.format === 'carousel') {
      const gap = 12;
      const start = W / 2 - ((count - 1) * gap) / 2;
      for (let k = 0; k < count; k++) s += `<circle cx="${n(start + k * gap)}" cy="16" r="${k === i ? 4 : 3}" fill="#ffffff" opacity="${k === i ? 1 : 0.45}"/>`;
    } else {
      const segW = (W - 16 - (count - 1) * 4) / count;
      for (let k = 0; k < count; k++) {
        s += `<rect x="${n(8 + k * (segW + 4))}" y="10" width="${n(segW)}" height="3" rx="1.5" fill="#ffffff" opacity="${k <= i ? 0.95 : 0.35}"/>`;
      }
    }
  }
  s += `<rect x="12" y="24" width="78" height="20" rx="10" fill="#000" opacity="0.35"/>`
    + `<text x="51" y="38" font-family="${SANS}" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">Sponsorisé</text>`
    + `<text x="${W - 14}" y="38" font-family="${SANS}" font-size="11" font-weight="bold" fill="#ffffff" opacity="0.85" text-anchor="end">${i + 1}/${Math.max(1, count)} · ${durationOf(c.scenes[i])} s</text>`;
  return s;
}

function visualCaption(scene: AdScene): string {
  const v = stripEmoji(scene?.visual ?? '').trim();
  if (!v) return '';
  const lines = wrapText(`Visuel : ${v}`, 300, 'Helvetica', 10, 1.06).slice(0, 2);
  if (wrapText(`Visuel : ${v}`, 300, 'Helvetica', 10, 1.06).length > 2) lines[1] = `${lines[1].replace(/[\s,.;]+$/, '')}…`;
  const hgt = lines.length * 13 + 8;
  return `<rect x="12" y="52" width="${n(Math.min(336, Math.max(...lines.map((l) => textWidth(l, 'Helvetica', 10) * 1.06)) + 16))}" height="${hgt}" rx="7" fill="#000" opacity="0.32"/>`
    + lines.map((l, k) => `<text x="20" y="${66 + k * 13}" font-family="${SANS}" font-size="10" font-style="italic" fill="#ffffff" opacity="0.92">${x(l)}</text>`).join('');
}

function bottom(c: FrameCtx, last: boolean): string {
  const p = c.d.palette;
  let s = '';
  if (last) {
    const cta = stripEmoji(c.creative.cta || 'Télécharger le guide');
    const ctaFit = fitText(cta, { maxWidth: 250, maxLines: 1, font: 'Helvetica-Bold', max: 16, min: 11, scale: 1.05 });
    s += `<rect x="14" y="${H - 168}" width="284" height="42" rx="10" fill="${p.accent}"/>`
      + `<text x="156" y="${H - 141}" font-family="${SANS}" font-size="${ctaFit.size}" font-weight="bold" fill="${readableOn(p.accent)}" text-anchor="middle">${x(ctaFit.lines[0] ?? cta)}</text>`
      + `<path d="M272 ${H - 152} l6 5 -6 5" fill="none" stroke="${readableOn(p.accent)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  s += `<text x="14" y="${H - (last ? 102 : 62)}" font-family="${SANS}" font-size="15" font-weight="bold" fill="#ffffff" stroke="#000" stroke-opacity="0.2" stroke-width="2">${x(c.handle)}</text>`;
  if (last) {
    const tags = (c.creative.hashtags ?? []).map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1).join(' ');
    const caption = stripEmoji(`${c.creative.caption ?? ''} ${tags}`).trim();
    const lines = wrapText(caption, 280, 'Helvetica', 12.5, 1.06).slice(0, 3);
    if (wrapText(caption, 280, 'Helvetica', 12.5, 1.06).length > 3 && lines.length) lines[2] = `${lines[2].replace(/[\s,.;]+$/, '')}…`;
    s += lines.map((l, k) => `<text x="14" y="${H - 82 + k * 16}" font-family="${SANS}" font-size="12.5" fill="#ffffff">${x(l)}</text>`).join('');
  } else {
    s += `<text x="14" y="${H - 44}" font-family="${SANS}" font-size="12.5" fill="#ffffff" opacity="0.9">${x(truncate(stripEmoji(c.product.title || ''), 42))}</text>`;
  }
  s += `<text x="14" y="${H - 18}" font-family="${SANS}" font-size="11.5" fill="#ffffff" opacity="0.85">♫ son original · ${x(c.handle)}</text>`;
  return s;
}

function shade(c: FrameCtx, uid: string): string {
  const high = Math.round(200 * c.h / H);
  return `<rect width="${c.w}" height="${c.h}" fill="url(#${uid}vig)"/>`
    + `<linearGradient id="${uid}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient>`
    + `<rect x="0" y="${c.h - high}" width="${c.w}" height="${high}" fill="url(#${uid}sh)"/>`;
}

const uidOf = (c: FrameCtx, i: number): string => `f${hashString(`${c.creative.id}|${i}`).toString(36).slice(0, 5)}`;

function svgFrame(c: FrameCtx, scene: AdScene | undefined, i: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.w} ${c.h}" width="${c.w}" height="${c.h}" role="img" aria-label="${x(`Scène ${i + 1} : ${scene?.onScreenText ?? ''}`)}">`
    + `<title>${x(scene?.onScreenText ?? `Scène ${i + 1}`)}</title>${body}</svg>`;
}

function renderFrame(c: FrameCtx, i: number, opts: { progress: boolean }): string {
  const scene = c.scenes[i];
  const last = i === c.scenes.length - 1;
  const uid = uidOf(c, i);
  const body = background(c, i, uid)
    + art(c, i, uid, last)
    + shade(c, uid)
    + topBar(c, i, opts.progress)
    + visualCaption(scene)
    + textBlock(c, scene?.onScreenText ?? '', i, last)
    + sideUi(c)
    + bottom(c, last);
  return svgFrame(c, scene, i, body);
}

/** The button of the last frame, in the zone. */
function ctaPill(c: FrameCtx, zone: Zone, y: number): string {
  const p = c.d.palette;
  const said = stripEmoji(c.creative.cta || 'Télécharger le guide').replace(/\s*\([^)]*\)\s*$/, '').replace(/^swipe\b.*?\bet\s+/i, ''); // the last card has nowhere left to swipe to
  const cta = said.charAt(0).toLocaleUpperCase('fr-FR') + said.slice(1);
  const width = zone.x1 - zone.x0 - CUT_PAD * 2;
  const fit = fitText(cta, { maxWidth: width - 28, maxLines: 1, font: 'Helvetica-Bold', max: 16, min: 11, scale: 1.05 });
  const cx = (zone.x0 + zone.x1) / 2;
  return `<rect x="${n(cx - width / 2)}" y="${n(y)}" width="${n(width)}" height="${CTA_H}" rx="10" fill="${p.accent}"/>`
    + `<text x="${n(cx)}" y="${n(y + CTA_H / 2 + fit.size * 0.36)}" font-family="${SANS}" font-size="${fit.size}" font-weight="bold" fill="${readableOn(p.accent)}" text-anchor="middle">${x(fit.lines[0] ?? cta)}</text>`;
}

/** One scene on a feed: no fake app, no rail, nothing of TikTok. The platform draws its own. */
function renderCutFrame(c: FrameCtx, i: number): string {
  const zone = c.zone!;
  const scene = c.scenes[i];
  const last = i === c.scenes.length - 1;
  const uid = uidOf(c, i);
  const mark = `<text x="${n(zone.x1 - CUT_PAD)}" y="${n(zone.y0 + 14)}" font-family="${SANS}" font-size="12" font-weight="bold" fill="#ffffff" opacity="0.85" text-anchor="end">${i + 1}/${c.scenes.length}</text>`;
  const end = last ? ctaPill(c, zone, zone.y1 - CTA_H - CUT_PAD) : `<text x="${n(zone.x0 + CUT_PAD)}" y="${n(zone.y1 - CUT_PAD)}" font-family="${SANS}" font-size="12.5" font-weight="bold" fill="#ffffff" opacity="0.9">${x(truncate(stripEmoji(c.product.title || ''), Math.floor((zone.x1 - zone.x0) / 7.5)))}</text>`;
  return svgFrame(c, scene, i, background(c, i, uid) + art(c, i, uid, last) + shade(c, uid) + mark + textBlock(c, scene?.onScreenText ?? '', i, last) + end);
}

/** The guide's own cover, as a nested SVG: it stays vector, and a frame is a file of its own, so its ids meet no others. */
function coverAt(c: FrameCtx, cx: number, cy: number, w: number, tilt: number): string {
  const brief = c.product;
  const svg = renderCoverSvg({ title: brief.title, subtitle: brief.content?.subtitle || brief.subtitle || '', audience: brief.audience, design: c.d, brand: c.brand });
  const h = w * COVER_RATIO;
  const body = svg.replace(/^<svg\b[^>]*>/, `<svg x="${n(cx - w / 2)}" y="${n(cy - h / 2)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 600 848">`);
  return `<g transform="rotate(${tilt} ${n(cx)} ${n(cy)})"><rect x="${n(cx - w / 2 + 6)}" y="${n(cy - h / 2 + 8)}" width="${n(w)}" height="${n(h)}" rx="6" fill="#000" opacity="0.35"/>${body}</g>`;
}

/** `static_image`: one still, the hook over the guide's cover, the button. */
function renderStaticFrame(c: FrameCtx): string {
  const zone = c.zone!;
  const scene = c.scenes[0];
  const uid = uidOf(c, 0);
  const high = zone.y1 - zone.y0;
  const wide = c.w / c.h > 0.9; // on the square the guide moves beside the text
  const coverW = (zone.x1 - zone.x0) * (wide ? 0.42 : 0.5);
  const hook = scene?.onScreenText || c.creative.hook;
  const textZone: Zone = wide ? { ...zone, x1: zone.x1 - coverW } : zone;
  const fit = fitText(stripEmoji(hook).replace(/\s+/g, ' ').trim(), { maxWidth: textZone.x1 - textZone.x0 - CUT_PAD * 2, maxLines: 5, font: 'Helvetica-Bold', max: 34, min: 18, scale: 1.06 });
  const lh = Math.round(fit.size * 1.18);
  const top = zone.y0 + high * (wide ? 0.14 : 0.04);
  const cx = (textZone.x0 + textZone.x1) / 2;
  const text = fit.lines.map((line, k) => {
    const y = top + (k + 1) * lh;
    return `<text x="${n(cx)}" y="${n(y)}" font-family="${SANS}" font-size="${fit.size}" font-weight="bold" fill="#111111" stroke="#111111" stroke-width="${n(fit.size * 0.2)}" stroke-linejoin="round" text-anchor="middle">${x(line)}</text>`
      + `<text x="${n(cx)}" y="${n(y)}" font-family="${SANS}" font-size="${fit.size}" font-weight="bold" fill="#ffffff" text-anchor="middle">${x(line)}</text>`;
  }).join('');
  const coverY = wide ? zone.y0 + high * 0.42 : zone.y0 + high * 0.66;
  const body = background(c, 0, uid) + shade(c, uid) + coverAt(c, wide ? zone.x1 - coverW / 2 : (zone.x0 + zone.x1) / 2 + c.w * 0.14, coverY, coverW, 4) + text + ctaPill(c, zone, zone.y1 - CTA_H - CUT_PAD);
  return svgFrame(c, scene, 0, body);
}

function previewHtml(c: FrameCtx, frames: string[]): string {
  const p = c.d.palette;
  const durations = c.scenes.map(durationOf);
  const total = durations.reduce((s, d) => s + d, 0);
  const subs = c.scenes.map((s) => stripEmoji(s.voiceover ?? '').trim());
  const review = c.creative.review;
  const reviewBadge = review?.status === 'approved' ? ['Validée par la plateforme', '#1f9d63']
    : review?.status === 'rejected' ? [`Refusée${review.reason ? ` : ${review.reason}` : ''}`, '#d64545']
      : ['En attente de validation', '#b7791f'];
  const tags = (c.creative.hashtags ?? []).map((t) => `#${String(t).replace(/^#+/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1);
  const accentFg = readableOn(p.accent);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aperçu — pub simulée · ${h(c.product.title)}</title>
<style>
:root{--ink:#14151a;--muted:#5d6170;--bg:${mix(p.soft, '#ffffff', 0.4)};--primary:${p.primary};--accent:${p.accent};--accent-fg:${accentFg};--line:${mix(p.primary, '#ffffff', 0.82)}}
*{box-sizing:border-box}
body{margin:0;font-family:${SANS};background:radial-gradient(900px 500px at 20% -10%,${rgba(p.primary, 0.18)},transparent),var(--bg);color:var(--ink);min-height:100vh}
.wrap{max-width:1040px;margin:0 auto;padding:28px 18px 48px;display:grid;gap:30px;align-items:start}
.label{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:6px 12px;border-radius:999px;background:var(--ink);color:#fff}
.label i{width:8px;height:8px;border-radius:50%;background:#fe2c55;display:inline-block;animation:blink 1.4s infinite}
@keyframes blink{50%{opacity:.25}}
.stage{display:flex;flex-direction:column;align-items:center;gap:16px}
.phone{position:relative;width:min(86vw,320px);border-radius:44px;background:#0b0b0f;padding:30px 12px 34px;box-shadow:0 30px 70px ${rgba('#000000', 0.35)},inset 0 0 0 2px #2a2a33}
.phone::before{content:"";position:absolute;top:12px;left:50%;transform:translateX(-50%);width:26%;height:6px;border-radius:3px;background:#2a2a33}
.phone::after{content:"";position:absolute;bottom:12px;left:50%;transform:translateX(-50%);width:32%;height:5px;border-radius:3px;background:#3a3a44}
.screen{position:relative;width:100%;aspect-ratio:9/16;border-radius:24px;overflow:hidden;background:#000}
.frame{position:absolute;inset:0;opacity:0;transition:opacity .28s ease}
.frame.on{opacity:1}
.frame svg{width:100%;height:100%;display:block}
.bars{position:absolute;top:12px;left:10px;right:10px;display:flex;gap:4px;z-index:4}
.bars span{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.35);overflow:hidden}
.bars b{display:block;height:100%;width:0;background:#fff}
.subs{position:absolute;left:8%;right:20%;bottom:30%;z-index:4;text-align:center;pointer-events:none}
.subs span{display:inline;background:rgba(0,0,0,.62);color:#fff;font-size:13.5px;line-height:1.55;padding:3px 8px;border-radius:6px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.controls{display:flex;gap:10px;align-items:center}
.controls button{appearance:none;border:0;cursor:pointer;font:inherit;font-weight:700;padding:10px 14px;white-space:nowrap;border-radius:999px;background:#fff;color:var(--ink);box-shadow:0 4px 14px rgba(0,0,0,.1);display:inline-flex;gap:8px;align-items:center}
.controls button.main{background:var(--accent);color:var(--accent-fg)}
.controls button:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.time{font-variant-numeric:tabular-nums;color:var(--muted);font-size:14px;min-width:86px;text-align:center}
.panel{background:#fff;border-radius:22px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,.06);border:1px solid var(--line)}
.panel h1{font-size:22px;margin:12px 0 6px;line-height:1.25}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 16px}
.chip{font-size:12.5px;font-weight:700;padding:5px 10px;border-radius:999px;background:${mix('#ffffff', p.primary, 0.12)};color:${darken(p.primary, 0.25)}}
.chip.status{color:#fff}
.kv{display:grid;gap:10px;margin:0 0 18px}
.kv div{font-size:14.5px;line-height:1.5}.kv strong{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.tags{color:${darken(p.primary, 0.2)};font-weight:600}
ol.scenes{list-style:none;margin:0;padding:0;display:grid;gap:10px}
ol.scenes li{display:grid;grid-template-columns:34px 1fr;gap:12px;padding:12px;border-radius:14px;border:1px solid var(--line);cursor:pointer;transition:background .2s,border-color .2s}
ol.scenes li:hover{background:${mix('#ffffff', p.primary, 0.05)}}
ol.scenes li.on{border-color:var(--primary);background:${mix('#ffffff', p.primary, 0.08)}}
ol.scenes .num{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--primary);color:${readableOn(p.primary)};font-weight:800}
ol.scenes .ost{font-weight:800;font-size:15px}
ol.scenes .vo{font-size:14px;color:var(--ink);margin-top:4px}
ol.scenes .vis{font-size:12.5px;color:var(--muted);margin-top:4px;font-style:italic}
ol.scenes .row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
ol.scenes .dur{flex:none;font-size:11.5px;font-weight:800;color:var(--muted);background:#f1f2f6;border-radius:999px;padding:2px 8px;margin-top:1px}
.note{font-size:12.5px;color:var(--muted);margin-top:16px}
@media (min-width:880px){.wrap{grid-template-columns:360px 1fr;gap:44px;padding-top:44px}.stage{position:sticky;top:24px}}
@media (prefers-reduced-motion:reduce){.frame{transition:none}.label i{animation:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="stage">
    <span class="label"><i></i>Aperçu — pub simulée</span>
    <div class="phone" aria-label="Aperçu de la publicité TikTok">
      <div class="screen" id="screen">
        ${frames.length
    ? frames.map((f, k) => `<div class="frame${k === 0 ? ' on' : ''}" data-k="${k}">${f}</div>`).join('\n        ')
    : '<div class="frame on" style="display:grid;place-items:center;color:#fff;font-weight:700;padding:24px;text-align:center">Aucune scène dans ce storyboard pour l’instant.</div>'}
        <div class="bars">${durations.map(() => '<span><b></b></span>').join('')}</div>
        <div class="subs" aria-live="polite"><span id="sub">${h(subs[0] ?? '')}</span></div>
      </div>
    </div>
    <div class="controls">
      <button type="button" class="main" id="play" aria-label="Lecture ou pause">⏸ Pause</button>
      <button type="button" id="restart" aria-label="Recommencer">↺ Recommencer</button>
      <span class="time" id="time">0:00 / ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}</span>
    </div>
  </div>
  <div class="panel">
    <span class="label" style="background:${mix(p.primary, '#000000', 0.2)}">Storyboard TikTok</span>
    <h1>${h(c.creative.hook || c.scenes[0]?.onScreenText || c.product.title)}</h1>
    <div class="meta">
      <span class="chip">Hook : ${h(HOOK_LABEL[c.creative.hookStyle] ?? c.creative.hookStyle)}</span>
      <span class="chip">Format : ${h(FORMAT_LABEL[c.creative.format] ?? c.creative.format)}</span>
      <span class="chip">${h(c.scenes.length)} scènes · ${h(total)} s</span>
      <span class="chip status" style="background:${reviewBadge[1]}">${h(reviewBadge[0])}</span>
    </div>
    <div class="kv">
      <div><strong>Produit</strong>${h(c.product.title)}</div>
      <div><strong>Légende</strong>${h(c.creative.caption || '—')} ${tags.length ? `<span class="tags">${h(tags.join(' '))}</span>` : ''}</div>
      <div><strong>Appel à l’action</strong>${h(c.creative.cta || '—')}</div>
    </div>
    <ol class="scenes" id="scenes">
      ${c.scenes.map((s, k) => `<li data-k="${k}"${k === 0 ? ' class="on"' : ''}><span class="num">${k + 1}</span><div><div class="row"><span class="ost">${h(s.onScreenText)}</span><span class="dur">${h(durations[k])} s</span></div>${s.voiceover ? `<div class="vo"><strong>Voix off :</strong> ${h(s.voiceover)}</div>` : ''}${s.visual ? `<div class="vis">Visuel : ${h(s.visual)}</div>` : ''}</div></li>`).join('\n      ')}
    </ol>
    <p class="note">Pub fabriquée par l’agence et diffusée uniquement dans le marché virtuel de Pixel Agency. Les compteurs (j’aime, commentaires…) sont simulés.</p>
  </div>
</div>
<script>
(function () {
  var durations = ${JSON.stringify(durations)};
  var subs = ${JSON.stringify(subs).replace(/</g, '\\u003c')};
  var frames = document.querySelectorAll('.frame');
  var bars = document.querySelectorAll('.bars b');
  var items = document.querySelectorAll('#scenes li');
  var sub = document.getElementById('sub');
  var playBtn = document.getElementById('play');
  var timeEl = document.getElementById('time');
  var total = durations.reduce(function (a, b) { return a + b; }, 0);
  var index = 0, elapsed = 0, playing = true, last = null;
  function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function show(k) {
    index = k;
    for (var i = 0; i < frames.length; i++) frames[i].classList.toggle('on', i === k);
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('on', j === k);
    sub.textContent = subs[k] || '';
    sub.style.display = subs[k] ? 'inline' : 'none';
  }
  function paint() {
    for (var i = 0; i < bars.length; i++) bars[i].style.width = (i < index ? 100 : i === index ? Math.min(100, (elapsed / durations[i]) * 100) : 0) + '%';
    var before = 0; for (var k = 0; k < index; k++) before += durations[k];
    timeEl.textContent = fmt(before + elapsed) + ' / ' + fmt(total);
  }
  function loop(now) {
    if (last === null) last = now;
    var dt = (now - last) / 1000; last = now;
    if (playing && durations.length) {
      elapsed += dt;
      if (elapsed >= durations[index]) { elapsed = 0; show((index + 1) % durations.length); }
    }
    paint();
    requestAnimationFrame(loop);
  }
  playBtn.addEventListener('click', function () { playing = !playing; playBtn.textContent = playing ? '⏸ Pause' : '▶ Lecture'; });
  document.getElementById('restart').addEventListener('click', function () { elapsed = 0; show(0); playing = true; playBtn.textContent = '⏸ Pause'; });
  for (var i = 0; i < items.length; i++) items[i].addEventListener('click', function () { elapsed = 0; show(Number(this.getAttribute('data-k'))); });
  show(0);
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>
`;
}

function frameCtx(input: { creative: AdCreative; product: Product; design: DesignSpec; brand: string }, frame: Pick<FrameCtx, 'w' | 'h' | 'zone'>): FrameCtx {
  const creative = input.creative;
  const brand = (input.brand || 'Pixel Agency').trim();
  const seed = hashString(creative?.id || creative?.hook || 'pub');
  const likes = 800 + (seed % 46000);
  return {
    creative, product: input.product, d: normalizeDesign(input.design ?? input.product?.design), brand,
    handle: `@${slugify(brand, 24).replace(/-/g, '.')}`,
    scenes: (creative?.scenes ?? []).filter(Boolean),
    counts: { likes, comments: Math.round(likes / (18 + (seed % 17))), saves: Math.round(likes / (7 + (seed % 9))), shares: Math.round(likes / (12 + (seed % 11))) },
    ...frame,
  };
}

const MASTER_FRAME = { w: W, h: H, zone: null };

/** 9:16 SVG frames (one per scene) + an HTML phone preview that plays them. */
export function renderAdStoryboard(input: { creative: AdCreative; product: Product; design: DesignSpec; brand: string }): { frames: string[]; previewHtml: string } {
  const ctx = frameCtx(input, MASTER_FRAME);
  const { scenes } = ctx;
  const frames = scenes.map((_, i) => renderFrame(ctx, i, { progress: true }));
  const previewFrames = scenes.map((_, i) => renderFrame(ctx, i, { progress: false }));
  return { frames, previewHtml: previewHtml(ctx, previewFrames) };
}

/** Still frames of a cut: 432×540, 540×540, 400×600, one per scene. A pin is one frame, an ad with no media has none. */
export function renderAdCut(input: { creative: AdCreative; product: Product; design: DesignSpec; brand: string; ratio: Exclude<AdRatio, 'text'> }): { frames: string[] } {
  const { ratio } = input;
  if (input.creative?.format === 'search_text') return { frames: [] };
  const ctx = frameCtx(input, ratio === '9:16' ? MASTER_FRAME : cutFrame(ratio));
  if (ratio === '9:16') return { frames: ctx.scenes.map((_, i) => renderFrame(ctx, i, { progress: true })) };
  if (input.creative?.format === 'static_image') return { frames: ctx.scenes.length ? [renderStaticFrame(ctx)] : [] };
  return { frames: ctx.scenes.map((_, i) => renderCutFrame(ctx, i)) };
}
