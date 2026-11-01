// French labels and lookup helpers shared by every panel.
import type {
  ActivityKind, AdFormat, AgentState, AgentStatus, Alumnus, CompanySnapshot, DayPhase, DeptDef, DeptId, Deliverable,
  Difficulty, DuelView, Experiment, HiringReqView, HookStyle, InboxMessage, LedgerType, Lesson, MessageIntent, ModelTier,
  PersonChip, ProbationPlan, ProductStatus, RoleId, Skill, Task, TaskKind, TaskStatus, ToolName, WorldEvent,
} from '../../../shared/types';
import type { IconName } from './icons';

export type TabId =
  | 'bureau' | 'taches' | 'calendrier' | 'produits' | 'pub' | 'canaux' | 'croissance' | 'effectif' | 'competition'
  | 'mail' | 'finance' | 'cerveau' | 'apprentissage' | 'galerie';

/** Ten in the bar, four behind « Plus » (ui D12). The phone menu lists all of them. */
export const TABS: { id: TabId; label: string; icon: IconName; key: string; more?: true }[] = [
  { id: 'bureau', label: 'Bureau', icon: 'building', key: '1' },
  { id: 'taches', label: 'Tâches', icon: 'list', key: '2' },
  { id: 'produits', label: 'Produits', icon: 'package', key: '3' },
  { id: 'pub', label: 'Publicité', icon: 'megaphone', key: '4' },
  { id: 'canaux', label: 'Canaux', icon: 'globe', key: '5' },
  { id: 'croissance', label: 'Croissance', icon: 'trendUp', key: '6' },
  { id: 'effectif', label: 'Effectif', icon: 'users', key: '7' },
  { id: 'competition', label: 'Compétition', icon: 'trophy', key: '8' },
  { id: 'finance', label: 'Finance', icon: 'wallet', key: '9' },
  { id: 'galerie', label: 'Galerie', icon: 'image', key: '0' },
  { id: 'mail', label: 'Boîte mail', icon: 'inbox', key: 'm', more: true },
  { id: 'calendrier', label: 'Calendrier', icon: 'calendar', key: 'c', more: true },
  { id: 'cerveau', label: 'Cerveau', icon: 'brain', key: 'b', more: true },
  { id: 'apprentissage', label: 'Apprentissage', icon: 'grad', key: 'a', more: true },
];

/** A place of the world opens the tab that tells its story (ui §4.6). */
export function placeTab(place: string): TabId | null {
  if (place === 'quai') return 'effectif';
  if (place === 'ligue' || place === 'podium' || place === 'duel') return 'competition';
  return place.startsWith('canal:') ? 'canaux' : null;
}

export const DEPT_ORDER: DeptId[] = ['direction', 'recherche', 'studio', 'creation', 'video', 'growth', 'crm', 'boutique', 'support', 'analyse', 'finance', 'rh', 'partenariats'];

/** Known departments in DEPT_ORDER, then any other as it came: a new one neither sorts first nor drops out of a filter. */
export function deptOrder<T extends { id: DeptId }>(departments: readonly T[]): T[] {
  const rank = (id: DeptId) => {
    const i = DEPT_ORDER.indexOf(id);
    return i < 0 ? DEPT_ORDER.length : i;
  };
  return [...departments].sort((a, b) => rank(a.id) - rank(b.id));
}

