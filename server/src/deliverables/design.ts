import type { DesignSpec } from '../shared.js';
import { isDark, safePalette, type Palette } from './color.js';
import { hashString, normalizeKey } from './text.js';

export type Motif = DesignSpec['motif'];
export type CoverLayout = DesignSpec['coverLayout'];

interface PaletteDef { name: string; family: string; palette: Palette }

/** Curated, harmonious palettes (bg = cover/hero background, soft = light tint for boxes). */
export const PALETTES: readonly PaletteDef[] = [
  { name: 'Nuit douce', family: 'parentalite', palette: { bg: '#1f2a4d', primary: '#2e4272', secondary: '#8fa8d8', accent: '#f6b48f', ink: '#1b2238', soft: '#eef2fb' } },
  { name: 'Pêche tendre', family: 'parentalite', palette: { bg: '#fff1e8', primary: '#d9735a', secondary: '#7fa7c9', accent: '#f4c95d', ink: '#3a2e39', soft: '#fff6f1' } },
  { name: 'Forêt chaleureuse', family: 'animaux', palette: { bg: '#f3efe0', primary: '#3f7d58', secondary: '#a4c686', accent: '#e8a33d', ink: '#1f3326', soft: '#f1f6ec' } },
  { name: 'Prairie', family: 'animaux', palette: { bg: '#e6f2df', primary: '#4e8d3a', secondary: '#f2c14e', accent: '#d9643a', ink: '#233021', soft: '#f4faf1' } },
  { name: 'Marine & or', family: 'argent', palette: { bg: '#0f1d3a', primary: '#1b2f5c', secondary: '#3c5a99', accent: '#d4af37', ink: '#121a2e', soft: '#f4f2ea' } },
  { name: 'Émeraude', family: 'argent', palette: { bg: '#0e3b34', primary: '#136f5e', secondary: '#5fb49c', accent: '#f2c14e', ink: '#0f2a25', soft: '#edf7f3' } },
  { name: 'Corail vitalité', family: 'sante', palette: { bg: '#fff0ec', primary: '#e05a47', secondary: '#1fa2a0', accent: '#ffb347', ink: '#2c2a2e', soft: '#fff5f2' } },
  { name: 'Lagon', family: 'sante', palette: { bg: '#e3f5f4', primary: '#12807f', secondary: '#ff7a6b', accent: '#ffd166', ink: '#16302f', soft: '#f0faf9' } },
  { name: 'Indigo studieux', family: 'etudes', palette: { bg: '#262a6b', primary: '#3b3f9e', secondary: '#7c83e8', accent: '#ffd23f', ink: '#1c1f4a', soft: '#f0f1fd' } },
  { name: 'Sauge & terracotta', family: 'maison', palette: { bg: '#eef0e6', primary: '#5f8466', secondary: '#c9d6c3', accent: '#c8664a', ink: '#2b3428', soft: '#f5f7f1' } },
  { name: 'Coucher de soleil', family: 'voyage', palette: { bg: '#ffe0c2', primary: '#e4572e', secondary: '#6a4c93', accent: '#ffc857', ink: '#2d1e2f', soft: '#fff4ea' } },
  { name: 'Blush & or', family: 'mariage', palette: { bg: '#fbeced', primary: '#b9606d', secondary: '#e8c4c8', accent: '#c9a15b', ink: '#3b2a2e', soft: '#fdf5f6' } },
  { name: 'Lavande', family: 'mental', palette: { bg: '#efeaf8', primary: '#6c5aa8', secondary: '#b9a7e3', accent: '#f29e8e', ink: '#2a2440', soft: '#f7f4fc' } },
  { name: 'Électrique', family: 'tech', palette: { bg: '#111827', primary: '#4f46e5', secondary: '#22d3ee', accent: '#facc15', ink: '#111827', soft: '#eef2ff' } },
  { name: 'Cuisine gourmande', family: 'cuisine', palette: { bg: '#fff4e0', primary: '#c8501a', secondary: '#7fa650', accent: '#f1c40f', ink: '#3a2a1a', soft: '#fff9ef' } },
];

