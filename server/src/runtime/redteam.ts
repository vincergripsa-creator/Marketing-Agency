/**
 * The Red Team as the gate of publish_product. Its verdict on a finished guide is an order, not an opinion:
 *   go    the guide can ship;
 *   fix   targeted pass (humanize → render), then a new Red Team on the new file;
 *   kill  structural rewrite (plan → draft → … → render, new sales page), then a new Red Team.
 * A correction that leaves the file as it was changes nothing: the gate stays closed and the next cycle rebuilds the
 * guide from its plan, one cycle more if it was the last. After MAX_REWORK_CYCLES, the CEO decides on a file that did
 * change: ship with a logged waiver, or kill. A guide even the rebuild leaves as it was is held for the founder: no
 * waiver on a correction nobody made. Nothing waits forever.
 */
import type { PdfContent, Product, Task, VoiceOfCustomer, WorldState } from '../shared.js';
import type { GuideGaps, RedTeamFacts } from '../contracts.js';
import type { RuntimeCtx } from './ctx.js';
import { incident, nameOf, say, speak } from './ctx.js';
import { productNote } from './notes.js';
import { officerId } from './org/officers.js';
import { killProduct, productTitleFor, reworkRedTeam, shelveProduct } from './pipeline.js';
import { isOpen, logTask, refreshAgentScore } from './tasks.js';
import { clip, median, mean, numOf, short, str, strArr, uniq } from './util.js';

/** Rework cycles allowed on a guide before the CEO has to decide. */
export const MAX_REWORK_CYCLES = 2;
/** A pain is treated when one chapter uses at least this share of its words. */
const PAIN_COVERED = 0.5;
/** Below this conformity score a guide is not shipped on a waiver. */
const WAIVER_MIN_COMPLIANCE = 60;

const STOP = new Set(['pour', 'avec', 'sans', 'dans', 'votre', 'notre', 'leur', 'leurs', 'plus', 'tous', 'toutes', 'comme', 'entre', 'apres', 'avant', 'quand', 'faire', 'cette', 'chez', 'sous', 'depuis', 'moins', 'guide', 'methode', 'mais', 'elle', 'elles', 'nous', 'vous', 'sont', 'toujours', 'encore', 'alors', 'meme', 'tout', 'trop', 'bien', 'fait', 'font', 'etre', 'avoir', 'deja', 'rien', 'ceux', 'celle', 'donc', 'parce']);

const fold = (s: string): string => s.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g, '');
const stemsOf = (s: string): string[] => uniq(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 6)));

function chapterText(c: PdfContent['chapters'][number]): string {
  return [c.title, c.intro, ...c.paragraphs, ...c.steps, c.example ?? '', ...c.checklist].join(' ');
}

/** What a guide leaves out of the research: the pains no chapter treats, the chapters without an example. */
export function guideGaps(content: PdfContent, voc: VoiceOfCustomer | undefined): GuideGaps {
  const chapters = content.chapters.map((c) => new Set(stemsOf(chapterText(c))));
  const covered = (pain: string): boolean => {
    const words = stemsOf(pain);
    if (!words.length) return true;
    return chapters.some((set) => words.filter((w) => set.has(w)).length / words.length >= PAIN_COVERED);
  };
  return {
    pains: (voc?.pains ?? []).filter((p) => !covered(p)),
    chapters: content.chapters.filter((c) => (c.example ?? '').length <= 40).map((c) => c.title),
  };
}

