/**
 * Reads the structured research items (see `knowledge` in shared/types.ts). The research samples each
 * array item by item, so the structure lives inside each string and survives whatever subset came back:
 * a fix never leaves its mistake, a step keeps its rank even when two research passes are merged.
 */
import type { VoiceOfCustomer } from '../../shared.js';
import { bare, clean, norm, sentence, splitSentences, uniqBy } from '../util.js';

export interface MethodStep {
  text: string;            // the action, one sentence without final dot
  detail: string;          // how / why, may be empty
  rank: number;            // order of the method
  when: string | null;     // moment of the plan (« jours 1 à 14 », « mi-mai », « 6 mois avant »)
  duration: string | null; // working time (« 45 min »)
  diagnostic: boolean;     // the observation step: done before the plan starts
  from: number | null;     // numeric start of `when` when it is a range of plan units
  to: number | null;
}

export interface MistakePair { mistake: string; why: string; fix: string | null }
export interface Situation { when: string; what: string }

export interface Material {
  steps: MethodStep[];
  pairs: MistakePair[];
  situations: Situation[];
  tips: string[];
  facts: string[];
  examples: string[];
  observe: string[];   // what to look for in the diagnostic chapter
  keep: string[];      // how to keep the result
  models: string[];    // ready-to-copy models (a sample day, a message, a calculation)
}

const OBSERVE = /^Observer\s*:\s*/iu;
const KEEP = /^Tenir\s*:\s*/iu;
const MODEL = /^Modèle\s*:\s*/iu;
const TOPIC = /^\[([a-z0-9-]+)\]\s*/;
const STEP_TAG = /\s*\(étape\s+(\d+)(?:\s*;\s*([^)]*))?\)\s*\.?\s*$/iu;
const RANGE = /^(?:jours?|nuits?|semaines?|soirs?)\s+(\d+)(?:\s+(?:à|et)\s+(\d+))?$/iu;
/** First step of a research without tags: observing or taking stock comes before the plan. */
const DIAGNOSTIC = /^(noter|observer|tenir un (journal|carnet)|mesurer|inspecter|faire l['’]inventaire|passer un test blanc|lister)\b/iu;
const SITUATION = /^Si\s+(.+?)\s+:\s+(.+)$/su;

export function parseStep(raw: string, index: number): MethodStep {
  const tag = STEP_TAG.exec(raw);
  const body = tag ? raw.slice(0, tag.index) : raw;
  const parts = (tag?.[2] ?? '').split(';').map(clean).filter(Boolean);
  const diagnostic = parts.some((p) => norm(p) === 'diagnostic') || (!tag && index === 0 && DIAGNOSTIC.test(bare(body)));
  const [when = null, duration = null] = parts.filter((p) => norm(p) !== 'diagnostic');
  const range = when ? RANGE.exec(when) : null;
  const sents = splitSentences(body);
  return {
    text: bare(sents[0] ?? body),
    detail: sents.slice(1).join(' '),
    rank: tag ? Number(tag[1]) : index + 1,
    when,
    duration,
    diagnostic,
    from: range ? Number(range[1]) : null,
    to: range ? Number(range[2] ?? range[1]) : null,
  };
}

export function parseMistake(raw: string): MistakePair {
  const [left = '', ...right] = raw.split(/\s+→\s+/);
  const sents = splitSentences(left);
  return { mistake: bare(sents[0] ?? left), why: sents.slice(1).join(' '), fix: right.length ? sentence(right.join(' ')) : null };
}

export function parseSituation(raw: string): Situation | null {
  const m = SITUATION.exec(clean(raw));
  return m ? { when: bare(m[1]!), what: sentence(m[2]!) } : null;
}

function emptyMaterial(): Material {
  return { steps: [], pairs: [], situations: [], tips: [], facts: [], examples: [], observe: [], keep: [], models: [] };
}

/** Splits a raw item from its optional « [sujet] » prefix. */
function split(raw: string): { topic: string | null; text: string } {
  const t = clean(raw);
  const m = TOPIC.exec(t);
  return m ? { topic: m[1]!, text: t.slice(m[0].length) } : { topic: null, text: t };
}

/** The core guide's material and one material per follow-up sub-problem. */
export function parseKnowledge(k: VoiceOfCustomer['knowledge']): { core: Material; topics: Record<string, Material> } {
  const core = emptyMaterial();
  const topics: Record<string, Material> = {};
  const into = (topic: string | null): Material => (topic ? (topics[topic] ??= emptyMaterial()) : core);
  const each = (arr: readonly string[] | undefined, fn: (m: Material, text: string, i: number) => void): void => {
    (arr ?? []).forEach((raw, i) => {
      const { topic, text } = split(raw);
      if (text) fn(into(topic), text, i);
    });
  };
  each(k.tips, (m, text) => {
    if (OBSERVE.test(text)) { m.observe.push(sentence(text.replace(OBSERVE, ''))); return; }
    if (KEEP.test(text)) { m.keep.push(sentence(text.replace(KEEP, ''))); return; }
    const s = parseSituation(text);
    if (s) m.situations.push(s);
    else m.tips.push(text);
  });
  each(k.steps, (m, text) => { m.steps.push(parseStep(text, m.steps.length)); });
  each(k.mistakes, (m, text) => { m.pairs.push(parseMistake(text)); });
  each(k.facts, (m, text) => { m.facts.push(text); });
  each(k.examples, (m, text) => {
    if (MODEL.test(text)) m.models.push(sentence(text.replace(MODEL, '')));
    else m.examples.push(text);
  });
  for (const m of [core, ...Object.values(topics)]) {
    // two merged research passes may shuffle the steps: the rank restores the method's order
    m.steps = uniqBy(m.steps, (s) => norm(s.text)).sort((a, b) => a.rank - b.rank);
    m.pairs = uniqBy(m.pairs, (p) => norm(p.mistake));
  }
  return { core, topics };
}