// Category / keyword → palette family (normalised, accent-free substrings).
const FAMILY_KEYWORDS: Record<string, string[]> = {
  parentalite: ['parent', 'bebe', 'enfant', 'famille', 'maternite', 'paternite', 'naissance', 'grossesse', 'adolescen', 'creche', 'allaitement', 'maman', 'papa'],
  animaux: ['animal', 'animaux', 'chien', 'chiot', 'chat', 'chaton', 'cheval', 'equitation', 'lapin', 'compagnie', 'veterinaire'],
  argent: ['argent', 'business', 'finance', 'budget', 'epargne', 'invest', 'dette', 'entrepreneur', 'freelance', 'vente', 'marketing', 'carriere', 'emploi', 'salaire', 'immobilier', 'impot', 'auto-entrepreneur', 'micro-entreprise'],
  sante: ['sante', 'forme', 'sport', 'fitness', 'nutrition', 'minceur', 'yoga', 'course', 'muscu', 'regime', 'douleur', 'dos', 'ventre', 'sommeil adulte'],
  etudes: ['etude', 'ecole', 'examen', 'bac', 'etudiant', 'apprentissage', 'langue', 'concours', 'revision', 'universite', 'lecture'],
  maison: ['maison', 'jardin', 'deco', 'potager', 'plante', 'menage', 'rangement', 'bricolage', 'demenagement', 'minimalisme'],
  voyage: ['voyage', 'vacances', 'tourisme', 'van', 'nomade', 'road trip', 'expatri', 'randonnee'],
  mariage: ['mariage', 'mariee', 'fiancaille', 'ceremonie', 'noces'],
  mental: ['stress', 'anxiete', 'mental', 'meditation', 'psycho', 'confiance', 'emotion', 'burn', 'couple', 'relation', 'amour', 'rupture', 'developpement personnel'],
  tech: ['tech', 'productivite', 'ia ', 'intelligence artificielle', 'code', 'numerique', 'excel', 'notion', 'logiciel', 'gaming'],
  cuisine: ['cuisine', 'recette', 'repas', 'gastronomie', 'patisserie', 'batch cooking', 'boulangerie'],
};

// Motif keywords, most specific first (first motif with the best score wins ties).
const MOTIF_KEYWORDS: [Motif, string[]][] = [
  ['paw', ['chien', 'chiot', 'chat', 'chaton', 'animal', 'animaux', 'compagnie', 'lapin', 'cheval', 'patte', 'croquette', 'aboie', 'laisse']],
  ['moon', ['sommeil', 'dormir', 'nuit', 'coucher', 'reveil', 'insomnie', 'sieste', 'endormissement', 'reve', 'berceuse', 'bebe']],
  ['dumbbell', ['sport', 'muscu', 'fitness', 'forme', 'course', 'abdos', 'ventre', 'poids', 'minceur', 'seance', 'entrainement', 'marathon', 'cardio']],
  ['leaf', ['plante', 'jardin', 'potager', 'nature', 'vegan', 'vegetal', 'ecolo', 'zero dechet', 'bio', 'compost', 'semis']],
  ['coin', ['argent', 'budget', 'epargne', 'finance', 'invest', 'dette', 'revenu', 'euro', 'economie', 'salaire', 'impot', 'credit']],
  ['chart', ['marketing', 'vente', 'croissance', 'freelance', 'client', 'linkedin', 'carriere', 'entreprise', 'business', 'prospection', 'chiffre']],
  ['book', ['etude', 'examen', 'bac', 'lecture', 'ecriture', 'livre', 'langue', 'apprendre', 'revision', 'concours', 'ecole', 'devoirs']],
  ['home', ['maison', 'rangement', 'menage', 'deco', 'demenagement', 'immobilier', 'location', 'appartement', 'chambre', 'bricolage']],
  ['heart', ['amour', 'couple', 'mariage', 'relation', 'rupture', 'confiance', 'emotion', 'tendresse', 'seduction', 'famille', 'coeur']],
  ['bolt', ['productivite', 'energie', 'motivation', 'procrastination', 'rapide', 'tech', 'focus', 'concentration', 'organisation', 'ia ']],
  ['sun', ['matin', 'soleil', 'voyage', 'vacances', 'ete', 'routine', 'lumiere', 'plage', 'reveil matinal']],
  ['sparkle', ['beaute', 'peau', 'cheveux', 'maquillage', 'fete', 'style', 'glow', 'eclat']],
];

const FAMILY_DEFAULT_MOTIF: Record<string, Motif> = {
  parentalite: 'moon', animaux: 'paw', argent: 'coin', sante: 'dumbbell', etudes: 'book', maison: 'home',
  voyage: 'sun', mariage: 'heart', mental: 'heart', tech: 'bolt', cuisine: 'home',
};

const LAYOUTS: readonly CoverLayout[] = ['centered', 'split', 'badge', 'minimal'];
export const MOTIFS: readonly Motif[] = ['moon', 'sun', 'leaf', 'coin', 'heart', 'bolt', 'book', 'chart', 'home', 'paw', 'dumbbell', 'sparkle'];

function familyOf(category: string, text: string): string | null {
  const cat = ` ${normalizeKey(category)} `;
  // explicit category wins over keywords found in the niche name
  for (const [family, keys] of Object.entries(FAMILY_KEYWORDS)) {
    if (keys.some((k) => cat.includes(k))) return family;
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [family, keys] of Object.entries(FAMILY_KEYWORDS)) {
    const score = keys.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { best = family; bestScore = score; }
  }
  return best;
}

