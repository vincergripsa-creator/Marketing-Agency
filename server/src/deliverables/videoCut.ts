/**
 * The cut of an ad (video §3): what the editor decided, as a plain plan. It lives in the world, in every run, and a render
 * only reads it. Each decision changes the file, so a bad editor makes a worse video, not a worse label. The talent behind
 * the decisions is never stored: `VideoCut` holds the decisions alone.
 */
import type { AdCreative, AdScene, BeatKind, ChapterContent, CutMetrics, PdfContent, Product, VideoBeat, VideoCut, VideoTempo, VoiceOfCustomer } from '../shared.js';
import type { Rng } from '../contracts.js';
import { clamp, round2 } from '../core/ids.js';
import { countWords, keyTokens, norm, overlap, stemSet } from '../sim/text.js';
import { estimateSpeechSec } from './speech.js';

export const TEMPOS: readonly VideoTempo[] = ['calm', 'standard', 'fast'];
/** Who edits when talent is off: nobody in particular. */
export const EDIT_BASELINE = 0.62;

/** One draw per creative: a good editor has a bad day. */
const BAD_DAY_SD = 0.08;
const TEMPO_SHOT: Record<VideoTempo, number> = { calm: 1.2, standard: 1, fast: 0.8 };
/** What a beat holds after its last word. The end card has its own hold. */
const BEAT_GAP = 0.16;
/** The guide rises under the hook, this long after its first word. */
const GUIDE_IN_HOOK_SEC = 0.45;
const NEEDLE = { minChars: 18, maxChars: 70, minTokens: 2, share: 0.6 };
/** A cut at a dash keeps a head at least this long. */
const DASH_HEAD = 20;
const PAIN_ITEMS = 2;
const PAIN_ITEM_CHARS = 70;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const total = (ns: readonly number[]): number => ns.reduce((s, n) => s + n, 0);

interface Decisions {
  titleSec: number;            // logo card before the hook, 0 = none
  tighten: 0 | 1 | 2;
  shotSec: number;             // the shot length aimed at
  proof: boolean;              // a real page when a needle exists
  guideEarly: boolean;         // the guide enters during the hook
  pain: boolean;               // the customers' own words, or a plain plate
  captionWords: number;        // 2: the spoken word sits on a pill
  endHoldSec: number;
  sfx: boolean;
}

/** Video §3.3, one row per decision. `x` is the editor on the day. */
function decide(x: number, tempo: VideoTempo): Decisions {
  return {
    titleSec: x < 0.3 ? 0.8 : x < 0.5 ? 0.25 : 0,
    tighten: x < 0.35 ? 0 : x < 0.6 ? 1 : 2,
    shotSec: lerp(3.4, 1.4, x) * TEMPO_SHOT[tempo],
    proof: x >= 0.5,
    guideEarly: x >= 0.75,
    pain: x >= 0.4,
    captionWords: x < 0.3 ? 6 : x < 0.6 ? 3 : 2,
    endHoldSec: lerp(0.6, 2, x),
    sfx: x >= 0.5,
  };
}

// ───────────────────────────── tightening ─────────────────────────────

/** Customer quotes hidden behind a filler of the same length: their punctuation is not the sentence's. */
const maskQuotes = (t: string): string => t.replace(/«[^»]*»/g, (m) => '_'.repeat(m.length));

/** Up to the end of the first real sentence: « 1. » is a number, not a sentence, and « … et » goes on. */
function firstSentence(t: string): string {
  for (const m of maskQuotes(t).matchAll(/[.!?…]\s+(?=[\p{Lu}_])/gu)) {
    const head = t.slice(0, m.index + 1);
    if (countWords(head) >= 3) return head;
  }
  return t;
}

