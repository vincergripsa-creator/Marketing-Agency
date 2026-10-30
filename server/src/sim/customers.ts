/** Simulated buyers and senders: French names, plausible e-mails, archetypes by difficulty. */
import { nextId } from '../core/index.js';
import type { Rng } from '../contracts.js';
import type { Customer, CustomerArchetype, Difficulty, MessageIntent, WorldState } from '../shared.js';
import { CUSTOMER_ARCHETYPES, DIFFICULTY } from './balance.js';
import { norm, pickWeighted } from './text.js';

export const FEMALE_NAMES: readonly string[] = [
  'Camille', 'Léa', 'Manon', 'Chloé', 'Emma', 'Inès', 'Sarah', 'Julie', 'Laura', 'Pauline', 'Marine', 'Aurélie', 'Céline',
  'Nathalie', 'Sandrine', 'Sophie', 'Élodie', 'Clara', 'Lucie', 'Mélanie', 'Fatou', 'Aïcha', 'Yasmine', 'Nadia', 'Amandine',
  'Justine', 'Océane', 'Margaux', 'Morgane', 'Charlotte', 'Gaëlle', 'Anaïs',
];

export const MALE_NAMES: readonly string[] = [
  'Thomas', 'Lucas', 'Hugo', 'Maxime', 'Julien', 'Nicolas', 'Antoine', 'Romain', 'Kévin', 'Mehdi', 'Karim', 'Yanis', 'Rayan',
  'Bastien', 'Florian', 'Damien', 'Olivier', 'Sébastien', 'Mathieu', 'Alexandre', 'Théo', 'Quentin', 'Samir', 'Ousmane',
  'Pierre', 'Jérôme', 'Christophe', 'Benoît',
];

export const FIRST_NAMES: readonly string[] = [...FEMALE_NAMES, ...MALE_NAMES];

export const LAST_NAMES: readonly string[] = [
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent',
  'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier',
  'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guerin',
  'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin', 'Morin', 'Mathieu', 'Clément', 'Gauthier', 'Dumont', 'Lopez',
  'Fontaine', 'Chevalier', 'Robin', 'Benali', 'Diallo', 'Nguyen', 'Haddad', 'Traoré', 'Boyer', 'Lemoine',
];

const MAIL_DOMAINS: readonly [string, number][] = [
  ['gmail.com', 0.42], ['hotmail.fr', 0.14], ['orange.fr', 0.1], ['yahoo.fr', 0.08], ['outlook.fr', 0.08],
  ['free.fr', 0.07], ['laposte.net', 0.05], ['sfr.fr', 0.04], ['icloud.com', 0.02],
];

const HANDLE_PARTS: readonly string[] = ['du', 'la', 'off', 'real', 'mlle', 'mr', 'the', 'xx', 'petit', 'zen', 'happy', 'mama', 'papa', 'ptit'];

function slug(s: string): string {
  return norm(s).replace(/[^a-z0-9]+/g, '');
}

export function randomName(rng: Rng): { first: string; last: string } {
  return { first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES) };
}

export function emailFor(rng: Rng, first: string, last: string): string {
  const f = slug(first); const l = slug(last);
  const style = rng.int(0, 3);
  const local = style === 0 ? `${f}.${l}${rng.int(10, 99)}` : style === 1 ? `${f}${l.charAt(0)}${rng.int(1980, 2006)}`
    : style === 2 ? `${f.charAt(0)}${l}${rng.int(1, 999)}` : `${f}_${l}${rng.int(10, 99)}`;
  return `${local}@${pickWeighted(rng, MAIL_DOMAINS)}`;
}

/** TikTok-style pseudo: "lea_du_34", "mama2loulous", "thomas.rdn". */
export function handleFor(rng: Rng, first?: string): string {
  const f = slug(first ?? rng.pick(FIRST_NAMES));
  const style = rng.int(0, 4);
  if (style === 0) return `${f}_${rng.pick(HANDLE_PARTS)}_${rng.int(10, 99)}`;
  if (style === 1) return `${rng.pick(HANDLE_PARTS)}${f}${rng.int(1, 9)}`;
  if (style === 2) return `${f}.${slug(rng.pick(LAST_NAMES)).slice(0, 3)}`;
  if (style === 3) return `${f}${rng.int(1990, 2009)}`;
  return `${f}_${slug(rng.pick(LAST_NAMES))}`;
}

/** Buyer archetype: calm majority, difficult share set by the difficulty profile. */
export function buyerArchetype(rng: Rng, difficulty: Difficulty): CustomerArchetype {
  const share = DIFFICULTY[difficulty]?.annoyingShare ?? 0.3;
  return rng.chance(share) ? pickWeighted(rng, CUSTOMER_ARCHETYPES.annoying) : pickWeighted(rng, CUSTOMER_ARCHETYPES.calm);
}

/** Archetype of a non-buyer who writes in (scammer, troll, curious prospect…). */
export function senderArchetype(rng: Rng, intent: MessageIntent): CustomerArchetype {
  switch (intent) {
    case 'arnaque': return 'arnaqueur';
    case 'troll': return 'troll';
    case 'sur_mesure': return 'demande_sur_mesure';
    case 'compliment': return 'superfan';
    case 'question': return rng.chance(0.25) ? 'sceptique' : rng.chance(0.2) ? 'perdu' : 'normal';
    default: return 'normal';
  }
}

const PATIENCE: Record<CustomerArchetype, [number, number]> = {
  normal: [0.5, 0.8], impatient: [0.05, 0.25], sceptique: [0.3, 0.6], chasseur_de_remboursement: [0.2, 0.5], troll: [0.1, 0.4],
  karen: [0, 0.15], perdu: [0.5, 0.9], superfan: [0.7, 1], arnaqueur: [0.2, 0.5], menace_chargeback: [0.05, 0.25], demande_sur_mesure: [0.4, 0.8],
};

export function createCustomer(world: WorldState, rng: Rng, archetype: CustomerArchetype): Customer {
  const { first, last } = randomName(rng);
  const [lo, hi] = PATIENCE[archetype] ?? [0.4, 0.8];
  const c: Customer = {
    id: nextId(world, 'cus'),
    name: `${first} ${last}`,
    email: emailFor(rng, first, last),
    archetype,
    patience: Math.round((lo + (hi - lo) * rng.next()) * 100) / 100,
    orders: [],
    satisfaction: archetype === 'superfan' ? 0.6 : archetype === 'karen' || archetype === 'troll' ? -0.3 : 0,
  };
  world.market.customers.push(c);
  return c;
}

export function firstName(c: Customer | undefined): string {
  return c ? c.name.split(' ')[0]! : 'Client';
}

/** UI-safe display name: "Sophie Martin" → "Sophie M." ; pseudos ("@lea_du_34") and single words stay as they are. */
export function displayName(c: Pick<Customer, 'name'> | undefined | null): string {
  const name = String(c?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return 'Client';
  if (name.startsWith('@')) return name;
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const initial = parts[parts.length - 1]!.charAt(0).toUpperCase();
  return initial ? `${parts[0]} ${initial}.` : parts[0]!;
}

export function customerById(world: WorldState, id: string): Customer | undefined {
  return world.market.customers.find((c) => c.id === id);
}
