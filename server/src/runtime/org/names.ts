/**
 * Who can walk in: the first names of the market and what a generated candidate looks like (org §9). A name belongs to
 * whoever was hired, for life: a candidate turned down goes back in the pool, and an empty pool adds an initial (D53).
 */
import type { AgentState, AvatarSpec, DeptId, RoleId, ToolName, WorldState } from '../../shared.js';
import type { Rng } from '../../contracts.js';
import { DEPARTMENTS } from '../roster.js';
import { CANDIDATES } from './catalog.js';

export interface PoolName { name: string; gender: AgentState['gender'] }

const pool = (gender: PoolName['gender'], names: string): PoolName[] => names.split(' ').map((name) => ({ name, gender }));

/** 60 first names, none of them one of the 31 of the catalog: a named candidate never meets a namesake. */
export const NAME_POOL: readonly PoolName[] = [
  ...pool('f', 'Léa Manon Jade Anaïs Margaux Sofia Aya Salomé Noémie Justine Clémence Agathe Romane Capucine Mathilde Océane Lou Leïla Amina Héloïse Juliette Pauline Céline Solène Marion Diane Flora Hélène Nina Sabrina'),
  ...pool('m', 'Yanis Nathan Arthur Jules Bastien Antoine Mathis Victor Ibrahim Karim Sacha Noé Maxime Thibault Baptiste Romain Florian Julien Damien Simon Félix Oscar Marius Aurélien Bilal Youssef Émile Lilian Tristan Gaspard'),
];

const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Names already someone's: the team, and everyone who ever left it. */
export function takenNames(w: WorldState): Set<string> {
  return new Set([...w.company.agents.map((a) => a.name), ...(w.company.org?.alumni ?? []).map((a) => a.name)]);
}

/** A free first name; once the pool is spent, a first name and an initial, then two: `taken` is finite, so this ends. */
export function pickName(taken: ReadonlySet<string>, rng: Rng): PoolName {
  const free = NAME_POOL.filter((n) => !taken.has(n.name));
  if (free.length) return rng.pick(free);
  const base = rng.pick(NAME_POOL);
  const start = rng.int(0, INITIALS.length - 1);
  for (let tried = 0; ; tried++) {
    const letters = INITIALS[(start + tried) % INITIALS.length]!.repeat(1 + Math.floor(tried / INITIALS.length));
    const name = `${base.name} ${letters}.`;
    if (!taken.has(name)) return { name, gender: base.gender };
  }
}

// ───────────────────────────── A generated candidate ─────────────────────────────

type Persona = (name: string, e: string) => string;

const PERSONAS: Record<DeptId, readonly Persona[]> = {
  direction: [
    (n) => `${n} tient le fil de chaque dossier et ne laisse rien traîner sans dire pourquoi.`,
    (n, e) => `Organisé${e} et direct${e}, ${n} préfère une décision prise à une réunion de plus.`,
  ],
  recherche: [
    (n) => `${n} lit tout ce que les clients écrivent et ne croit que ce qu'ils paient déjà.`,
    (n) => `Curiosité froide : ${n} compare les prix, les avis et les promesses avant d'avoir un avis.`,
  ],
  studio: [
    (n) => `${n} écrit court, concret, et coupe tout ce qui ne sert pas le lecteur.`,
    (n, e) => `${e ? 'Attentive' : 'Attentif'} au mot juste, ${n} remplace chaque généralité par un exemple vécu.`,
  ],
  creation: [
    (n) => `${n} pense en miniatures : ce qui ne se lit pas sur un téléphone n'existe pas.`,
    (n) => `Du blanc, deux couleurs, une idée par page : ${n} défend la simplicité.`,
  ],
  video: [
    (n) => `${n} monte au rythme de la voix et sait que tout se joue dans la première seconde.`,
    (n) => `Sous-titres, cadrage, relances : ${n} soigne ce que le spectateur ne remarque pas.`,
  ],
  growth: [
    (n) => `${n} coupe vite ce qui ne marche pas et ne double que ce qui se prouve.`,
    (n, e) => `Froid${e} devant les chiffres, ${n} tient les budgets au centime et refuse toute promesse en l'air.`,
  ],
  crm: [
    (n) => `${n} écrit aux gens comme à des voisins et répond à chaque commentaire.`,
    (n) => `Régularité d'abord : ${n} préfère dix messages utiles à un coup d'éclat.`,
  ],
  boutique: [
    (n) => `${n} écrit avec les mots exacts des clients et répond aux objections avant qu'on les pose.`,
    (n) => `${n} teste un prix à la fois et ne monte que quand les ventes suivent.`,
  ],
  support: [
    (n, e) => `Patient${e} et ferme, ${n} répond vite, rembourse de bonne foi et flaire les arnaques.`,
    (n) => `${n} garde son calme face aux clients pénibles et fait remonter chaque plainte utile.`,
  ],
  analyse: [
    (n) => `${n} ne croit qu'aux chiffres et à leurs marges d'erreur, une variable à la fois.`,
    (n) => `${n} raconte une journée en trois lignes et un tableau, sans conclure trop tôt.`,
  ],
  finance: [
    (n) => `${n} rapproche chaque ligne du grand livre et repère l'écart avant tout le monde.`,
    (n) => `Prudence et méthode : ${n} veut savoir ce que coûte chaque décision avant de la prendre.`,
  ],
  rh: [
    (n) => `${n} coache avant de juger et transforme chaque erreur en leçon chiffrée.`,
    (n) => `${n} cherche la faille de chaque idée avant qu'elle coûte de l'argent.`,
  ],
  partenariats: [
    (n) => `${n} préfère dix petits créateurs à la commission à une star payée d'avance.`,
    (n) => `${n} vérifie les abonnés et l'engagement avant de signer quoi que ce soit.`,
  ],
};

