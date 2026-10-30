import type { DesignSpec } from '../shared.js';

export type Palette = DesignSpec['palette'];

type Rgb = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

function toRgb(hex: string): Rgb {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex([r, g, b]: Rgb): string {
  const c = (x: number) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Normalises any colour input to #rrggbb, falling back when it is not a hex colour. */
export function safeColor(value: unknown, fallback: string): string {
  return isHex(value) ? toHex(toRgb(value)) : toHex(toRgb(fallback));
}

/** Linear blend: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(safeColor(a, '#888888'));
  const y = toRgb(safeColor(b, '#888888'));
  const k = Math.min(1, Math.max(0, t));
  return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
}

export const lighten = (c: string, t: number): string => mix(c, '#ffffff', t);
export const darken = (c: string, t: number): string => mix(c, '#000000', t);

/** WCAG relative luminance 0..1. */
export function luminance(c: string): number {
  const ch = toRgb(safeColor(c, '#888888')).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const isDark = (c: string): boolean => luminance(c) < 0.28;

/** Best readable text colour on `bg`: light or the given dark ink. */
export function readableOn(bg: string, ink = '#1b1b24', light = '#ffffff'): string {
  return contrast(bg, light) >= contrast(bg, ink) ? light : ink;
}

/** Darkens/lightens `fg` until it reaches `min` contrast against `bg` (for text in brand colours). */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  let c = safeColor(fg, '#333333');
  const towardDark = luminance(bg) > 0.4;
  for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = towardDark ? darken(c, 0.15) : lighten(c, 0.15);
  return c;
}

/** rgba() string for HTML/CSS. */
export function rgba(c: string, alpha: number): string {
  const [r, g, b] = toRgb(safeColor(c, '#000000'));
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** Palette with every colour guaranteed to be a valid #rrggbb (defensive: specs can come from an LLM). */
export function safePalette(p: Partial<Palette> | null | undefined): Palette {
  return {
    bg: safeColor(p?.bg, '#1f2a4d'),
    primary: safeColor(p?.primary, '#2e4272'),
    secondary: safeColor(p?.secondary, '#8fa8d8'),
    accent: safeColor(p?.accent, '#f6b48f'),
    ink: safeColor(p?.ink, '#1b2238'),
    soft: safeColor(p?.soft, '#eef2fb'),
  };
}
