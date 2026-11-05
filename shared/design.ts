/** shared/design.ts. Public facts about looks (design plan D200 to D202): the UI and the agents may read them, the market's taste stays in NicheTruth. */
import type { ArtStyle, PageHero, PageTemplate } from './types.js';

export const ART_STYLES: readonly ArtStyle[] = ['bauhaus', 'typo', 'grille', 'pop', 'trait', 'collage', 'aura', 'riso'];
export const PAGE_TEMPLATES: readonly PageTemplate[] = ['express', 'editorial', 'inside', 'creator', 'proof', 'value'];
export const PAGE_HEROES: readonly PageHero[] = ['book', 'devices', 'spread', 'bundle', 'desk'];

export interface LookPublic { label: string; blurb: string }

/** What each art direction looks like, as the art director would describe it to the founder. */
export const STYLE_INFO: Record<ArtStyle, LookPublic> = {
  bauhaus: { label: 'Bauhaus', blurb: 'Formes géométriques franches, une grande figure, cinq encres à plat.' },
  typo: { label: 'Typo XXL', blurb: 'Le titre en très grand comme une affiche, un seul aplat de couleur, presque rien d’autre.' },
  grille: { label: 'Grille suisse', blurb: 'Une grille stricte, un grand chiffre, des filets fins : sérieux et lisible.' },
  pop: { label: 'Pop', blurb: 'Contours épais, ombres franches, couleurs vives et autocollants : fait pour le fil.' },
  trait: { label: 'Ligne claire', blurb: 'Illustration au trait, taches pastel, beaucoup d’air : doux et rassurant.' },
  collage: { label: 'Papier découpé', blurb: 'Formes de papier déchiré superposées, grain et ombres portées : fait main.' },
  aura: { label: 'Aura', blurb: 'Dégradés doux en halos, grain fin, une carte translucide pour le titre.' },
  riso: { label: 'Risographie', blurb: 'Deux encres en trame de points, léger décalage de calage : rétro et chaleureux.' },
};

/** What each page template is for, in the shop lead's words. */
export const TEMPLATE_INFO: Record<PageTemplate, LookPublic> = {
  express: { label: 'Express', blurb: 'Une page courte pour mobile : la promesse, trois bénéfices, un aperçu, l’achat.' },
  editorial: { label: 'Éditoriale', blurb: 'Une lecture de magazine : le problème raconté, le sommaire, des citations.' },
  inside: { label: 'Feuilletage', blurb: 'Les vraies pages d’abord : on voit ce qu’on achète avant de lire l’argumentaire.' },
  creator: { label: 'Créatrice', blurb: 'Pourquoi on l’a écrit, pour qui, et pour qui ce n’est pas : un ton personnel.' },
  proof: { label: 'Mur d’avis', blurb: 'Les avis des acheteurs en premier, avec leur vérification : seulement quand ils existent.' },
  value: { label: 'Valeur claire', blurb: 'Ce que vous obtenez, poste par poste, et ce que coûterait de faire autrement.' },
};

/** What the first screen shows next to the title. */
export const HERO_INFO: Record<PageHero, LookPublic> = {
  book: { label: 'Livre 3D', blurb: 'Le guide seul, en volume, avec son ombre.' },
  devices: { label: 'Livre et écrans', blurb: 'Le guide avec une tablette et un téléphone ouverts sur ses pages.' },
  spread: { label: 'Double page', blurb: 'Le guide ouvert sur deux vraies pages.' },
  bundle: { label: 'Le pack', blurb: 'Le guide, son kit et ses fiches en éventail.' },
  desk: { label: 'Sur le bureau', blurb: 'Les pages imprimées posées sur un bureau, vues de dessus.' },
};

/** Page templates that need data the product may not have yet: an agent never picks one while the condition fails. */
export const TEMPLATE_NEEDS: Partial<Record<PageTemplate, { minReviews?: number; previews?: boolean }>> = {
  proof: { minReviews: 5 },
  inside: { previews: true },
};

/** Heroes that need something the product may not have. */
export const HERO_NEEDS: Partial<Record<PageHero, { previews?: boolean; bundle?: boolean }>> = {
  devices: { previews: true },
  spread: { previews: true },
  bundle: { bundle: true },
};
