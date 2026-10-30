/**
 * Vector illustrations, one per DesignSpec motif. Each is drawn in a 200×200 box with the palette
 * colours and only uses SVG features that both browsers and svg-to-pdfkit understand
 * (paths, basic shapes, linear/radial gradients, opacity — no filters, no fonts).
 */
import type { Motif } from './design.js';
import { darken, lighten, mix, type Palette } from './color.js';
import { decoRng, n } from './text.js';

interface Ink { hero: string; heroLight: string; heroDark: string; c1: string; c2: string; c2Light: string; light: string; soft: string; dark: string }

function inks(p: Palette): Ink {
  return {
    hero: p.accent,
    heroLight: lighten(p.accent, 0.4),
    heroDark: darken(p.accent, 0.25),
    c1: p.primary,
    c2: p.secondary,
    c2Light: lighten(p.secondary, 0.45),
    light: '#ffffff',
    soft: p.soft,
    dark: darken(p.ink, 0.1),
  };
}

const lin = (id: string, a: string, b: string, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const rad = (id: string, a: string, b: string) =>
  `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${a}" stop-opacity="0.9"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>`;

/** Concave 4-point sparkle centred on (x, y). */
export function sparklePath(x: number, y: number, r: number): string {
  return `M${n(x)} ${n(y - r)} Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)} Q${n(x)} ${n(y)} ${n(x)} ${n(y + r)} Q${n(x)} ${n(y)} ${n(x - r)} ${n(y)} Q${n(x)} ${n(y)} ${n(x)} ${n(y - r)}Z`;
}

/** Classic heart in a box of width s whose top-left corner is (x, y). */
export function heartPath(x: number, y: number, s: number): string {
  const k = s / 100;
  const P = (px: number, py: number) => `${n(x + px * k)} ${n(y + py * k)}`;
  return `M${P(50, 88)} C${P(20, 66)} ${P(4, 50)} ${P(4, 32)} C${P(4, 16)} ${P(16, 6)} ${P(30, 6)} C${P(40, 6)} ${P(47, 12)} ${P(50, 19)} C${P(53, 12)} ${P(60, 6)} ${P(70, 6)} C${P(84, 6)} ${P(96, 16)} ${P(96, 32)} C${P(96, 50)} ${P(80, 66)} ${P(50, 88)}Z`;
}

function cloud(x: number, y: number, w: number, fill: string, opacity = 1): string {
  const r = w / 4;
  return `<g fill="${fill}" opacity="${opacity}"><ellipse cx="${n(x + w * 0.5)}" cy="${n(y)}" rx="${n(w * 0.5)}" ry="${n(r * 0.7)}"/>`
    + `<circle cx="${n(x + w * 0.32)}" cy="${n(y - r * 0.45)}" r="${n(r * 0.85)}"/><circle cx="${n(x + w * 0.62)}" cy="${n(y - r * 0.7)}" r="${n(r * 1.05)}"/>`
    + `<circle cx="${n(x + w * 0.84)}" cy="${n(y - r * 0.2)}" r="${n(r * 0.6)}"/></g>`;
}

function stars(seed: number, count: number, color: string, box = { x: 0, y: 0, w: 200, h: 200 }, maxR = 7): string {
  const rnd = decoRng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = box.x + rnd() * box.w;
    const y = box.y + rnd() * box.h;
    const r = 2 + rnd() * (maxR - 2);
    out += i % 3 === 0
      ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * 0.35)}" fill="${color}" opacity="${n(0.5 + rnd() * 0.5)}"/>`
      : `<path d="${sparklePath(x, y, r)}" fill="${color}" opacity="${n(0.55 + rnd() * 0.45)}"/>`;
  }
  return out;
}

function zLetter(x: number, y: number, s: number, color: string, w = 3): string {
  return `<path d="M${n(x)} ${n(y)} H${n(x + s)} L${n(x)} ${n(y + s)} H${n(x + s)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function leafShape(x: number, y: number, len: number, angle: number, fill: string, vein: string): string {
  const w = len * 0.36;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(angle)})"><path d="M0 0 C${n(len * 0.3)} ${n(-w)} ${n(len * 0.75)} ${n(-w)} ${n(len)} 0 C${n(len * 0.75)} ${n(w)} ${n(len * 0.3)} ${n(w)} 0 0Z" fill="${fill}"/>`
    + `<path d="M${n(len * 0.08)} 0 L${n(len * 0.85)} 0" stroke="${vein}" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/></g>`;
}

