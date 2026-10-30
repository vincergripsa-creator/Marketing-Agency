// Sky, sun/moon, stars, pixel mountains, treeline and drifting pixel clouds. Time of day follows
// the snapshot tick (morning → day → sunset → night) and animates smoothly between ticks.
import { TICKS_PER_DAY } from '../../../shared/types';
import { hexToRgb, lerpRgb, mix, rgbToHex, type RGB } from './palette';
import { hash2, makeCanvas } from './pixel';

interface Key { h: number; top: string; mid: string; hor: string; hazeTop: string; hazeBot: string; tint: string; tintA: number; night: number; sunset: number }

const KEYS: Key[] = [
  { h: 0, top: '#0a0f2e', mid: '#141b45', hor: '#28285e', hazeTop: '#1b2150', hazeBot: '#121838', tint: '#101a4a', tintA: 0.52, night: 1, sunset: 0 },
  { h: 5, top: '#141a48', mid: '#2c2a62', hor: '#5a3f78', hazeTop: '#2c2c5e', hazeBot: '#1e2248', tint: '#2a2060', tintA: 0.42, night: 0.85, sunset: 0.2 },
  { h: 6.5, top: '#5b7fd0', mid: '#a98bc8', hor: '#ffbfa0', hazeTop: '#ffe2d2', hazeBot: '#f4cfc8', tint: '#ff9a7a', tintA: 0.12, night: 0.15, sunset: 0.7 },
  { h: 8, top: '#4a95e8', mid: '#7cb9f2', hor: '#cfeaff', hazeTop: '#eaf6ff', hazeBot: '#d6ebfb', tint: '#ffffff', tintA: 0, night: 0, sunset: 0 },
  { h: 16.5, top: '#4a90e2', mid: '#79b3ee', hor: '#d8ecfb', hazeTop: '#edf5fc', hazeBot: '#d7e7f5', tint: '#ffffff', tintA: 0, night: 0, sunset: 0 },
  { h: 18.6, top: '#4d63b8', mid: '#c08ab6', hor: '#ffbe85', hazeTop: '#ffe1c4', hazeBot: '#f6c7b0', tint: '#ff9a50', tintA: 0.15, night: 0.05, sunset: 0.8 },
  { h: 19.8, top: '#2f3486', mid: '#8a4f94', hor: '#ff8a5c', hazeTop: '#f9b59a', hazeBot: '#d99a96', tint: '#ff7040', tintA: 0.24, night: 0.3, sunset: 1 },
  { h: 21, top: '#141a4e', mid: '#2b2560', hor: '#563f78', hazeTop: '#2d2b5e', hazeBot: '#1e2147', tint: '#3a2c80', tintA: 0.42, night: 0.8, sunset: 0.3 },
  { h: 22.5, top: '#0a0f2e', mid: '#141b45', hor: '#28285e', hazeTop: '#1b2150', hazeBot: '#121838', tint: '#101a4a', tintA: 0.52, night: 1, sunset: 0 },
  { h: 24, top: '#0a0f2e', mid: '#141b45', hor: '#28285e', hazeTop: '#1b2150', hazeBot: '#121838', tint: '#101a4a', tintA: 0.52, night: 1, sunset: 0 },
];

export interface SkyColors {
  top: string; mid: string; hor: string; hazeTop: string; hazeBot: string;
  tint: string; tintA: number; night: number; sunset: number;
}

export function skyAt(hour: number): SkyColors {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h || 1)));
  const c = (x: string, y: string) => rgbToHex(lerpRgb(hexToRgb(x), hexToRgb(y), t));
  return {
    top: c(a.top, b.top), mid: c(a.mid, b.mid), hor: c(a.hor, b.hor), hazeTop: c(a.hazeTop, b.hazeTop), hazeBot: c(a.hazeBot, b.hazeBot),
    tint: c(a.tint, b.tint), tintA: a.tintA + (b.tintA - a.tintA) * t, night: a.night + (b.night - a.night) * t, sunset: a.sunset + (b.sunset - a.sunset) * t,
  };
}

