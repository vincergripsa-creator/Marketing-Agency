/** Weekly HR review: agent scores, XP levels, promotions, coaching rules, rh/revue-semaine-N.md. */
import type { BrainVault } from '../contracts.js';
import type { DeptId, WorldState } from '../shared.js';
import { clamp, emit } from '../core/index.js';
import { retroAgent } from './data.js';
import { addRule, agentNoteName, COACHING_PREFIX, writePlaybookNotes } from './playbooks.js';
import { DEPT_PLAYBOOK_LABELS, fmtNum, plural, shorten } from './text.js';

/** XP needed to reach level 1..10 (index = level - 1). */
export const LEVEL_THRESHOLDS = [0, 60, 150, 280, 450, 680, 960, 1300, 1700, 2200] as const;
export const MAX_LEVEL = LEVEL_THRESHOLDS.length;
const PROMOTION_XP = 60;
const GOOD_WEEK_XP = 20;

export function levelForXp(xp: number): number {
  let level = 1;
  LEVEL_THRESHOLDS.forEach((t, i) => {
    if (xp >= t) level = i + 1;
  });
  return level;
}

interface Counters { done: number; approved: number; rejected: number; changes: number; failed: number; notes: string[] }

const empty = (): Counters => ({ done: 0, approved: 0, rejected: 0, changes: 0, failed: 0, notes: [] });