function pawPrint(x: number, y: number, s: number, angle: number, fill: string, opacity = 1): string {
  const k = s / 40;
  const P = (v: number) => n(v * k);
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(angle)})" fill="${fill}" opacity="${n(opacity)}">`
    + `<path d="M0 ${P(-2)} C${P(9)} ${P(-2)} ${P(17)} ${P(8)} ${P(15)} ${P(15)} C${P(13)} ${P(21)} ${P(6)} ${P(19)} 0 ${P(19)} C${P(-6)} ${P(19)} ${P(-13)} ${P(21)} ${P(-15)} ${P(15)} C${P(-17)} ${P(8)} ${P(-9)} ${P(-2)} 0 ${P(-2)}Z"/>`
    + `<ellipse cx="${P(-17)}" cy="${P(-6)}" rx="${P(5)}" ry="${P(6.5)}" transform="rotate(-20 ${P(-17)} ${P(-6)})"/>`
    + `<ellipse cx="${P(-7)}" cy="${P(-16)}" rx="${P(5.2)}" ry="${P(7)}"/>`
    + `<ellipse cx="${P(7)}" cy="${P(-16)}" rx="${P(5.2)}" ry="${P(7)}"/>`
    + `<ellipse cx="${P(17)}" cy="${P(-6)}" rx="${P(5)}" ry="${P(6.5)}" transform="rotate(20 ${P(17)} ${P(-6)})"/></g>`;
}

function coinStack(cx: number, base: number, count: number, i: Ink, uid: string): string {
  let out = '';
  for (let j = 0; j < count; j++) {
    const y = base - j * 11;
    out += `<ellipse cx="${n(cx)}" cy="${n(y + 7)}" rx="26" ry="8.5" fill="${i.heroDark}"/>`
      + `<rect x="${n(cx - 26)}" y="${n(y)}" width="52" height="7" fill="${i.heroDark}"/>`
      + `<ellipse cx="${n(cx)}" cy="${n(y)}" rx="26" ry="8.5" fill="url(#${uid}gold)"/>`
      + `<ellipse cx="${n(cx)}" cy="${n(y)}" rx="18" ry="5.5" fill="none" stroke="${i.heroDark}" stroke-width="1.4" opacity="0.55"/>`;
  }
  return out;
}

// ───────────────────────────── the 12 motifs ─────────────────────────────

function moon(i: Ink, uid: string, v: number): string {
  return `<defs>${lin(`${uid}moon`, i.heroLight, i.hero)}${rad(`${uid}halo`, i.heroLight, i.heroLight)}</defs>`
    + `<circle cx="100" cy="96" r="96" fill="url(#${uid}halo)" opacity="0.45"/>`
    + `<circle cx="96" cy="98" r="78" fill="${i.light}" opacity="0.06"/>`
    + stars(11 + v, 14, i.light, { x: 6, y: 6, w: 188, h: 120 }, 8)
    + `<path d="M112 26 A72 72 0 0 0 112 170 A97 97 0 0 1 112 26Z" fill="url(#${uid}moon)"/>`
    + `<circle cx="62" cy="80" r="7" fill="${i.heroDark}" opacity="0.18"/><circle cx="66" cy="124" r="5" fill="${i.heroDark}" opacity="0.18"/><circle cx="54" cy="104" r="3.5" fill="${i.heroDark}" opacity="0.18"/>`
    + cloud(8, 170, 120, i.light, 0.92)
    + cloud(104, 182, 92, i.c2Light, 0.85)
    // sleeping little one resting on the cloud
    + `<circle cx="70" cy="150" r="17" fill="#f6d5bf"/><path d="M56 143 C60 128 82 126 86 141 C78 136 66 136 56 143Z" fill="${darken(i.c1, 0.1)}"/>`
    + `<path d="M61 152 Q65 156 69 152 M75 152 Q79 156 83 152" fill="none" stroke="${darken(i.dark, 0.1)}" stroke-width="1.6" stroke-linecap="round"/>`
    + `<circle cx="61" cy="158" r="3" fill="#f2a7a0" opacity="0.7"/><circle cx="83" cy="158" r="3" fill="#f2a7a0" opacity="0.7"/>`
    + zLetter(98, 118, 10, i.light, 2.6) + zLetter(114, 100, 14, i.light, 3) + zLetter(134, 76, 18, i.light, 3.4);
}