const OPEN_NE = /(?:^|[^a-z])n(?:e |')/;
const CLOSES_NE = /\b(?:pas|jamais|plus|rien|aucune?|personne|ni|que|guere|nulle?)\b/;
/** A head ending on one of these has not finished its clause. */
const DANGLING = /\b(?:et|ou|mais|donc|or|ni|car|de|du|des|a|au|aux|le|la|les|un|une|que|qui|si|pour|avec|sans|dans|sur|par|en|ce|cet|cette|ces|son|sa|ses|mon|ma|mes|ton|ta|tes)$/;
/** A clause opening on one of these waits for its main clause: « Si les plantes grillent en juillet » says nothing yet. */
const SUBORDINATE = /^(?:si|s'il|quand|lorsque?|des que|avant|apres|pour|parce|puisque?|comme|tant que|afin)\b/;
/** A tail opening on one of these takes back part of the head: without it the sentence says more than the script. */
const QUALIFIES = /^(?:mais|sauf|sans|pas|ni|non|jamais|meme si|a condition|seulement|uniquement)\b/;

/** « head — tail » becomes the head, only when the head stands on its own. A second dash, a « ne » without its « pas » or a « si » without its answer say the tail finishes it. */
function cutAtDash(t: string): string {
  const masked = maskQuotes(t);
  const at = masked.indexOf(' — ');
  if (at < DASH_HEAD) return t;
  const tail = masked.slice(at + 3);
  const head = norm(t.slice(0, at));
  const clause = head.split(' : ').at(-1)!;
  if (tail.includes(' — ') || (OPEN_NE.test(clause) && !CLOSES_NE.test(clause)) || DANGLING.test(head) || SUBORDINATE.test(clause) || QUALIFIES.test(norm(tail))) return t;
  return t.slice(0, at);
}

/**
 * Deletes at sentence or clause boundaries only, so no negation can be lost and no word appears. Level 1: the first
 * sentence. Level 2: also the head of a dash, and the title in apposition in the last scene.
 */
export function tightenSpoken(voiceover: string, level: number, last = false): string {
  let t = voiceover.trim();
  if (level >= 1) t = firstSentence(t);
  if (level >= 2) {
    t = cutAtDash(t);
    if (last) t = t.replace(/\s*,\s*«[^»]*»\s*,\s*/, ' ');
  }
  return t;
}

// ───────────────────────────── scenes ─────────────────────────────

export type SceneRole = 'hook' | 'pain' | 'step' | 'bonus' | 'proof' | 'end';

/** Reads the text alone, so that a Claude-written ad works too. A buyer's quoted review is proof, never a comment seen online. */
export function roleOf(scene: AdScene, index: number, count: number): SceneRole {
  if (index === 0) return 'hook';
  if (index === count - 1) return 'end';
  const said = norm(`${scene.onScreenText ?? ''} ${scene.voiceover ?? ''}`);
  if (/\bacheteu|\bavis\b/.test(said)) return 'proof';
  if (said.includes('«')) return 'pain';
  if (/^\d\./.test(norm(scene.onScreenText ?? '')) || /\betapes?\b/.test(said)) return 'step';
  return /\bbonus\b/.test(said) ? 'bonus' : 'proof';
}

function sentencesOf(c: ChapterContent): string[] {
  const blocks = [c.intro, ...(c.paragraphs ?? []), ...(c.steps ?? []), c.example ?? '', ...(c.checklist ?? [])];
  return blocks.flatMap((b) => (b ?? '').split(/(?<=[.!?…])\s+/)).map((s) => s.trim().replace(/[\s.!?…:;,]+$/, ''));
}

/**
 * The longest sentence of the guide that shares most of its words with what this scene says: the line the marker sweeps
 * on the real page. It is copied from the chapter, or there is no proof.
 */
function findNeedle(content: PdfContent | null, voiceover: string, taken: ReadonlySet<string>): VideoBeat['proof'] {
  const said = stemSet(voiceover);
  let best: NonNullable<VideoBeat['proof']> | null = null;
  (content?.chapters ?? []).forEach((c, chapter) => {
    for (const s of sentencesOf(c)) {
      if (s.length < NEEDLE.minChars || s.length > NEEDLE.maxChars || s.length <= (best?.needle.length ?? 0) || taken.has(s)) continue;
      const tokens = keyTokens(s);
      if (tokens.length >= NEEDLE.minTokens && overlap(tokens, said) >= NEEDLE.share) best = { chapter, needle: s };
    }
  });
  return best;
}

/** Real customer phrases next to the bubble: research, never invented, never a word the platform refuses. */
function painItems(voc: VoiceOfCustomer, said: string): string[] {
  const banned = voc.bannedClaims.map(norm);
  const heard = norm(said);
  return voc.phrases.filter((p) => p.length <= PAIN_ITEM_CHARS && !heard.includes(norm(p)) && !banned.some((b) => norm(p).includes(b))).slice(0, PAIN_ITEMS);
}

const readingSec = (screen: string): number => Math.max(1.8, countWords(screen) / 2.6 + 0.5);

// ───────────────────────────── the plan ─────────────────────────────

const SHOWS_GUIDE: ReadonlySet<BeatKind> = new Set<BeatKind>(['page_proof', 'bonus_stack', 'end_card']);

function metricsOf(beats: readonly VideoBeat[], d: Decisions, voiced: boolean, still: boolean): CutMetrics {
  const estSec = total(beats.map((b) => b.estSec));
  const shots = total(beats.map((b) => b.shots));
  const startOf = (i: number): number => total(beats.slice(0, i).map((b) => b.estSec));
  const hook = beats.findIndex((b) => b.kind === 'hook' || b.kind === 'slide');
  const guide = beats.findIndex((b) => SHOWS_GUIDE.has(b.kind) || !!b.proof);
  const hookWordSec = hook < 0 ? 0 : startOf(hook);
  const risesInHook = d.guideEarly && beats[hook]?.kind === 'hook'; // a slide has no guide to raise: claiming one would be a label (D9)
  return {
    estSec: round2(estSec),
    hookWordSec: round2(hookWordSec),
    productSec: risesInHook ? round2(hookWordSec + GUIDE_IN_HOOK_SEC) : guide < 0 ? null : round2(startOf(guide)),
    avgShotSec: still || !shots ? 0 : round2(estSec / shots), // cards have no shots: 0 is how a carousel reads
    kinds: new Set(beats.filter((b) => b.kind !== 'title_card').map((b) => b.kind)).size,
    captionWords: voiced ? d.captionWords : Math.max(0, ...beats.map((b) => countWords(b.screen))),
    endHoldSec: round2(d.endHoldSec),
  };
}

/**
 * Draws exactly one number. `craft` stays 0: the caller stores `scoreCut` there, the market recomputes it from the metrics
 * anyway. `skill` goes no further than this function.
 */
export function planCut(input: { creative: AdCreative; product: Product; voc: VoiceOfCustomer; skill: number; tempo: VideoTempo; rng: Rng }): VideoCut {
  const { creative, product, voc, skill, tempo, rng } = input;
  const d = decide(clamp(skill + rng.normal(0, BAD_DAY_SD), 0, 1), tempo);
  const { format } = creative;
  const scenes = creative.scenes ?? [];
  const narrated = format === 'ugc_avatar';
  const voiced = narrated || format === 'faceless_voiceover';
  const still = !voiced && format !== 'text_slideshow';
  const taken = new Set<string>();
  const beats: VideoBeat[] = d.titleSec ? [{ kind: 'title_card', scene: 0, spoken: '', screen: '', estSec: d.titleSec, shots: 1 }] : [];

  const kindOf = (role: SceneRole, proof: VideoBeat['proof']): BeatKind => {
    if (!voiced) return role === 'end' ? 'end_card' : 'slide';
    switch (role) {
      case 'hook': return 'hook';
      case 'end': return 'end_card';
      case 'bonus': return 'bonus_stack';
      case 'pain': return !d.pain ? 'fact_card' : narrated ? 'narrator' : 'pain_bubble';
      case 'step': return narrated && d.pain ? 'narrator' : proof ? 'page_proof' : 'fact_card';
      default: return proof ? 'page_proof' : 'fact_card';
    }
  };

  scenes.forEach((scene, i) => {
    const role = roleOf(scene, i, scenes.length);
    const voiceover = scene.voiceover ?? '';
    const spoken = voiced ? tightenSpoken(voiceover, d.tighten, role === 'end') : '';
    const screen = scene.onScreenText || (role === 'hook' ? creative.hook : '');
    const wantsProof = voiced && d.proof && (role === 'step' || role === 'proof');
    const proof = wantsProof ? findNeedle(product.content, voiceover, taken) : null;
    if (proof) taken.add(proof.needle);
    const kind = kindOf(role, proof);
    const base = spoken ? estimateSpeechSec(spoken) : readingSec(screen);
    const estSec = round2(role === 'end' ? base + d.endHoldSec : spoken ? base + BEAT_GAP : base);
    beats.push({
      kind, scene: i, spoken, screen, estSec,
      shots: still ? 1 : Math.max(1, Math.ceil(estSec / d.shotSec)),
      ...(proof ? { proof } : {}),
      ...(kind === 'pain_bubble' ? { items: painItems(voc, voiceover) } : {}),
    });
  });

  return { v: 1, tempo, beats, metrics: metricsOf(beats, d, voiced, still), sfx: d.sfx && !still, craft: 0 };
}
