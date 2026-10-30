/**
 * Task system: kind metadata, creation helper, dependency resolution, assignment by department chiefs
 * and reviewer routing. Pure functions over WorldState (activities are emitted through core/emit).
 */
import type { AgentId, AgentState, DeptId, Lesson, Mission, Task, TaskKind, WorldState } from '../shared.js';
import { emit, nextId } from '../core/index.js';
import { short, idNum } from './util.js';

export interface KindMeta {
  dept: DeptId;
  work: number;          // ticks of work (heuristic pacing)
  label: string;         // default French title
  bubble: string;        // what the agent says while doing it
  keywords: string;      // brain search query
  topics: Lesson['topic'][];
}

export const KIND_META: Record<TaskKind, KindMeta> = {
  plan_day: { dept: 'direction', work: 1, label: 'Planifier la journée', bubble: 'Je prépare le plan du jour', keywords: 'objectifs stratégie budget', topics: ['process', 'finance'] },
  scan_trends: { dept: 'recherche', work: 2, label: 'Scanner les tendances', bubble: 'Je scanne les tendances TikTok', keywords: 'niche tendance règle du un', topics: ['niche'] },
  mine_pains: { dept: 'recherche', work: 2, label: 'Écouter la voix du client', bubble: 'Je lis les commentaires et les avis', keywords: 'client douleur règle du un mots', topics: ['niche', 'product'] },
  scan_competitors: { dept: 'recherche', work: 1, label: 'Analyser la concurrence', bubble: "J'épluche Gumroad et Etsy", keywords: 'concurrents prix avis', topics: ['niche', 'pricing'] },
  pick_opportunity: { dept: 'recherche', work: 1, label: 'Choisir la prochaine niche', bubble: 'Je compare les opportunités', keywords: 'règle du un niche prix', topics: ['niche'] },
  red_team: { dept: 'rh', work: 1, label: "Red Team : essayer de tuer l'idée", bubble: "J'essaie de tout casser", keywords: 'risque conformité règle du un', topics: ['product', 'niche', 'process'] },
  write_titles: { dept: 'studio', work: 1, label: 'Écrire 10 titres', bubble: "J'écris dix titres", keywords: "structure d'un pdf qui vend titre", topics: ['product'] },
  write_outline: { dept: 'studio', work: 1, label: 'Construire le plan qui vend', bubble: 'Je construis le plan', keywords: "structure d'un pdf qui vend plan bonus", topics: ['product'] },
  write_pdf: { dept: 'studio', work: 4, label: 'Rédiger le guide', bubble: 'Je rédige le guide', keywords: "structure d'un pdf qui vend rédaction exemples", topics: ['product'] },
  humanize_pdf: { dept: 'studio', work: 2, label: 'Humaniser le texte', bubble: "Je chasse les phrases d'IA", keywords: 'humanisation phrases génériques', topics: ['product'] },
  fact_check: { dept: 'studio', work: 1, label: 'Vérifier les faits', bubble: 'Je vérifie chaque affirmation', keywords: 'conformité promesse chiffres', topics: ['product'] },
  design_cover: { dept: 'creation', work: 2, label: 'Dessiner la couverture', bubble: 'Je dessine la couverture', keywords: 'couverture design miniature', topics: ['product'] },
  render_pdf: { dept: 'creation', work: 2, label: 'Mettre en page le PDF', bubble: 'Je mets le PDF en page', keywords: 'mise en page infographie visuels', topics: ['product'] },
  write_sales_page: { dept: 'boutique', work: 2, label: 'Écrire la page de vente', bubble: "J'écris la page de vente", keywords: 'page de vente objections promesse', topics: ['product', 'pricing'] },
  set_price: { dept: 'boutique', work: 1, label: 'Fixer le prix', bubble: 'Je cherche le bon prix', keywords: 'prix ancres commencer bas', topics: ['pricing'] },
  publish_product: { dept: 'boutique', work: 1, label: 'Mettre en ligne', bubble: 'Je prépare la mise en ligne', keywords: 'boutique mise en ligne page de vente', topics: ['product', 'process'] },
  design_upsell: { dept: 'boutique', work: 1, label: 'Concevoir l’upsell « La suite est ici »', bubble: 'Je prépare le PDF suivant', keywords: 'upsell la suite est ici même public', topics: ['product', 'pricing'] },
  write_ad_hooks: { dept: 'growth', work: 1, label: 'Écrire des hooks TikTok', bubble: "J'écris des hooks", keywords: 'hook tiktok canaux acquisition', topics: ['ads'] },
  produce_ad: { dept: 'growth', work: 2, label: 'Produire une pub TikTok', bubble: 'Je monte un storyboard 9:16', keywords: 'pub tiktok conformité format', topics: ['ads'] },
  launch_campaign: { dept: 'growth', work: 1, label: 'Lancer la campagne TikTok', bubble: 'Je paramètre la campagne', keywords: 'campagne budget ciblage stop-loss', topics: ['ads', 'finance'] },
  optimize_ads: { dept: 'growth', work: 1, label: 'Optimiser les campagnes', bubble: 'Je regarde les chiffres des pubs', keywords: 'stop-loss scale fatigue créative roas', topics: ['ads', 'finance'] },
  post_organic: { dept: 'growth', work: 1, label: 'Poster un TikTok organique', bubble: 'Je poste un TikTok', keywords: 'organique tiktok douleur', topics: ['ads'] },
  reply_inbox: { dept: 'support', work: 1, label: 'Répondre aux clients', bubble: 'Je réponds aux clients', keywords: 'support client remboursement arnaque', topics: ['support'] },
  handle_refund: { dept: 'support', work: 1, label: 'Traiter un remboursement', bubble: 'Je traite un remboursement', keywords: 'remboursement chargeback support', topics: ['support', 'finance'] },
  find_creators: { dept: 'partenariats', work: 1, label: 'Trouver des créateurs', bubble: 'Je cherche des créateurs', keywords: 'créateurs commission partenariats', topics: ['partnership'] },
  negotiate_deal: { dept: 'partenariats', work: 1, label: 'Négocier un partenariat', bubble: 'Je négocie un partenariat', keywords: 'négociation créateurs signaux alerte', topics: ['partnership', 'finance'] },
  daily_report: { dept: 'analyse', work: 1, label: 'Rapport du jour', bubble: 'Je prépare le rapport', keywords: 'kpi objectifs roas', topics: ['process', 'ads', 'finance'] },
  run_experiment: { dept: 'analyse', work: 1, label: 'Piloter les expériences A/B', bubble: 'Je pilote les tests A/B', keywords: 'expérience test prix hook', topics: ['ads', 'pricing', 'process'] },
  budget_review: { dept: 'finance', work: 1, label: 'Revue budgétaire', bubble: 'Je fixe le budget du jour', keywords: 'budget garde-fous runway', topics: ['finance'] },
  reconcile_ledger: { dept: 'finance', work: 1, label: 'Rapprocher le grand livre', bubble: 'Je rapproche le grand livre', keywords: 'grand livre rapprochement frais remboursements', topics: ['finance'] },
  weekly_pnl: { dept: 'finance', work: 1, label: 'P&L de la semaine par produit', bubble: 'Je boucle le P&L de la semaine', keywords: 'profit marge produit coûts', topics: ['finance'] },
  follow_missions: { dept: 'direction', work: 1, label: 'Suivre les missions et relancer', bubble: 'Je relance les dossiers en retard', keywords: 'suivi missions planification blocage', topics: ['process'] },
  retro: { dept: 'rh', work: 1, label: 'Rétro du soir', bubble: 'On fait la rétro', keywords: 'leçons erreurs objectifs', topics: ['process'] },
  performance_review: { dept: 'rh', work: 1, label: 'Revue RH hebdomadaire', bubble: 'Je fais les revues RH', keywords: 'performance coaching', topics: ['process'] },
  headcount_review: { dept: 'rh', work: 1, label: 'Revue des effectifs', bubble: 'Je regarde qui manque', keywords: 'recrutement effectif charge masse salariale', topics: ['process', 'finance'] },
  recruit: { dept: 'rh', work: 1, label: 'Recruter', bubble: 'Je fais passer le test', keywords: 'recrutement test candidat', topics: ['process'] },
  league_review: { dept: 'rh', work: 1, label: 'Clôture de la saison', bubble: 'Je clos la saison', keywords: 'saison classement performance remplacement', topics: ['process'] },
  open_channel: { dept: 'growth', work: 1, label: 'Ouvrir un canal', bubble: 'J’ouvre le compte publicitaire', keywords: 'canaux acquisition compte publicitaire', topics: ['ads'] },
  adapt_creative: { dept: 'video', work: 1, label: 'Adapter une créa à un canal', bubble: 'Je recadre la créa', keywords: 'format ratio canal créative', topics: ['ads'] },
  write_search_ads: { dept: 'growth', work: 1, label: 'Écrire des annonces Search', bubble: 'J’écris des annonces Search', keywords: 'annonces recherche mots-clés conformité', topics: ['ads'] },
  reconcile_channels: { dept: 'analyse', work: 1, label: 'Rapprocher les canaux', bubble: 'Je rapproche les ventes déclarées', keywords: 'attribution canaux roas ventes', topics: ['ads', 'finance'] },
  allocate_channels: { dept: 'finance', work: 1, label: 'Répartir le budget entre les canaux', bubble: 'Je répartis le budget', keywords: 'budget canaux roas marginal', topics: ['ads', 'finance'] },
  write_lead_magnet: { dept: 'crm', work: 2, label: 'Écrire l’aimant à prospects', bubble: 'J’écris l’aimant à prospects', keywords: 'liste e-mail prospects guide offert', topics: ['ads', 'product'] },
  write_email_sequence: { dept: 'crm', work: 2, label: 'Écrire la séquence e-mail', bubble: 'J’écris la séquence', keywords: 'séquence e-mail bienvenue liste', topics: ['ads', 'product'] },
  send_broadcast: { dept: 'crm', work: 1, label: 'Envoyer un e-mail à la liste', bubble: 'J’écris à la liste', keywords: 'e-mail liste désinscription', topics: ['ads'] },
  design_bump: { dept: 'boutique', work: 1, label: 'Préparer l’offre à la commande', bubble: 'Je prépare le kit', keywords: 'offre commande kit panier', topics: ['product', 'pricing'] },
  portfolio_review: { dept: 'direction', work: 1, label: 'Revue du portefeuille', bubble: 'Je passe le portefeuille en revue', keywords: 'portefeuille produits contribution arbitrage', topics: ['product', 'finance'] },
};

