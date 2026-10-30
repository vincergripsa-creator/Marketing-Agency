/**
 * Catalog of French-market niches with their HIDDEN truth. Some are gems (moderate buzz, good
 * willingness to pay, weak competitors), some are traps (high buzz but low WTP, saturated, or
 * compliance minefields) — research and learning are what tell them apart.
 *
 *   gems    : proprete-chiot, oral-aide-soignante, urssaf-micro, mariage-moins-10k, relooker-meuble
 *   solid   : sommeil-bebe, dme-diversification, potager-balcon, toeic-800, japon-petit-budget
 *   traps   : chat-griffe-canape (low WTP), batch-cooking-budget (low WTP), stress-bac (low WTP + trolls),
 *             freelance-linkedin (saturated), ventre-apres-40 (compliance), revendre-vinted (money claims)
 */
import type { NicheTruth } from '../shared.js';
import { BATCH_COOKING, DME, SOMMEIL_BEBE, STRESS_BAC } from './catalog/famille.js';
import { CHAT_GRIFFE, POTAGER_BALCON, PROPRETE_CHIOT, RELOOKER_MEUBLE } from './catalog/maison.js';
import { FREELANCE_LINKEDIN, ORAL_AIDE_SOIGNANTE, TOEIC_800, URSSAF_MICRO } from './catalog/pro.js';
import { JAPON_BUDGET, MARIAGE_10K, VENTRE_40, VINTED } from './catalog/vie.js';

export const NICHE_CATALOG: readonly NicheTruth[] = [
  SOMMEIL_BEBE, DME, PROPRETE_CHIOT, CHAT_GRIFFE, ORAL_AIDE_SOIGNANTE, URSSAF_MICRO, FREELANCE_LINKEDIN, POTAGER_BALCON,
  VENTRE_40, TOEIC_800, BATCH_COOKING, MARIAGE_10K, VINTED, JAPON_BUDGET, STRESS_BAC, RELOOKER_MEUBLE,
];

export function catalogNiche(id: string): NicheTruth | undefined {
  return NICHE_CATALOG.find((n) => n.id === id);
}

/** Deep copy (the catalog itself is never mutated by a run). */
export function cloneNiche(n: NicheTruth): NicheTruth {
  return JSON.parse(JSON.stringify(n)) as NicheTruth;
}
