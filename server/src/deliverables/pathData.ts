/**
 * Path data as short as the same shape can be written, for the files of a run: each segment absolute or relative, whichever
 * is shorter, a line as H or V where it is one, the command letter left out where it repeats, no separator where a sign or a
 * point already is one. Every point lands where it was, to the last decimal written. A renderer adds relative steps in
 * 32-bit floats, so a point may land a hundred-thousandth of a unit off and an edge pixel take another shade of its
 * antialiasing: measured on a year's ads, covers and pages at twice their size, under 0.1 % of pixels, none the eye finds.
 * What this does not read (arcs, exponents, more than four decimals) stays as it came. Only files pay for it: `toSvg`, and
 * every byte budget the art keeps, read the plain form. A sales page is written again at every price and every review: one
 * pass over the characters, and no candidate is written out but the one kept.
 */

const MAX_DECIMALS = 4;
const POW = [1, 10, 100, 1000, 10000] as const;

/** Numbers a command takes, by char code; -1 for what is no command. */
const ARITY = new Int8Array(128).fill(-1);
for (const [c, n] of Object.entries({ M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 })) {
  ARITY[c.charCodeAt(0)] = n;
  ARITY[c.toLowerCase().charCodeAt(0)] = n;
}
const NUMBER = 0;
const LOWER = 32;
const [M, L, H, V, Z, m, l, z] = [...'MLHVZmlz'].map((c) => c.charCodeAt(0)) as [number, number, number, number, number, number, number, number];

/** A path read: char codes of its letters and NUMBER for its numbers, in order, and the numbers as integers at `decimals`. */
function read(d: string): { kinds: number[]; nums: number[]; decimals: number } | null {
  const kinds: number[] = [];
  const mant: number[] = [];
  const decs: number[] = [];
  let decimals = 0;
  const n = d.length;
  for (let i = 0; i < n;) {
    const c = d.charCodeAt(i);
    if (c === 32 || c === 44 || (c >= 9 && c <= 13)) { i++; continue; }
    if (c < 128 && ARITY[c]! >= 0) { kinds.push(c); i++; continue; }
    let sign = 1;
    if (c === 45 || c === 43) { if (c === 45) sign = -1; i++; }
    let v = 0, dec = 0, digits = 0, dot = false;
    for (; i < n; i++) {
      const ch = d.charCodeAt(i);
      if (ch >= 48 && ch <= 57) { v = v * 10 + (ch - 48); digits++; if (dot) dec++; }
      else if (ch === 46 && !dot) dot = true;
      else break;
    }
    if (!digits || dec > MAX_DECIMALS) return null;
    const next = d.charCodeAt(i);
    if (next === 101 || next === 69) return null; // an exponent
    kinds.push(NUMBER);
    mant.push(sign * v);
    decs.push(dec);
    if (dec > decimals) decimals = dec;
  }
  if (kinds[0] !== M && kinds[0] !== m) return null;
  for (let k = 0; k < mant.length; k++) mant[k] = mant[k]! * POW[decimals - decs[k]!]!;
  return { kinds, nums: mant, decimals };
}

/** An integer at `decimals` as SVG writes it: no sign for zero, no leading zero, no trailing one. */
function num(v: number, decimals: number): string {
  if (v === 0) return '0';
  if (!decimals) return String(v);
  const a = v < 0 ? -v : v;
  const scale = POW[decimals]!;
  const int = Math.floor(a / scale);
  let frac = a - int * scale;
  let s: string;
  if (!frac) s = String(int);
  else {
    let k = decimals;
    while (frac % 10 === 0) { frac /= 10; k--; }
    let f = String(frac);
    while (f.length < k) f = `0${f}`;
    s = int ? `${int}.${f}` : `.${f}`;
  }
  return v < 0 ? `-${s}` : s;
}

/** Whether `t` written after `prev` needs a separator: not after a letter, not before a sign, not before a point after a point. */
const gap = (prev: string, t: string): boolean => prev !== '' && t.charCodeAt(0) !== 45 && !(t.charCodeAt(0) === 46 && prev.includes('.'));

/** What a letter implies for the numbers that follow it without one; 0 after a close. */
const implied = (c: number): number => (c === M ? L : c === m ? l : c === Z || c === z ? 0 : c);