function motifOf(text: string, family: string | null): Motif {
  let best: Motif | null = null;
  let bestScore = 0;
  for (const [motif, keys] of MOTIF_KEYWORDS) {
    const score = keys.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { best = motif; bestScore = score; }
  }
  return best ?? (family ? FAMILY_DEFAULT_MOTIF[family] ?? 'sparkle' : 'sparkle');
}

function hintedLayout(hint: string): CoverLayout | null {
  if (/centr/.test(hint)) return 'centered';
  if (/split|deux blocs|divis/.test(hint)) return 'split';
  if (/badge|sceau|medaille|macaron/.test(hint)) return 'badge';
  if (/minimal|epure|sobre/.test(hint)) return 'minimal';
  return null;
}

function hintedMotif(hint: string): Motif | null {
  const direct: Record<string, Motif> = {
    lune: 'moon', moon: 'moon', etoile: 'moon', soleil: 'sun', sun: 'sun', feuille: 'leaf', leaf: 'leaf', piece: 'coin', coin: 'coin',
    coeur: 'heart', heart: 'heart', eclair: 'bolt', bolt: 'bolt', livre: 'book', book: 'book', graphique: 'chart', chart: 'chart',
    maison: 'home', home: 'home', patte: 'paw', paw: 'paw', haltere: 'dumbbell', dumbbell: 'dumbbell', paillette: 'sparkle', sparkle: 'sparkle',
  };
  for (const [k, m] of Object.entries(direct)) if (new RegExp(`\\b${k}`).test(hint)) return m;
  return null;
}

/** Deterministic design system for a product: same inputs → same palette, motif, layout and fonts. */
export function designFor(input: { nicheName: string; category: string; seed: number; hint?: string }): DesignSpec {
  const name = String(input?.nicheName ?? '');
  const category = String(input?.category ?? '');
  const hint = normalizeKey(input?.hint ?? '');
  const seed = Number.isFinite(input?.seed) ? Math.trunc(input.seed) : 0;
  const text = ` ${normalizeKey(`${name} ${category} ${input?.hint ?? ''}`)} `;
  const h = hashString(`${normalizeKey(name)}|${normalizeKey(category)}|${seed}`);

  const family = familyOf(category, text);
  const candidates = PALETTES.filter((p) => p.family === family);
  const pool = candidates.length > 0 ? candidates : PALETTES;
  let def = pool[h % pool.length];
  // a hint may ask for a dark or a light look inside the family
  if (/sombre|nuit|dark|fonce/.test(hint)) def = pool.find((p) => isDark(p.palette.bg)) ?? def;
  if (/clair|light|lumineu|pastel/.test(hint)) def = pool.find((p) => !isDark(p.palette.bg)) ?? def;
  const named = PALETTES.find((p) => hint.includes(normalizeKey(p.name)));
  if (named) def = named;

  const motif = hintedMotif(hint) ?? motifOf(text, family);
  const coverLayout = hintedLayout(hint) ?? LAYOUTS[(h >>> 8) % LAYOUTS.length];

  const elegant = family === 'mariage' || family === 'argent' || /elegan|luxe|chic|classique/.test(hint);
  const titleFont: DesignSpec['titleFont'] = /machine a ecrire|typewriter|retro|code/.test(hint)
    ? 'Courier-Bold'
    : elegant ? 'Times-Bold' : 'Helvetica-Bold';
  const bodyFont: DesignSpec['bodyFont'] = family === 'mariage' || /litter|roman|poesie/.test(hint) ? 'Times-Roman' : 'Helvetica';

  return { palette: { ...def.palette }, motif, coverLayout, titleFont, bodyFont, seed };
}

/** Defensive copy of a DesignSpec coming from elsewhere (LLM, old saves): every field valid. */
export function normalizeDesign(design: Partial<DesignSpec> | null | undefined): DesignSpec {
  const d = design ?? {};
  return {
    palette: safePalette(d.palette),
    motif: MOTIFS.includes(d.motif as Motif) ? (d.motif as Motif) : 'sparkle',
    coverLayout: LAYOUTS.includes(d.coverLayout as CoverLayout) ? (d.coverLayout as CoverLayout) : 'centered',
    titleFont: d.titleFont === 'Times-Bold' || d.titleFont === 'Courier-Bold' ? d.titleFont : 'Helvetica-Bold',
    bodyFont: d.bodyFont === 'Times-Roman' ? 'Times-Roman' : 'Helvetica',
    seed: Number.isFinite(d.seed) ? Number(d.seed) : 0,
  };
}

/** CSS font stacks matching the PDF standard fonts. */
export function cssFontStack(font: DesignSpec['titleFont'] | DesignSpec['bodyFont']): string {
  if (font.startsWith('Times')) return `Georgia, 'Times New Roman', Times, serif`;
  if (font.startsWith('Courier')) return `'Courier New', Courier, monospace`;
  return `'Helvetica Neue', Helvetica, Arial, sans-serif`;
}
