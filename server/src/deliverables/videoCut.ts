/**
 * The cut of an ad (video §3): what the editor decided, as a plain plan. It lives in the world, in every run, and a render
 * only reads it. Each decision changes the file, so a bad editor makes a worse video, not a worse label. The talent behind
 * the decisions is never stored: `VideoCut` holds the decisions alone.
 */
import type { AdCreative, AdScene, BeatKind, ChapterContent, CutMetrics, Product, VideoBeat, VideoCut, VideoTempo, VoiceOfCustomer } from '../shared.js';
import type { Rng } from '../contracts.js';
import { clamp, round2 } from '../core/ids.js';
import { countWords, keyTokens, norm, overlap, stem, stemSet } from '../sim/text.js';
import { estimateSpeechSec } from './speech.js';

export const TEMPOS: readonly VideoTempo[] = ['calm', 'standard', 'fast'];
/** Who edits when talent is off: nobody in particular. */
export const EDIT_BASELINE = 0.62;

/** One draw per creative: a good editor has a bad day. */
const BAD_DAY_SD = 0.08;
const TEMPO_SHOT: Record<VideoTempo, number> = { calm: 1.2, standard: 1, fast: 0.8 };
/** What a beat holds after its last word. The end card has its own hold. */
const BEAT_GAP = 0.16;
/** A strong editor raises the guide under the hook, this long after its first word. */
const GUIDE_IN_HOOK_SEC = 0.45;
/** `share` is a line that says what the voice says, `loose` a line on the same subject. Under that, a step still is the guide's own. */
const NEEDLE = { minChars: 18, maxChars: 70, minTokens: 2, share: 0.6, loose: 0.34 };
/** What a script says before its line: it opens every ad of its kind, so it says nothing of a page. */
const LEAD_IN = /^\s*(?:la méthode commence par un geste tout simple|un repère à garder en tête)\s*:\s*/iu;
/** Under this many pages the guide is a digest: it prints its steps, not its running text. */
const DIGEST_PAGES = 12;
/** A cut at a dash keeps a head at least this long. */
const DASH_HEAD = 20;
const PAIN_ITEMS = 2;
const PAIN_ITEM_CHARS = 70;
/** Of a phrase's key tokens, already in the voice: a second bubble saying the same words is no second voice. */
const PAIN_ECHO = 0.75;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const total = (ns: readonly number[]): number => ns.reduce((s, n) => s + n, 0);

interface Decisions {
  titleSec: number;            // logo card before the hook, 0 = none
  tighten: 0 | 1 | 2;
  shotSec: number;             // the shot length aimed at
  pages: number;               // real pages the cut may show: a plain editor stops at one
  holdPage: boolean;           // a plain editor holds his page on one shot
  guideSec: number | null;     // the guide enters during the hook, this long after its first word
  pain: boolean;               // the customers' own words, or a plain plate
  captionWords: number;        // 3 or under: the spoken word sits on a pill
  endHoldSec: number;
  sfx: boolean;
}