/** `d` written shorter, or `d` itself when it holds what this does not read. */
export function compactPathData(d: string): string {
  const r = read(d);
  if (!r) return d;
  const { kinds, nums, decimals } = r;
  let out = '';
  let letter = 0;             // the letter in force, written or implied
  let last = '';              // the last number written
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let cmd = 0;
  let at = 0;                 // the next number
  const p: number[] = [];
  const abs: string[] = [];
  const rel: string[] = [];
  /** Length of `strs` written under `c`, the letter dropped where implied. */
  const cost = (c: number, strs: readonly string[], count: number): number => {
    const bare = implied(letter) === c;
    let len = bare ? 0 : 1;
    let prev = bare ? last : '';
    for (let k = 0; k < count; k++) { const t = strs[k]!; len += t.length + (gap(prev, t) ? 1 : 0); prev = t; }
    return len;
  };
  const put = (c: number, strs: readonly string[], count: number): void => {
    const bare = implied(letter) === c;
    if (!bare) out += String.fromCharCode(c);
    let prev = bare ? last : '';
    for (let k = 0; k < count; k++) { const t = strs[k]!; if (gap(prev, t)) out += ' '; out += t; prev = t; }
    letter = c;
    if (count) last = strs[count - 1]!;
  };
  for (let i = 0; i < kinds.length;) {
    if (kinds[i] !== NUMBER) cmd = kinds[i++]!;
    else if (cmd === Z || cmd === z || cmd === 0) return d;
    else if (cmd === M) cmd = L;
    else if (cmd === m) cmd = l;
    const up = cmd & ~LOWER;
    const n = ARITY[cmd]!;
    if (up === Z) { out += 'z'; letter = z; cx = sx; cy = sy; continue; }
    for (let k = 0; k < n; k++) if (kinds[i + k] !== NUMBER) return d;
    const isRel = cmd !== up;
    // the absolute points: H and V are lines
    let count: number;
    if (up === H) { p[0] = isRel ? cx + nums[at]! : nums[at]!; p[1] = cy; count = 2; }
    else if (up === V) { p[0] = cx; p[1] = isRel ? cy + nums[at]! : nums[at]!; count = 2; }
    else { for (let k = 0; k < n; k++) p[k] = isRel ? nums[at + k]! + (k % 2 ? cy : cx) : nums[at + k]!; count = n; }
    i += n;
    at += n;
    const c = up === H || up === V ? L : up;
    for (let k = 0; k < count; k++) { abs[k] = num(p[k]!, decimals); rel[k] = num(p[k]! - (k % 2 ? cy : cx), decimals); }
    // absolute, relative, then H or V: the first of the shortest
    let bestC = c, best = abs, bestN = count, bestLen = cost(c, abs, count);
    const relLen = cost(c | LOWER, rel, count);
    if (relLen < bestLen) { bestC = c | LOWER; best = rel; bestLen = relLen; }
    if (c === L) {
      const x = p[0]!, y = p[1]!;
      if (y === cy && x !== cx) {
        const a = cost(H, abs, 1), b = cost(H | LOWER, rel, 1);
        if (a < bestLen) { bestC = H; best = abs; bestN = 1; bestLen = a; }
        if (b < bestLen) { bestC = H | LOWER; best = rel; bestN = 1; bestLen = b; }
      }
      if (x === cx && y !== cy) {
        const ya = [abs[1]!], yr = [rel[1]!];
        const a = cost(V, ya, 1), b = cost(V | LOWER, yr, 1);
        if (a < bestLen) { bestC = V; best = ya; bestN = 1; bestLen = a; }
        if (b < bestLen) { bestC = V | LOWER; best = yr; bestN = 1; bestLen = b; }
      }
    }
    put(bestC, best, bestN);
    cx = p[count - 2]!; cy = p[count - 1]!;
    if (c === M) { sx = cx; sy = cy; }
  }
  return out;
}

/** Every path of an SVG or HTML text, its data written shorter; the rest of the text as it is. */
export function compactPaths(text: string): string {
  return text.replace(/(<path\b[^>]*?\sd=")([^"]*)"/g, (_, head: string, d: string) => `${head}${compactPathData(d)}"`);
}