export const ALL_KINDS = Object.keys(KIND_META) as TaskKind[];

/** Kinds the CEO (or Claude, or a founder mission) may plan. The others are run by the runtime itself. A package opens a V1 kind when it needs to (D57). */
export const PLAN_KINDS: TaskKind[] = ALL_KINDS.filter((k) => !([
  'plan_day', 'budget_review', 'retro', 'performance_review',
  'headcount_review', 'recruit', 'league_review',
  'open_channel', 'adapt_creative', 'write_search_ads', 'reconcile_channels', 'allocate_channels',
  'write_lead_magnet', 'write_email_sequence', 'send_broadcast', 'design_bump', 'portfolio_review',
] as TaskKind[]).includes(k));

/** Kinds that only make sense for a product. */
export const PRODUCT_KINDS: TaskKind[] = [
  'red_team', 'write_titles', 'write_outline', 'write_pdf', 'humanize_pdf', 'fact_check', 'design_cover', 'render_pdf',
  'write_sales_page', 'set_price', 'publish_product', 'design_upsell', 'write_ad_hooks', 'produce_ad', 'launch_campaign',
  'post_organic', 'find_creators',
];

const DEFAULT_REVIEWER: Partial<Record<TaskKind, AgentId>> = {
  write_pdf: 'samuel',
  render_pdf: 'samuel',
  fact_check: 'elise',
  design_cover: 'zoe',
  red_team: 'camille',
  produce_ad: 'leo',
  write_sales_page: 'clara',
  publish_product: 'camille',
  weekly_pnl: 'gabriel',
};

