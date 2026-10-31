/**
 * The visual score (pdf §12): what a guide and its cover are worth, from their audits alone. Pure. `issues` name what a
 * designer can fix, the pages first (`scorePdf` blocks on the first one), and none says how far the eye searched: that is
 * the talent.
 */
import type { CoverAudit, PdfAudit } from '../contracts.js';
import type { DesignEffort, VisualReport } from '../shared.js';
import { coverScore } from './art/evaluate.js';

/** The standard fonts are a fallback: such a guide can ship, it cannot score as designed. */
const DEGRADED_MAX = 60;
/** From this many px on a 150 px thumbnail a title has full marks (pdf §12.2). */
const THUMB_FULL = 13;
const RAIL_FULL = 0.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const plural = (n: number, s: string): string => `${n} ${s}${n > 1 ? 's' : ''}`;

/** fill .3, short pages .2, figures .25, rail .15, sheets .1, less 5 points per defect. */
function interiorOf(a: PdfAudit): number {
  const fill = 100 * clamp01((a.fillMean - 0.5) / 0.3);
  const short = 100 * (1 - a.shortPages / Math.max(1, a.textPages));
  const figures = 100 * (0.5 * clamp01(a.figureKinds / 4) + 0.5 * clamp01(a.figuresPerChapter));
  const rail = 100 * clamp01(a.railShare / RAIL_FULL);
  const sheets = 100 * clamp01(a.sheets / 2);
  const score = 0.3 * fill + 0.2 * short + 0.25 * figures + 0.15 * rail + 0.1 * sheets - 5 * (a.widows + a.strandedHeadings + a.overflow);
  return round1(Math.min(a.degraded ? DEGRADED_MAX : 100, Math.max(0, score)));
}

function issuesOf(a: PdfAudit, cover: CoverAudit): string[] {
  const out: string[] = [];
  const defects = a.widows + a.strandedHeadings + a.overflow;
  if (a.shortPages) out.push(`Mise en page creuse : ${plural(a.shortPages, 'page')} à moitié ${a.shortPages > 1 ? 'vides' : 'vide'}.`);
  if (defects) out.push(`${plural(defects, 'défaut')} de composition : ligne isolée, titre seul en bas de page ou texte hors de son cadre.`);
  if (a.degraded) out.push('Polices absentes : le guide sort en polices de secours, à réinstaller avant la vente.');
  if (a.figuresPerChapter < 1) out.push('Moins d’un schéma par chapitre : en ajouter là où le texte décrit un cycle, un plan ou un choix.');
  if (a.railShare < RAIL_FULL) out.push('Marges peu utilisées : placer les notes et les renvois dans la colonne latérale.');
  if (a.sheets < 2) out.push('Moins de deux fiches à imprimer : l’acheteur garde ce qu’il peut remplir.');
  if (cover.thumbPx < THUMB_FULL) out.push(`Titre à ${Math.round(cover.thumbPx)} px en miniature : le raccourcir pour dépasser ${THUMB_FULL} px.`);
  return out;
}

/** overall = 0.55 cover + 0.45 interior. `explored` is the real count of art candidates: `pickArt` says it. */
export function visualReport(pdf: PdfAudit, cover: CoverAudit, effort: DesignEffort, explored: number): VisualReport {
  const front = coverScore(cover);
  const interior = interiorOf(pdf);
  return { version: 1, cover: front, interior, overall: round1(0.55 * front + 0.45 * interior), effort, explored, issues: issuesOf(pdf, cover) };
}
