/**
 * Shared context handed to every handler: the world, the minds, the brain, the market tools,
 * plus helpers to write real files, record deliverables and keep the brain alive.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Activity, ActivityKind, AgentId, AgentState, Deliverable, NicheBrief, Office, Product, Task, TaskKind, VoiceOfCustomer, WorldState,
} from '../shared.js';
import type { BrainVault, CompanyOptions, ContentEngine, MarketTools, RunPaths, Rng } from '../contracts.js';
import { emit, nextId } from '../core/index.js';
import { officerId } from './org/officers.js';
import { errorText } from './util.js';

export interface RuntimeCtx {
  world: WorldState;
  engine: ContentEngine;
  brain: BrainVault;
  tools: MarketTools;
  rng: Rng;
  /** Channel decisions: its own stream, rebuilt each tick. */
  channelRng: Rng;
  paths: RunPaths;
  /** Today's notable events (French), handed to the evening retro. */
  incidents: string[];
  /** Notes of the last market close (for the daily report). */
  lastMarketNotes: string[];
  /** Runs a task of a pillar right now, like the retro. Never waits for the founder (D48). */
  ritual(kind: TaskKind, agentId: AgentId, title: string): Promise<void>;
  /** Where compaction hands the rows it removes. Absent: they are dropped. */
  archive?: CompanyOptions['archive'];
}

export function say(ctx: RuntimeCtx, agentId: AgentId | null, text: string, kind: Activity['kind'] = 'thought', refs?: Activity['refs'], extra?: Pick<Activity, 'toAgentId' | 'place'>): Activity {
  return emit(ctx.world, { agentId, kind, text, ...(refs ? { refs } : {}), ...(extra ?? {}) });
}

/** A line in the voice of whoever holds an office today. */
export function speak(ctx: RuntimeCtx, office: Office, text: string, kind: ActivityKind = 'thought', refs?: Activity['refs']): Activity {
  const id = officerId(ctx.world, office);
  return say(ctx, id, `${nameOf(ctx, id)} : ${text}`, kind, refs);
}

export function incident(ctx: RuntimeCtx, text: string): void {
  if (!ctx.incidents.includes(text)) ctx.incidents.push(text);
  if (ctx.incidents.length > 60) ctx.incidents.splice(0, ctx.incidents.length - 60);
}

export function agentOf(ctx: RuntimeCtx, id: AgentId | null | undefined): AgentState | undefined {
  return id ? ctx.world.company.agents.find((a) => a.id === id) : undefined;
}

export function nameOf(ctx: RuntimeCtx, id: AgentId | null | undefined): string {
  return agentOf(ctx, id)?.name ?? 'Quelqu’un';
}

export function productOf(ctx: RuntimeCtx, id: unknown): Product | undefined {
  return typeof id === 'string' ? ctx.world.company.products.find((p) => p.id === id) : undefined;
}

// ───────────────────────────── Files & deliverables ─────────────────────────────

/** Run-relative path ("files/prd_3/v1/guide.pdf") → absolute path. */
export function absPath(ctx: RuntimeCtx, rel: string): string {
  return join(ctx.paths.root, ...rel.split('/'));
}