export const OPEN_STATUSES: Task['status'][] = ['pending', 'in_progress', 'review', 'awaiting_founder'];

export function isOpen(t: Task): boolean {
  return OPEN_STATUSES.includes(t.status);
}

export interface TaskSpec {
  kind: TaskKind;
  title?: string;
  input?: Record<string, unknown>;
  priority?: 1 | 2 | 3;
  dependsOn?: string[];
  createdBy?: Task['createdBy'];
  missionId?: string | null;
  assignee?: AgentId | null;
  workLeft?: number;
  reviewer?: AgentId | null;
}

export function createTask(world: WorldState, spec: TaskSpec): Task {
  const meta = KIND_META[spec.kind];
  const task: Task = {
    id: nextId(world, 'tsk'),
    kind: spec.kind,
    title: spec.title ?? meta.label,
    dept: meta.dept,
    assignee: spec.assignee ?? null,
    createdBy: spec.createdBy ?? 'system',
    missionId: spec.missionId ?? null,
    dependsOn: [...(spec.dependsOn ?? [])],
    status: 'pending',
    priority: spec.priority ?? 2,
    dayCreated: world.day,
    dayDone: null,
    progress: 0,
    workLeft: Math.max(0, spec.workLeft ?? meta.work),
    attempts: 0,
    reviewer: spec.reviewer !== undefined ? spec.reviewer : (DEFAULT_REVIEWER[spec.kind] ?? null),
    reviews: [],
    input: { ...(spec.input ?? {}) },
    output: null,
    deliverableIds: [],
    log: [],
  };
  if (task.assignee) fixSelfReview(world, task);
  world.company.tasks.push(task);
  if (task.missionId) {
    const mission = world.company.missions.find((m) => m.id === task.missionId);
    if (mission && !mission.taskIds.includes(task.id)) {
      mission.taskIds.push(task.id);
      // A mission that delivered its product stays closed: the campaigns that follow are not part of the request.
      if (mission.status !== 'open' && !mission.wantsProduct) mission.status = 'open';
    }
  }
  return task;
}