export const DEFAULT_DEPTS: Record<DeptId, { name: string; color: string; icon: string }> = {
  direction: { name: 'Direction', color: '#7c3aed', icon: 'DIRECTION' },
  recherche: { name: 'Recherche', color: '#2563eb', icon: 'RECHERCHE' },
  studio: { name: 'Studio PDF', color: '#f59e0b', icon: 'STUDIO' },
  creation: { name: 'Création', color: '#8b5cf6', icon: 'CRÉATION' },
  growth: { name: 'Growth', color: '#ec4899', icon: 'GROWTH' },
  boutique: { name: 'Boutique', color: '#e11d48', icon: 'BOUTIQUE' },
  support: { name: 'Support', color: '#f97316', icon: 'SUPPORT' },
  analyse: { name: 'Analyse', color: '#14b8a6', icon: 'ANALYSE' },
  finance: { name: 'Finance', color: '#16a34a', icon: 'FINANCE' },
  rh: { name: 'RH', color: '#db2777', icon: 'RH' },
  partenariats: { name: 'Partenariats', color: '#0ea5e9', icon: 'PARTENARIATS' },
  video: { name: 'Studio Vidéo', color: '#dc2626', icon: 'VIDÉO' },
  crm: { name: 'Communauté & Email', color: '#10b981', icon: 'COMMUNAUTÉ' },
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'En attente',
  in_progress: 'En cours',
  review: 'En revue',
  done: 'Terminée',
  failed: 'Échouée',
  cancelled: 'Annulée',
  awaiting_founder: 'Validation fondateur',
};

export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  pending: 'neutral', in_progress: 'blue', review: 'violet', done: 'green', failed: 'red', cancelled: 'neutral', awaiting_founder: 'amber',
};

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  plan_day: 'Stand-up du matin',
  scan_trends: 'Veille des tendances',
  mine_pains: 'Écoute client',
  scan_competitors: 'Analyse concurrence',
  pick_opportunity: 'Choix de la niche',
  red_team: 'Red Team',
  write_titles: '10 titres',
  write_outline: 'Plan qui vend',
  write_pdf: 'Rédaction du guide',
  humanize_pdf: 'Humanisation',
  fact_check: 'Fact-check',
  design_cover: 'Couverture',
  render_pdf: 'Mise en page PDF',
  write_sales_page: 'Page de vente',
  set_price: 'Fixation du prix',
  publish_product: 'Mise en ligne',
  design_upsell: 'Upsell « La suite »',
  write_ad_hooks: 'Hooks publicitaires',
  produce_ad: 'Production pub',
  launch_campaign: 'Lancement campagne',
  optimize_ads: 'Optimisation des pubs',
  post_organic: 'Post organique',
  reply_inbox: 'Réponses clients',
  handle_refund: 'Remboursement',
  find_creators: 'Recherche de créateurs',
  negotiate_deal: 'Négociation créateur',
  daily_report: 'Rapport du jour',
  run_experiment: 'Expérience A/B',
  budget_review: 'Revue du budget',
  reconcile_ledger: 'Rapprochement du grand livre',
  weekly_pnl: 'P&L de la semaine',
  follow_missions: 'Suivi des missions',
  retro: 'Rétro du soir',
  performance_review: 'Revue RH',
  headcount_review: 'Revue des effectifs',
  recruit: 'Recrutement',
  league_review: 'Clôture de saison',
  open_channel: 'Ouverture de canal',
  adapt_creative: 'Adaptation de créa',
  write_search_ads: 'Annonces Search',
  reconcile_channels: 'Rapprochement des canaux',
  allocate_channels: 'Répartition entre canaux',
  write_lead_magnet: 'Aimant à prospects',
  write_email_sequence: 'Séquence e-mail',
  send_broadcast: 'Envoi à la liste',
  design_bump: 'Offre à la commande',
  portfolio_review: 'Revue du portefeuille',
};

export const RESEARCH_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>(['scan_trends', 'mine_pains', 'scan_competitors', 'pick_opportunity']);

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'Disponible',
  walking: 'En déplacement',
  working: 'Au travail',
  meeting: 'En réunion',
  reviewing: 'En revue',
  coffee: 'Pause café',
  thinking: 'Réfléchit',
  blocked: 'Bloqué',
};

export const AGENT_STATUS_TONE: Record<AgentStatus, Tone> = {
  idle: 'green', walking: 'neutral', working: 'blue', meeting: 'violet', reviewing: 'violet', coffee: 'amber', thinking: 'blue', blocked: 'red',
};