const TICK_HOURS = [7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18.6, 20.2];

export function hourForTick(tick: number): number {
  const i = Math.max(0, Math.min(TICK_HOURS.length - 1, Math.floor(((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY)));
  return TICK_HOURS[i] ?? 12;
}

// ───────────── procedural layers ─────────────

const STRIP_W = 320;
const STRIP_H = 64;

function periodic(x: number, seed: number, amps: [number, number][]): number {
  let v = 0;
  amps.forEach(([freq, amp], i) => {
    v += Math.sin((x / STRIP_W) * Math.PI * 2 * freq + seed * (i + 1) * 1.7) * amp;
  });
  return v;
}

function mountainStrip(seed: number, base: number, amps: [number, number][], body: string, shadow: string, snow: string | null, snowLine: number): HTMLCanvasElement {
  const { c, g } = makeCanvas(STRIP_W, STRIP_H);
  const hs: number[] = [];
  for (let x = 0; x < STRIP_W; x++) hs.push(Math.round(base + periodic(x, seed, amps) + Math.abs(periodic(x, seed + 3, [[9, 4]]))));
  for (let x = 0; x < STRIP_W; x++) {
    const h = Math.max(2, Math.min(STRIP_H - 2, hs[x]));
    const next = hs[(x + 1) % STRIP_W];
    const top = STRIP_H - h;
    g.fillStyle = body;
    g.fillRect(x, top, 1, h);
    if (next < hs[x]) {
      g.fillStyle = shadow;
      g.fillRect(x, top + 1, 1, h - 1);
    }
    if (snow && h > snowLine) {
      g.fillStyle = snow;
      g.fillRect(x, top, 1, Math.min(4, h - snowLine + 1));
    }
  }
  return c;
}

function treeStrip(seed: number, tree: string, treeDark: string, meadow: string, meadowLight: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(STRIP_W, 24);
  g.fillStyle = meadow;
  g.fillRect(0, 17, STRIP_W, 7);
  g.fillStyle = meadowLight;
  g.fillRect(0, 17, STRIP_W, 1);
  let x = 0;
  let i = 0;
  while (x < STRIP_W) {
    const h = 6 + Math.floor(hash2(i, 1, seed) * 8);
    for (let y = 0; y < h; y++) {
      const w = Math.max(1, Math.round(((y + 1) / h) * (2 + h * 0.28)));
      g.fillStyle = tree;
      g.fillRect(x - w + 2, 17 - h + y, w, 1);
      g.fillStyle = treeDark;
      g.fillRect(x + 2, 17 - h + y, w, 1);
    }
    x += 3 + Math.floor(hash2(i, 2, seed) * 4);
    i++;
  }
  return c;
}

const CLOUD_SHAPES: [number, number, number][][] = [
  [[8, 9, 6], [16, 6, 8], [25, 8, 6], [32, 10, 4]],
  [[7, 8, 5], [14, 5, 7], [22, 7, 6]],
  [[6, 9, 5], [13, 7, 6], [21, 5, 7], [30, 7, 6], [38, 9, 4]],
  [[6, 7, 4], [12, 5, 5], [18, 7, 4]],
  [[9, 9, 6], [18, 6, 8], [28, 7, 7], [37, 9, 5], [45, 10, 3]],
];

function cloudSprite(shape: [number, number, number][], body: string, shade: string, light: string): HTMLCanvasElement {
  const w = Math.max(...shape.map(([x, , r]) => x + r)) + 2;
  const h = 15;
  const { c, g } = makeCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      let topDist = 99;
      for (const [cx, cy, r] of shape) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) {
          inside = true;
          topDist = Math.min(topDist, dy + r);
        }
      }
      if (!inside || y > 12) continue;
      g.fillStyle = y >= 10 ? shade : topDist < 2 ? light : body;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

interface CloudInst { x: number; y: number; v: number; scale: number; speed: number; par: number; front: boolean }
interface Star { x: number; y: number; s: number; tw: number; ph: number }

export interface SkyView {
  w: number; h: number; // css px
  camX: number; camY: number; zoom: number;
  cx0: number; cy0: number; // world centre (for parallax)
}

export class Scenery {
  hour = 12;
  private targetHour = 12;
  private tick = 4;
  private evening = 0;
  private initialized = false;
  private cacheKey = '';
  private far: HTMLCanvasElement | null = null;
  private near: HTMLCanvasElement | null = null;
  private trees: HTMLCanvasElement | null = null;
  private clouds: HTMLCanvasElement[] = [];
  private cloudInst: CloudInst[] = [];
  private stars: Star[] = [];
  colors: SkyColors = skyAt(12);

  constructor() {
    for (let i = 0; i < 16; i++) {
      const front = i >= 13;
      this.cloudInst.push({
        x: Math.random(),
        y: front ? 0.82 + Math.random() * 0.14 : i < 10 ? 0.06 + Math.random() * 0.36 : 0.62 + Math.random() * 0.22,
        v: Math.floor(Math.random() * CLOUD_SHAPES.length),
        scale: front ? 4 : i < 10 ? 2 + Math.floor(Math.random() * 2) : 3,
        speed: 4 + Math.random() * 7,
        par: front ? 0.55 : i < 10 ? 0.04 + Math.random() * 0.06 : 0.16,
        front,
      });
    }
    for (let i = 0; i < 150; i++) this.stars.push({ x: Math.random(), y: Math.random() * 0.56, s: Math.random() < 0.15 ? 2 : 1, tw: 0.6 + Math.random() * 2.2, ph: Math.random() * 6.28 });
  }

  setClock(tick: number): void {
    this.tick = tick;
    this.targetHour = hourForTick(tick);
    if (tick % TICKS_PER_DAY !== TICKS_PER_DAY - 1) this.evening = 0;
    if (!this.initialized) {
      this.hour = this.targetHour;
      this.initialized = true;
    }
  }

  update(dt: number): void {
    let target = this.targetHour;
    if (this.tick % TICKS_PER_DAY === TICKS_PER_DAY - 1) {
      // evening retro: the sky slowly turns to night while the retro runs
      if (Math.abs(this.hour - target - this.evening) < 0.05) this.evening = Math.min(3.3, this.evening + dt * 0.14);
      target += this.evening;
    }
    const fwd = (((target - this.hour) % 24) + 24) % 24;
    if (fwd > 14) this.hour -= Math.min(24 - fwd, dt * 3);
    else if (fwd > 0.001) this.hour += Math.min(fwd, dt * Math.max(0.9, fwd / 2.2));
    this.hour = ((this.hour % 24) + 24) % 24;
    this.colors = skyAt(this.hour);
  }

  private ensure(): void {
    const k = `${Math.round(this.hour * 12)}`;
    if (k === this.cacheKey && this.far) return;
    this.cacheKey = k;
    const c = this.colors;
    const n = c.night;
    const s = c.sunset;
    const tone = (day: string, sunset: string, night: string) => mix(mix(day, sunset, s * 0.85), night, n);
    this.far = mountainStrip(3, 26, [[2, 9], [5, 6], [11, 3]], tone('#aaa6e8', '#b48bc6', '#2a2c5a'), tone('#9893d8', '#9c78b4', '#23254e'), tone('#ffffff', '#ffe6f0', '#8d93c9'), 33);
    this.near = mountainStrip(7, 16, [[3, 7], [7, 4], [13, 2]], tone('#7f95dc', '#8c6fae', '#22264e'), tone('#6b80c9', '#7a5f9a', '#1c2044'), null, 99);
    this.trees = treeStrip(11, tone('#3f8f5c', '#4a6a52', '#16302a'), tone('#2f7448', '#3b5544', '#10251f'), tone('#8ed36f', '#a0a860', '#1f3d2c'), tone('#b4ea8f', '#c9c07a', '#2b4f3a'));
    const body = tone('#ffffff', '#ffe3d6', '#4a5288');
    const sh = tone('#d9e6f6', '#f0b4a8', '#363d6e');
    const li = tone('#ffffff', '#fff4ec', '#5d66a0');
    this.clouds = CLOUD_SHAPES.map((sp) => cloudSprite(sp, body, sh, li));
  }

  horizonY(v: SkyView): number {
    const par = (v.camY - v.cy0) * v.zoom * 0.07;
    return Math.max(v.h * 0.28, Math.min(v.h * 0.78, v.h * 0.55 - par));
  }

  /** Background (call with globalCompositeOperation = 'destination-over', nearest layer first). */
  drawBackground(g: CanvasRenderingContext2D, v: SkyView, t: number, dpr: number): void {
    this.ensure();
    const c = this.colors;
    const W = v.w;
    const H = v.h;
    const hy = Math.round(this.horizonY(v));
    const pix = Math.max(2, Math.round(2 * dpr)) / dpr; // css px per art pixel
    const lowClouds = this.cloudInst.filter((ci) => !ci.front && ci.y > 0.5);
    const highClouds = this.cloudInst.filter((ci) => !ci.front && ci.y <= 0.5);

    // low clouds over the haze
    for (const ci of lowClouds) this.drawCloud(g, ci, v, t, pix, hy + (ci.y - 0.5) * H * 0.9);
    // treeline + mountains
    const strip = (img: HTMLCanvasElement | null, par: number, baseY: number) => {
      if (!img) return;
      const sw = img.width * pix;
      const sh = img.height * pix;
      let off = (-(v.camX - v.cx0) * v.zoom * par) % sw;
      if (off > 0) off -= sw;
      for (let x = off; x < W; x += sw) g.drawImage(img, Math.round(x), Math.round(baseY - sh), Math.ceil(sw), Math.ceil(sh));
    };
    strip(this.trees, 0.1, hy + 8 * pix);
    strip(this.near, 0.07, hy + 2 * pix);
    strip(this.far, 0.045, hy);
    // haze below the horizon
    const haze = g.createLinearGradient(0, hy, 0, H);
    haze.addColorStop(0, c.hazeTop);
    haze.addColorStop(1, c.hazeBot);
    g.fillStyle = haze;
    g.fillRect(0, hy, W, H - hy);
    // high clouds
    for (const ci of highClouds) this.drawCloud(g, ci, v, t, pix, ci.y * hy * 1.3);
    // sun / moon
    this.drawSunMoon(g, W, hy, pix, t);
    // stars
    if (c.night > 0.05) {
      for (const st of this.stars) {
        const y = st.y * hy;
        if (y > hy - 6) continue;
        const a = c.night * (0.55 + 0.45 * Math.sin(t * st.tw + st.ph));
        g.fillStyle = `rgba(255,255,240,${a.toFixed(3)})`;
        g.fillRect(Math.round(st.x * W), Math.round(y), st.s * pix * 0.75, st.s * pix * 0.75);
      }
    }
    // sky gradient
    const sky = g.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, c.top);
    sky.addColorStop(0.55, c.mid);
    sky.addColorStop(1, c.hor);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, hy + 1);
  }

  /** Clouds passing in front of the islands (normal compositing, after the world). */
  drawFront(g: CanvasRenderingContext2D, v: SkyView, t: number, dpr: number): void {
    this.ensure();
    const pix = Math.max(2, Math.round(2 * dpr)) / dpr;
    g.globalAlpha = 0.82;
    for (const ci of this.cloudInst) if (ci.front) this.drawCloud(g, ci, v, t, pix, ci.y * v.h);
    g.globalAlpha = 1;
  }

  private drawCloud(g: CanvasRenderingContext2D, ci: CloudInst, v: SkyView, t: number, pix: number, y: number): void {
    const img = this.clouds[ci.v];
    if (!img) return;
    const s = pix * ci.scale * 0.5;
    const w = img.width * s;
    const wrap = v.w + w + 200;
    let x = (ci.x * wrap + t * ci.speed - (v.camX - v.cx0) * v.zoom * ci.par) % wrap;
    if (x < 0) x += wrap;
    g.drawImage(img, Math.round(x - w - 100), Math.round(y), Math.ceil(w), Math.ceil(img.height * s));
  }

  private drawSunMoon(g: CanvasRenderingContext2D, W: number, hy: number, pix: number, t: number): void {
    const h = this.hour;
    const arc = (p: number) => ({ x: W * (0.1 + 0.8 * p), y: hy - Math.sin(p * Math.PI) * hy * 0.72 + 14 });
    if (h > 5.6 && h < 20.6) {
      const p = (h - 5.6) / 15;
      const { x, y } = arc(p);
      const sunset = this.colors.sunset;
      const core = mix('#fff6b8', '#ffb36b', sunset);
      const ring = mix('#ffe27a', '#ff8a5c', sunset);
      const r = 7 * pix;
      const glow = g.createRadialGradient(x, y, r * 0.5, x, y, r * 4.2);
      glow.addColorStop(0, `rgba(255,236,170,${(0.55 - sunset * 0.1).toFixed(2)})`);
      glow.addColorStop(1, 'rgba(255,236,170,0)');
      for (let yy = -7; yy <= 7; yy++) {
        for (let xx = -7; xx <= 7; xx++) {
          const d2 = xx * xx + yy * yy;
          if (d2 > 50) continue;
          g.fillStyle = d2 > 30 ? ring : xx + yy < -5 ? '#fffbe0' : core;
          g.fillRect(Math.round(x + xx * pix), Math.round(y + yy * pix), Math.ceil(pix), Math.ceil(pix));
        }
      }
      // twinkling pixel rays
      g.fillStyle = ring;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 0.15;
        const d = (10 + (i % 2) * 2 + Math.sin(t * 2 + i) * 0.8) * pix;
        g.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), Math.ceil(pix), Math.ceil(pix));
      }
      g.fillStyle = glow;
      g.fillRect(x - r * 4.2, y - r * 4.2, r * 8.4, r * 8.4);
    }
    if (h > 19.2 || h < 6.6) {
      const p = ((h - 19.2 + 24) % 24) / 11.4;
      const { x, y } = arc(Math.min(1, p));
      const a = Math.min(1, this.colors.night * 1.4);
      g.globalAlpha = a;
      // crescent: inside the moon disc, outside a second disc shifted to the right
      for (let yy = -6; yy <= 6; yy++) {
        for (let xx = -6; xx <= 6; xx++) {
          if (xx * xx + yy * yy > 38) continue;
          const bx = xx - 3;
          const by = yy + 1;
          if (bx * bx + by * by < 26) continue;
          g.fillStyle = xx < -3 && yy > 0 ? '#d9d5bc' : '#f4f1d8';
          g.fillRect(Math.round(x + xx * pix), Math.round(y + yy * pix), Math.ceil(pix), Math.ceil(pix));
        }
      }
      const glow = g.createRadialGradient(x, y, 4 * pix, x, y, 20 * pix);
      glow.addColorStop(0, `rgba(220,225,255,${(0.25 * a).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(220,225,255,0)');
      g.fillStyle = glow;
      g.fillRect(x - 20 * pix, y - 20 * pix, 40 * pix, 40 * pix);
      g.globalAlpha = 1;
    }
  }
}

export function rgbOf(hex: string): RGB {
  return hexToRgb(hex);
}