/** The facts the Red Team checks: what the company's own research says, and what the guide really contains. */
export function redTeamFacts(ctx: RuntimeCtx, product: Product, subject: 'idea' | 'pdf' | 'sales_page' | 'ad'): RedTeamFacts {
  const { research } = ctx.world.company;
  const s = research.trends.find((t) => t.nicheId === product.nicheId);
  const comps = research.competitors[product.nicheId] ?? [];
  const voc = research.voc[product.nicheId];
  const gaps = subject === 'pdf' && product.content ? guideGaps(product.content, voc) : null;
  return {
    title: product.title, audience: product.audience, problem: product.problem, price: product.price > 0 ? product.price : null,
    signal: s ? { searchInterest: s.searchInterest, tiktokBuzz: s.tiktokBuzz, competition: s.competitionHint } : null,
    competitors: comps.length ? { count: comps.length, medianPrice: median(comps.map((c) => c.price)), avgRating: mean(comps.map((c) => c.rating)), reviews: comps.reduce((n, c) => n + c.reviews, 0) } : null,
    voc: voc ? { pains: voc.pains.length, medianAnchor: median(voc.priceAnchors.filter((p) => p > 0)), sensitiveClaims: voc.bannedClaims.length } : null,
    guide: gaps && product.content ? {
      promise: product.content.promise, wordCount: product.content.wordCount, painsKnown: voc?.pains.length ?? 0,
      uncoveredPains: gaps.pains, chaptersWithoutExample: gaps.chapters, chapters: product.content.chapters.length,
    } : null,
  };
}