export const BUSY_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>(['working', 'reviewing', 'thinking', 'meeting']);

export const TIER_LABEL: Record<ModelTier, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };

/** The titles of the role catalog: a role under pressure often has nobody to read its title from. */
export const ROLE_LABEL: Record<RoleId, string> = {
  ceo: 'CEO', chief_of_staff: 'Chef de cabinet',
  research_lead: 'Chef Recherche', competitor_analyst: 'Veille concurrents', voc_analyst: 'Voix du client',
  editor_in_chief: 'Rédaction en chef', ghostwriter: 'Plume', humanizer: 'Édition-humanisation', fact_checker: 'Fact-checker',
  art_director: 'Direction artistique', cover_designer: 'Designer de couvertures', layout_designer: 'Maquettiste',
  video_editor: 'Montage vidéo', motion_designer: 'Motion designer',
  growth_lead: 'Head of growth', hook_writer: 'Scénariste de hooks', media_buyer_tiktok: 'Media buyer TikTok',
  media_buyer_meta: 'Media buyer Facebook & Instagram', media_buyer_google: 'Media buyer Google', media_buyer_pinterest: 'Media buyer Pinterest',
  community_manager: 'Community manager', email_marketer: 'Email marketer',
  shop_lead: 'Chef boutique', sales_copywriter: 'Copywriter page de vente', pricing_manager: 'Pricing & upsell',
  support_lead: 'Chef support', support_agent: 'Agent support',
  data_analyst: 'Data analyst', experiment_analyst: 'Expériences A/B',
  cfo: 'CFO', accountant: 'Comptable',
  hr_lead: 'DRH & coach', red_teamer: 'Red Team',
  partnerships_lead: 'Chef partenariats', partner_manager: 'Négociation & anti-fraude',
};

export const SKILL_LABEL: Record<Skill, string> = {
  copy: 'Pubs', video: 'Montage', longform: 'Guides', polish: 'Relecture', page: 'Pages de vente', design: 'Design',
  buying: 'Achat média', research: 'Recherche', support: 'Support',
};

export const CONTRACT_LABEL: Record<PersonChip['contract'], string> = { trial: 'Essai', active: 'Titulaire', probation: 'Plan d’amélioration', notice: 'Préavis' };
export const CONTRACT_TONE: Record<PersonChip['contract'], Tone> = { trial: 'blue', active: 'green', probation: 'amber', notice: 'red' };

export const REQ_STATUS_LABEL: Record<HiringReqView['status'], string> = { open: 'Ouvert', filled: 'Pourvu', cancelled: 'Annulé' };
export const REQ_STATUS_TONE: Record<HiringReqView['status'], Tone> = { open: 'amber', filled: 'green', cancelled: 'neutral' };

export const PLAN_OUTCOME_LABEL: Record<ProbationPlan['outcome'], string> = { open: 'En cours', met: 'Atteint', failed: 'Échoué', kept_no_better: 'Maintenu : personne de mieux', kept_no_test: 'Maintenu : pas de test fiable' };
export const PLAN_OUTCOME_TONE: Record<ProbationPlan['outcome'], Tone> = { open: 'amber', met: 'green', failed: 'red', kept_no_better: 'neutral', kept_no_test: 'neutral' };

export const DUEL_STATUS_LABEL: Record<DuelView['status'], string> = { open: 'En cours', done: 'Terminé', void: 'Annulé' };
export const DUEL_STATUS_TONE: Record<DuelView['status'], Tone> = { open: 'blue', done: 'green', void: 'neutral' };

export const ALUMNUS_KIND_LABEL: Record<Alumnus['kind'], string> = { fired: 'Remplacement', layoff: 'Réduction d’effectif', founder_order: 'Décision du fondateur' };

