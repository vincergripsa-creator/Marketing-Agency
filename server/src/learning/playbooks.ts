/** Playbooks: learned rules per agent (bounded), routed by lesson topic, mirrored as brain notes. */
import type { BrainVault } from '../contracts.js';
import type { AgentState, DeptId, Lesson, WorldState } from '../shared.js';
import { basenameOf } from './markdown.js';
import { DEPT_PLAYBOOK_LABELS, fmtPct, fold, safeFileName, shorten, unique } from './text.js';

/** One niche holds up to 4 directives: 24 rules leave room for a real portfolio without growing with the run. */
export const MAX_RULES = 24;
/** A directive acts on what the agent does; prose only informs. An overflow drops prose first. */
const DIRECTIVE_PRIORITY = 0.25;
export const COACHING_PREFIX = 'Coaching RH :';

/** Which departments receive a lesson of a given topic ('chiefs' = every department chief). */
export const TOPIC_DEPTS: Record<Lesson['topic'], DeptId[] | 'chiefs'> = {
  ads: ['growth'],
  pricing: ['boutique'],
  product: ['studio', 'creation'],
  support: ['support'],
  niche: ['recherche', 'direction'],
  finance: ['finance', 'direction'],
  partnership: ['partenariats'],
  process: 'chiefs',
};

/** Machine-readable rule patterns honoured by the heuristic engine (see shared conventions). */
export const RULE_PATTERNS: readonly RegExp[] = [
  /Ne jamais écrire « [^»]+ »/,
  /Privilégier le hook « [a-z_]+ »/,
  /Privilégier le format « [a-z_]+ »/,
  /Prix cible « \d+ »/,
  /Niveau de promesse max « [\d.]+ »/,
  /Ton support « [^»]+ »/,
];

export function hasMachineRule(text: string): boolean {
  return RULE_PATTERNS.some((re) => re.test(text));
}

export function quotedTerms(text: string): string[] {
  return [...String(text ?? '').matchAll(/«\s*([^»]+?)\s*»/g)].map((m) => fold(m[1]!));
}

function ruleKey(rule: string): string {
  return fold(rule).replace(/\s+/g, ' ').trim();
}

/** Short human title of a lesson (first clause of the insight). */
export function lessonTitle(l: Pick<Lesson, 'insight'>): string {
  const first = String(l.insight ?? '').split(/\s:\s|\.\s/)[0] ?? '';
  return shorten(first.replace(/[.\s]+$/, ''), 90) || 'Leçon';
}

/** "[[jour-003-pub-mot-interdit-garanti|Ne jamais écrire « garanti » dans une pub]]" */
export function lessonLink(l: Pick<Lesson, 'insight' | 'notePath'>): string {
  const alias = lessonTitle(l).replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  return `[[${basenameOf(l.notePath)}|${alias}]]`;
}

/**
 * Agents whose playbook receives a lesson: the topic's departments (+ extra departments, + matching roles).
 * `routeOnly`: only the extra departments and the CEO (e.g. a process issue of one team).
 */
export function agentsForLesson(
  world: WorldState, topic: Lesson['topic'], extraDepts: readonly DeptId[] = [], roles: readonly string[] = [], routeOnly = false,
): AgentState[] {
  const agents = world.company.agents ?? [];
  const route = routeOnly && extraDepts.length ? 'only' : (TOPIC_DEPTS[topic] ?? 'chiefs');
  const depts = new Set<DeptId>([...(route === 'chiefs' || route === 'only' ? [] : route), ...extraDepts]);
  const roleKeys = roles.map((r) => fold(r).trim()).filter((r) => r.length >= 3);
  return agents.filter((a) => {
    if (depts.has(a.dept)) return true;
    if (route === 'chiefs' && a.isChief) return true;
    if (route === 'only' && a.isChief && a.dept === 'direction') return true;
    if (roleKeys.length === 0) return false;
    const role = fold(a.role);
    return roleKeys.some((r) => r === a.dept || r === fold(a.name) || r === a.id || role.includes(r) || (role.length >= 4 && r.includes(role)));
  });
}