/** Same guide = same print: what a buyer gets (text, visuals, design), not the bytes pdfkit happens to write. */
export function pdfFingerprint(product: Product): string {
  const text = JSON.stringify({ content: product.content, design: product.design });
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

const isPdfRun = (t: Task, p: Product): boolean => t.kind === 'red_team' && t.input.productId === p.id && t.input.subject === 'pdf'
  && t.status !== 'cancelled' && t.status !== 'failed' && t.output?.onLive !== true;

export interface RedTeamGate { state: 'clear' | 'waiting' | 'blocked'; reason: string | null; taskId: string | null; cycle: number }

/** May this version ship? Only what the Red Team said about the file in production counts. */
export function redTeamGate(world: WorldState, product: Product): RedTeamGate {
  const runs = world.company.tasks.filter((t) => isPdfRun(t, product) && (numOf(t.input.version) ?? 1) === product.version);
  const last = runs[runs.length - 1];
  if (!last) return { state: 'clear', reason: null, taskId: null, cycle: 0 };
  const cycle = numOf(last.input.cycle) ?? 0;
  if (isOpen(last)) return { state: 'waiting', reason: 'la Red Team relit le guide', taskId: last.id, cycle };
  if (last.output?.finalVerdict === 'go' || last.output?.waiver) return { state: 'clear', reason: null, taskId: null, cycle };
  return { state: 'blocked', reason: `la Red Team n'a pas validé le guide (verdict ${String(last.output?.finalVerdict ?? 'inconnu')})`, taskId: last.id, cycle };
}

/** The Red Team's refusal counts against the guide's author, like a reviewer's: perf score and weekly HR review. */
function blameAuthor(ctx: RuntimeCtx, product: Product, notes: string[]): void {
  const author = [...ctx.world.company.tasks].reverse().find((t) => t.kind === 'write_pdf' && t.status === 'done' && t.input.productId === product.id);
  if (!author) return;
  author.reviews.push({ by: officerId(ctx.world, 'ceo'), day: ctx.world.day, verdict: 'changes', notes: notes.slice(0, 3).map((n) => `Red Team : ${n}`) });
  const agent = ctx.world.company.agents.find((a) => a.id === author.assignee);
  if (agent) { agent.perf.rejected += 1; refreshAgentScore(agent); }
}

/** The end of the loop: a guide the Red Team still wants dead dies; a guide it only wants corrected ships on a logged waiver. */
async function decide(ctx: RuntimeCtx, task: Task, product: Product, verdict: string, reasons: string[]): Promise<void> {
  const why = clip(reasons[0] ?? 'risque trop élevé', 120);
  const ceo = officerId(ctx.world, 'ceo');
  if (verdict === 'kill' || (product.quality?.compliance ?? 100) < WAIVER_MIN_COMPLIANCE) {
    await killProduct(ctx, product, `la Red Team le refuse encore après ${MAX_REWORK_CYCLES} reprises (${why})`);
    return;
  }
  task.output = { ...(task.output ?? {}), waiver: { day: ctx.world.day, by: ceo, reasons: reasons.slice(0, 3) } };
  logTask(task, `Jour ${ctx.world.day} : dérogation de ${nameOf(ctx, ceo)} — ${why}`);
  incident(ctx, `Dérogation : « ${product.title} » sort malgré les réserves de la Red Team (${why})`);
  say(ctx, ceo, `${nameOf(ctx, ceo)} signe une dérogation : « ${short(product.title, 50)} » sort après ${MAX_REWORK_CYCLES} reprises, réserve notée pour la prochaine version (${short(why, 70)})`, 'thought', { productId: product.id, taskId: task.id });
  await productNote(ctx, product, ceo, 'Dérogation de mise en ligne', [`- Décision du jour ${ctx.world.day} après ${MAX_REWORK_CYCLES} reprises.`, ...reasons.slice(0, 3).map((r) => `- ${r}`)].join('\n'));
}

/** What follows the verdict on a guide: nothing (go), the next rework cycle, or the CEO's decision. */
export async function settleRedTeam(ctx: RuntimeCtx, task: Task, product: Product): Promise<void> {
  const out = task.output ?? {};
  const verdict = str(out.finalVerdict) ?? 'fix';
  const cycle = numOf(task.input.cycle) ?? 0;
  const ceo = officerId(ctx.world, 'ceo');
  if (verdict === 'go') {
    if (cycle > 0) speak(ctx, 'ceo', `la Red Team valide la reprise de « ${short(product.title, 50)} », la mise en ligne peut suivre`, 'thought', { productId: product.id, taskId: task.id });
    return;
  }
  const reasons = strArr(out.reasons);
  const fixes = strArr(out.fixes).slice(0, 4);
  blameAuthor(ctx, product, reasons);
  if (out.onLive === true) {
    incident(ctx, `La Red Team relit « ${product.title} » en ligne : ${short(reasons[0] ?? 'à corriger', 100)}`);
    return;
  }
  const unchanged = out.unchanged === true;
  if (cycle >= MAX_REWORK_CYCLES && !unchanged) { await decide(ctx, task, product, verdict, reasons); return; }
  if (cycle > MAX_REWORK_CYCLES) {
    const why = `la Red Team le bloque et même la reprise depuis le plan n'a rien changé (${clip(reasons[1] ?? reasons[0] ?? 'à corriger', 100)})`;
    shelveProduct(ctx, product, why);
    say(ctx, ceo, `${nameOf(ctx, ceo)} au fondateur : je ne signe pas de dérogation pour « ${short(product.title, 50)} », ${why}. Il reste hors ligne : dis « remets le guide en ligne » si tu prends le risque.`, 'founder', { productId: product.id, taskId: task.id });
    return;
  }
  const structural = verdict === 'kill' || unchanged;
  const gaps: GuideGaps | null = out.gaps && typeof out.gaps === 'object' ? out.gaps as GuideGaps : null;
  reworkRedTeam(ctx, product, { structural, fixes, gaps, cycle: cycle + 1, previousPrint: str(out.fingerprint) ?? '', previousVerdict: verdict, missionId: task.missionId });
  const turn = `reprise ${cycle + 1}/${Math.max(cycle + 1, MAX_REWORK_CYCLES)}`;
  incident(ctx, `La Red Team renvoie « ${product.title} » (${structural ? 'réécriture structurelle' : 'correction ciblée'}, ${turn}) : ${short(reasons[0] ?? 'promesse trop large', 100)}`);
  say(ctx, ceo, `${nameOf(ctx, ceo)} bloque la mise en ligne de « ${short(product.title, 40)} » : ${structural ? 'réécriture depuis le plan' : 'corrections'} (${turn}), puis nouvelle revue de ${nameOf(ctx, officerId(ctx.world, 'red_team'))}.`, 'thought', { productId: product.id, taskId: task.id });
}

/** A gate that closed with no rework left in flight (a step failed): one more Red Team run settles it. */
export function reopenGate(ctx: RuntimeCtx, product: Product, gate: RedTeamGate, missionId: string | null): Task | null {
  const last = ctx.world.company.tasks.find((t) => t.id === gate.taskId);
  if (!last) return null;
  return reworkRedTeam(ctx, product, { review: true, cycle: gate.cycle + 1, previousPrint: '', previousVerdict: str(last.output?.finalVerdict) ?? 'fix', missionId, title: productTitleFor('red_team', product, ' (nouvelle revue)') });
}