export function taskById(world: WorldState, id: string): Task | undefined {
  return world.company.tasks.find((t) => t.id === id);
}

export function logTask(task: Task, line: string): void {
  task.log.push(line);
  if (task.log.length > 20) task.log.splice(0, task.log.length - 20);
}

export type DepState = 'ready' | 'waiting' | 'broken';

/** Dependencies: all done → ready; one failed/cancelled → broken; else waiting. Unknown ids are ignored. */
export function depState(world: WorldState, task: Task): DepState {
  let waiting = false;
  for (const id of task.dependsOn) {
    const dep = taskById(world, id);
    if (!dep) continue;
    if (dep.status === 'failed' || dep.status === 'cancelled') return 'broken';
    if (dep.status !== 'done') waiting = true;
  }
  return waiting ? 'waiting' : 'ready';
}

export function openTasks(world: WorldState, pred?: (t: Task) => boolean): Task[] {
  return world.company.tasks.filter((t) => isOpen(t) && (!pred || pred(t)));
}

export function productIdOf(task: Task): string | undefined {
  const v = task.input.productId;
  return typeof v === 'string' ? v : undefined;
}

export function chiefOf(world: WorldState, dept: DeptId): AgentState | undefined {
  const def = world.company.departments.find((d) => d.id === dept);
  return world.company.agents.find((a) => a.id === def?.chiefId) ?? world.company.agents.find((a) => a.dept === dept && a.isChief);
}

export function agentById(world: WorldState, id: AgentId | null | undefined): AgentState | undefined {
  return id ? world.company.agents.find((a) => a.id === id) : undefined;
}

/** The live perf score: reviews passed and tasks finished without failing. */
export function refreshAgentScore(a: AgentState): void {
  const q = (a.perf.approved + 1) / (a.perf.approved + a.perf.rejected + 2);
  const r = (a.perf.done + 1) / (a.perf.done + a.perf.failed + 1);
  a.perf.score = Math.round(100 * (0.6 * q + 0.4 * r));
}

/** Load = remaining work of open tasks assigned to the agent. */
export function agentLoad(world: WorldState, agentId: AgentId): number {
  let load = 0;
  for (const t of world.company.tasks) {
    if (t.assignee !== agentId) continue;
    if (t.status === 'pending' || t.status === 'in_progress') load += Math.max(1, t.workLeft);
  }
  return load;
}

/** Never let an agent review their own work: fall back to the chief, then the CEO, then the chief of staff. */
export function fixSelfReview(world: WorldState, task: Task): void {
  if (!task.reviewer || task.reviewer !== task.assignee) return;
  const chief = chiefOf(world, task.dept);
  if (chief && chief.id !== task.assignee) task.reviewer = chief.id;
  else task.reviewer = task.assignee === 'camille' ? 'hugo' : 'camille';
}

/** Candidates able to do a kind: department members first, then anyone with the skill. */
export function capableAgents(world: WorldState, kind: TaskKind, dept?: DeptId): AgentState[] {
  const able = world.company.agents.filter((a) => a.taskKinds.includes(kind));
  const inDept = able.filter((a) => a.dept === (dept ?? KIND_META[kind].dept));
  return inDept.length ? inDept : able;
}