export const PHASE_LABEL: Record<DayPhase, string> = { morning: 'matin', work: 'travail', market: 'marché', evening: 'soir' };
export const PHASE_ICON: Record<DayPhase, IconName> = { morning: 'sunrise', work: 'briefcase', market: 'store', evening: 'moon' };
export const PHASE_HINT: Record<DayPhase, string> = {
  morning: 'Stand-up : la CEO lit le cerveau et distribue les missions',
  work: 'Les agents exécutent leurs tâches et passent en revue',
  market: 'Clôture du marché : ventes, remboursements, nouveaux messages',
  evening: 'Rétro : leçons du jour, bandits, playbooks',
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  idea: 'Idée', research: 'Recherche', writing: 'Rédaction', design: 'Design', qa: 'Contrôle qualité',
  ready: 'Prêt', live: 'En vente', paused: 'En pause', killed: 'Abandonné',
};
export const PRODUCT_STATUS_TONE: Record<ProductStatus, Tone> = {
  idea: 'neutral', research: 'blue', writing: 'blue', design: 'violet', qa: 'violet', ready: 'amber', live: 'green', paused: 'neutral', killed: 'red',
};
export const PIPELINE: ProductStatus[] = ['idea', 'research', 'writing', 'design', 'qa', 'ready', 'live'];

export const HOOK_LABEL: Record<HookStyle, string> = {
  question: 'Question', contrarian: 'À contre-courant', story: 'Histoire', stat: 'Chiffre choc', pov: 'POV',
  mistake: 'Erreur à éviter', before_after: 'Avant / après', listicle: 'Liste',
};
export const FORMAT_LABEL: Record<AdFormat, string> = {
  faceless_voiceover: 'Voix off faceless', text_slideshow: 'Diaporama texte', ugc_avatar: 'Narrateur animé', carousel: 'Carrousel',
  static_image: 'Image fixe', search_text: 'Annonce Search',
};

export const INTENT_LABEL: Record<MessageIntent, string> = {
  question: 'Question', non_recu: 'Non reçu', remboursement: 'Remboursement', plainte_qualite: 'Plainte qualité',
  sur_mesure: 'Sur mesure', partenariat: 'Partenariat', arnaque: 'Arnaque', compliment: 'Compliment', troll: 'Troll',
  menace_chargeback: 'Menace de chargeback', bug_paiement: 'Bug de paiement',
};
export const INTENT_TONE: Record<MessageIntent, Tone> = {
  question: 'blue', non_recu: 'amber', remboursement: 'amber', plainte_qualite: 'red', sur_mesure: 'violet', partenariat: 'violet',
  arnaque: 'red', compliment: 'green', troll: 'neutral', menace_chargeback: 'red', bug_paiement: 'amber',
};

export const CHANNEL_LABEL: Record<InboxMessage['channel'], string> = {
  email: 'E-mail', commentaire_tiktok: 'Commentaire TikTok', commentaire_pub: 'Commentaire de pub', avis: 'Avis', dm: 'Message privé',
};
export const CHANNEL_ICON: Record<InboxMessage['channel'], IconName> = {
  email: 'mail', commentaire_tiktok: 'music', commentaire_pub: 'megaphone', avis: 'star', dm: 'dm',
};
export const MESSAGE_STATUS_LABEL: Record<InboxMessage['status'], string> = {
  open: 'Ouvert', replied: 'Répondu', resolved: 'Résolu', escalated: 'Escaladé',
};
export const MESSAGE_STATUS_TONE: Record<InboxMessage['status'], Tone> = {
  open: 'amber', replied: 'blue', resolved: 'green', escalated: 'red',
};

export const LEDGER_LABEL: Record<LedgerType, string> = {
  capital: 'Capital', revenue: 'Ventes', refund: 'Remboursements', chargeback: 'Chargebacks', ad_spend: 'Publicité',
  payment_fee: 'Frais de paiement', platform_fee: 'Frais plateforme', tool_subscription: 'Abonnements outils',
  compute: 'Compute Claude', creator_payout: 'Commissions créateurs', scam_loss: 'Pertes (arnaques)', discount: 'Remises',
  salary: 'Salaires', recruiting: 'Recrutement',
};

