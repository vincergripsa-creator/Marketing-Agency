/** The faces of the video: the pdf pillar's WOFF folder, registered as they are (D28). */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts } from '@napi-rs/canvas';
import type { DesignSpec } from '../shared.js';

export const FONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');

export const FACE = { display: 'Anton', bold: 'MontX', semi: 'MontS', serif: 'HookSerif' } as const;

const FILES: [string, string][] = [
  [FACE.display, 'anton-latin-400-normal.woff'],
  [FACE.bold, 'montserrat-latin-800-normal.woff'],
  [FACE.semi, 'montserrat-latin-600-normal.woff'],
  [FACE.serif, 'dm-serif-display-400-normal.woff'], // the pdf pillar's. Absent: hooks stay in Anton
];

const loaded = new Set<string>();

/** Safe to call twice. A missing file costs that face, Skia then draws its default. */
export function registerFonts(dir = FONT_DIR): string[] {
  for (const [family, file] of FILES) {
    const path = join(dir, file);
    if (!loaded.has(family) && existsSync(path) && GlobalFonts.registerFromPath(path, family)) loaded.add(family);
  }
  return [...loaded];
}

/** Hooks are Anton, except for a guide set in a serif. */
export function displayFontFor(design: Pick<DesignSpec, 'titleFont'>): string {
  return design.titleFont === 'Times-Bold' && loaded.has(FACE.serif) ? FACE.serif : FACE.display;
}