export async function writeRunFile(ctx: RuntimeCtx, rel: string, data: string | Uint8Array): Promise<string> {
  const abs = absPath(ctx, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return abs;
}

export async function readRunFile(ctx: RuntimeCtx, rel: string | null | undefined): Promise<string | null> {
  if (!rel) return null;
  try {
    return await readFile(absPath(ctx, rel), 'utf8');
  } catch {
    return null;
  }
}

export function runFileExists(ctx: RuntimeCtx, rel: string | null | undefined): boolean {
  return !!rel && existsSync(absPath(ctx, rel));
}

export function versionDir(product: Product): string {
  return `files/${product.id}/v${product.version}`;
}

export function addDeliverable(ctx: RuntimeCtx, d: Omit<Deliverable, 'id' | 'day'>, task?: Task): Deliverable {
  const deliverable: Deliverable = { id: nextId(ctx.world, 'liv'), day: ctx.world.day, ...d };
  ctx.world.company.deliverables.push(deliverable);
  if (task && !task.deliverableIds.includes(deliverable.id)) task.deliverableIds.push(deliverable.id);
  const q = deliverable.quality !== null ? ` (qualité ${Math.round(deliverable.quality)}/100)` : '';
  say(ctx, d.createdBy, `${nameOf(ctx, d.createdBy)} livre : ${deliverable.title}${q}`, 'deliverable', {
    deliverableId: deliverable.id,
    ...(deliverable.productId ? { productId: deliverable.productId } : {}),
    ...(deliverable.creativeId ? { creativeId: deliverable.creativeId } : {}),
    ...(task ? { taskId: task.id } : {}),
  });
  return deliverable;
}

// ───────────────────────────── Brain ─────────────────────────────

export interface NoteInput { path: string; title: string; tags: string[]; body: string }

/** Writes a brain note (brain-relative path), emits 'brain_write'. Never throws. */
export async function writeNote(ctx: RuntimeCtx, agentId: AgentId, note: NoteInput, refs?: Activity['refs']): Promise<boolean> {
  try {
    await ctx.brain.write({ ...note, day: ctx.world.day });
    say(ctx, agentId, `${nameOf(ctx, agentId)} écrit dans le cerveau : ${note.title}`, 'brain_write', refs);
    return true;
  } catch (e) {
    say(ctx, agentId, `${nameOf(ctx, agentId)} n'arrive pas à écrire « ${note.title} » dans le cerveau (${errorText(e)})`, 'thought', refs);
    return false;
  }
}

/** Appends to a note, creating it when missing. */
export async function appendNote(ctx: RuntimeCtx, agentId: AgentId, note: NoteInput, refs?: Activity['refs']): Promise<boolean> {
  try {
    const existing = await ctx.brain.read(note.path);
    if (existing) {
      await ctx.brain.append(note.path, note.body, ctx.world.day);
      say(ctx, agentId, `${nameOf(ctx, agentId)} complète la note « ${existing.title || note.title} »`, 'brain_write', refs);
      return true;
    }
  } catch {
    /* fall through to a full write */
  }
  return writeNote(ctx, agentId, note, refs);
}

// ───────────────────────────── Research access ─────────────────────────────

export function emptyVoc(nicheId: string): VoiceOfCustomer {
  return {
    nicheId, depth: 'quick', pains: [], phrases: [], objections: [], desiredOutcomes: [],
    knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [],
  };
}

/** Known VoC for a niche; runs a quick (free) mining pass when nothing is known yet. */
export function vocOf(ctx: RuntimeCtx, nicheId: string): VoiceOfCustomer {
  const known = ctx.world.company.research.voc[nicheId];
  if (known) return known;
  try {
    const voc = ctx.tools.minePains(nicheId, 'quick');
    ctx.world.company.research.voc[nicheId] = voc;
    return voc;
  } catch {
    return emptyVoc(nicheId);
  }
}

export function nicheBriefOf(ctx: RuntimeCtx, nicheId: string): NicheBrief {
  let brief: NicheBrief | null = null;
  try {
    brief = ctx.tools.nicheBrief(nicheId);
  } catch {
    brief = null;
  }
  if (brief) return brief;
  const t = ctx.world.company.research.trends.find((s) => s.nicheId === nicheId);
  const p = ctx.world.company.products.find((x) => x.nicheId === nicheId);
  return {
    nicheId,
    name: t?.name ?? p?.title ?? nicheId,
    audience: t?.audience ?? p?.audience ?? 'lecteurs francophones',
    problem: p?.problem ?? '',
    category: t?.category ?? 'divers',
    keywords: [],
  };
}

/** The niche brief seen through a product (audience/problem of the product win: rule of one, upsells). */
export function productBrief(ctx: RuntimeCtx, product: Product): NicheBrief {
  const b = nicheBriefOf(ctx, product.nicheId);
  return { ...b, audience: product.audience || b.audience, problem: product.problem || b.problem };
}

export function nicheName(ctx: RuntimeCtx, nicheId: string): string {
  return ctx.world.company.research.trends.find((s) => s.nicheId === nicheId)?.name ?? nicheBriefOf(ctx, nicheId).name;
}

/** Output of the newest done task of a kind for a product. */
export function latestOutput(world: WorldState, kind: TaskKind, productId: string): Record<string, unknown> | null {
  for (let i = world.company.tasks.length - 1; i >= 0; i--) {
    const t = world.company.tasks[i]!;
    if (t.kind === kind && t.status === 'done' && t.input.productId === productId && t.output) return t.output;
  }
  return null;
}

export function doneOutputs(world: WorldState, kind: TaskKind, productId: string): Record<string, unknown>[] {
  return world.company.tasks
    .filter((t) => t.kind === kind && t.status === 'done' && t.input.productId === productId && t.output)
    .map((t) => t.output!);
}