/** Ledger entries with a 'hold:' ref: typed platform_fee on the server, but cash timing only (see derive.ts isReserve). */
export const RESERVE_LABEL = 'Réserve de paiement (temporaire)';

export const LESSON_TOPIC_LABEL: Record<Lesson['topic'], string> = {
  ads: 'Pub', pricing: 'Prix', product: 'Produit', support: 'Support', niche: 'Niche', finance: 'Finance', process: 'Process', partnership: 'Partenariats',
};
export const LESSON_TOPIC_TONE: Record<Lesson['topic'], Tone> = {
  ads: 'pink', pricing: 'amber', product: 'blue', support: 'orange', niche: 'violet', finance: 'green', process: 'neutral', partnership: 'cyan',
};

export const DELIVERABLE_LABEL: Record<Deliverable['kind'], string> = {
  pdf: 'Guide PDF', cover: 'Couverture', sales_page: 'Page de vente', ad_storyboard: 'Storyboard', ad_preview: 'Aperçu pub',
  report: 'Rapport', research: 'Recherche', note: 'Note',
  page_preview: 'Aperçu des pages', lead_magnet: 'Aimant à prospects', email_sequence: 'Séquence e-mail',
};
export const DELIVERABLE_ICON: Record<Deliverable['kind'], IconName> = {
  pdf: 'file', cover: 'image', sales_page: 'store', ad_storyboard: 'film', ad_preview: 'music', report: 'chart', research: 'search', note: 'brain',
  page_preview: 'image', lead_magnet: 'file', email_sequence: 'mail',
};

export const DIFFICULTY_INFO: Record<Difficulty, { label: string; text: string }> = {
  facile: {
    label: 'Facile',
    text: 'Clients patients et bienveillants, CPM bas, très peu d’arnaques. Idéal pour regarder la machine tourner.',
  },
  normal: {
    label: 'Normal',
    text: 'Un vrai marché : quelques clients pénibles, des pubs refusées, des concurrents qui copient vos idées.',
  },
  cauchemar: {
    label: 'Cauchemar',
    text: 'Karen, chasseurs de remboursement, menaces de chargeback, faux créateurs, CPM qui flambent et compte pub suspendu. Survivre est déjà une victoire.',
  },
};

export const EVENT_TONE: Record<WorldEvent['severity'], Tone> = { info: 'blue', warn: 'amber', danger: 'red', good: 'green' };

export const EXPERIMENT_DIM_LABEL: Record<string, string> = {
  hook_style: 'Style de hook', ad_format: 'Format pub', price: 'Prix', sales_hype: 'Niveau de promesse',
  support_tone: 'Ton du support', niche: 'Niche',
};
export const METRIC_LABEL: Record<string, string> = {
  ctr: 'CTR', cvr: 'Conversion', roas: 'ROAS', refund_rate: 'Taux de remboursement', resolution: 'Résolution',
};
export const EXPERIMENT_STATUS: Record<Experiment['status'], { label: string; tone: Tone; title?: string }> = {
  running: { label: 'En cours', tone: 'blue' },
  concluded: { label: 'Conclue', tone: 'green' },
  cancelled: { label: 'Annulée', tone: 'neutral', title: 'Une variante n’a reçu aucun trafic : le test n’a rien appris.' },
};

// ───────────────────────────── Activity kinds ─────────────────────────────