function sun(i: Ink, uid: string, v: number): string {
  let rays = '';
  for (let k = 0; k < 12; k++) rays += `<rect x="96" y="${k % 2 ? 22 : 14}" width="8" height="${k % 2 ? 20 : 26}" rx="4" fill="${i.hero}" transform="rotate(${k * 30} 100 86)"/>`;
  return `<defs>${lin(`${uid}sun`, i.heroLight, i.hero)}${rad(`${uid}glow`, i.heroLight, i.heroLight)}</defs>`
    + `<circle cx="100" cy="86" r="92" fill="url(#${uid}glow)" opacity="0.55"/>`
    + rays
    + `<circle cx="100" cy="86" r="42" fill="url(#${uid}sun)"/><circle cx="86" cy="72" r="12" fill="${i.light}" opacity="0.35"/>`
    + `<path d="M0 160 Q50 128 104 152 T200 146 V200 H0Z" fill="${i.c2}" opacity="0.85"/>`
    + `<path d="M0 178 Q60 150 120 172 T200 168 V200 H0Z" fill="${i.c1}"/>`
    + cloud(118, 118, 70, i.light, 0.9)
    + `<path d="M34 54 q6 -6 12 0 q6 -6 12 0 M150 34 q5 -5 10 0 q5 -5 10 0" fill="none" stroke="${i.dark}" stroke-width="2.2" stroke-linecap="round" opacity="0.55"/>`
    + stars(23 + v, 4, i.light, { x: 10, y: 100, w: 60, h: 40 }, 6);
}

function leaf(i: Ink, uid: string, v: number): string {
  const g1 = i.c1;
  const g2 = mix(i.c1, i.c2, 0.5);
  const vein = lighten(i.c1, 0.6);
  return `<defs>${lin(`${uid}pot`, lighten(i.hero, 0.1), i.heroDark)}</defs>`
    + `<circle cx="100" cy="92" r="84" fill="${i.c2Light}" opacity="0.55"/>`
    + `<path d="M100 136 C98 110 96 86 100 52" fill="none" stroke="${darken(g1, 0.15)}" stroke-width="3.5" stroke-linecap="round"/>`
    + `<path d="M100 120 C86 108 72 100 58 96 M100 104 C116 92 128 84 144 80 M99 84 C90 74 84 64 80 52" fill="none" stroke="${darken(g1, 0.15)}" stroke-width="3" stroke-linecap="round"/>`
    + leafShape(100, 56, 46, -95, g1, vein)
    + leafShape(80, 54, 40, -140, g2, vein)
    + leafShape(58, 96, 48, 192, g1, vein)
    + leafShape(144, 80, 48, -18, g2, vein)
    + leafShape(100, 118, 42, -32, g1, vein)
    + leafShape(100, 126, 40, 205, g2, vein)
    + `<path d="M64 140 H136 L126 192 H74Z" fill="url(#${uid}pot)"/>`
    + `<rect x="58" y="130" width="84" height="16" rx="5" fill="${darken(i.hero, 0.12)}"/>`
    + `<path d="M76 160 H124" stroke="${i.light}" stroke-width="2" opacity="0.35" stroke-linecap="round"/>`
    + leafShape(160, 140, 20, 40, g2, vein) + leafShape(30, 150, 16, -150, g1, vein)
    + stars(37 + v, 5, i.light, { x: 10, y: 10, w: 180, h: 60 }, 6);
}

