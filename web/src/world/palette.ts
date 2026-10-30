// Colour helpers + the fixed palette of the pixel world.
import type { DeptId } from '../../../shared/types';

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function hexToRgb(hex: string): RGB {
  const hit = cache.get(hex);
  if (hit) return hit;
  let h = (hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const rgb: RGB = Number.isFinite(n) && h.length >= 6 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 136, 160];
  cache.set(hex, rgb);
  return rgb;
}

export function rgbToHex(c: RGB): string {
  const v = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${v(c[0])}${v(c[1])}${v(c[2])}`;
}

export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** amt > 0 lightens towards white, amt < 0 darkens towards a cool near-black (keeps pixel art lively). */
export function shade(hex: string, amt: number): string {
  return amt >= 0 ? mix(hex, '#ffffff', amt) : mix(hex, '#1c1430', -amt);
}

export function rgba(hex: string, a: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Used when a department arrives without a colour (or for the minimap fallback). */
export const DEPT_FALLBACK_COLORS: Record<DeptId, string> = {
  direction: '#7c6cf0',
  recherche: '#3b82f6',
  studio: '#f59e0b',
  creation: '#8b5cf6',
  growth: '#ec4899',
  boutique: '#ef4444',
  support: '#f97316',
  analyse: '#14b8a6',
  finance: '#65a30d',
  rh: '#f472b6',
  partenariats: '#06b6d4',
  video: '#dc2626',
  crm: '#10b981',
};

export function deptColor(id: string, color: string | undefined): string {
  if (color && /^#?[0-9a-f]{3,8}$/i.test(color.trim())) return color.startsWith('#') ? color : `#${color}`;
  return (DEPT_FALLBACK_COLORS as Record<string, string>)[id] ?? '#8b8fb8';
}

export const PAL = {
  outline: '#2a1f3d',
  grass: '#6cc24a',
  grassLight: '#8ad65a',
  grassDark: '#4f9e38',
  grassDeep: '#3d8130',
  grassLip: '#57a83c',
  dirt: '#9a6438',
  dirtLight: '#b47a47',
  dirtDark: '#764a2a',
  dirtDeep: '#5a3620',
  rock: '#8d8794',
  rockLight: '#aaa4b0',
  root: '#5b3a22',
  vine: '#3f8a3a',
  wood: '#b9814c',
  woodLight: '#d39a5f',
  woodDark: '#8a5a33',
  woodDeep: '#64401f',
  rope: '#e2c58f',
  metal: '#5b6170',
  metalDark: '#3c404c',
  white: '#f7f4ee',
  paper: '#fffdf6',
  screenOff: '#1d2540',
  screenOn: '#8fe3ff',
  leaf: '#52b043',
  leafLight: '#7fd35a',
  leafDark: '#357f34',
  pine: '#2f7a4c',
  pineDark: '#1f5a39',
  trunk: '#7a4b2a',
  trunkDark: '#57331c',
  pot: '#d0704a',
  potDark: '#a9533a',
  plazaStone: '#f4dce8',
  plazaStoneAlt: '#ead0e0',
  plazaRing: '#e98bc0',
  plazaRingDark: '#c55a9c',
  cafeA: '#bfeee0',
  cafeB: '#f8fffb',
  fountainDark: '#3b2a78',
  fountainMid: '#5a43a8',
  fountainRim: '#f2e6ff',
  crystal: '#f08ad8',
  crystalLight: '#ffd2f4',
  parasol: '#e5484d',
  lampGlow: '#ffd27a',
} as const;