function countersFromTasks(world: WorldState, fromDay: number, toDay: number): Map<string, Counters> {
  const out = new Map<string, Counters>();
  for (const t of world.company.tasks ?? []) {
    if (!t.assignee) continue;
    const c = out.get(t.assignee) ?? empty();
    if (t.status === 'done' && t.dayDone != null && t.dayDone >= fromDay && t.dayDone <= toDay) c.done++;
    const failDay = t.dayDone ?? t.dayCreated;
    if (t.status === 'failed' && failDay >= fromDay && failDay <= toDay) c.failed++;
    for (const r of t.reviews ?? []) {
      if (r.day < fromDay || r.day > toDay) continue;
      if (r.verdict === 'approve') c.approved++;
      else {
        if (r.verdict === 'reject') c.rejected++;
        else c.changes++;
        c.notes.push(...(r.notes ?? []));
      }
    }
    out.set(t.assignee, c);
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function deptName(world: WorldState, dept: DeptId): string {
  return (world.company.departments ?? []).find((d) => d.id === dept)?.name ?? DEPT_PLAYBOOK_LABELS[dept] ?? dept;
}

function topNote(notes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const n of notes) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? shorten(best[0], 80) : null;
}

export async function performanceReview(world: WorldState, brain: BrainVault): Promise<string[]> {
  const day = world.day;
  const week = Math.max(1, Math.ceil(day / 7));
  const agents = world.company.agents ?? [];
  const nora = retroAgent(world);
  const noraId = nora?.id ?? 'nora';
  if (agents.length === 0) return [`Revue RH semaine ${week} : aucun agent à évaluer.`];

  const weekly = countersFromTasks(world, day - 6, day);
  const lifetime = countersFromTasks(world, 1, day);

  // cumulative counters maintained by the runtime, or derived from the task history when absent
  const totals = new Map<string, { done: number; approved: number; rejected: number; failed: number }>();
  for (const a of agents) {
    const p = a.perf ?? { done: 0, approved: 0, rejected: 0, failed: 0, score: 0 };
    const hasPerf = p.done + p.approved + p.rejected + p.failed > 0;
    const l = lifetime.get(a.id) ?? empty();
    totals.set(a.id, hasPerf ? { done: p.done, approved: p.approved, rejected: p.rejected, failed: p.failed } : { done: l.done, approved: l.approved, rejected: l.rejected, failed: l.failed });
  }
  const activeIds = agents.filter((a) => {
    const t = totals.get(a.id)!;
    return t.done + t.approved + t.rejected + t.failed > 0;
  }).map((a) => a.id);
  const refDone = Math.max(3, median(activeIds.map((id) => totals.get(id)!.done)));

  const scores = new Map<string, number>();
  for (const a of agents) {
    a.perf ??= { done: 0, approved: 0, rejected: 0, failed: 0, score: 0 };
    const t = totals.get(a.id)!;
    if (!activeIds.includes(a.id)) {
      if (!a.perf.score) a.perf.score = 70;
      scores.set(a.id, a.perf.score);
      continue;
    }
    const w = weekly.get(a.id) ?? empty();
    const approval = (t.approved + 3.2) / (t.approved + t.rejected + 4); // prior 80 % with weight 4
    const reliability = (t.done + 3) / (t.done + t.failed + 3);
    const volume = Math.min(1, t.done / refDone);
    const current = 100 * (0.5 * approval + 0.35 * reliability + 0.15 * volume) - Math.min(10, w.changes * 2);
    const prev = a.perf.score;
    const score = Math.round(clamp(prev > 0 ? 0.3 * prev + 0.7 * current : current, 0, 100));
    a.perf.score = score;
    scores.set(a.id, score);
  }

  const lines: string[] = [];
  const changed = new Set<string>();
  const avg = Math.round(agents.reduce((s, a) => s + (scores.get(a.id) ?? 0), 0) / agents.length);
  lines.push(`Revue RH semaine ${week} : score moyen ${avg}/100 sur ${plural(agents.length, 'agent', 'agents')} (${activeIds.length} actifs).`);

  // promotions: top 3 active agents with a solid score
  const ranked = agents.filter((a) => activeIds.includes(a.id)).sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || (totals.get(b.id)!.done - totals.get(a.id)!.done));
  const promoted = ranked.filter((a) => (scores.get(a.id) ?? 0) >= 70).slice(0, 3);
  const promotionLines: string[] = [];
  for (const a of promoted) {
    a.xp = (a.xp ?? 0) + PROMOTION_XP;
    a.level = Math.min(MAX_LEVEL, Math.max(a.level ?? 1, levelForXp(a.xp)) + 1);
    a.xp = Math.max(a.xp, LEVEL_THRESHOLDS[a.level - 1] ?? a.xp);
    const w = weekly.get(a.id) ?? empty();
    const line = `Promotion : ${a.name} (${deptName(world, a.dept)}) passe niveau ${a.level} — score ${scores.get(a.id)}/100, ${plural(w.done, 'tâche terminée', 'tâches terminées')} cette semaine, ${plural(w.rejected, 'rejet', 'rejets')}.`;
    lines.push(line);
    promotionLines.push(line);
    changed.add(a.id);
    emit(world, { agentId: noraId, kind: 'meeting', toAgentId: a.id, text: `Félicitations ${a.name} : promotion au niveau ${a.level} !` });
  }

  // XP levels for everyone else
  const levelUps: string[] = [];
  for (const a of agents) {
    if (promoted.includes(a)) continue;
    if ((scores.get(a.id) ?? 0) >= 75 && activeIds.includes(a.id)) a.xp = (a.xp ?? 0) + GOOD_WEEK_XP;
    const lvl = Math.min(MAX_LEVEL, Math.max(a.level ?? 1, levelForXp(a.xp ?? 0)));
    if (lvl > (a.level ?? 1)) {
      a.level = lvl;
      levelUps.push(`Montée de niveau : ${a.name} atteint le niveau ${lvl} (${fmtNum(a.xp)} XP).`);
      changed.add(a.id);
    } else a.level = a.level ?? 1;
  }
  lines.push(...levelUps);

  // coaching for low performers, lifted for those who recovered
  const coachingLines: string[] = [];
  for (const a of agents) {
    if (!activeIds.includes(a.id)) continue;
    const score = scores.get(a.id) ?? 0;
    const t = totals.get(a.id)!;
    const w = weekly.get(a.id) ?? empty();
    const pb = (world.company.playbooks ??= {})[a.id] ?? [];
    if (score < 55 && t.rejected + t.failed + w.changes >= 2) {
      const reviews = t.approved + t.rejected;
      const note = topNote(w.notes);
      const failHeavy = safeShare(t.failed, t.done + t.failed) >= safeShare(t.rejected, reviews);
      const rule = failHeavy
        ? `${COACHING_PREFIX} lire le cerveau et découper la tâche avant de commencer (${plural(t.failed, 'échec', 'échecs')} sur ${plural(t.done + t.failed, 'tâche', 'tâches')}).`
        : `${COACHING_PREFIX} relire les notes de revue précédentes et la checklist avant de rendre (${plural(t.rejected, 'rejet', 'rejets')} sur ${plural(reviews, 'revue', 'revues')}${note ? ` ; motif fréquent : « ${note} »` : ''}).`;
      addRule(world, a.id, rule, COACHING_PREFIX);
      const line = `Coaching : ${a.name} (${deptName(world, a.dept)}), score ${score}/100 — ${failHeavy ? `${plural(t.failed, 'échec', 'échecs')} à analyser` : `${plural(t.rejected, 'rejet', 'rejets')} en revue`}.`;
      lines.push(line);
      coachingLines.push(line);
      changed.add(a.id);
      emit(world, { agentId: noraId, kind: 'review', toAgentId: a.id, text: `Point coaching avec ${a.name} : ${failHeavy ? 'découper et lire le cerveau avant d’agir' : 'relire les retours de revue avant de rendre'}.` });
    } else if (score >= 70 && pb.some((r) => r.startsWith(COACHING_PREFIX))) {
      world.company.playbooks[a.id] = pb.filter((r) => !r.startsWith(COACHING_PREFIX));
      const line = `Coaching levé : ${a.name} est remonté à ${score}/100.`;
      lines.push(line);
      coachingLines.push(line);
      changed.add(a.id);
    }
  }

  // departments
  const depts = new Map<DeptId, number[]>();
  for (const a of agents) if (activeIds.includes(a.id)) depts.set(a.dept, [...(depts.get(a.dept) ?? []), scores.get(a.id) ?? 0]);
  const deptRows = [...depts].map(([d, s]) => ({ d, avg: Math.round(s.reduce((x, y) => x + y, 0) / s.length), n: s.length })).sort((a, b) => b.avg - a.avg);
  if (deptRows.length >= 2) {
    const best = deptRows[0]!;
    const worst = deptRows[deptRows.length - 1]!;
    lines.push(`Département le plus solide : ${deptName(world, best.d)} (${best.avg}/100) · à surveiller : ${deptName(world, worst.d)} (${worst.avg}/100).`);
  }

  // rh/revue-semaine-N.md
  const table = [
    '| Agent | Département | Rôle | Score | Niveau | Terminées (sem.) | Approuvées | Rejetées | Échecs |',
    '|---|---|---|---|---|---|---|---|---|',
    ...[...agents]
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
      .map((a) => {
        const t = totals.get(a.id)!;
        const w = weekly.get(a.id) ?? empty();
        return `| [[${agentNoteName(world, a)}]] | ${deptName(world, a.dept)} | ${a.role || '—'} | ${scores.get(a.id) ?? 0}/100${activeIds.includes(a.id) ? '' : ' (inactif)'} | ${a.level ?? 1} | ${w.done} | ${t.approved} | ${t.rejected} | ${t.failed} |`;
      }),
  ].join('\n');
  const body = [
    `> ${lines[0]}`,
    '',
    '## Promotions',
    ...(promotionLines.length ? promotionLines.map((l) => `- ${l}`) : ['- Aucune promotion cette semaine (score ≥ 70 requis).']),
    ...(levelUps.length ? ['', '## Montées de niveau', ...levelUps.map((l) => `- ${l}`)] : []),
    '',
    '## Coaching',
    ...(coachingLines.length ? coachingLines.map((l) => `- ${l}`) : ['- Personne sous le seuil de 55/100 avec assez de données.']),
    '',
    '## Départements',
    ...(deptRows.length
      ? ['| Département | Score moyen | Agents actifs |', '|---|---|---|', ...deptRows.map((r) => `| ${deptName(world, r.d)} | ${r.avg}/100 | ${r.n} |`)]
      : ['_Aucun agent actif cette semaine : pas encore de tâche terminée ni de revue._']),
    '',
    '## Tableau des agents',
    table,
    '',
    '## Méthode',
    'Score = 50 % taux d’approbation en revue (a priori 80 %) + 35 % fiabilité (tâches terminées sans échec) + 15 % volume (vs médiane), lissé avec la semaine précédente. Promotion : top 3 avec un score ≥ 70. Coaching : score < 55 avec au moins 2 rejets ou échecs.',
    '',
    [week > 1 ? `Semaine précédente : [[revue-semaine-${week - 1}]]` : null, '[[Playbook RH]]', '[[00 - Accueil]]'].filter(Boolean).join(' · '),
  ].join('\n');
  emit(world, { agentId: noraId, kind: 'meeting', text: shorten(lines[0]!, 140) });
  try {
    await brain.write({ path: `rh/revue-semaine-${week}.md`, title: `Revue RH — semaine ${week}`, tags: ['rh', 'revue'], body, day });
    if (changed.size) await writePlaybookNotes(world, brain, changed, day);
    emit(world, { agentId: noraId, kind: 'brain_write', text: `${nora?.name ?? 'Nora'} écrit la revue RH de la semaine ${week} dans le cerveau.` });
  } catch (err) {
    // scores, levels and coaching rules are already applied to the world: a disk error only loses the note
    emit(world, { agentId: noraId, kind: 'thought', text: shorten(`${nora?.name ?? 'Nora'} n'arrive pas à écrire la revue RH (${err instanceof Error ? err.message : String(err)})`, 160) });
  }
  return lines;
}

function safeShare(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