function coin(i: Ink, uid: string, v: number): string {
  const bars = [44, 68, 96, 128].map((h, k) => `<rect x="${24 + k * 40}" y="${170 - h}" width="26" height="${h}" rx="5" fill="${i.c2}" opacity="${n(0.35 + k * 0.12)}"/>`).join('');
  return `<defs>${lin(`${uid}gold`, i.heroLight, i.hero)}</defs>`
    + `<circle cx="100" cy="100" r="88" fill="${i.light}" opacity="0.07"/>`
    + bars
    + `<path d="M20 132 L64 108 L96 118 L150 62" fill="none" stroke="${i.hero}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M136 56 L160 52 L154 76Z" fill="${i.hero}"/>`
    + coinStack(62, 176, 4, i, uid) + coinStack(124, 182, 6, i, uid)
    + `<circle cx="160" cy="150" r="28" fill="${i.heroDark}"/><circle cx="158" cy="147" r="28" fill="url(#${uid}gold)"/>`
    + `<circle cx="158" cy="147" r="21" fill="none" stroke="${i.heroDark}" stroke-width="1.6" opacity="0.6"/>`
    + `<path d="M166 136 A13 13 0 1 0 166 158 M146 143 H162 M146 151 H160" fill="none" stroke="${i.heroDark}" stroke-width="3.2" stroke-linecap="round"/>`
    + stars(41 + v, 5, i.heroLight, { x: 10, y: 10, w: 180, h: 60 }, 7);
}

function heart(i: Ink, uid: string, v: number): string {
  return `<defs>${lin(`${uid}heart`, lighten(i.hero, 0.25), darken(i.hero, 0.08))}${rad(`${uid}hglow`, i.heroLight, i.heroLight)}</defs>`
    + `<circle cx="100" cy="98" r="94" fill="url(#${uid}hglow)" opacity="0.5"/>`
    + `<circle cx="100" cy="98" r="72" fill="none" stroke="${i.light}" stroke-width="1.5" stroke-dasharray="3 7" opacity="0.6"/>`
    + `<path d="${heartPath(36, 40, 128)}" fill="url(#${uid}heart)"/>`
    + `<ellipse cx="70" cy="72" rx="14" ry="9" fill="${i.light}" opacity="0.35" transform="rotate(-30 70 72)"/>`
    + `<path d="${heartPath(146, 26, 34)}" fill="${i.c2}" opacity="0.9"/>`
    + `<path d="${heartPath(18, 128, 28)}" fill="${i.c1}" opacity="0.85"/>`
    + `<path d="${heartPath(150, 140, 22)}" fill="${i.heroLight}"/>`
    + stars(53 + v, 7, i.light, { x: 10, y: 10, w: 180, h: 180 }, 7);
}

