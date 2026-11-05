/**
 * The page wears the cover's art direction (design plan D200): the guide's `design.style` sets how cards, buttons and
 * grounds look, and draws the decor behind the hero, in pure CSS and inline SVG from the guide's own inks. Decor is
 * placed from the product's seed, never drawn at random.
 */
import type { ArtStyle } from '../../shared.js';
import { mix, rgba } from '../color.js';
import { decoRng } from '../text.js';
import { BP } from './css.js';
import type { Tokens } from './theme.js';

const n1 = (v: number): string => String(Math.round(v * 10) / 10);

/** An SVG as a CSS background, percent-encoded so that `url(` holds no quote and no bracket. */
export function svgUrl(svg: string): string {
  return `url(data:image/svg+xml,${encodeURIComponent(svg).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27')})`;
}

const NS = 'xmlns="http://www.w3.org/2000/svg"';

/** Paper grain: one tiny turbulence tile, the same on every page of the style. */
const grain = (alpha: number): string => svgUrl(`<svg ${NS} width="160" height="160"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${alpha} 0"/></filter><rect width="160" height="160" filter="url(#g)"/></svg>`);

/** Halftone dots of one ink. */
const dots = (ink: string, size: number, r: number): string => `radial-gradient(circle at center, ${ink} ${r}px, transparent ${r + 0.6}px) 0 0/${size}px ${size}px`;

/** A torn edge, as a mask strip: jagged along its top, the same tear for a given seed. */
function tornEdge(seed: number, fill: string): string {
  const rnd = decoRng(seed);
  let d = 'M0 24';
  for (let x = 0; x <= 400; x += 8) d += `L${x} ${n1(6 + rnd() * 12)}`;
  d += 'L400 24Z';
  return svgUrl(`<svg ${NS} viewBox="0 0 400 24" preserveAspectRatio="none"><path d="${d}" fill="${fill}"/></svg>`);
}

/** A wobbly underline, as a background. */
const squiggle = (ink: string): string => svgUrl(`<svg ${NS} viewBox="0 0 120 10"><path d="M2 6c10-6 18 6 28 0s18 6 28 0 18 6 28 0 18 6 28 0" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/></svg>`);

interface Skin { vars: string; css: (t: Tokens) => string }

