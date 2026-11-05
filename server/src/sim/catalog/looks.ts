/**
 * Genre conventions of looks (design plan §5): what practitioners say each shelf wears. Public research, not the answer: the
 * market draws its hidden taste around it (sim/market.ts) and the agents start their bandits from it (learning/looks.ts).
 * The numbers below the tables are what the market does with a look (D201).
 */
import type { AdFormat, ArtStyle, GuideArchetype, PageHero, PageTemplate } from '../../shared.js';

/** The palette families of `deliverables/design.ts`, read from a niche's category and keywords. */
export type LookFamily = 'parentalite' | 'animaux' | 'argent' | 'sante' | 'etudes' | 'maison' | 'voyage' | 'mariage' | 'mental' | 'tech' | 'cuisine';

export const STYLE_CONVENTIONS: Record<LookFamily, { convention: readonly ArtStyle[]; opposite: readonly ArtStyle[] }> = {
  parentalite: { convention: ['trait', 'aura', 'collage'], opposite: ['grille', 'pop'] },
  animaux: { convention: ['pop', 'trait', 'collage'], opposite: ['grille', 'aura'] },
  argent: { convention: ['grille', 'typo', 'bauhaus'], opposite: ['aura', 'collage'] },
  sante: { convention: ['aura', 'typo', 'trait'], opposite: ['riso', 'grille'] },
  etudes: { convention: ['grille', 'typo', 'pop'], opposite: ['aura', 'collage'] },
  maison: { convention: ['collage', 'riso', 'trait'], opposite: ['grille', 'aura'] },
  voyage: { convention: ['riso', 'collage', 'aura'], opposite: ['grille', 'bauhaus'] },
  mariage: { convention: ['aura', 'typo', 'trait'], opposite: ['pop', 'grille'] },
  mental: { convention: ['aura', 'trait', 'collage'], opposite: ['pop', 'grille'] },
  tech: { convention: ['grille', 'pop', 'typo'], opposite: ['collage', 'trait'] },
  cuisine: { convention: ['collage', 'riso', 'pop'], opposite: ['grille', 'aura'] },
};

export const TEMPLATE_CONVENTIONS: Record<GuideArchetype, readonly PageTemplate[]> = {
  habitude: ['creator', 'inside'], projet: ['inside', 'value'], demarche: ['value', 'editorial'], examen: ['express', 'value'],
  evenement: ['editorial', 'creator'], systeme: ['express', 'inside'], paliers: ['creator', 'proof'],
};

/** `bundle` goes wherever a kit exists: every guide of the catalogue ships printable sheets, so every family. */
export const HERO_CONVENTIONS: Record<PageHero, readonly LookFamily[] | 'all'> = {
  devices: ['argent', 'etudes', 'maison'], spread: ['argent', 'etudes', 'maison'], desk: ['maison', 'cuisine', 'etudes'], book: ['mariage', 'voyage'], bundle: 'all',
};

/** Shift of an arm before the run's draw, per record, and the range the record ends in. */
export const TASTE = {
  style: { convention: 0.10, opposite: -0.08, min: 0.86, max: 1.16 },
  page: { convention: 0.12, opposite: 0, min: 0.85, max: 1.20 },
  hero: { convention: 0.04, opposite: 0, min: 0.95, max: 1.06 },
  sigma: 0.05,      // lognormal of the run's draw
  surprise: 0.07,   // one random arm of each record, so the research helps but is not the answer
} as const;

const isFamily = (f: string | null | undefined): f is LookFamily => !!f && f in STYLE_CONVENTIONS;

/** +convention, −opposite or 0 for a style of a family. */
export function styleConvention(style: ArtStyle, family: string | null | undefined): number {
  if (!isFamily(family)) return 0;
  const row = STYLE_CONVENTIONS[family];
  return row.convention.includes(style) ? TASTE.style.convention : row.opposite.includes(style) ? TASTE.style.opposite : 0;
}

export function templateConvention(template: PageTemplate, archetype: GuideArchetype | null | undefined): number {
  return archetype && TEMPLATE_CONVENTIONS[archetype]?.includes(template) ? TASTE.page.convention : 0;
}

export function heroConvention(hero: PageHero, family: string | null | undefined): number {
  const row = HERO_CONVENTIONS[hero];
  return row === 'all' || (isFamily(family) && row.includes(family)) ? TASTE.hero.convention : 0;
}

/** What a look does to the market (D201). Taste: conversion × page × hero × style^cvr, clicks × style^ctr where the cover shows. */
export const LOOK_MARKET = {
  cvrStyleExp: 0.35,
  ctrStyleExp: { cover: 0.8, film: 0.4 },
  /** The formats whose frame is the cover itself. Films show it on their end card; a search ad shows none. */
  coverFormats: ['static_image', 'carousel', 'text_slideshow'] as readonly AdFormat[],
  /** Public conditions from the research: short pages sell cheap guides, long reads dear ones, proof needs proof, `inside` real pages. */
  cheapMax: 14, dearMin: 29, priceLift: 1.06, priceDrop: 0.94,
  proofMinReviews: 5, proofWithout: 0.82,
  insideWithout: 0.85,
} as const;