/** Has done less than a quarter of what a colleague did: the specialists keep their share, nobody is left out. */
function farBehind(a: AgentState, b: AgentState): boolean {
  return a.perf.done * 4 < b.perf.done;
}

/**
 * Chiefs delegate every ready, unassigned task to the capable member with the lowest load and energy > 20
 * (chiefs work too: among equally loaded specialists, a member far behind the others takes the next task, so a
 * team of three never leaves one of them idle for weeks). Emits 'delegate' (chief → assignee) and 'walk'.
 */
export function assignReady(world: WorldState): number {
  let assigned = 0;
  const pending = world.company.tasks
    .filter((t) => t.status === 'pending' && !t.assignee)
    .sort((a, b) => a.priority - b.priority || idNum(a.id) - idNum(b.id));
  for (const task of pending) {
    if (depState(world, task) !== 'ready') continue;
    const candidates = capableAgents(world, task.kind, task.dept).filter((a) => a.energy > 20);
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const la = agentLoad(world, a.id), lb = agentLoad(world, b.id);
      if (la !== lb) return la - lb;
      const pa = a.taskKinds[0] === task.kind ? 0 : 1, pb = b.taskKinds[0] === task.kind ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (farBehind(a, b)) return -1;
      if (farBehind(b, a)) return 1;
      if (a.isChief !== b.isChief) return a.isChief ? 1 : -1;
      return b.energy - a.energy;
    });
    const assignee = candidates[0]!;
    task.assignee = assignee.id;
    fixSelfReview(world, task);
    assigned++;
    const chief = chiefOf(world, task.dept) ?? assignee;
    if (chief.id === assignee.id) {
      emit(world, { agentId: chief.id, kind: 'delegate', text: `${chief.name} s'en charge ${selfWord(chief)} : « ${short(task.title, 60)} »`, refs: { taskId: task.id, productId: productIdOf(task) } });
    } else {
      emit(world, { agentId: chief.id, toAgentId: assignee.id, kind: 'delegate', text: `${chief.name} confie « ${short(task.title, 60)} » à ${assignee.name}`, refs: { taskId: task.id, productId: productIdOf(task) } });
    }
    logTask(task, `Jour ${world.day} : confiée à ${assignee.name} par ${chief.name}.`);
    if (assignee.place !== assignee.dept && assignee.status !== 'meeting') {
      assignee.place = assignee.dept;
      assignee.status = 'walking';
      emit(world, { agentId: assignee.id, kind: 'walk', place: assignee.dept, text: `${assignee.name} rejoint son bureau`, refs: { taskId: task.id } });
    }
  }
  return assigned;
}

/** "lui-même" / "elle-même" from a small list of the roster's female first names. */
const FEMININE = new Set(['camille', 'nadia', 'yasmine', 'elise', 'lina', 'zoe', 'maelle', 'sarah', 'chloe', 'clara', 'ines', 'fatou', 'emma', 'alice', 'nora', 'louise']);
export function selfWord(agent: AgentState): string {
  return FEMININE.has(agent.id) ? 'elle-même' : 'lui-même';
}
export function isFeminine(agentId: AgentId): boolean {
  return FEMININE.has(agentId);
}

export function closeMissions(world: WorldState): Mission[] {
  const closed: Mission[] = [];
  for (const m of world.company.missions) {
    if (m.status !== 'open') continue;
    // A product was asked for: finished tasks prove nothing, only a product online does (in the niche named, if any).
    if (m.wantsProduct && (m.nicheId || m.productId)) {
      const live = world.company.products.find((p) => p.status === 'live' && (m.nicheId ? p.nicheId === m.nicheId : p.id === m.productId));
      if (live) {
        m.status = 'done';
        m.productId = live.id;
        m.outcome = `« ${live.title} » est en ligne.`;
        closed.push(m);
        continue;
      }
      if (m.nicheId || world.company.products.find((p) => p.id === m.productId)?.status !== 'killed') continue;
    }
    const tasks = m.taskIds.map((id) => taskById(world, id)).filter((t): t is Task => !!t);
    if (!tasks.length || tasks.some(isOpen)) continue;
    // The founder asked for a product, the research ended without choosing any niche.
    if (m.wantsProduct) m.outcome = 'Aucun produit n’a été créé : la recherche n’a retenu aucune niche.';
    m.status = !m.wantsProduct && tasks.some((t) => t.status === 'done') ? 'done' : 'failed';
    closed.push(m);
  }
  return closed;
}