/** Confidence used to rank rules when a playbook overflows. */
function ruleConfidence(world: WorldState, rule: string): number {
  const key = ruleKey(rule);
  const lesson = (world.company.lessons ?? []).find((l) => ruleKey(l.insight) === key);
  if (lesson) return lesson.confidence;
  if (rule.startsWith(COACHING_PREFIX)) return 0.5;
  if (BANNED_RX.test(rule)) return 0.9; // a banned claim was learned the hard way: it goes last
  return 0.55; // seed rules written by the runtime
}

function trimPlaybook(world: WorldState, agentId: string, pb: string[], keep: string): void {
  while (pb.length > MAX_RULES) {
    let worst = -1;
    let worstRank = Infinity;
    pb.forEach((rule, i) => {
      if (rule === keep) return;
      const rank = ruleConfidence(world, rule) + (hasMachineRule(rule) ? DIRECTIVE_PRIORITY : 0);
      if (rank < worstRank) { // strict: on ties the oldest (lowest index) goes first
        worstRank = rank;
        worst = i;
      }
    });
    if (worst < 0) break;
    const [gone] = pb.splice(worst, 1);
    // `appliesTo` says who holds the rule: a later confirmation of the lesson can bring it back to this agent
    const key = ruleKey(gone!);
    for (const l of world.company.lessons ?? []) {
      if (ruleKey(l.insight) === key) l.appliesTo = l.appliesTo.filter((id) => id !== agentId);
    }
  }
}

const BANNED_RX = /Ne jamais écrire\s*«\s*([^»]+?)\s*»/i;
/** Same regexes as the runtime's parser: these directives are singletons ("last rule wins"). */
const SINGLETON_RX: readonly RegExp[] = [
  /Privilégier le hook\s*«\s*([^»]+?)\s*»/i,
  /Privilégier le format\s*«\s*([^»]+?)\s*»/i,
  /Prix cible\s*«\s*([^»]+?)\s*»/i,
  /Niveau de promesse max\s*«\s*([^»]+?)\s*»/i,
  /Ton support\s*«\s*([^»]+?)\s*»/i,
];

const TONE_RX = SINGLETON_RX.length - 1;
/** « … sur « Niche » » right after a directive scopes it to one niche (same reading as the runtime's parser). */
const SCOPE_RX = /^\s*(?:\([^)]*\)\s*)?sur\s*«\s*([^»]+?)\s*»/i;

/** Directive family of a rule: same family = same slot in the playbook. Each niche has its own slot; the support tone has one. */
export function directiveKind(rule: string): string | null {
  const b = BANNED_RX.exec(rule);
  if (b) return `banned:${fold(b[1]!.trim())}`;
  for (const [i, rx] of SINGLETON_RX.entries()) {
    const m = rx.exec(rule);
    if (!m) continue;
    const scope = i === TONE_RX ? null : SCOPE_RX.exec(rule.slice(m.index + m[0].length));
    return `single:${i}:${scope ? fold(scope[1]!) : ''}`;
  }
  return null;
}

/** Slot of a one-value directive (hook, format, price, promise, tone), null for anything else. */
export function directiveSlot(rule: string): string | null {
  const kind = directiveKind(rule);
  return kind?.startsWith('single:') ? kind : null;
}

/**
 * Adds a rule to an agent's playbook (at most MAX_RULES; prose goes before directives, then lowest confidence, then oldest).
 * A rule carrying the same directive as an existing one (same banned word, or the same singleton pattern)
 * replaces it in place — unless the old singleton is clearly better supported ('skipped').
 * `replacePrefix`: an existing rule starting with it is replaced in place (one coaching rule per agent).
 */
