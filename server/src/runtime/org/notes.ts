/**
 * What the organisation keeps in the brain (org §11): the chart, the week in numbers, the note of whoever left.
 * Each write is awaited (D55): a note landing behind the next brain.search would make a reload differ from a straight run.
 */
import type { AgentState, RoleId, WorldState } from '../../shared.js';
import { sameAccount } from '../../shared.js';
import { agentNoteName, agentNotePath, writeAlumnusNote, writeDeptNote, writePlaybookNotes } from '../../learning/playbooks.js';
import { openChannels } from '../channels.js';
import type { RuntimeCtx } from '../ctx.js';
import { say, writeNote } from '../ctx.js';
import { KIND_META } from '../tasks.js';
import { dec, errorText, eur, pct, short, sum } from '../util.js';
import { ROLES } from './catalog.js';
import { ORG } from './constants.js';
import { moneyRead } from './hiring.js';
import { officerId, ownersOfAny, roleHolders } from './officers.js';
import { payOf, payrollToday } from './payroll.js';

const CHART_PATH = 'entreprise/Organigramme.md';
const DAYS_PER_MONTH = 30;

function linkOf(w: WorldState, a: AgentState): string {
  return `[[${agentNoteName(w, a)}]]`;
}

function chartBody(w: WorldState): string {
  const { agents, departments, org } = w.company;
  const { payroll, revenue30 } = moneyRead(w, 'ceo');
  const lines = [
    `**Effectif** : ${agents.length} · **Masse salariale** : ${eur(payroll)} par jour (${eur(payroll * DAYS_PER_MONTH)} par mois) · **Revenu par tête** : ${eur(revenue30 / Math.max(1, agents.length))} par mois`,
    `_Tenu à jour à chaque embauche et chaque départ (jour ${w.day})._`,
    '', '## Départements ouverts',
  ];
  for (const d of departments) {
    lines.push('', `### ${d.name}`);
    for (const a of agents.filter((x) => x.dept === d.id).sort((x, y) => Number(y.isChief) - Number(x.isChief))) {
      const hats = a.hatKinds.map((k) => KIND_META[k].label);
      lines.push(`- ${linkOf(w, a)} — ${a.role}${a.isChief ? ' (chef)' : ''}${a.notice ? ', sur le départ' : ''}${hats.length ? ` · casquettes : ${hats.join(', ')}` : ''}`);
    }
  }
  if (org?.closedDepts.length) {
    lines.push('', '## Départements fermés');
    for (const d of org.closedDepts) {
      const host = org.deptHost[d.id];
      lines.push(`- ${d.name} : porté par ${departments.find((x) => x.id === host)?.name ?? host ?? 'la Direction'}`);
    }
  }
  const open = org?.positions.filter((p) => p.status === 'open') ?? [];
  if (open.length) {
    lines.push('', '## Postes ouverts');
    for (const p of open) lines.push(`- ${ROLES[p.roleId].title} : ${p.detail}`);
  }
  lines.push('', 'Liens : [[Recrutement]] · [[Playbook RH]] · [[00 - Accueil]]');
  return lines.join('\n');
}

/** The chart, rewritten at each change of the team. */
export async function writeOrgNote(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  await writeNote(ctx, officerId(w, 'hr'), { path: CHART_PATH, title: 'Organigramme', tags: ['entreprise', 'organigramme', 'rh'], body: chartBody(w) });
}

/** One line per role that has someone on it, or work waiting for someone: those who do it, what waited, how busy they were. A channel not open has no such role yet. */
function roleRow(w: WorldState, roleId: RoleId, days: NonNullable<WorldState['company']['org']>['load']): string | null {
  const role = ROLES[roleId];
  const n = Math.max(1, days.length);
  const wait = sum(days.flatMap((d) => role.core.map((k) => d.wait[k] ?? 0))) / n;
  const holders = roleHolders(w, roleId);
  if (!holders.length && (wait <= 0 || (role.channel && !openChannels(w).some((ch) => sameAccount(ch, role.channel!))))) return null;
  const owners = holders.length ? holders : ownersOfAny(w, role.core);
  const busy = sum(owners.flatMap((a) => days.map((d) => d.busy[a.id] ?? 0)));
  const util = busy / (Math.max(1, owners.length) * n * ORG.workTicksPerDay);
  const who = `${holders.length ? '' : 'casquette : '}${owners.map((a) => linkOf(w, a)).join(', ')}`;
  return `| ${role.title} | ${who} | ${dec(wait, 1)} | ${pct(util, 0)} | ${eur(sum(holders.map(payOf)))} |`;
}

/** rh/effectif-semaine-N.md: the table Nora reads out, on the evening of the HR review. */
export async function writeWeekNote(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  const org = w.company.org;
  if (!org) return;
  const week = Math.ceil(w.day / 7);
  const from = w.day - 6;
  const days = org.load.filter((d) => d.day >= from);
  const rows = (Object.keys(ROLES) as RoleId[]).flatMap((r) => roleRow(w, r, days) ?? []);
  const decisions = org.decisions.filter((d) => d.day >= from).map((d) => `- Jour ${d.day} : ${d.text}`);
  const payroll = payrollToday(w);
  const body = [
    `Semaine ${week}, jours ${Math.max(1, from)} à ${w.day} : **${w.company.agents.length} agents**, ${eur(payroll)} de salaires par jour (${eur(payroll * DAYS_PER_MONTH)} par mois).`,
    '', '| Rôle | Qui | Attente par jour | Occupation | Salaires par jour |', '|---|---|---|---|---|',
    ...rows,
    '', '## Décisions de la semaine',
    ...(decisions.length ? decisions : ["_Aucun mouvement dans l'équipe cette semaine._"]),
    '', [week > 1 ? `Semaine précédente : [[effectif-semaine-${week - 1}]]` : null, '[[Organigramme]]', '[[Recrutement]]', '[[Playbook RH]]'].filter(Boolean).join(' · '),
  ].join('\n');
  await writeNote(ctx, officerId(w, 'hr'), { path: `rh/effectif-semaine-${week}.md`, title: `Effectif — semaine ${week}`, tags: ['rh', 'effectif'], body });
}

/** A brain that fails costs the note, never the departure: the world has already moved. */
async function safely(ctx: RuntimeCtx, what: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (e) {
    say(ctx, officerId(ctx.world, 'hr'), short(`Note « ${what} » impossible à écrire (${errorText(e)})`, 160));
  }
}

/** Every agent has a note and the chart exists from the first evening on (I8). The retro writes missing notes too: this is the net under a retro that could not. */
export async function writeMissingNotes(ctx: RuntimeCtx): Promise<void> {
  const w = ctx.world;
  await safely(ctx, 'playbooks/', async () => {
    const missing: string[] = [];
    for (const a of w.company.agents) if (!(await ctx.brain.read(agentNotePath(w, a)))) missing.push(a.id);
    if (missing.length) await writePlaybookNotes(w, ctx.brain, missing, w.day);
  });
  await writeOrgNote(ctx);
}

/** Someone left: their note says why and stays, their department's note drops them, those who took over see the rules they received, the chart moves. */
export async function writeDepartureNotes(ctx: RuntimeCtx, agent: AgentState, path: string, line: string, heirs: readonly string[]): Promise<void> {
  const w = ctx.world;
  await safely(ctx, path, async () => {
    await writeAlumnusNote(w, ctx.brain, agent, path, line, w.day);
    await writeDeptNote(w, ctx.brain, agent.dept, w.day);
    if (heirs.length) await writePlaybookNotes(w, ctx.brain, heirs, w.day);
  });
  await writeOrgNote(ctx);
}