function bolt(i: Ink, uid: string, v: number): string {
  let lines = '';
  for (let k = 0; k < 10; k++) lines += `<rect x="98" y="4" width="4" height="${k % 2 ? 12 : 18}" rx="2" fill="${i.hero}" opacity="0.7" transform="rotate(${k * 36 + 18} 100 100)"/>`;
  return `<defs>${lin(`${uid}badge`, lighten(i.c1, 0.15), darken(i.c1, 0.2))}${lin(`${uid}bolt`, i.heroLight, i.hero)}</defs>`
    + lines
    + `<circle cx="100" cy="100" r="70" fill="url(#${uid}badge)"/>`
    + `<circle cx="100" cy="100" r="58" fill="none" stroke="${i.light}" stroke-width="2" opacity="0.25"/>`
    + `<path d="M114 30 L62 110 H96 L84 172 L140 88 H106Z" fill="${i.heroDark}" transform="translate(4 4)" opacity="0.5"/>`
    + `<path d="M114 30 L62 110 H96 L84 172 L140 88 H106Z" fill="url(#${uid}bolt)"/>`
    + `<circle cx="160" cy="160" r="20" fill="${i.c2}"/><path d="M150 160 L157 167 L171 153" fill="none" stroke="${i.light}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    + stars(67 + v, 5, i.light, { x: 6, y: 6, w: 60, h: 190 }, 7);
}

function book(i: Ink, uid: string, v: number): string {
  let text = '';
  for (let k = 0; k < 6; k++) {
    text += `<rect x="40" y="${80 + k * 12}" width="${k % 3 === 2 ? 30 : 46}" height="3.5" rx="1.75" fill="${i.c1}" opacity="0.28"/>`;
    text += `<rect x="${112}" y="${82 + k * 12}" width="${k % 2 ? 34 : 46}" height="3.5" rx="1.75" fill="${i.c1}" opacity="0.28"/>`;
  }
  return `<defs>${lin(`${uid}page`, '#ffffff', mix('#ffffff', i.soft, 0.9))}</defs>`
    + `<circle cx="100" cy="96" r="86" fill="${i.c2Light}" opacity="0.5"/>`
    + `<path d="M14 66 C46 56 80 58 100 72 C120 58 154 56 186 66 V172 C154 162 120 164 100 178 C80 164 46 162 14 172Z" fill="${i.c1}"/>`
    + `<path d="M22 60 C50 50 80 52 100 66 V168 C80 154 50 152 22 162Z" fill="url(#${uid}page)"/>`
    + `<path d="M178 60 C150 50 120 52 100 66 V168 C120 154 150 152 178 162Z" fill="url(#${uid}page)"/>`
    + `<path d="M100 66 V168" stroke="${darken(i.soft, 0.15)}" stroke-width="2"/>`
    + text
    + `<path d="M136 52 V96 L144 88 L152 96 V50" fill="${i.hero}"/>`
    + `<g transform="rotate(-38 150 40)"><rect x="128" y="34" width="56" height="11" rx="2" fill="${i.hero}"/><rect x="128" y="34" width="10" height="11" fill="${i.heroDark}"/><path d="M184 34 L196 39.5 L184 45Z" fill="#f2d3a9"/><path d="M192 37.6 L196 39.5 L192 41.4Z" fill="${i.dark}"/></g>`
    + stars(79 + v, 6, i.light, { x: 6, y: 6, w: 110, h: 50 }, 8);
}

function chart(i: Ink, uid: string, v: number): string {
  const bars = [38, 56, 50, 80, 104].map((h, k) => `<rect x="${44 + k * 24}" y="${150 - h}" width="15" height="${h}" rx="3" fill="${k === 4 ? i.hero : i.c2}" opacity="${k === 4 ? 1 : n(0.55 + k * 0.1)}"/>`).join('');
  return `<defs>${lin(`${uid}board`, '#ffffff', mix('#ffffff', i.soft, 0.8))}</defs>`
    + `<circle cx="100" cy="100" r="90" fill="${i.light}" opacity="0.08"/>`
    + `<rect x="24" y="30" width="152" height="138" rx="14" fill="${darken(i.c1, 0.25)}" opacity="0.25" transform="translate(5 6)"/>`
    + `<rect x="24" y="30" width="152" height="138" rx="14" fill="url(#${uid}board)"/>`
    + `<rect x="40" y="44" width="54" height="7" rx="3.5" fill="${i.c1}" opacity="0.7"/><rect x="40" y="56" width="32" height="5" rx="2.5" fill="${i.c1}" opacity="0.3"/>`
    + `<path d="M40 150 H162" stroke="${i.c1}" stroke-width="1.5" opacity="0.3"/>`
    + bars
    + `<path d="M48 118 L76 98 L100 106 L128 74 L158 52" fill="none" stroke="${i.c1}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`
    + [[48, 118], [76, 98], [100, 106], [128, 74]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#ffffff" stroke="${i.c1}" stroke-width="2.5"/>`).join('')
    + `<path d="M146 46 L166 44 L162 64Z" fill="${i.c1}"/>`
    + `<circle cx="160" cy="160" r="22" fill="none" stroke="${i.dark}" stroke-width="6"/><circle cx="160" cy="160" r="17" fill="${i.light}" opacity="0.35"/>`
    + `<path d="M176 176 L194 194" stroke="${i.dark}" stroke-width="9" stroke-linecap="round"/>`
    + stars(83 + v, 4, i.hero, { x: 6, y: 6, w: 40, h: 40 }, 8);
}

function home(i: Ink, uid: string, v: number): string {
  return `<defs>${lin(`${uid}wall`, '#ffffff', mix('#ffffff', i.soft, 0.9))}${rad(`${uid}win`, i.heroLight, i.heroLight)}</defs>`
    + `<ellipse cx="100" cy="186" rx="92" ry="10" fill="${i.c1}" opacity="0.18"/>`
    + `<circle cx="100" cy="96" r="84" fill="${i.c2Light}" opacity="0.45"/>`
    // tree
    + `<rect x="160" y="132" width="8" height="52" rx="3" fill="${darken(i.hero, 0.35)}"/><circle cx="164" cy="122" r="24" fill="${i.c1}"/><circle cx="152" cy="132" r="14" fill="${mix(i.c1, i.c2, 0.4)}"/>`
    // house
    + `<rect x="44" y="96" width="104" height="88" rx="4" fill="url(#${uid}wall)"/>`
    + `<rect x="120" y="44" width="16" height="36" fill="${darken(i.hero, 0.2)}"/>`
    + `<path d="M30 104 L96 44 L162 104Z" fill="${i.hero}"/><path d="M30 104 L96 44 L162 104" fill="none" stroke="${i.heroDark}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<path d="M84 184 V146 A12 12 0 0 1 108 146 V184Z" fill="${i.c1}"/><circle cx="102" cy="164" r="2.2" fill="${i.light}"/>`
    + `<rect x="56" y="118" width="22" height="22" rx="3" fill="url(#${uid}win)"/><rect x="56" y="118" width="22" height="22" rx="3" fill="none" stroke="${i.c1}" stroke-width="3"/><path d="M67 118 V140 M56 129 H78" stroke="${i.c1}" stroke-width="2.4"/>`
    + `<rect x="116" y="118" width="22" height="22" rx="3" fill="url(#${uid}win)"/><rect x="116" y="118" width="22" height="22" rx="3" fill="none" stroke="${i.c1}" stroke-width="3"/><path d="M127 118 V140 M116 129 H138" stroke="${i.c1}" stroke-width="2.4"/>`
    + `<path d="${heartPath(86, 70, 20)}" fill="${i.light}" opacity="0.9"/>`
    + `<path d="M128 40 C120 30 136 26 128 14 M136 38 C130 30 144 26 138 16" fill="none" stroke="${i.light}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`
    + stars(97 + v, 4, i.light, { x: 6, y: 6, w: 70, h: 50 }, 7);
}

function paw(i: Ink, uid: string, v: number): string {
  return `<defs>${lin(`${uid}paw`, lighten(i.c1, 0.1), darken(i.c1, 0.15))}</defs>`
    + `<circle cx="100" cy="100" r="88" fill="${i.c2Light}" opacity="0.5"/>`
    + pawPrint(36, 170, 22, -25, i.c1, 0.35) + pawPrint(58, 132, 24, -15, i.c1, 0.5) + pawPrint(160, 40, 20, 30, i.c1, 0.4)
    + `<g transform="translate(102 98)">${pawPrint(0, 0, 70, -8, `url(#${uid}paw)`)}</g>`
    // bone
    + `<g transform="rotate(-28 150 160)"><rect x="126" y="153" width="48" height="14" rx="5" fill="${i.light}"/><circle cx="126" cy="154" r="8" fill="${i.light}"/><circle cx="126" cy="166" r="8" fill="${i.light}"/><circle cx="174" cy="154" r="8" fill="${i.light}"/><circle cx="174" cy="166" r="8" fill="${i.light}"/></g>`
    // ball
    + `<circle cx="40" cy="50" r="18" fill="${i.hero}"/><path d="M24 44 C34 52 46 52 56 44 M26 58 C36 50 46 50 56 58" fill="none" stroke="${i.light}" stroke-width="2.4" opacity="0.8"/>`
    + `<path d="${heartPath(150, 82, 22)}" fill="${i.hero}" opacity="0.85"/>`
    + stars(101 + v, 4, i.light, { x: 100, y: 6, w: 90, h: 40 }, 6);
}

function dumbbell(i: Ink, uid: string, v: number): string {
  return `<defs>${lin(`${uid}plate`, lighten(i.c1, 0.15), darken(i.c1, 0.2))}${lin(`${uid}bottle`, lighten(i.c2, 0.3), i.c2)}</defs>`
    + `<circle cx="100" cy="100" r="88" fill="${i.light}" opacity="0.1"/>`
    + `<path d="M8 92 H54 L64 70 L78 120 L92 50 L106 132 L118 92 H192" fill="none" stroke="${i.hero}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`
    + `<g transform="rotate(-24 100 128)">`
    + `<rect x="46" y="122" width="108" height="12" rx="5" fill="${darken(i.soft, 0.35)}"/>`
    + `<rect x="30" y="98" width="20" height="60" rx="7" fill="url(#${uid}plate)"/><rect x="14" y="106" width="18" height="44" rx="6" fill="url(#${uid}plate)"/>`
    + `<rect x="150" y="98" width="20" height="60" rx="7" fill="url(#${uid}plate)"/><rect x="168" y="106" width="18" height="44" rx="6" fill="url(#${uid}plate)"/>`
    + `<rect x="34" y="104" width="4" height="48" rx="2" fill="${i.light}" opacity="0.3"/><rect x="154" y="104" width="4" height="48" rx="2" fill="${i.light}" opacity="0.3"/></g>`
    + `<rect x="148" y="20" width="30" height="56" rx="10" fill="url(#${uid}bottle)"/><rect x="155" y="10" width="16" height="12" rx="3" fill="${i.hero}"/>`
    + `<rect x="148" y="40" width="30" height="14" fill="${i.light}" opacity="0.55"/><rect x="153" y="26" width="5" height="40" rx="2.5" fill="${i.light}" opacity="0.35"/>`
    + stars(113 + v, 5, i.light, { x: 10, y: 10, w: 120, h: 40 }, 7);
}

function sparkle(i: Ink, uid: string, v: number): string {
  return `<defs>${lin(`${uid}spk`, i.heroLight, i.hero)}${rad(`${uid}sglow`, i.heroLight, i.heroLight)}</defs>`
    + `<circle cx="100" cy="100" r="96" fill="url(#${uid}sglow)" opacity="0.5"/>`
    + `<ellipse cx="100" cy="104" rx="88" ry="30" fill="none" stroke="${i.light}" stroke-width="1.6" opacity="0.5" transform="rotate(-18 100 104)"/>`
    + `<circle cx="100" cy="100" r="58" fill="none" stroke="${i.c2}" stroke-width="1.5" stroke-dasharray="2 6" opacity="0.8"/>`
    + `<path d="${sparklePath(100, 98, 70)}" fill="url(#${uid}spk)"/>`
    + `<path d="${sparklePath(100, 98, 30)}" fill="${i.light}" opacity="0.55"/>`
    + `<path d="${sparklePath(158, 42, 20)}" fill="${i.c2}"/><path d="${sparklePath(42, 160, 16)}" fill="${i.c1}" opacity="0.85"/>`
    + `<path d="${sparklePath(160, 156, 12)}" fill="${i.heroLight}"/>`
    + `<circle cx="20" cy="88" r="5" fill="${i.c2}"/><circle cx="176" cy="104" r="4" fill="${i.hero}"/>`
    + stars(127 + v, 8, i.light, { x: 6, y: 6, w: 188, h: 188 }, 6);
}

const DRAW: Record<Motif, (i: Ink, uid: string, v: number) => string> = {
  moon, sun, leaf, coin, heart, bolt, book, chart, home, paw, dumbbell, sparkle,
};

/** Raw illustration markup in a 200×200 coordinate box (gradient ids are prefixed with `uid`). */
export function motifMarkup(motif: Motif, palette: Palette, uid: string, variant = 0): string {
  const draw = DRAW[motif] ?? sparkle;
  return draw(inks(palette), uid, variant);
}

/** Illustration placed with its top-left at (x, y) and the given size. */
export function placeMotif(motif: Motif, palette: Palette, uid: string, x: number, y: number, size: number, variant = 0, opacity = 1): string {
  const op = opacity < 1 ? ` opacity="${n(opacity)}"` : '';
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${(size / 200).toFixed(4)})"${op}>${motifMarkup(motif, palette, uid, variant)}</g>`;
}

/** Stand-alone SVG of the illustration (used to embed it in the PDF through svg-to-pdfkit). */
export function motifSvg(motif: Motif, palette: Palette, uid: string, variant = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${motifMarkup(motif, palette, uid, variant)}</svg>`;
}