export const ACTIVITY_META: Record<ActivityKind, { icon: IconName; label: string; chip: string }> = {
  thought: { icon: 'bulb', label: 'Réflexion', chip: 'RÉFLEXION' },
  brain_read: { icon: 'brain', label: 'Lecture du cerveau', chip: 'CERVEAU' },
  brain_write: { icon: 'brain', label: 'Écriture au cerveau', chip: 'CERVEAU' },
  delegate: { icon: 'arrowRight', label: 'Délégation', chip: 'DÉLÉGATION' },
  task_start: { icon: 'play', label: 'Tâche démarrée', chip: 'TÂCHE' },
  task_done: { icon: 'check', label: 'Tâche terminée', chip: 'TERMINÉ' },
  task_failed: { icon: 'x', label: 'Tâche échouée', chip: 'ÉCHEC' },
  review: { icon: 'review', label: 'Revue', chip: 'REVUE' },
  deliverable: { icon: 'file', label: 'Livrable', chip: 'LIVRABLE' },
  sale: { icon: 'cart', label: 'Vente', chip: 'VENTE' },
  refund: { icon: 'refund', label: 'Remboursement', chip: 'REMBOURSEMENT' },
  ad: { icon: 'megaphone', label: 'Publicité', chip: 'PUBLICITÉ' },
  message: { icon: 'mail', label: 'Message client', chip: 'BOÎTE MAIL' },
  event: { icon: 'alert', label: 'Événement', chip: 'ÉVÉNEMENT' },
  finance: { icon: 'euro', label: 'Finance', chip: 'FINANCE' },
  lesson: { icon: 'grad', label: 'Leçon', chip: 'LEÇON' },
  walk: { icon: 'walk', label: 'Déplacement', chip: 'DÉPLACEMENT' },
  coffee: { icon: 'coffee', label: 'Café', chip: 'CAFÉ' },
  meeting: { icon: 'users', label: 'Réunion', chip: 'RÉUNION' },
  founder: { icon: 'crown', label: 'Fondateur', chip: 'FONDATEUR' },
  chat: { icon: 'chat', label: 'Discussion', chip: 'DISCUSSION' },
  org: { icon: 'users', label: 'Équipe', chip: 'ÉQUIPE' },
};

// ───────────────────────────── Tools ─────────────────────────────

export const TOOL_GROUPS: { id: string; label: string; icon: IconName; tools: ToolName[] }[] = [
  { id: 'brain', label: 'Cerveau (Obsidian)', icon: 'brain', tools: ['brain.read', 'brain.write'] },
  { id: 'market', label: 'Recherche marché', icon: 'search', tools: ['market.trends', 'market.competitors', 'market.pains'] },
  { id: 'store', label: 'Boutique en ligne', icon: 'store', tools: ['store.publish', 'store.price', 'store.stats'] },
  { id: 'ads', label: 'Publicité', icon: 'megaphone', tools: ['ads.review', 'ads.campaign', 'ads.stats'] },
  { id: 'organic', label: 'TikTok organique', icon: 'music', tools: ['organic.post'] },
  { id: 'creators', label: 'Créateurs', icon: 'users', tools: ['creators.search', 'creators.deal'] },
  { id: 'inbox', label: 'Boîte mail', icon: 'inbox', tools: ['inbox.read', 'inbox.reply', 'inbox.refund'] },
  { id: 'finance', label: 'Grand livre', icon: 'wallet', tools: ['finance.ledger'] },
  { id: 'pdf', label: 'Moteur PDF', icon: 'file', tools: ['pdf.render'] },
  { id: 'design', label: 'Studio design', icon: 'image', tools: ['design.cover', 'design.storyboard'] },
  { id: 'web', label: 'Pages web', icon: 'globe', tools: ['web.page'] },
  { id: 'team', label: 'Équipe', icon: 'users', tools: ['team.delegate', 'team.review'] },
];

export const TOOL_LABEL: Record<ToolName, string> = {
  'brain.read': 'Lire le cerveau', 'brain.write': 'Écrire au cerveau',
  'market.trends': 'Tendances', 'market.competitors': 'Concurrents', 'market.pains': 'Douleurs clients',
  'store.publish': 'Publier', 'store.price': 'Prix', 'store.stats': 'Stats boutique',
  'ads.review': 'Validation pub', 'ads.campaign': 'Campagnes', 'ads.stats': 'Stats pub',
  'organic.post': 'Posts organiques', 'creators.search': 'Recherche créateurs', 'creators.deal': 'Deals créateurs',
  'inbox.read': 'Lire', 'inbox.reply': 'Répondre', 'inbox.refund': 'Rembourser',
  'finance.ledger': 'Grand livre', 'pdf.render': 'Rendu PDF', 'design.cover': 'Couvertures', 'design.storyboard': 'Storyboards',
  'web.page': 'Pages de vente', 'team.delegate': 'Déléguer', 'team.review': 'Relire',
  'ads.channels': 'Canaux pub', 'ads.report': 'Rapports des canaux',
};

