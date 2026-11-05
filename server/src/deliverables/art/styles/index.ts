/**
 * The art directions (design plan D200), by id. A style not built yet draws as Bauhaus, so that the rest of the system can
 * already choose any of the eight. A new style registers here, one import and one entry in `BUILT`; a style module never
 * imports this file back.
 */
import type { ArtStyle, DesignSpec } from '../../../shared.js';
import type { Scene } from '../../scene.js';
import { bauhaus } from './bauhaus.js';
import { typo } from './typo.js';
import type { ArtStyleDef, PlateSpec } from './types.js';

// styles A: grille, pop, trait

import { aura } from './aura.js';
import { collage } from './collage.js';
import { riso } from './riso.js';

const BUILT: Partial<Record<ArtStyle, ArtStyleDef>> = {
  bauhaus,
  typo,
  collage,
  aura,
  riso,
};

/** The styles that draw their own art, Bauhaus first. */
export const BUILT_STYLES: readonly ArtStyle[] = Object.keys(BUILT) as ArtStyle[];

export const isBuilt = (id: unknown): id is ArtStyle => typeof id === 'string' && Object.hasOwn(BUILT, id);

/** The style that draws `id`: absent or not built yet, Bauhaus. */
export const styleDef = (id: ArtStyle | undefined): ArtStyleDef => (id && BUILT[id]) || bauhaus;

export const styleOf = (d: Pick<DesignSpec, 'style'>): ArtStyleDef => styleDef(d.style);

/**
 * The composition a design is drawn in, among its style's. A design that names none gets its style's default; one that names
 * more than its style has, as a style not built yet may, wraps round.
 */
export function compositionOf(d: DesignSpec, def: ArtStyleDef = styleOf(d)): number {
  const k = d.composition;
  return typeof k === 'number' && Number.isInteger(k) && k >= 0 ? k % def.compositions.length : def.defaultComposition(d);
}

/** The guide's art in a rectangle, in its own style. Bauhaus draws the field V1 drew. */
export function drawPlate(d: Pick<DesignSpec, 'style'>, s: Scene, p: PlateSpec): void {
  styleOf(d).plate(s, p);
}

export type { ArtStyleDef, Composition, CoverArt, CoverCall, CoverKit, PlateRole, PlateSpec } from './types.js';