export function personaFor(dept: DeptId, name: string, gender: AgentState['gender'], rng: Rng): string {
  return rng.pick(PERSONAS[dept])(name, gender === 'f' ? 'e' : '');
}

/** The roles without a named candidate of their own, which the catalog cannot speak for. */
const NEW_ROLE_SKILLS: Partial<Record<RoleId, string[]>> = {
  motion_designer: ['Recadrage', 'Animation de texte', 'Formats par canal', 'Rythme'],
  media_buyer_meta: ['Media buying', 'Ciblage Meta', 'Stop-loss', 'Analyse ROAS'],
  media_buyer_google: ['Media buying', 'Annonces Search', 'YouTube', 'Analyse ROAS'],
  media_buyer_pinterest: ['Media buying', 'Épingles sponsorisées', 'Saisonnalité', 'Analyse ROAS'],
  email_marketer: ['Séquences e-mail', 'Lettres utiles', 'Segmentation', 'Délivrabilité'],
};

/** Whose kit a new role takes when it has no named candidate. */
const KIT_OF: Partial<Record<RoleId, RoleId>> = {
  motion_designer: 'video_editor',
  media_buyer_meta: 'media_buyer_tiktok', media_buyer_google: 'media_buyer_tiktok', media_buyer_pinterest: 'media_buyer_tiktok',
  email_marketer: 'community_manager',
};

const namedOf = (role: RoleId) => Object.values(CANDIDATES).find((c) => c.roleId === role);

export function skillsOf(role: RoleId): string[] {
  return [...(NEW_ROLE_SKILLS[role] ?? namedOf(role)?.skills ?? [])];
}

export function toolsOf(role: RoleId): ToolName[] {
  return [...(namedOf(KIT_OF[role] ?? role)?.tools ?? [])];
}

// Same looks as the catalog's people.
const SKINS = ['#e8b48a', '#f5d0b0', '#7a4a2c', '#f1c7a0', '#c98e62', '#a86b45', '#5a3520', '#d9a273'];
const HAIRS = ['#2b1d14', '#a0522d', '#111111', '#d8b06a', '#7b2d26', '#3d2a5c', '#5a3a22', '#e85d75', '#e6e2da'];
const PANTS = ['#2d3142', '#3c415c', '#1b263b', '#4a4e69', '#264653', '#3d405b', '#22223b', '#5c4033'];
const HAIR_STYLES: Record<AgentState['gender'], readonly AvatarSpec['hairStyle'][]> = { f: [1, 2, 3, 5], m: [0, 3, 4] };
const ACCESSORIES: Record<AgentState['gender'], readonly AvatarSpec['accessory'][]> = {
  f: ['none', 'none', 'glasses', 'headphones', 'cap'],
  m: ['none', 'glasses', 'headphones', 'cap', 'beard', 'tie'],
};

/** Each trait draws from `rng(trait)`, so that one more colour in a palette moves no other trait. */
export function avatarFor(dept: DeptId, gender: AgentState['gender'], rng: (trait: number) => Rng): AvatarSpec {
  return {
    shirt: DEPARTMENTS.find((d) => d.id === dept)!.color,
    pants: rng(0).pick(PANTS),
    skin: rng(1).pick(SKINS),
    hair: rng(2).pick(HAIRS),
    hairStyle: rng(3).pick(HAIR_STYLES[gender]),
    accessory: rng(4).pick(ACCESSORIES[gender]),
  };
}