const SKINS: Record<ArtStyle, Skin> = {
  bauhaus: {
    vars: '--r:0;--r-btn:0;--bw:0px;--bc:transparent;--sh:none;--card-bg:var(--card);--bw-btn:0px;--bc-btn:transparent;--sh-btn:none;--lift-x:0px;--lift-y:-2px;--sec-alt:var(--tint)',
    css: () => `.card{border-top:6px solid var(--a)}
.kicker::before{content:"";width:12px;height:12px;border-radius:50%;background:var(--b);flex:none}
.h2{letter-spacing:-.03em}
.buy{border-radius:0}
.alt{background:var(--sec-alt)}
.divider{height:22px;background:linear-gradient(90deg,var(--a) 0 33.3%,var(--b) 33.3% 66.6%,var(--c) 66.6%)}`,
  },
  typo: {
    vars: '--r:0;--r-btn:0;--bw:0px;--bc:transparent;--sh:none;--card-bg:transparent;--bw-btn:0px;--bc-btn:transparent;--sh-btn:none;--lift-x:0px;--lift-y:-2px;--sec-alt:var(--tint-a)',
    css: () => `.hero h1,.hero h1.long,.hero h1.xlong{line-height:.94;letter-spacing:-.05em}
.hero h1{font-size:min(clamp(34px,9.6vw,56px),var(--fit))}.hero h1.long{font-size:min(clamp(32px,8.6vw,50px),var(--fit))}.hero h1.xlong{font-size:min(clamp(28px,7.2vw,42px),var(--fit))}
@media (min-width:${BP.lg}px){.hero h1{font-size:min(clamp(60px,6.6vw,104px),var(--fit))}.hero h1.long{font-size:min(clamp(50px,5.2vw,78px),var(--fit))}.hero h1.xlong{font-size:min(clamp(40px,4vw,58px),var(--fit))}}
.h2{font-size:clamp(34px,7vw,84px);line-height:.95;letter-spacing:-.045em}
.card{border-top:2px solid var(--ink);padding-top:18px}
.kicker{color:var(--ink);letter-spacing:.22em}
.alt{background:var(--sec-alt)}
.buy{text-transform:uppercase;letter-spacing:.08em;font-size:15px}
.divider{height:2px;background:var(--ink);margin:0 auto;max-width:1096px}
.giant{position:absolute;inset:auto 0 -4% 0;font:700 min(46vw,560px)/0.8 var(--display);letter-spacing:-.07em;color:var(--tint-a);text-align:center;white-space:nowrap;overflow:hidden;pointer-events:none;user-select:none}`,
  },
  grille: {
    vars: '--r:0;--r-btn:0;--bw:1px;--bc:var(--ink);--sh:none;--card-bg:var(--paper);--bw-btn:0px;--bc-btn:transparent;--sh-btn:none;--lift-x:0px;--lift-y:0px;--sec-alt:var(--paper)',
    css: (t) => `body{counter-reset:sec}
section.numbered .h2::before{counter-increment:sec;content:counter(sec,decimal-leading-zero);display:block;font:700 clamp(54px,10vw,110px)/.82 var(--display);letter-spacing:-.05em;color:var(--b-text);margin-bottom:14px}
.kicker{letter-spacing:.18em;color:var(--ink)}
.kicker::before{content:"";width:28px;height:2px;background:var(--b-text);flex:none}
.buy:hover{background:${mix(t.btn, t.paper, 0.12)}}
.alt{background-image:linear-gradient(var(--line) 1px,transparent 1px);background-size:100% 40px}
section+section{border-top:1px solid var(--ink)}
.divider{display:none}`,
  },
  pop: {
    vars: '--r:18px;--r-btn:14px;--bw:3px;--bc:var(--ink);--sh:6px 6px 0 var(--ink);--card-bg:var(--card);--bw-btn:3px;--bc-btn:var(--ink);--sh-btn:4px 4px 0 var(--ink);--lift-x:-2px;--lift-y:-2px;--sec-alt:var(--tint)',
    css: () => `.buy:hover{box-shadow:6px 6px 0 var(--ink)}
.buy:active{box-shadow:1px 1px 0 var(--ink);transform:translate(3px,3px)}
.pg{border:3px solid var(--ink);box-shadow:6px 6px 0 var(--ink)}
.h2 .hl,h1 .hl{background:linear-gradient(transparent 58%,var(--mark) 58% 92%,transparent 92%);padding:0 .08em}
.kicker{display:inline-flex;background:var(--card);border:2px solid var(--ink);border-radius:999px;padding:6px 12px;color:var(--ink);box-shadow:3px 3px 0 var(--ink)}
.badge-new,.price-cut{border:2px solid var(--ink);box-shadow:2px 2px 0 var(--ink)}
.alt{background:var(--sec-alt)}
.faq details{border-top:3px solid var(--ink)}.faq details:last-of-type{border-bottom:3px solid var(--ink)}
.divider{height:18px;background:linear-gradient(135deg,var(--ink) 25%,transparent 25%) -9px 0/18px 18px,linear-gradient(225deg,var(--ink) 25%,transparent 25%) -9px 0/18px 18px}`,
  },
  trait: {
    vars: '--r:24px;--r-btn:999px;--bw:1.5px;--bc:var(--line-strong);--sh:0 14px 34px -22px var(--shadow-ink);--card-bg:var(--card);--bw-btn:0px;--bc-btn:transparent;--sh-btn:0 10px 24px -12px var(--shadow-ink);--lift-x:0px;--lift-y:-2px;--sec-alt:var(--tint-a)',
    css: (t) => `section{padding-top:72px;padding-bottom:72px}
.h2::after{content:"";display:block;width:120px;height:10px;margin-top:12px;background:${squiggle(t.b)} no-repeat 0 0/120px 10px}
.center .h2::after,.final .h2::after{margin-left:auto;margin-right:auto}
.ico{stroke-width:1.5}
.pg{border-radius:10px}
.alt{background:var(--sec-alt)}
.divider{display:none}
@media (min-width:${BP.md}px){section{padding-top:104px;padding-bottom:104px}}`,
  },
  collage: {
    vars: '--r:3px;--r-btn:4px;--bw:0px;--bc:transparent;--sh:0 1px 2px var(--shadow-soft),0 16px 28px -16px var(--shadow-ink);--card-bg:var(--card);--bw-btn:0px;--bc-btn:transparent;--sh-btn:0 2px 0 var(--shadow-ink),0 10px 20px -10px var(--shadow-ink);--lift-x:0px;--lift-y:-2px;--sec-alt:var(--tint)',
    css: (t) => `body{background-image:${grain(0.07)};background-color:var(--paper)}
.card{position:relative}
.card::before{content:"";position:absolute;top:-10px;left:50%;width:86px;height:22px;margin-left:-43px;background:${rgba(mix(t.c, '#ffffff', 0.35), 0.72)};transform:rotate(-3deg);box-shadow:0 1px 1px var(--shadow-soft)}
.cards>.card:nth-child(2n){transform:rotate(.6deg)}.cards>.card:nth-child(3n){transform:rotate(-.7deg)}
.kicker{display:inline-flex;background:var(--ink);color:var(--paper);padding:6px 10px;transform:rotate(-1.5deg);letter-spacing:.12em}
.alt{background:var(--sec-alt) ${grain(0.08)}}
.alt::before{content:"";position:absolute;left:0;right:0;top:-23px;height:24px;background:${tornEdge(7, t.tint)} 0 0/100% 100%}
.pg{transform:rotate(-.8deg)}
.strip figure:nth-child(2n) .pg{transform:rotate(1deg)}
.divider{display:none}`,
  },
  aura: {
    vars: '--r:26px;--r-btn:999px;--bw:1px;--bc:rgba(255,255,255,.75);--sh:0 24px 60px -30px var(--shadow-ink);--card-bg:var(--glass);--bw-btn:0px;--bc-btn:transparent;--sh-btn:0 14px 34px -14px var(--shadow-ink);--lift-x:0px;--lift-y:-2px;--sec-alt:transparent',
    css: (t) => `body{background:radial-gradient(60% 40% at 8% 4%,${rgba(t.halo[0], 0.2)},transparent 70%),radial-gradient(50% 36% at 96% 18%,${rgba(t.halo[1], 0.2)},transparent 70%),radial-gradient(60% 40% at 50% 62%,${rgba(t.halo[2], 0.18)},transparent 70%),var(--paper);background-attachment:scroll}
body::after{content:"";position:fixed;inset:0;background-image:${grain(0.05)};pointer-events:none;z-index:40;opacity:.6}
.card{-webkit-backdrop-filter:blur(16px) saturate(1.2);backdrop-filter:blur(16px) saturate(1.2)}
@media (min-width:${BP.lg}px){.hero:not(.e-hero){--col:.43}.hero:not(.e-hero) .h-copy{background:var(--glass);border:1px solid rgba(255,255,255,.75);border-radius:28px;padding:34px 36px;box-shadow:0 30px 70px -36px var(--shadow-ink);-webkit-backdrop-filter:blur(18px) saturate(1.2);backdrop-filter:blur(18px) saturate(1.2)}}
.top{background:${rgba(t.paper, 0.86)};-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.pg{border-radius:12px}
.kicker{display:inline-flex;background:var(--glass);border:1px solid rgba(255,255,255,.8);border-radius:999px;padding:7px 13px}
.divider{display:none}`,
  },
  riso: {
    vars: '--r:0;--r-btn:0;--bw:2px;--bc:var(--a);--sh:5px 5px 0 var(--tint-b);--card-bg:var(--card);--bw-btn:0px;--bc-btn:transparent;--sh-btn:4px 4px 0 var(--b);--lift-x:-1px;--lift-y:-1px;--sec-alt:var(--tint-b)',
    css: (t) => `h1,.h2{text-shadow:.05em .035em 0 ${rgba(t.b, 0.42)}}
.kicker{color:var(--a-text)}
.kicker::before{content:"";width:14px;height:14px;background:${dots(t.b, 4, 1.2)};flex:none}
.alt{background:${dots(rgba(t.b, 0.22), 9, 1.6)},var(--paper)}
.pg{box-shadow:6px 6px 0 ${rgba(t.b, 0.55)}}
.final{background:var(--band)}
.divider{height:14px;background:${dots(t.a, 7, 2.2)}}`,
  },
};