export function toolGroupsOf(tools: readonly ToolName[] | undefined) {
  const set = new Set(tools ?? []);
  return TOOL_GROUPS.map((g) => ({ ...g, owned: g.tools.filter((t) => set.has(t)) })).filter((g) => g.owned.length > 0);
}

// ───────────────────────────── Lookups ─────────────────────────────

export type Tone = 'neutral' | 'blue' | 'green' | 'red' | 'amber' | 'violet' | 'pink' | 'orange' | 'cyan';

export interface Lookups {
  agents: Map<string, AgentState>;
  /** People who left (`scene.names`), so an old task never prints a raw id. */
  names: Map<string, string>;
  depts: Map<DeptId, DeptDef>;
  tasks: Map<string, Task>;
  deliverables: Map<string, Deliverable>;
  nicheNames: Map<string, string>;
  products: Map<string, CompanySnapshot['company']['products'][number]>;
  ceo: AgentState | null;
}

export function buildLookups(s: CompanySnapshot | null): Lookups {
  const c = s?.company;
  const agents = new Map((c?.agents ?? []).map((a) => [a.id, a] as const));
  const depts = new Map((c?.departments ?? []).map((d) => [d.id, d] as const));
  const tasks = new Map((c?.tasks ?? []).map((t) => [t.id, t] as const));
  const deliverables = new Map((c?.deliverables ?? []).map((d) => [d.id, d] as const));
  const products = new Map((c?.products ?? []).map((p) => [p.id, p] as const));
  const nicheNames = new Map<string, string>();
  for (const t of c?.research?.trends ?? []) if (t?.nicheId) nicheNames.set(t.nicheId, t.name);
  for (const n of s?.godMode?.niches ?? []) if (n?.id && !nicheNames.has(n.id)) nicheNames.set(n.id, n.name);
  const ceoId = depts.get('direction')?.chiefId;
  const ceo = (ceoId && agents.get(ceoId)) || (c?.agents ?? []).find((a) => a.dept === 'direction' && a.isChief) || (c?.agents ?? []).find((a) => a.dept === 'direction') || null;
  const names = new Map(Object.entries(s?.scene?.names ?? {}));
  return { agents, names, depts, tasks, deliverables, nicheNames, products, ceo };
}

export function deptColor(l: Lookups, id: DeptId | null | undefined): string {
  if (!id) return '#94a3b8';
  return l.depts.get(id)?.color ?? DEFAULT_DEPTS[id]?.color ?? '#94a3b8';
}

export function deptName(l: Lookups, id: DeptId | null | undefined): string {
  if (!id) return '';
  return l.depts.get(id)?.name ?? DEFAULT_DEPTS[id]?.name ?? id;
}

export function agentColor(l: Lookups, agentId: string | null | undefined): string {
  if (!agentId) return '#94a3b8';
  const a = l.agents.get(agentId);
  return a ? deptColor(l, a.dept) : '#94a3b8';
}

export function agentName(l: Lookups, id: string | null | undefined): string {
  if (!id) return '—';
  if (id === 'founder') return 'Fondateur';
  if (id === 'system') return 'Système';
  return l.agents.get(id)?.name ?? l.names.get(id) ?? id;
}

export function nicheName(l: Lookups, id: string | null | undefined): string {
  if (!id) return '';
  return l.nicheNames.get(id) ?? id.replace(/^nch_/, '').replace(/[-_]+/g, ' ');
}