/** Video §3.3, one row per decision. `x` is the editor on the day. */
function decide(x: number, tempo: VideoTempo): Decisions {
  return {
    titleSec: x < 0.3 ? 0.8 : x < 0.5 ? 0.25 : 0,
    tighten: x < 0.35 ? 0 : x < 0.6 ? 1 : 2,
    shotSec: lerp(3.4, 1.4, x) * TEMPO_SHOT[tempo],
    pages: x < 0.1 ? 0 : x < 0.5 ? 1 : Infinity,
    holdPage: x < 0.3,
    guideSec: x >= 0.75 ? GUIDE_IN_HOOK_SEC : null,
    pain: x >= 0.4,
    captionWords: x < 0.3 ? 6 : x < 0.6 ? 3 : 2,
    endHoldSec: x < 0.3 ? 0.8 : x < 0.5 ? 1.2 : x < 0.75 ? 1.5 : 1.8, // on the bands the title and the guide already show: a `lerp` gave the editor's day away to anyone with the file (D129)
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
 * sentence, and the title in apposition in the last scene: the card shows it, a voice reading it holds the ad for six
 * seconds. Level 2: also the head of a dash.
 */
export function tightenSpoken(voiceover: string, level: number, last = false): string {
  let t = voiceover.trim();
  if (level >= 1) {
    t = firstSentence(t);
    if (last) t = t.replace(/\s*,\s*«[^»]*»\s*,\s*/, ' ');
  }
  if (level >= 2) t = cutAtDash(t);
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

/** The line a scene says, without the words every ad of its kind opens on. */
export const leadOut = (spoken: string): string => spoken.replace(LEAD_IN, '');

const spokenStem = (w: string): string => stem(norm(w).replace(/^[a-z]+'/, '').replace(/[^a-z0-9]/g, ''));

/**
 * Where the voice says a printed line, in words of `spoken`: the stretch that holds the most of its key tokens, the first
 * one on a tie, from its first such word to its last. A word the line does not hold is no anchor: « la », « le ».
 */
export function saidSpan(needle: string, spoken: readonly string[]): { from: number; to: number } | null {
  const tokens = new Set(keyTokens(needle).map(stem));
  const stems = spoken.map(spokenStem);
  const reach = Math.max(4, tokens.size * 2);
  let best: { from: number; to: number } | null = null;
  let most = 0;
  stems.forEach((first, from) => {
    if (!tokens.has(first)) return;
    const seen = new Set<string>();
    let to = from;
    for (let i = from; i < Math.min(stems.length, from + reach); i++) {
      if (tokens.has(stems[i]!)) { seen.add(stems[i]!); to = i; }
    }
    if (seen.size > most) { most = seen.size; best = { from, to }; }
  });
  return best;
}

/** The label a page does not print: the box of a checklist says « fait », the frame of an example says what it is. */
const printedLine = (s: string): string => s.replace(/^\s*\d+\s*[.)]\s*/, '').replace(/^\s*[-•*]\s*/, '').replace(/^(?:fait|je ne fais plus|exemple type)[\s\u00a0]*:\s*/iu, '').replace(/\s*:\s*fait\.?$/iu, '');

const sentencesIn = (blocks: readonly (string | null | undefined)[]): string[] => blocks
  .flatMap((b) => (b ?? '').split(/(?<=[.!?…])\s+/))
  .map((s) => printedLine(s.trim()).replace(/[\s.!?…:;,]+$/, ''));

const stepsOf = (c: ChapterContent): string[] => sentencesIn(c.steps ?? []);

/** A chapter as its pages print it. A digest keeps its steps: the running text stays in the full guide. */
const printedOf = (c: ChapterContent, digest: boolean): string[] => (digest ? stepsOf(c) : [...sentencesIn(c.paragraphs ?? []), ...stepsOf(c), ...sentencesIn([c.example, ...(c.checklist ?? [])])]);

/** The chapter's intro prints on its opener, under a giant numeral that makes a poor close-up: the last page a beat should land on. */
const openerOf = (c: ChapterContent, digest: boolean): string[] => (digest ? [] : sentencesIn([c.intro]));

const fitsNeedle = (s: string, taken: ReadonlySet<string>): boolean => s.length >= NEEDLE.minChars && s.length <= NEEDLE.maxChars && !taken.has(s);

/** A line too long for the marker is marked up to its first clause: the page prints that head too, the voice says it too. */
const markable = (s: string): string => (s.length > NEEDLE.maxChars ? /^[^:;,—–]+/.exec(s)?.[0].trim() ?? s : s);

/**
 * The line the marker sweeps on the real page, copied from what the pages print, or there is no proof. Of the lines that
 * say what the voice says, the one it says first: the marker lands when the viewer hears it. Else the closest line on its
 * subject; else the first step of the method, which is what a scene about the method shows. Never a line that was not
 * printed, so a page can always be found. `spoken` is what the viewer hears, not what the script held: an editor's cut is a line gone.
 */
function findNeedle(product: Product, spoken: string, taken: ReadonlySet<string>, step: boolean): VideoBeat['proof'] {
  const chapters = product.content?.chapters ?? [];
  const digest = (product.pdfFacts?.pages ?? DIGEST_PAGES) < DIGEST_PAGES;
  const heard = leadOut(spoken);
  const said = stemSet(heard);
  const voice = heard.split(/\s+/);
  const lineAmong = (linesOf: (c: ChapterContent, digest: boolean) => string[]): VideoBeat['proof'] => {
    let best: NonNullable<VideoBeat['proof']> | null = null;
    let bestAt = Infinity;
    let close: NonNullable<VideoBeat['proof']> | null = null;
    let closest = 0;
    chapters.forEach((c, chapter) => {
      for (const line of linesOf(c, digest)) {
        const s = markable(line);
        if (!fitsNeedle(s, taken)) continue;
        const tokens = keyTokens(s);
        if (tokens.length < NEEDLE.minTokens) continue;
        const share = overlap(tokens, said);
        if (share >= NEEDLE.share) {
          const at = saidSpan(s, voice)?.from ?? Infinity;
          if (at < bestAt || (at === bestAt && s.length > (best?.needle.length ?? 0))) { best = { chapter, needle: s }; bestAt = at; }
        }
        if (share >= NEEDLE.loose && share > closest) { closest = share; close = { chapter, needle: s }; }
      }
    });
    return best ?? close;
  };
  const found = lineAmong(printedOf) ?? lineAmong(openerOf);
  if (found || !step) return found;
  for (const [chapter, c] of chapters.entries()) {
    const needle = stepsOf(c).map(markable).find((s) => fitsNeedle(s, taken));
    if (needle) return { chapter, needle };
  }
  return null;
}

/** A scene where the voice reads a buyer's review, and the review it reads. The review is real or the scene says nothing of one. */
export function reviewQuote(voiceover: string): string | null {
  return /\bacheteu/i.test(voiceover) ? /«\s*([^»]+?)\s*»/.exec(voiceover)?.[1] ?? null : null;
}

/** Real customer phrases next to the bubble: research, never invented, never a word the platform refuses. */
function painItems(voc: VoiceOfCustomer, said: string): string[] {
  const banned = voc.bannedClaims.map(norm);
  const heard = stemSet(said);
  return voc.phrases.filter((p) => p.length <= PAIN_ITEM_CHARS && overlap(keyTokens(p), heard) < PAIN_ECHO && !banned.some((b) => norm(p).includes(b))).slice(0, PAIN_ITEMS);
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
  const inHook = beats[hook]?.kind === 'hook' ? d.guideSec : null; // a slide has no guide to raise: claiming one would be a label (D9)
  return {
    estSec: round2(estSec),
    hookWordSec: round2(hookWordSec),
    productSec: inHook !== null ? round2(hookWordSec + inHook) : guide < 0 ? null : round2(startOf(guide)),
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
  let pagesLeft = d.pages;
  const beats: VideoBeat[] = d.titleSec ? [{ kind: 'title_card', scene: 0, spoken: '', screen: '', estSec: d.titleSec, shots: 1 }] : [];

  const kindOf = (role: SceneRole, proof: VideoBeat['proof'], mustShow: boolean): BeatKind => {
    if (!voiced) return role === 'end' ? 'end_card' : 'slide';
    switch (role) {
      case 'hook': return 'hook';
      case 'end': return 'end_card';
      case 'bonus': return 'bonus_stack';
      case 'pain': return narrated ? 'narrator' : d.pain ? 'pain_bubble' : 'fact_card';
      case 'step': return narrated && !mustShow ? 'narrator' : proof ? 'page_proof' : 'fact_card';
      default: return proof ? 'page_proof' : 'fact_card';
    }
  };

  const roles = scenes.map((scene, i) => roleOf(scene, i, scenes.length));
  // The scene after the hook is the viewer's problem, in a customer's words or not: it is the narrator's to say.
  if (narrated && roles[1] === 'proof' && !reviewQuote(scenes[1]!.voiceover ?? '')) roles[1] = 'pain';
  const spokenOf = (i: number): string => (voiced ? tightenSpoken(scenes[i]!.voiceover ?? '', d.tighten, roles[i] === 'end') : '');
  const showsPage = (i: number): boolean => voiced && (roles[i] === 'step' || roles[i] === 'proof') && !reviewQuote(scenes[i]!.voiceover ?? '');
  /** A later scene of its own will fill the frame with a page: the narrator may keep this one beside him. */
  const pageLater = (from: number, line: VideoBeat['proof']): boolean => scenes.some((_, j) => j > from && roles[j] === 'proof' && showsPage(j)
    && !!findNeedle(product, spokenOf(j), new Set([...taken, ...(line ? [line.needle] : [])]), false));

  scenes.forEach((scene, i) => {
    const role = roles[i]!;
    const voiceover = scene.voiceover ?? '';
    const spoken = spokenOf(i);
    const screen = scene.onScreenText || (role === 'hook' ? creative.hook : '');
    const stepLine = narrated && role === 'step' && d.pages > 0 && showsPage(i) ? findNeedle(product, spoken, taken, true) : null;
    // On a phone a page beside the narrator does not read: each cut with pages fills the frame with one, on a line the voice says.
    const later = stepLine ? pageLater(i, stepLine) : false;
    const inset = narrated && d.pain && role === 'step' && later;
    const wantsProof = showsPage(i) && (narrated && role === 'step' ? inset || (!later && pagesLeft > 0) : pagesLeft > 0);
    const proof = wantsProof ? findNeedle(product, spoken, taken, role === 'step') : null;
    if (proof) taken.add(proof.needle);
    const kind = kindOf(role, proof, !later && !!proof);
    if (kind === 'page_proof') pagesLeft -= 1;
    const quote = voiced ? null : reviewQuote(voiceover); // the card shows the buyer's words: it stays long enough to read them
    const base = spoken ? estimateSpeechSec(spoken) : readingSec(quote ?? screen);
    const estSec = round2(role === 'end' ? base + d.endHoldSec : spoken ? base + BEAT_GAP : base);
    beats.push({
      kind, scene: i, spoken, screen, estSec,
      shots: still || (kind === 'page_proof' && d.holdPage) ? 1 : Math.max(1, Math.ceil(estSec / d.shotSec)),
      ...(proof ? { proof } : {}),
      ...(kind === 'pain_bubble' ? { items: painItems(voc, voiceover) } : {}),
    });
  });

  return { v: 1, tempo, beats, metrics: metricsOf(beats, d, voiced, still), sfx: d.sfx && !still, craft: 0 };
}