export function skinCss(style: ArtStyle, t: Tokens): string {
  const s = SKINS[style] ?? SKINS.bauhaus;
  return `:root{${s.vars}}\n${s.css(t)}`;
}

// ───────────────────────────── the decor behind a hero ─────────────────────────────

/**
 * What stands behind the product on the first screen, in the guide's style. Decorative, hidden from screen readers.
 * `giant` is the oversized word of `typo`: a number of the title, else its first letter.
 */
export function backdrop(style: ArtStyle, t: Tokens, seed: number, giant: string): string {
  const rnd = decoRng(seed);
  const svg = (body: string, extra = ''): string => `<svg class="bd-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
  switch (style) {
    case 'bauhaus': {
      const x = 52 + rnd() * 10;
      return `<div class="backdrop" aria-hidden="true">${svg(`<circle cx="${n1(x)}" cy="46" r="34" fill="${t.c}"/><path d="M${n1(x - 46)} 98a24 24 0 0 1 48 0z" fill="${t.b}"/><rect x="${n1(78 + rnd() * 8)}" y="8" width="13" height="13" fill="${t.a}"/><path d="M4 18h28" stroke="${t.ink}" stroke-width=".7"/>`, ' preserveAspectRatio="xMidYMid meet"')}</div>`;
    }
    case 'typo':
      return `<div class="backdrop" aria-hidden="true"><div class="giant">${giant}</div></div>`;
    case 'grille': {
      let lines = '';
      for (let k = 1; k < 12; k++) lines += `<path d="M${n1((k * 100) / 12)} 0V100" stroke="${rgba(t.ink, 0.09)}" stroke-width=".25"/>`;
      for (let k = 1; k < 8; k++) lines += `<path d="M0 ${n1((k * 100) / 8)}H100" stroke="${rgba(t.ink, 0.09)}" stroke-width=".25"/>`;
      return `<div class="backdrop" aria-hidden="true">${svg(`${lines}<rect x="${n1(8 + rnd() * 6)}" y="${n1(70 + rnd() * 8)}" width="8.33" height="12.5" fill="${t.b}"/><circle cx="83.3" cy="25" r="16.6" fill="none" stroke="${t.ink}" stroke-width=".35"/>`)}</div>`;
    }
    case 'pop': {
      let burst = '';
      const k = 14;
      for (let i = 0; i < k * 2; i++) {
        const a = (Math.PI * i) / k;
        const r = i % 2 ? 30 : 44;
        burst += `${i ? 'L' : 'M'}${n1(52 + Math.cos(a) * r)} ${n1(50 + Math.sin(a) * r)}`;
      }
      return `<div class="backdrop" aria-hidden="true">${svg(`<path d="${burst}Z" fill="${t.c}" stroke="${t.ink}" stroke-width="1.2" stroke-linejoin="round"/><circle cx="${n1(12 + rnd() * 6)}" cy="${n1(14 + rnd() * 6)}" r="5" fill="${t.b}" stroke="${t.ink}" stroke-width="1"/><circle cx="90" cy="86" r="3.4" fill="${t.a}" stroke="${t.ink}" stroke-width="1"/>`, ' preserveAspectRatio="xMidYMid meet"')}</div>`;
    }
    case 'trait': {
      const blob = (cx: number, cy: number, r: number, fill: string): string => {
        let d = '';
        const pts = 8;
        for (let i = 0; i <= pts; i++) {
          const a = (Math.PI * 2 * i) / pts;
          const rr = r * (0.82 + rnd() * 0.3);
          d += `${i ? 'L' : 'M'}${n1(cx + Math.cos(a) * rr)} ${n1(cy + Math.sin(a) * rr)}`;
        }
        return `<path d="${d}Z" fill="${fill}" stroke="${fill}" stroke-width="9" stroke-linejoin="round"/>`;
      };
      return `<div class="backdrop" aria-hidden="true">${svg(`${blob(56, 48, 30, mix(t.paper, t.a, 0.16))}${blob(24, 78, 14, mix(t.paper, t.b, 0.22))}${blob(86, 22, 9, mix(t.paper, t.c, 0.45))}<path d="M14 22l2 4 4 1-4 1-2 4-2-4-4-1 4-1z" fill="none" stroke="${t.aText}" stroke-width=".7" stroke-linejoin="round"/><path d="M84 70c4-3 8 3 12 0" fill="none" stroke="${t.bText}" stroke-width=".8" stroke-linecap="round"/><circle cx="90" cy="48" r="2.2" fill="none" stroke="${t.aText}" stroke-width=".6"/>`, ' preserveAspectRatio="xMidYMid meet"')}</div>`;
    }
    case 'collage': {
      const torn = (x: number, y: number, w: number, hh: number, rot: number, fill: string): string => {
        let d = `M${x} ${y}`;
        for (let i = 1; i <= 10; i++) d += `L${n1(x + (w * i) / 10)} ${n1(y + (rnd() - 0.5) * 2.4)}`;
        for (let i = 1; i <= 8; i++) d += `L${n1(x + w + (rnd() - 0.5) * 2.4)} ${n1(y + (hh * i) / 8)}`;
        for (let i = 9; i >= 0; i--) d += `L${n1(x + (w * i) / 10)} ${n1(y + hh + (rnd() - 0.5) * 2.4)}`;
        return `<path d="${d}Z" fill="${fill}" transform="rotate(${rot} ${x + w / 2} ${y + hh / 2})"/>`;
      };
      return `<div class="backdrop" aria-hidden="true">${svg(`<g class="paper-shadow">${torn(30, 16, 56, 50, -7, t.c)}${torn(8, 54, 40, 36, 5, t.b)}${torn(70, 66, 24, 22, 12, mix(t.a, t.paper, 0.15))}</g>`, ' preserveAspectRatio="xMidYMid meet"')}</div>`;
    }
    case 'aura':
      return `<div class="backdrop" aria-hidden="true"><i class="halo h1"></i><i class="halo h2"></i><i class="halo h3"></i></div>`;
    case 'riso':
      return `<div class="backdrop" aria-hidden="true"><i class="riso-dots"></i><i class="riso-shape"></i></div>`;
    default:
      return '';
  }
}

/** The backdrop's own CSS, scoped to the scene. */
export function backdropCss(style: ArtStyle, t: Tokens): string {
  const base = '.backdrop{position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden}.bd-svg{position:absolute;inset:0;width:100%;height:100%}';
  switch (style) {
    case 'collage': return `${base}.paper-shadow{filter:drop-shadow(0 1.2px 1.2px ${rgba(t.ink, 0.25)})}`;
    case 'aura': return `${base}.halo{position:absolute;border-radius:50%;filter:blur(28px);opacity:.75}
.halo.h1{left:6%;top:4%;width:62%;height:62%;background:radial-gradient(circle,${rgba(t.halo[0], 0.55)},transparent 68%)}
.halo.h2{right:0;top:24%;width:56%;height:56%;background:radial-gradient(circle,${rgba(t.halo[1], 0.5)},transparent 68%)}
.halo.h3{left:22%;bottom:0;width:58%;height:50%;background:radial-gradient(circle,${rgba(t.halo[2], 0.55)},transparent 68%)}`;
    case 'riso': return `${base}.riso-dots{position:absolute;left:14%;top:6%;width:76%;height:84%;border-radius:50%;background:${dots(t.b, 7, 2)};opacity:.85}
.riso-shape{position:absolute;left:4%;bottom:6%;width:38%;height:30%;background:${rgba(t.a, 0.85)};mix-blend-mode:multiply;transform:rotate(-8deg)}`;
    default: return base;
  }
}