export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/** Human label of a bandit dimension key ("hook_style:nch_3" → "Style de hook · Sommeil bébé"). */
export function banditDimensionLabel(l: Lookups, key: string): string {
  const [dim, niche] = key.split(':');
  const base: Record<string, string> = {
    hook_style: 'Style de hook', ad_format: 'Format pub', price: 'Prix', hype: 'Niveau de promesse (page de vente)',
    support_tone: 'Ton du support', niche: 'Choix de niche',
  };
  const label = base[dim ?? ''] ?? dim ?? key;
  return niche ? `${label} · ${nicheName(l, niche)}` : label;
}

export function banditArmLabel(l: Lookups, dimKey: string, arm: string): string {
  const dim = dimKey.split(':')[0];
  if (dim === 'hook_style') return HOOK_LABEL[arm as HookStyle] ?? arm;
  if (dim === 'ad_format') return FORMAT_LABEL[arm as AdFormat] ?? arm;
  if (dim === 'price') return `${arm} €`;
  if (dim === 'hype') {
    const v = Number(arm);
    return Number.isFinite(v) ? `Promesse ${Math.round(v * 100)} %` : arm;
  }
  if (dim === 'niche') return nicheName(l, arm);
  return arm.charAt(0).toUpperCase() + arm.slice(1);
}

// ───────────────────────────── Playbook rule patterns ─────────────────────────────

export type RuleKind = 'banned' | 'hook' | 'format' | 'price' | 'hype' | 'tone' | 'free';

export interface ParsedRule { kind: RuleKind; label: string; value: string | null; text: string }

const RULE_PATTERNS: { kind: RuleKind; label: string; re: RegExp }[] = [
  { kind: 'banned', label: 'Interdit', re: /Ne jamais écrire\s*«\s*([^»]+?)\s*»/i },
  { kind: 'hook', label: 'Hook préféré', re: /Privilégier le hook\s*«\s*([^»]+?)\s*»/i },
  { kind: 'format', label: 'Format préféré', re: /Privilégier le format\s*«\s*([^»]+?)\s*»/i },
  { kind: 'price', label: 'Prix cible', re: /Prix cible\s*«\s*([^»]+?)\s*»/i },
  { kind: 'hype', label: 'Promesse max', re: /Niveau de promesse max\s*«\s*([^»]+?)\s*»/i },
  { kind: 'tone', label: 'Ton support', re: /Ton support\s*«\s*([^»]+?)\s*»/i },
];

export function parseRule(text: string): ParsedRule {
  for (const p of RULE_PATTERNS) {
    const m = p.re.exec(text);
    if (m) {
      let value = m[1]?.trim() ?? null;
      if (value && p.kind === 'hook') value = HOOK_LABEL[value as HookStyle] ?? value;
      if (value && p.kind === 'format') value = FORMAT_LABEL[value as AdFormat] ?? value;
      if (value && p.kind === 'price') value = `${value} €`;
      if (value && p.kind === 'hype') value = `${Math.round(Number(value.replace(',', '.')) * 100) || value} %`;
      return { kind: p.kind, label: p.label, value, text };
    }
  }
  return { kind: 'free', label: 'Règle', value: null, text };
}

/** Best-matching lesson for a playbook rule (word overlap), restricted to lessons applied to the agent. */
export function lessonForRule(rule: string, lessons: readonly Lesson[], agentId: string): Lesson | null {
  const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const rw = words(rule);
  let best: Lesson | null = null;
  let bestScore = 0;
  for (const l of lessons) {
    if (!l.appliesTo?.includes(agentId)) continue;
    if (l.insight && (rule.includes(l.insight) || l.insight.includes(rule))) return l;
    const lw = words(`${l.insight} ${l.evidence}`);
    let common = 0;
    for (const w of rw) if (lw.has(w)) common++;
    const score = rw.size ? common / rw.size : 0;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return bestScore >= 0.25 ? best : null;
}