export function addRule(world: WorldState, agentId: string, rule: string, replacePrefix?: string): 'added' | 'present' | 'replaced' | 'skipped' {
  const text = String(rule ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'present';
  const books = (world.company.playbooks ??= {});
  const pb = (books[agentId] ??= []);
  const key = ruleKey(text);
  if (pb.some((r) => ruleKey(r) === key)) return 'present';
  if (replacePrefix) {
    const i = pb.findIndex((r) => r.startsWith(replacePrefix));
    if (i >= 0) {
      pb[i] = text;
      return 'replaced';
    }
  }
  const kind = directiveKind(text);
  if (kind) {
    const i = pb.findIndex((r) => directiveKind(r) === kind);
    if (i >= 0) {
      if (kind.startsWith('single:') && ruleConfidence(world, text) + 0.15 < ruleConfidence(world, pb[i]!)) return 'skipped';
      pb[i] = text;
      return 'replaced';
    }
  }
  pb.push(text);
  trimPlaybook(world, agentId, pb, text);
  return pb.includes(text) ? 'added' : 'skipped';
}

/** Replaces a revised rule everywhere it appears. Returns the agents whose playbook changed. */
export function replaceRuleEverywhere(world: WorldState, oldRule: string, newRule: string): string[] {
  const changed: string[] = [];
  const oldKey = ruleKey(oldRule);
  for (const [agentId, pb] of Object.entries(world.company.playbooks ?? {})) {
    const i = pb.findIndex((r) => ruleKey(r) === oldKey);
    if (i < 0) continue;
    if (pb.some((r) => ruleKey(r) === ruleKey(newRule))) pb.splice(i, 1);
    else pb[i] = newRule;
    changed.push(agentId);
  }
  return changed;
}

/**
 * A directive holds one value across the whole agency: every other rule of that slot, in any playbook, becomes
 * this one (a measured lesson also beats an unmeasured seed rule). Returns the agents whose playbook changed.
 */
export function syncDirective(world: WorldState, rule: string): string[] {
  const slot = directiveSlot(rule);
  if (!slot) return [];
  const changed: string[] = [];
  for (const [agentId, pb] of Object.entries(world.company.playbooks ?? {})) {
    const first = pb.findIndex((r) => r !== rule && directiveSlot(r) === slot);
    if (first < 0) continue;
    if (!pb.includes(rule)) pb[first] = rule;
    world.company.playbooks[agentId] = pb.filter((r) => r === rule || directiveSlot(r) !== slot);
    changed.push(agentId);
  }
  return changed;
}

// ───────────────────────────── Brain notes ─────────────────────────────

export function deptNoteTitle(dept: DeptId): string {
  return `Playbook ${DEPT_PLAYBOOK_LABELS[dept] ?? dept}`;
}

/** Note name of an agent's playbook: the first name, disambiguated when two agents share it. */
export function agentNoteName(world: WorldState, agent: AgentState): string {
  const name = safeFileName(agent.name || agent.id);
  const twins = (world.company.agents ?? []).filter((a) => fold(safeFileName(a.name || a.id)) === fold(name));
  return twins.length > 1 ? safeFileName(`${name} (${agent.id})`) : name;
}

export function agentNotePath(world: WorldState, agent: AgentState): string {
  return `playbooks/${agentNoteName(world, agent)}.md`;
}

function lessonsOfRules(world: WorldState, rules: readonly string[]): Lesson[] {
  const keys = new Set(rules.map(ruleKey));
  return (world.company.lessons ?? []).filter((l) => keys.has(ruleKey(l.insight)));
}

function agentNoteBody(world: WorldState, agent: AgentState): string {
  const rules = world.company.playbooks?.[agent.id] ?? [];
  const lines: string[] = [];
  lines.push(`**Rôle** : ${agent.role || '—'} · **Département** : [[${deptNoteTitle(agent.dept)}]]${agent.isChief ? " · chef d'équipe" : ''}`);
  const score = Math.round(agent.perf?.score ?? 0);
  lines.push(`**Niveau** ${agent.level ?? 1} · **Score** ${score > 0 ? `${score}/100` : 'pas encore évalué'} · **Tâches terminées** ${agent.perf?.done ?? 0}`);
  if (agent.persona) lines.push('', `> ${agent.persona}`);
  lines.push('', `## Règles apprises (${rules.length}/${MAX_RULES})`);
  if (rules.length) rules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  else lines.push("_Aucune règle apprise pour l'instant : les rétros du soir rempliront ce playbook._");
  const sources = lessonsOfRules(world, rules);
  if (sources.length) {
    lines.push('', '## Leçons sources');
    for (const l of sources) lines.push(`- ${lessonLink(l)} — jour ${l.day}, confiance ${fmtPct(l.confidence, 0)}`);
  }
  lines.push('', 'Retour : [[00 - Accueil]]');
  return lines.join('\n');
}

/** Section of a department note maintained by the retro; everything else in the note (seed text) is kept. */
export const DEPT_RULES_SECTION = '## Règles en vigueur';

/** Header of a department note created from scratch (no seed note in the vault). */
function deptNoteIntro(world: WorldState, dept: DeptId): string {
  const def = (world.company.departments ?? []).find((d) => d.id === dept);
  const members = (world.company.agents ?? []).filter((a) => a.dept === dept).sort((a, b) => Number(b.isChief) - Number(a.isChief));
  const lines: string[] = [];
  lines.push(`Département **${def?.name ?? DEPT_PLAYBOOK_LABELS[dept] ?? dept}**${def?.description ? ` — ${def.description}` : ''}`);
  lines.push('', '## Équipe');
  if (members.length) for (const a of members) lines.push(`- [[${agentNoteName(world, a)}]] — ${a.role || 'agent'}${a.isChief ? ' (chef)' : ''}`);
  else lines.push('_Personne dans ce département pour le moment._');
  lines.push('', 'Retour : [[00 - Accueil]]');
  return lines.join('\n');
}

/** The maintained "## Règles en vigueur" section: rules currently in the team's playbooks + links to each member. */
export function deptRulesSection(world: WorldState, dept: DeptId, day: number): string {
  const members = (world.company.agents ?? []).filter((a) => a.dept === dept).sort((a, b) => Number(b.isChief) - Number(a.isChief));
  const lines: string[] = [DEPT_RULES_SECTION, `_Tenue à jour par la rétro du soir (jour ${day}) à partir des playbooks de l'équipe._`];
  if (members.length) lines.push('', `**Playbooks individuels** : ${members.map((a) => `[[${agentNoteName(world, a)}]]`).join(' · ')}`);
  const counts = new Map<string, number>();
  for (const a of members) for (const r of world.company.playbooks?.[a.id] ?? []) counts.set(r, (counts.get(r) ?? 0) + 1);
  lines.push('');
  if (counts.size) {
    for (const [r, n] of [...counts].sort((x, y) => y[1] - x[1])) lines.push(`- ${r}${members.length > 1 ? ` _(${n}/${members.length} agents)_` : ''}`);
  } else lines.push("_Aucune règle apprise pour le moment : les règles de départ s'appliquent._");
  return lines.join('\n');
}

/** Removes one "## Heading" section (up to the next level-2 heading) from a markdown body. */
export function removeSection(body: string, heading: string): string {
  const lines = String(body ?? '').split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === heading) {
      skipping = true;
      continue;
    }
    if (skipping && /^##\s+\S/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Department note body: the existing (seed) body untouched + the maintained rules section at the end. */
export function deptNoteBody(world: WorldState, dept: DeptId, day: number, existingBody: string | null): string {
  const base = existingBody !== null ? removeSection(existingBody, DEPT_RULES_SECTION) : deptNoteIntro(world, dept);
  return `${base.trimEnd()}${base.trim() ? '\n\n' : ''}${deptRulesSection(world, dept, day)}`;
}

/**
 * Writes playbooks/<Prénom>.md for the given agents and refreshes the "## Règles en vigueur" section of
 * "Playbook <Département>" for their departments. A department note shipped by the seed vault keeps its
 * title, tags and body: only that section is (re)written below it.
 */
export async function writePlaybookNotes(world: WorldState, brain: BrainVault, agentIds: Iterable<string>, day: number): Promise<number> {
  const ids = new Set(agentIds);
  const agents = (world.company.agents ?? []).filter((a) => ids.has(a.id));
  let written = 0;
  for (const a of agents) {
    await brain.write({ path: agentNotePath(world, a), title: a.name || a.id, tags: ['playbook', a.dept], body: agentNoteBody(world, a), day });
    written++;
  }
  for (const dept of unique(agents.map((a) => a.dept))) {
    const path = `playbooks/${deptNoteTitle(dept)}.md`;
    const existing = await brain.read(path);
    const own = existing && fold(existing.path) === fold(path) ? existing : null;
    await brain.write({
      path,
      title: own?.title || deptNoteTitle(dept),
      tags: unique([...(own?.tags ?? []), 'playbook', 'departement', dept]),
      body: deptNoteBody(world, dept, day, own ? own.body : null),
      day,
    });
    written++;
  }
  return written;
}
