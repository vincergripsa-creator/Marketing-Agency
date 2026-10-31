import type { TypeVoice } from '../shared.js';
import type { FaceName } from './fonts.js';

/** One type voice: the faces of a family of guides, and the body size its text face reads best at. */
export interface Voice { id: TypeVoice; display: FaceName; displayIt: FaceName; deck: FaceName; text: FaceName; textIt: FaceName; textB: FaceName; label: FaceName; labelB: FaceName; body: number }

export const VOICES: Record<TypeVoice, Voice> = {
  conte: { id: 'conte', display: 'fraunces-900-normal', displayIt: 'fraunces-600-italic', deck: 'fraunces-600-normal', text: 'source-serif-4-400-normal', textIt: 'source-serif-4-400-italic', textB: 'source-serif-4-600-normal', label: 'inter-500-normal', labelB: 'inter-700-normal', body: 10.3 },
  dossier: { id: 'dossier', display: 'playfair-display-900-normal', displayIt: 'playfair-display-500-italic', deck: 'playfair-display-700-normal', text: 'spectral-400-normal', textIt: 'spectral-400-italic', textB: 'spectral-600-normal', label: 'inter-500-normal', labelB: 'inter-700-normal', body: 10.4 },
  atelier: { id: 'atelier', display: 'dm-serif-display-400-normal', displayIt: 'dm-serif-display-400-italic', deck: 'dm-serif-display-400-normal', text: 'lora-400-normal', textIt: 'lora-400-italic', textB: 'lora-600-normal', label: 'dm-sans-500-normal', labelB: 'dm-sans-700-normal', body: 10.1 },
  signal: { id: 'signal', display: 'bricolage-grotesque-800-normal', displayIt: 'bricolage-grotesque-500-normal', deck: 'bricolage-grotesque-700-normal', text: 'inter-400-normal', textIt: 'inter-500-normal', textB: 'inter-600-normal', label: 'archivo-narrow-500-normal', labelB: 'archivo-narrow-700-normal', body: 9.6 },
};

/** The rescue voice (pdf §3.3): standard PDF fonts, nothing to load, nothing embedded. */
export const STD_VOICE: Voice = { id: 'conte', display: 'Times-Bold', displayIt: 'Times-Italic', deck: 'Times-Bold', text: 'Times-Roman', textIt: 'Times-Italic', textB: 'Times-Bold', label: 'Helvetica', labelB: 'Helvetica-Bold', body: 10.2 };

const FAMILY_VOICE: Record<string, TypeVoice> = {
  parentalite: 'conte', animaux: 'conte', mental: 'conte',
  argent: 'dossier', etudes: 'dossier', mariage: 'dossier',
  maison: 'atelier', cuisine: 'atelier',
  sante: 'signal', tech: 'signal', voyage: 'signal',
};

export const facesOf = (v: Voice): FaceName[] => [...new Set([v.display, v.displayIt, v.deck, v.text, v.textIt, v.textB, v.label, v.labelB])];

/** The voice of a niche family. `hint` is the normalised art hint of `designFor`: a hint outranks the family. */
export function voiceFor(family: string | null | undefined, hint = ''): TypeVoice {
  if (/elegan|luxe|chic|classique/.test(hint)) return 'dossier';
  if (/sobre|moderne|tech/.test(hint)) return 'signal';
  return (family && FAMILY_VOICE[family]) || 'conte';
}

export const isVoice = (v: unknown): v is TypeVoice => typeof v === 'string' && Object.hasOwn(VOICES, v);
