// Realistic, fully typed fake snapshot (the company of day 10: the eight founders and their first four hires, 11 open
// departments, a live product, 10 days of KPIs) for offline previews and the shell's demo mode. Deterministic content;
// `at` timestamps are relative to now so the speech bubbles show up.
import { CHANNELS, CHANNEL_IDS } from '../../../shared/channels';
import type {
  Activity, ActivityKind, AdCreative, AgentState, AvatarSpec, BanditArm, Campaign, ChannelChip, ChronicleEntry, CompanySnapshot, CreatorProfile, DailyAdStats,
  DailyKpi, DeptDef, DeptId, Deliverable, Experiment, FinanceSnapshot, InboxMessage, LedgerEntry, Lesson, Mission, ModelTier,
  Order, OrganicPost, OrgState, Partnership, PdfContent, PersonCard, Place, Product, RoleId, SceneView, StageId, Task, TaskKind, ToolName, WorldEvent, AgentStatus,
} from '../../../shared/types';

const DAY = 10;
const TICK = 4;

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// ───────────── departments ─────────────

const DEPTS: DeptDef[] = [
  { id: 'direction', name: 'Direction', color: '#7c6cf0', icon: 'DIRECTION', description: 'Fixe le cap chaque matin, arbitre les budgets et valide ce qui part chez le client.', chiefId: 'camille', grid: { col: 0, row: 0 } },
  { id: 'recherche', name: 'Recherche', color: '#3b82f6', icon: 'RECHERCHE', description: 'Trouve les niches rentables : tendances, douleurs des clients, concurrents.', chiefId: 'nadia', grid: { col: -1, row: 0 } },
  { id: 'studio', name: 'Studio PDF', color: '#f59e0b', icon: 'STUDIO PDF', description: 'Écrit les guides : 10 titres, plan qui vend, rédaction, humanisation, fact-check.', chiefId: 'elise', grid: { col: -1, row: -1 } },
  { id: 'creation', name: 'Création', color: '#8b5cf6', icon: 'CRÉATION', description: 'Couvertures, mise en page du PDF, visuels et storyboards TikTok.', chiefId: 'zoe', grid: { col: 0, row: -1 } },
  { id: 'growth', name: 'Growth', color: '#ec4899', icon: 'GROWTH', description: 'Pubs TikTok, contenu organique, tests de hooks et pilotage des budgets.', chiefId: 'leo', grid: { col: 2, row: -1 } },
  { id: 'boutique', name: 'Boutique', color: '#ef4444', icon: 'BOUTIQUE', description: 'Pages de vente, prix, mise en ligne et upsell « La suite est ici ».', chiefId: 'clara', grid: { col: 1, row: 0 } },
  { id: 'support', name: 'Support', color: '#f97316', icon: 'SUPPORT', description: 'Répond aux clients, gère remboursements, arnaques et clients difficiles.', chiefId: 'lucas', grid: { col: 1, row: 1 } },
  { id: 'analyse', name: 'Analyse', color: '#14b8a6', icon: 'ANALYSE', description: 'Rapports quotidiens, expériences A/B et lecture honnête des chiffres.', chiefId: 'raphael', grid: { col: -2, row: 2 } },
  { id: 'finance', name: 'Finance', color: '#65a30d', icon: 'FINANCE', description: 'Trésorerie, enveloppes de dépense, rentabilité et garde-fous budgétaires.', chiefId: 'gabriel', grid: { col: -1, row: 1 } },
  { id: 'rh', name: 'RH', color: '#f472b6', icon: 'RH', description: 'Rétro du soir, leçons, playbooks et revues de performance des agents.', chiefId: 'nora', grid: { col: -2, row: 1 } },
  { id: 'crm', name: 'Communauté & Email', color: '#0ea5e9', icon: 'COMMUNAUTÉ', description: 'Anime la communauté au quotidien et écrit à la liste e-mail.', chiefId: 'tom', grid: { col: 2, row: 0 } },
];
/** The catalog's two departments with nobody yet: vacant plots. Their kinds are worn as hats, `mockOrgState` says by which department. */
const CLOSED_DEPTS: DeptDef[] = [
  { id: 'partenariats', name: 'Partenariats', color: '#06b6d4', icon: 'PARTENARIATS', description: 'Petits créateurs à la commission, négociation et détection des arnaques.', chiefId: '', grid: { col: 1, row: -1 } },
  { id: 'video', name: 'Studio Vidéo', color: '#a855f7', icon: 'VIDÉO', description: 'Monte les publicités vidéo et les déclinaisons de format.', chiefId: '', grid: { col: 0, row: -2 } },
];

// ───────────── agents ─────────────

interface AgentRow {
  id: string; name: string; role: string; dept: DeptId; chief?: boolean; tier: ModelTier;
  persona: string; skills: string[]; tools: ToolName[]; kinds: TaskKind[]; hats?: TaskKind[]; hatDepts?: DeptId[];
  look: [skin: number, hair: number, style: AvatarSpec['hairStyle'], acc: AvatarSpec['accessory'], shirt: string, pants?: string];
  status: AgentStatus; place?: Place; bubble?: string; task?: number; hiredDay?: number;
}

const SKIN = ['#f8d9bd', '#f1c7a5', '#e2a97f', '#c98a5e', '#9c6440', '#6e4229'];
const HAIR = ['#2b1d16', '#4a2f22', '#7a4a2b', '#b5651d', '#e0b057', '#1b1b22', '#c9c2b8', '#a8322a'];

// What reconcileOrg gives this team: the kinds of each role, then the hats of whatever nobody holds. world.test.ts checks it against the catalog.
const ROWS: AgentRow[] = [
  { id: 'camille', name: 'Camille', role: 'CEO & orchestratrice', dept: 'direction', chief: true, tier: 'opus', persona: 'Calme et exigeante, elle lit le cerveau chaque matin et ne lance qu’un pari à la fois.', skills: ['Stratégie', 'Arbitrage budgétaire', 'Délégation'], tools: ['brain.read', 'brain.write', 'team.delegate', 'team.review', 'finance.ledger'], kinds: ['plan_day', 'portfolio_review', 'pick_opportunity'], hats: ['follow_missions'], look: [1, 0, 1, 'none', '#7c6cf0', '#2f2a4a'], status: 'reviewing', task: 205, bubble: 'On garde un seul produit tant qu’il n’est pas rentable.' },
  { id: 'nadia', name: 'Nadia', role: 'Cheffe Recherche', dept: 'recherche', chief: true, tier: 'sonnet', persona: 'Curieuse et rigoureuse, elle préfère une niche étroite à une audience floue.', skills: ['Tendances TikTok', 'Règle du un', 'Synthèse'], tools: ['market.trends', 'market.pains', 'market.competitors', 'creators.search', 'creators.deal', 'brain.read', 'brain.write', 'team.delegate'], kinds: ['scan_trends', 'pick_opportunity', 'mine_pains'], hats: ['scan_competitors', 'find_creators', 'negotiate_deal'], hatDepts: ['partenariats'], look: [4, 5, 5, 'glasses', '#3b82f6', '#1e3a5f'], status: 'working', task: 202 },
  { id: 'elise', name: 'Élise', role: 'Rédactrice en chef', dept: 'studio', chief: true, tier: 'opus', persona: 'Plume précise, elle traque le flou et exige des étapes numérotées.', skills: ['Plan qui vend', 'Édition', 'Ton de marque'], tools: ['brain.read', 'brain.write', 'team.delegate', 'team.review'], kinds: ['write_titles', 'write_outline', 'write_pdf'], hats: ['humanize_pdf', 'write_lead_magnet'], hatDepts: ['crm'], look: [0, 4, 2, 'glasses', '#f59e0b', '#3f3a4f'], status: 'reviewing', task: 208, bubble: 'Chapitre 3 : il manque un exemple concret.' },
  { id: 'zoe', name: 'Zoé', role: 'Directrice artistique', dept: 'creation', chief: true, tier: 'sonnet', persona: 'Elle veut des couvertures lisibles en vignette et jamais surchargées.', skills: ['Couverture', 'Palette', 'Mise en page'], tools: ['design.cover', 'pdf.render', 'team.delegate', 'team.review'], kinds: ['design_cover', 'render_pdf'], hats: ['adapt_creative'], hatDepts: ['video'], look: [2, 7, 5, 'none', '#8b5cf6', '#312e81'], status: 'working', task: 209 },
  { id: 'leo', name: 'Léo', role: 'Head of growth', dept: 'growth', chief: true, tier: 'opus', persona: 'Obsédé par le CTR, il coupe vite ce qui ne marche pas et double ce qui marche.', skills: ['Pubs TikTok', 'Budgets', 'Tests'], tools: ['ads.campaign', 'ads.stats', 'team.delegate', 'brain.read'], kinds: ['write_ad_hooks', 'launch_campaign', 'optimize_ads', 'open_channel'], hats: ['write_search_ads'], look: [2, 1, 0, 'cap', '#ec4899', '#1f2937'], status: 'meeting', place: 'direction' },
  { id: 'clara', name: 'Clara', role: 'Responsable boutique', dept: 'boutique', chief: true, tier: 'sonnet', persona: 'Elle écrit avec les mots des clients et traite les objections avant qu’elles arrivent.', skills: ['Page de vente', 'Objections', 'Mise en ligne'], tools: ['store.publish', 'store.price', 'store.stats', 'web.page', 'team.delegate'], kinds: ['publish_product', 'write_sales_page'], hats: ['set_price', 'design_upsell', 'write_email_sequence', 'send_broadcast', 'design_bump'], hatDepts: ['crm'], look: [2, 7, 1, 'none', '#ef4444', '#3f3f46'], status: 'blocked', task: 217, bubble: 'J’attends la validation de Gabriel pour passer à 24 €.' },
  { id: 'gabriel', name: 'Gabriel', role: 'Directeur financier', dept: 'finance', chief: true, tier: 'sonnet', persona: 'Prudent, il protège la trésorerie et fixe l’enveloppe pub du jour.', skills: ['Trésorerie', 'Rentabilité', 'Garde-fous'], tools: ['finance.ledger', 'brain.read', 'team.review'], kinds: ['budget_review', 'allocate_channels'], hats: ['reconcile_ledger', 'weekly_pnl'], look: [1, 6, 0, 'tie', '#65a30d', '#1f2937'], status: 'meeting', place: 'direction' },
  { id: 'nora', name: 'Nora', role: 'DRH & rétrospectives', dept: 'rh', chief: true, tier: 'sonnet', persona: 'Bienveillante, elle transforme chaque erreur en règle de playbook.', skills: ['Rétro', 'Coaching', 'Playbooks'], tools: ['brain.read', 'brain.write', 'team.review'], kinds: ['retro', 'performance_review', 'headcount_review', 'recruit', 'league_review'], hats: ['red_team', 'fact_check'], hatDepts: ['studio'], look: [2, 1, 1, 'none', '#f472b6', '#4a044e'], status: 'coffee', place: 'cafe' },
  // The first hires, in the order they came
  { id: 'adam', name: 'Adam', role: 'Media buyer TikTok', dept: 'growth', tier: 'sonnet', persona: 'Il surveille la fréquence et le CPM comme le lait sur le feu.', skills: ['Ciblage', 'Enchères', 'Fatigue créa'], tools: ['ads.campaign', 'ads.stats', 'ads.review'], kinds: ['launch_campaign', 'optimize_ads'], look: [5, 0, 3, 'none', '#fb7185', '#111827'], status: 'thinking', task: 213, hiredDay: 2 },
  { id: 'raphael', name: 'Raphaël', role: 'Data analyst', dept: 'analyse', chief: true, tier: 'sonnet', persona: 'Il dit les mauvaises nouvelles en premier et chiffre tout.', skills: ['Rapports', 'Cohortes', 'Attribution'], tools: ['ads.stats', 'store.stats', 'finance.ledger', 'brain.write', 'team.delegate'], kinds: ['daily_report', 'reconcile_channels', 'run_experiment'], look: [2, 0, 0, 'glasses', '#14b8a6', '#134e4a'], status: 'idle', hiredDay: 3 },
  { id: 'tom', name: 'Tom', role: 'Community manager', dept: 'crm', chief: true, tier: 'haiku', persona: 'Il teste des formats TikTok gratuits sur la douleur exacte des parents.', skills: ['TikTok organique', 'Tendances sonores'], tools: ['organic.post', 'design.storyboard', 'brain.read'], kinds: ['post_organic', 'produce_ad'], look: [1, 2, 0, 'none', '#be185d', '#374151'], status: 'walking', place: 'growth', hiredDay: 4 },
  { id: 'lucas', name: 'Lucas', role: 'Agent support', dept: 'support', chief: true, tier: 'haiku', persona: 'Il répond vite, renvoie le bon lien et garde le sourire avec les clients pressés.', skills: ['Réponses rapides', 'Liens de téléchargement'], tools: ['inbox.read', 'inbox.reply', 'inbox.refund'], kinds: ['reply_inbox', 'handle_refund'], look: [1, 4, 0, 'headphones', '#fdba74', '#1f2937'], status: 'working', task: 220, hiredDay: 5 },
];

const PANTS_DEFAULT = ['#2f3a56', '#3a3f5c', '#43405a', '#2b3445'];

/** Role and gender of each row, then the eight founders. */
const PEOPLE: Record<string, [RoleId, 'f' | 'm']> = {
  camille: ['ceo', 'f'], nadia: ['research_lead', 'f'], elise: ['editor_in_chief', 'f'], zoe: ['art_director', 'f'],
  leo: ['growth_lead', 'm'], clara: ['shop_lead', 'f'], gabriel: ['cfo', 'm'], nora: ['hr_lead', 'f'],
  adam: ['media_buyer_tiktok', 'm'], raphael: ['data_analyst', 'm'], tom: ['community_manager', 'm'], lucas: ['support_agent', 'm'],
};
const FOUNDERS = new Set(['camille', 'nadia', 'elise', 'zoe', 'leo', 'clara', 'gabriel', 'nora']);
const RAMP_DAYS = 3; // ORG.rampDays
const MOCK_PAY: Record<ModelTier, number> = { opus: 1.2, sonnet: 0.8, haiku: 0.5 }; // ORG.payPerDay

function buildAgents(rand: () => number): AgentState[] {
  return ROWS.map((r, i) => {
    const [skin, hair, style, acc, shirt, pants] = r.look;
    const done = 6 + Math.floor(rand() * 18);
    const rejected = Math.floor(rand() * 3);
    const failed = Math.floor(rand() * 2);
    const level = 1 + Math.floor((done + (r.chief ? 8 : 0)) / 8);
    const place: Place = r.place ?? r.dept;
    return {
      id: r.id, name: r.name, role: r.role, dept: r.dept, isChief: !!r.chief, tier: r.tier, persona: r.persona, skills: r.skills, tools: r.tools,
      taskKinds: [...r.kinds, ...(r.hats ?? [])],
      avatar: { skin: SKIN[skin], hair: HAIR[hair], hairStyle: style, accessory: acc, shirt, pants: pants ?? PANTS_DEFAULT[i % PANTS_DEFAULT.length] },
      status: r.status,
      place,
      currentTaskId: r.task === undefined ? null : `tsk_${r.task}`,
      energy: r.status === 'coffee' ? 38 + Math.floor(rand() * 15) : 55 + Math.floor(rand() * 40),
      level,
      xp: done * 35 + Math.floor(rand() * 30),
      perf: { done, approved: done - rejected, rejected, failed, score: Math.round(62 + rand() * 33) },
      bubble: r.bubble ?? null,
      roleId: PEOPLE[r.id]![0],
      gender: PEOPLE[r.id]![1],
      founder: FOUNDERS.has(r.id),
      hatKinds: r.hats ?? [],
      hatDepts: r.hatDepts ?? [],
      hiredDay: r.hiredDay ?? 0,
      rampUntilDay: r.hiredDay ? r.hiredDay + RAMP_DAYS : 0,
      notice: null,
    };
  });
}

// ───────────── product ─────────────

const NICHE = 'sommeil-bebe-6-18-mois';

const CONTENT: PdfContent = {
  title: 'Dodo serein',
  subtitle: '21 nuits pour aider bébé (6-18 mois) à faire ses nuits sans le laisser pleurer',
  audience: 'Parents épuisés d’un bébé de 6 à 18 mois qui se réveille plusieurs fois par nuit',
  promise: 'Un rituel du soir clair, un plan nuit par nuit et des réponses prêtes pour les réveils de 3 h du matin.',
  introduction: [
    'Il est 3 h 12. Il se réveille toutes les deux heures, vous connaissez le plafond de la chambre par cœur et la journée de demain s’annonce longue.',
    'Ce guide ne promet pas de miracle : il vous donne un plan simple, testé par des parents qui disaient exactement la même chose que vous.',
  ],
  chapters: [
    {
      title: 'Comprendre pourquoi il se réveille',
      intro: 'Avant de changer quoi que ce soit, on observe trois nuits sans rien modifier.',
      paragraphs: ['La plupart des réveils viennent d’une association d’endormissement : bébé s’endort au sein, au biberon ou dans les bras, puis cherche la même chose à chaque cycle.'],
      steps: ['Notez l’heure de chaque réveil pendant 3 nuits.', 'Notez comment il s’est endormi au coucher.', 'Repérez le réveil le plus régulier.'],
      example: '« Il s’endormait au biberon à 20 h et se réveillait à 23 h, 2 h et 4 h 30 » — Julie, maman de Léon (9 mois).',
      checklist: ['Journal de sommeil rempli', 'Association identifiée'],
      visual: { type: 'timeline', title: 'Une nuit type avant le plan', labels: ['20 h', '23 h', '2 h', '4 h 30', '7 h'], values: [] },
    },
    {
      title: 'Le rituel du soir en 5 étapes',
      intro: 'Toujours les mêmes gestes, dans le même ordre, pendant 25 minutes maximum.',
      paragraphs: ['Le rituel annonce la nuit : bain tiède, pyjama, lumière tamisée, une histoire courte, puis le lit éveillé mais somnolent.'],
      steps: ['Bain ou toilette à heure fixe.', 'Pyjama et gigoteuse dans la chambre.', 'Lumière tamisée, voix basse.', 'Une seule histoire, toujours la même phrase de fin.', 'Poser bébé éveillé mais somnolent.'],
      example: null,
      checklist: ['Rituel affiché sur le frigo', 'Même heure ± 15 min'],
      visual: { type: 'steps_diagram', title: 'Le rituel', labels: ['Bain', 'Pyjama', 'Lumière douce', 'Histoire', 'Au lit éveillé'], values: [] },
    },
    {
      title: 'Les réveils de 3 h du matin',
      intro: 'Une réponse prévisible et de plus en plus courte.',
      paragraphs: ['On attend 2 minutes, on rassure avec la voix, puis la main, sans rallumer la lumière.'],
      steps: ['Attendre 2 minutes avant d’intervenir.', 'Rassurer d’abord à la voix.', 'Main posée sur le ventre 1 minute.', 'Sortir avant qu’il ne dorme.'],
      example: '« La troisième nuit, il s’est rendormi seul en 6 minutes » — Mehdi, papa d’Inaya (14 mois).',
      checklist: ['Pas de lumière forte', 'Même phrase rassurante'],
      visual: { type: 'bar_chart', title: 'Minutes pour se rendormir', labels: ['Nuit 1', 'Nuit 3', 'Nuit 7', 'Nuit 14'], values: [80, 55, 30, 15] },
    },
    {
      title: 'Le plan 21 nuits',
      intro: 'Trois semaines, un petit pas à la fois.',
      paragraphs: ['Semaine 1 : rituel et journal. Semaine 2 : réponses courtes aux réveils. Semaine 3 : on consolide et on décale l’heure du coucher si besoin.'],
      steps: ['Nuits 1 à 7 : rituel fixe.', 'Nuits 8 à 14 : réponse en 3 temps.', 'Nuits 15 à 21 : consolidation.'],
      example: null,
      checklist: ['Calendrier imprimé', 'Partenaire briefé'],
      visual: { type: 'checklist_card', title: 'Votre calendrier', labels: ['Semaine 1', 'Semaine 2', 'Semaine 3'], values: [] },
    },
    {
      title: 'Quand demander de l’aide',
      intro: 'Certains signaux méritent un avis médical.',
      paragraphs: ['Fièvre, ronflements importants, pauses respiratoires ou perte de poids : parlez-en à votre pédiatre avant tout plan de sommeil.'],
      steps: ['Lister les signaux observés.', 'Prendre rendez-vous chez le pédiatre.'],
      example: null,
      checklist: ['Carnet de santé à jour'],
      visual: { type: 'do_dont', title: 'À faire / à éviter', labels: ['Rituel fixe', 'Écrans le soir', 'Lit éveillé', 'Changer de méthode chaque nuit'], values: [] },
    },
  ],
  bonus: {
    title: 'Bonus : les siestes qui sauvent la nuit',
    intro: 'Une mauvaise sieste fait souvent une mauvaise nuit.',
    paragraphs: ['Entre 6 et 18 mois, deux siestes bien placées réduisent les réveils nocturnes.'],
    steps: ['Sieste du matin 2 h 30 après le réveil.', 'Sieste de l’après-midi avant 15 h 30.'],
    example: null,
    checklist: ['Fenêtres d’éveil notées'],
    visual: null,
  },
  nextStep: { title: 'La suite est ici', text: 'Les siestes restent compliquées ? Le guide « Siestes faciles » vous accompagne pas à pas.', upsellProductId: 'prd_2' },
  wordCount: 6840,
};

function buildProducts(): Product[] {
  const live: Product = {
    id: 'prd_1', nicheId: NICHE, title: CONTENT.title, subtitle: CONTENT.subtitle, audience: CONTENT.audience,
    problem: 'Bébé se réveille toutes les deux heures et les parents n’en peuvent plus', price: 19, status: 'live', version: 2,
    content: CONTENT,
    design: { palette: { bg: '#fdf6ff', primary: '#5b4bd6', secondary: '#f3b5d4', accent: '#ffcf66', ink: '#231d3a', soft: '#ece6ff' }, motif: 'moon', coverLayout: 'centered', titleFont: 'Helvetica-Bold', bodyFont: 'Helvetica', seed: 1207 },
    salesPage: {
      headline: 'Il se réveille toutes les 2 heures ? Retrouvez des nuits complètes en 21 nuits',
      subheadline: 'Le plan doux, nuit par nuit, pour les bébés de 6 à 18 mois — sans le laisser pleurer seul.',
      painBullets: ['« Je connais le plafond de sa chambre par cœur »', '« Il ne s’endort qu’au biberon »', '« On se relaie toute la nuit avec mon conjoint »'],
      solution: 'Un rituel en 5 étapes, une réponse en 3 temps aux réveils et un calendrier de 21 nuits.',
      chapterBlurbs: CONTENT.chapters.map((c) => ({ title: c.title, blurb: c.intro })),
      bonusBlurb: 'Cadeau inside : le chapitre bonus sur les siestes qui sauvent la nuit.',
      objections: [
        { q: 'Et si mon bébé est différent ?', a: 'Le plan part de votre journal de 3 nuits : il s’adapte à votre enfant.' },
        { q: 'Faut-il le laisser pleurer ?', a: 'Non. Vous restez présent, avec une réponse de plus en plus courte.' },
      ],
      guarantee: 'Satisfait ou remboursé pendant 14 jours, sans justification.',
      cta: 'Je télécharge Dodo serein',
      hypeLevel: 0.35,
    },
    files: { pdf: 'files/prd_1/v2/guide.pdf', cover: 'files/prd_1/v2/cover.svg', salesPage: 'files/prd_1/v2/sales-page.html' },
    quality: { overall: 84, specificity: 90, structure: 88, actionability: 86, humanTone: 79, design: 82, promiseMatch: 85, compliance: 92, issues: ['Ajouter un exemple au chapitre 4.'], evaluator: 'heuristic' },
    salesQuality: { overall: 81, specificity: 88, structure: 84, actionability: 75, humanTone: 83, design: 78, promiseMatch: 86, compliance: 90, issues: ['La garantie pourrait être plus visible.'], evaluator: 'heuristic' },
    upsellProductId: 'prd_2', createdDay: 3, launchedDay: 6,
    stats: {
      views: 612, sales: 20, revenue: 330, refunds: 1, refundAmount: 14, rating: 4.5, upsellSales: 0,
      reviews: [
        { id: 'rev_1', day: 8, customerId: 'cus_3', rating: 5, text: 'Le rituel en 5 étapes a tout changé, deux réveils au lieu de cinq dès la première semaine.' },
        { id: 'rev_2', day: 9, customerId: 'cus_7', rating: 4, text: 'Très concret. J’aurais aimé plus d’exemples pour les jumeaux.' },
        { id: 'rev_3', day: 9, customerId: 'cus_11', rating: 5, text: 'Enfin un guide qui ne dit pas juste « soyez patients ».' },
        { id: 'rev_4', day: 10, customerId: 'cus_15', rating: 4, text: 'Bien, mais le chapitre sur les siestes est trop court.' },
      ],
    },
    priceHistory: [{ day: 6, price: 14 }, { day: 9, price: 19 }],
  };
  const next: Product = {
    id: 'prd_2', nicheId: NICHE, title: 'Siestes faciles', subtitle: 'Le guide des siestes pour les 6-18 mois', audience: CONTENT.audience,
    problem: 'Les siestes sont trop courtes et ruinent la nuit', price: 0, status: 'writing', version: 1, content: null, design: null, salesPage: null,
    files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null, upsellProductId: null, createdDay: 9, launchedDay: null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [],
  };
  return [live, next];
}

function buildCreatives(): AdCreative[] {
  const base = { productId: 'prd_1', caption: 'Le plan doux pour des nuits complètes 🌙', hashtags: ['#sommeilbebe', '#parents', '#maman', '#bebe'], cta: 'Lien dans la bio', createdBy: 'tom' };
  return [
    {
      ...base, id: 'crt_1', hook: 'Ton bébé se réveille encore à 3 h du matin ?', hookStyle: 'question', format: 'faceless_voiceover',
      scenes: [
        { visual: 'Chambre plongée dans le noir, babyphone qui s’allume', onScreenText: '3 h 12… encore', voiceover: 'Ton bébé se réveille encore à 3 h du matin ?', durationSec: 2.5 },
        { visual: 'Calendrier qui se coche nuit après nuit', onScreenText: '21 nuits, un petit pas à la fois', voiceover: 'Voici le plan doux que 2 000 parents ont suivi.', durationSec: 4 },
        { visual: 'Couverture du guide Dodo serein', onScreenText: 'Dodo serein · 19 €', voiceover: 'Le lien est dans la bio.', durationSec: 3 },
      ],
      files: { storyboard: ['files/prd_1/ads/crt_1/frame-1.svg', 'files/prd_1/ads/crt_1/frame-2.svg', 'files/prd_1/ads/crt_1/frame-3.svg'], preview: 'files/prd_1/ads/crt_1/preview.html' },
      quality: { overall: 82, specificity: 86, structure: 80, actionability: 74, humanTone: 84, design: 80, promiseMatch: 88, compliance: 95, issues: [], evaluator: 'heuristic' },
      review: { status: 'approved', reason: null, day: 6 }, createdDay: 5,
    },
    {
      ...base, id: 'crt_2', hook: 'L’erreur que font 8 parents sur 10 au coucher', hookStyle: 'mistake', format: 'text_slideshow',
      scenes: [
        { visual: 'Texte blanc sur fond violet', onScreenText: 'L’erreur n°1 au coucher', voiceover: '', durationSec: 2 },
        { visual: 'Biberon posé sur la table de nuit', onScreenText: 'Il s’endort au biberon… puis le réclame à chaque réveil', voiceover: '', durationSec: 3 },
        { visual: 'Couverture du guide', onScreenText: 'Le rituel en 5 étapes est dans Dodo serein', voiceover: '', durationSec: 3 },
      ],
      files: { storyboard: ['files/prd_1/ads/crt_2/frame-1.svg', 'files/prd_1/ads/crt_2/frame-2.svg', 'files/prd_1/ads/crt_2/frame-3.svg'], preview: 'files/prd_1/ads/crt_2/preview.html' },
      quality: { overall: 76, specificity: 80, structure: 78, actionability: 70, humanTone: 77, design: 74, promiseMatch: 84, compliance: 93, issues: ['La 2e scène est un peu longue.'], evaluator: 'heuristic' },
      review: { status: 'approved', reason: null, day: 7 }, createdDay: 6,
    },
    {
      ...base, id: 'crt_3', hook: 'Il fait ses nuits en 3 jours, garanti', hookStyle: 'before_after', format: 'ugc_avatar',
      scenes: [{ visual: 'Maman souriante au réveil', onScreenText: 'En 3 jours, garanti', voiceover: 'Mon fils fait ses nuits depuis 3 jours, garanti !', durationSec: 3 }],
      files: { storyboard: ['files/prd_1/ads/crt_3/frame-1.svg'], preview: 'files/prd_1/ads/crt_3/preview.html' },
      quality: { overall: 58, specificity: 70, structure: 60, actionability: 50, humanTone: 62, design: 70, promiseMatch: 40, compliance: 35, issues: ['Promesse de résultat garanti interdite.'], evaluator: 'heuristic' },
      review: { status: 'rejected', reason: 'Promesse de résultat garanti (« fait ses nuits en 3 jours »).', day: 8 }, createdDay: 8,
    },
  ];
}

// ───────────── KPIs, finance, ledger ─────────────

const SERIES = {
  revenue: [0, 0, 0, 0, 0, 28, 42, 70, 114, 76],
  adSpend: [0, 0, 0, 0, 0, 20, 20, 25, 25, 18],
  refunds: [0, 0, 0, 0, 0, 0, 0, 14, 0, 0],
  fees: [0, 0, 0, 0, 0, 1.9, 2.85, 4.75, 7.2, 4.8],
  other: [1.5, 1.5, 1.5, 9.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
  sales: [0, 0, 0, 0, 0, 2, 3, 5, 6, 4],
  impressions: [0, 0, 0, 0, 0, 4100, 4300, 5200, 5000, 3600],
  clicks: [0, 0, 0, 0, 0, 92, 110, 150, 155, 108],
  tickets: [0, 0, 0, 0, 0, 1, 2, 3, 2, 3],
  reply: [0, 0, 0, 0, 0, 72, 78, 81, 84, 86],
  tasks: [6, 9, 11, 12, 10, 14, 13, 15, 16, 8],
  lessons: [1, 1, 2, 1, 2, 2, 3, 2, 3, 0],
};

function buildKpis(): DailyKpi[] {
  const out: DailyKpi[] = [];
  let cum = 0;
  for (let i = 0; i < DAY; i++) {
    const profit = r2(SERIES.revenue[i] - SERIES.refunds[i] - SERIES.adSpend[i] - SERIES.fees[i] - SERIES.other[i]);
    cum = r2(cum + profit);
    const clicks = SERIES.clicks[i];
    const sales = SERIES.sales[i];
    out.push({
      day: i + 1, cash: r2(500 + cum), revenue: SERIES.revenue[i], adSpend: SERIES.adSpend[i], profit, cumulativeProfit: cum, sales,
      refunds: SERIES.refunds[i] ? 1 : 0, impressions: SERIES.impressions[i], clicks, ctr: SERIES.impressions[i] ? r2((clicks / SERIES.impressions[i]) * 10000) / 10000 : 0,
      cvr: clicks ? Math.round((sales / clicks) * 10000) / 10000 : 0, roas: SERIES.adSpend[i] ? r2(SERIES.revenue[i] / SERIES.adSpend[i]) : 0,
      cac: sales ? r2(SERIES.adSpend[i] / sales) : 0, openTickets: SERIES.tickets[i], avgReplyScore: SERIES.reply[i], liveProducts: i >= 5 ? 1 : 0,
      tasksDone: SERIES.tasks[i], lessonsLearned: SERIES.lessons[i],
    });
  }
  return out;
}

function sum(a: number[], from = 0): number {
  return r2(a.slice(from).reduce((s, v) => s + v, 0));
}

function buildFinance(kpis: DailyKpi[]): FinanceSnapshot {
  const last = kpis[kpis.length - 1];
  const profit7d = r2(kpis.slice(-7).reduce((s, k) => s + k.profit, 0));
  const spend7 = sum(SERIES.adSpend, 3);
  return {
    cash: last.cash, revenue: sum(SERIES.revenue), refunds: sum(SERIES.refunds), adSpend: sum(SERIES.adSpend), fees: sum(SERIES.fees), compute: 0,
    otherCosts: sum(SERIES.other), profit: last.cumulativeProfit, profit7d, burn7d: r2(-profit7d / 7), runwayDays: null,
    roas7d: spend7 ? r2(sum(SERIES.revenue, 3) / spend7) : 0, bankrupt: false,
  };
}

function buildLedger(): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let n = 1;
  const add = (day: number, type: LedgerEntry['type'], amount: number, memo: string, ref: string | null = null) => out.push({ id: `led_${n++}`, day, type, amount: r2(amount), memo, ref });
  add(1, 'capital', 500, 'Capital de départ');
  for (let d = 1; d <= DAY; d++) {
    add(d, 'tool_subscription', -1.5, 'Abonnement boutique + hébergement des fichiers');
    if (d === 4) add(d, 'tool_subscription', -8, 'Nom de domaine de la boutique');
    if (SERIES.adSpend[d - 1]) add(d, 'ad_spend', -SERIES.adSpend[d - 1], 'TikTok Ads — Dodo serein — test hooks', 'cmp_1');
    if (SERIES.revenue[d - 1]) add(d, 'revenue', SERIES.revenue[d - 1], `${SERIES.sales[d - 1]} ventes « Dodo serein »`, 'prd_1');
    if (SERIES.fees[d - 1]) add(d, 'payment_fee', -SERIES.fees[d - 1], 'Frais de paiement', 'prd_1');
    if (SERIES.refunds[d - 1]) add(d, 'refund', -SERIES.refunds[d - 1], 'Remboursement — « pas le temps de lire »', 'ord_9');
  }
  return out;
}

// ───────────── market ─────────────

function buildOrders(): Order[] {
  const out: Order[] = [];
  let n = 1;
  for (let d = 6; d <= DAY; d++) {
    for (let i = 0; i < SERIES.sales[d - 1]; i++) {
      const price = d >= 9 ? 19 : 14;
      const src: Order['source'] = n % 6 === 0 ? 'organic' : n % 9 === 0 ? 'creator' : 'ads';
      out.push({ id: `ord_${n}`, day: d, customerId: `cus_${n}`, productId: 'prd_1', price, source: src, campaignId: src === 'ads' ? 'cmp_1' : null, creatorId: src === 'creator' ? 'cre_1' : null, refunded: n === 9, chargeback: false });
      n++;
    }
  }
  return out;
}

function buildAdStats(): DailyAdStats[] {
  const out: DailyAdStats[] = [];
  for (let d = 6; d <= DAY; d++) {
    const i = d - 1;
    for (const [cid, share, ctrK] of [['crt_1', 0.6, 1.18], ['crt_2', 0.4, 0.72]] as const) {
      const spend = r2(SERIES.adSpend[i] * share);
      const impressions = Math.round(SERIES.impressions[i] * share);
      const clicks = Math.round(SERIES.clicks[i] * share * ctrK);
      const purchases = Math.round(SERIES.sales[i] * share * ctrK);
      const revenue = purchases * (d >= 9 ? 19 : 14);
      out.push({
        day: d, campaignId: 'cmp_1', creativeId: cid, productId: 'prd_1', spend, impressions, clicks,
        ctr: impressions ? Math.round((clicks / impressions) * 10000) / 10000 : 0, cpc: clicks ? r2(spend / clicks) : 0, cpm: impressions ? r2((spend / impressions) * 1000) : 0,
        landingViews: Math.round(clicks * 0.86), purchases, revenue, roas: spend ? r2(revenue / spend) : 0, frequency: r2(1.1 + (d - 6) * 0.18),
        comments: d === 9 && cid === 'crt_1'
          ? [{ author: '@claire_maman2', text: 'Ça marche vraiment pour un bébé allaité ?', tone: 'question' }, { author: '@juju.parent', text: 'Testé, 2 réveils au lieu de 5 🙏', tone: 'positive' }]
          : d === 8 && cid === 'crt_2' ? [{ author: '@nofilter_dad', text: 'Encore un guide à 2 balles…', tone: 'troll' }] : [],
      });
    }
  }
  return out;
}

const CUSTOMER_NAMES = ['Sophie L.', 'Karim B.', 'Julie M.', 'Thomas R.', 'Nadia P.', 'Camille D.'];

function buildInbox(): InboxMessage[] {
  const m = (id: number, day: number, channel: InboxMessage['channel'], subject: string, body: string, intent: InboxMessage['intent'], mood: number, status: InboxMessage['status'], reply?: [string, string]): InboxMessage => ({
    id: `msg_${id}`, day, customerId: `cus_${id + 2}`, channel, subject, body, intent, productId: 'prd_1', orderId: `ord_${id}`, mood, status, deadlineDay: day + 2,
    thread: [{ from: 'customer', text: body, day }, ...(reply ? [{ from: reply[0], text: reply[1], day }] : [])], resolution: status === 'resolved' ? 'Lien renvoyé, cliente satisfaite.' : null,
    customerName: CUSTOMER_NAMES[(id - 1) % CUSTOMER_NAMES.length], replyScore: reply ? 70 + ((id * 7) % 25) : null, repliedDay: reply ? day : null,
  });
  return [
    m(1, 7, 'email', 'Je n’ai pas reçu mon PDF', 'Bonjour, j’ai payé hier soir et je n’ai rien reçu dans ma boîte mail.', 'non_recu', -0.3, 'resolved', ['lucas', 'Bonjour Sophie, désolé pour l’attente ! Voici votre lien de téléchargement direct. Pensez à vérifier les spams.']),
    m(2, 8, 'email', 'Remboursement', 'Je n’ai pas le temps de lire 40 pages, remboursez-moi.', 'remboursement', -0.5, 'resolved', ['lucas', 'Bonjour, c’est noté, le remboursement est en cours. Le chapitre 2 se lit en 5 minutes si vous voulez retenter.']),
    m(3, 9, 'commentaire_tiktok', 'Question sur la pub', 'Ça marche aussi pour des jumeaux ?', 'question', 0.2, 'replied', ['lucas', 'Oui ! Le plan s’applique à chacun, on conseille de décaler les rituels de 10 minutes.']),
    m(4, 9, 'dm', 'Collaboration', 'Salut, je fais 80k sur TikTok, 150 € et je poste ton guide demain.', 'arnaque', 0, 'escalated'),
    m(5, 10, 'email', 'Paiement refusé', 'Ma carte a été débitée deux fois ??', 'bug_paiement', -0.7, 'open'),
    m(6, 10, 'avis', 'Merci !', 'Deux réveils au lieu de cinq dès la première semaine. Merci !!', 'compliment', 0.9, 'open'),
  ];
}

function buildCreators(): CreatorProfile[] {
  return [
    { id: 'cre_1', handle: '@maman.zen', nicheId: NICHE, followers: 18400, avgViews: 9200, engagement: 0.071, askUpfront: 0, askCommission: 0.3, redFlags: [] },
    { id: 'cre_2', handle: '@papa_en_galere', nicheId: NICHE, followers: 42100, avgViews: 15800, engagement: 0.054, askUpfront: 40, askCommission: 0.2, redFlags: [] },
    { id: 'cre_3', handle: '@bebe.tips.officiel', nicheId: NICHE, followers: 81000, avgViews: 900, engagement: 0.004, askUpfront: 150, askCommission: 0, redFlags: ['Vues très faibles pour 81k abonnés', 'Messages génériques copiés-collés'] },
  ];
}

function buildPartnerships(): Partnership[] {
  return [
    { id: 'par_1', creatorId: 'cre_1', productId: 'prd_1', day: 8, upfront: 0, commission: 0.3, status: 'accepted', sales: 2, revenue: 33 },
    { id: 'par_2', creatorId: 'cre_2', productId: 'prd_1', day: 10, upfront: 20, commission: 0.2, status: 'proposed', sales: 0, revenue: 0 },
  ];
}

function buildEvents(): WorldEvent[] {
  return [
    { id: 'evt_1', day: 7, kind: 'cpm_spike', title: 'Hausse du CPM', description: 'Le CPM TikTok grimpe de 30 % pendant deux jours (forte concurrence publicitaire).', severity: 'warn' },
    { id: 'evt_2', day: 8, kind: 'ad_rejected', title: 'Pub refusée', description: '« Il fait ses nuits en 3 jours, garanti » refusée : promesse de résultat garanti.', severity: 'danger', refs: { productId: 'prd_1' } },
    { id: 'evt_3', day: 9, kind: 'scam_attempt', title: 'Tentative d’arnaque', description: 'Un faux créateur demande 150 € d’avance pour un post (audience achetée).', severity: 'warn' },
    { id: 'evt_4', day: 10, kind: 'viral_organic', title: 'Post organique qui décolle', description: 'Le POV de Tom dépasse 38 000 vues.', severity: 'good', refs: { productId: 'prd_1' } },
  ];
}

function buildOrganic(): OrganicPost[] {
  return [
    { id: 'org_1', day: 7, productId: 'prd_1', hook: 'POV : tu connais le plafond de sa chambre par cœur', hookStyle: 'pov', format: 'text_slideshow', views: 3100, likes: 240, clicks: 22, sales: 1, viral: false },
    { id: 'org_2', day: 8, productId: 'prd_1', hook: '3 erreurs au coucher que j’ai faites pendant 6 mois', hookStyle: 'listicle', format: 'carousel', views: 1800, likes: 96, clicks: 9, sales: 0, viral: false },
    { id: 'org_3', day: 9, productId: 'prd_1', hook: 'Il se réveillait 5 fois par nuit. Voilà ce qui a changé.', hookStyle: 'story', format: 'faceless_voiceover', views: 6200, likes: 510, clicks: 41, sales: 2, viral: false },
    { id: 'org_4', day: 10, productId: 'prd_1', hook: 'POV : la première nuit complète depuis 8 mois', hookStyle: 'pov', format: 'ugc_avatar', views: 38400, likes: 4100, clicks: 260, sales: 1, viral: true },
  ];
}

// ───────────── tasks, missions, research, learning ─────────────

function buildTasks(): Task[] {
  const t = (id: number, kind: TaskKind, title: string, dept: DeptId, assignee: string, status: Task['status'], progress: number, reviewer: string | null = null, dayCreated = DAY): Task => ({
    id: `tsk_${id}`, kind, title, dept, assignee, createdBy: dept === 'direction' ? 'system' : 'camille', missionId: id < 210 ? 'mis_2' : 'mis_1', dependsOn: [], status,
    priority: (status === 'in_progress' ? 1 : 2) as 1 | 2, dayCreated, dayDone: status === 'done' ? DAY : null, progress, workLeft: Math.round((1 - progress) * 4), attempts: 1,
    reviewer, reviews: status === 'review' ? [] : [], input: { productId: 'prd_2', nicheId: NICHE }, output: null, deliverableIds: [], log: [`Assignée à ${assignee}`],
  });
  return [
    t(200, 'plan_day', 'Stand-up du jour 10 : priorités et enveloppe pub', 'direction', 'camille', 'done', 1),
    t(202, 'scan_trends', 'Scanner les tendances « sommeil » et « siestes »', 'recherche', 'nadia', 'in_progress', 0.6),
    t(203, 'mine_pains', 'Voix du client : siestes trop courtes (verbatims)', 'recherche', 'nadia', 'pending', 0.4),
    t(205, 'write_outline', 'Plan qui vend — « Siestes faciles »', 'studio', 'elise', 'review', 0.9, 'camille', 9),
    t(206, 'write_pdf', 'Rédiger les chapitres 1 à 3 de « Siestes faciles »', 'studio', 'elise', 'pending', 0.35),
    t(207, 'humanize_pdf', 'Humaniser le chapitre 4 de « Dodo serein » v2', 'studio', 'elise', 'in_progress', 0.7),
    t(208, 'fact_check', 'Fact-check des conseils médicaux (chapitre 5)', 'studio', 'nora', 'review', 0.8, 'elise'),
    t(209, 'design_cover', 'Couverture « Siestes faciles » — 3 pistes', 'creation', 'zoe', 'in_progress', 0.5),
    t(211, 'produce_ad', 'Storyboard du hook « POV première nuit complète »', 'growth', 'tom', 'pending', 0.1),
    t(213, 'optimize_ads', 'Couper les créas sous 1 % de CTR, monter le budget de crt_1', 'growth', 'adam', 'in_progress', 0.55),
    t(214, 'write_ad_hooks', '10 nouveaux hooks « question » pour la niche sommeil', 'growth', 'leo', 'in_progress', 0.3),
    t(217, 'set_price', 'Test de prix 19 € → 24 €', 'boutique', 'clara', 'awaiting_founder', 0.2, 'gabriel'),
    t(220, 'reply_inbox', 'Répondre aux 3 messages ouverts (dont double débit)', 'support', 'lucas', 'in_progress', 0.4),
    t(223, 'daily_report', 'Rapport du jour 9 : ROAS 4,6 après la hausse de prix', 'analyse', 'raphael', 'done', 1),
    t(229, 'red_team', 'Red Team : la promesse de « Siestes faciles » tient-elle ?', 'rh', 'nora', 'review', 0.85, 'camille'),
    t(230, 'negotiate_deal', 'Proposition à @papa_en_galere : 20 € + 20 %', 'recherche', 'nadia', 'pending', 0.5),
  ];
}

function buildMissions(): Mission[] {
  return [
    { id: 'mis_1', day: 6, from: 'camille', text: 'Rentabiliser « Dodo serein » : tester les hooks et monter le prix progressivement.', ownerId: 'leo', taskIds: ['tsk_213', 'tsk_214', 'tsk_217'], status: 'open' },
    { id: 'mis_2', day: 9, from: 'camille', text: 'Préparer le 2e PDF « Siestes faciles » pour l’upsell « La suite est ici ».', ownerId: 'elise', taskIds: ['tsk_205', 'tsk_206', 'tsk_209'], status: 'open' },
  ];
}

function buildResearch(): CompanySnapshot['company']['research'] {
  const voc = {
    nicheId: NICHE, depth: 'deep' as const,
    pains: ['Réveils toutes les deux heures', 'Endormissement uniquement au biberon', 'Parents qui se relaient toute la nuit'],
    phrases: ['il se réveille toutes les 2 h', 'je connais le plafond par cœur', 'on a tout essayé', 'il ne s’endort qu’au sein'],
    objections: ['Je ne veux pas le laisser pleurer', 'Chaque bébé est différent', 'J’ai déjà lu plein d’articles gratuits'],
    desiredOutcomes: ['Une nuit de 6 h d’affilée', 'Un coucher sans larmes', 'Retrouver de l’énergie la journée'],
    knowledge: {
      tips: ['Poser bébé éveillé mais somnolent', 'Toujours la même phrase de fin d’histoire'],
      steps: ['Journal de sommeil sur 3 nuits', 'Rituel fixe de 25 minutes', 'Réponse en 3 temps aux réveils'],
      mistakes: ['Changer de méthode chaque soir', 'Rallumer la lumière la nuit'],
      examples: ['Léon, 9 mois : de 3 réveils à 1 en 10 nuits'],
      facts: ['Entre 6 et 18 mois, un cycle de sommeil dure environ 50 à 60 minutes'],
    },
    priceAnchors: [12, 15, 19, 27],
    bannedClaims: ['garanti', 'en 3 jours', 'miracle'],
  };
  return {
    trends: [
      { nicheId: NICHE, name: 'Sommeil des bébés 6-18 mois', audience: 'Parents épuisés', category: 'parentalité', searchInterest: 82, tiktokBuzz: 76, competitionHint: 'moyenne', sampleTitles: ['Faire ses nuits en douceur', 'Le guide du sommeil de bébé'] },
      { nicheId: 'siestes-bebe', name: 'Siestes des tout-petits', audience: 'Parents de 6-18 mois', category: 'parentalité', searchInterest: 58, tiktokBuzz: 49, competitionHint: 'faible', sampleTitles: ['Des siestes enfin longues'] },
      { nicheId: 'batch-cooking-etudiant', name: 'Batch cooking étudiant à 20 €/semaine', audience: 'Étudiants en colocation', category: 'cuisine', searchInterest: 64, tiktokBuzz: 71, competitionHint: 'forte', sampleTitles: ['Manger sain pour 3 € par jour'] },
      { nicheId: 'reconversion-dev-35', name: 'Reconversion développeur après 35 ans', audience: 'Salariés en reconversion', category: 'carrière', searchInterest: 55, tiktokBuzz: 38, competitionHint: 'moyenne', sampleTitles: ['Devenir dev à 35 ans'] },
    ],
    voc: { [NICHE]: voc },
    competitors: {
      [NICHE]: [
        { id: 'cmp_a', nicheId: NICHE, title: 'Baby Sleep Made Simple', price: 27, reviews: 1240, rating: 4.4, ageDays: 620, platform: 'gumroad', weaknesses: ['Trop long (90 pages)', 'Pas de plan nuit par nuit'] },
        { id: 'cmp_b', nicheId: NICHE, title: 'Le sommeil de bébé en 7 jours', price: 15, reviews: 210, rating: 3.6, ageDays: 300, platform: 'etsy', weaknesses: ['Méthode des pleurs', 'Promesses irréalistes'] },
        { id: 'cmp_c', nicheId: NICHE, title: 'Nuits paisibles', price: 9.99, reviews: 88, rating: 4.1, ageDays: 140, platform: 'amazon_kdp', weaknesses: ['Aucun exemple concret'] },
      ],
    },
    shortlist: [NICHE, 'siestes-bebe', 'batch-cooking-etudiant'],
  };
}

function buildLessons(): Lesson[] {
  return [
    { id: 'les_1', day: 7, topic: 'ads', insight: 'Les hooks « question » font 2× plus de clics que les hooks « stat » sur la niche sommeil.', evidence: 'CTR 3,1 % contre 1,4 % sur 4 200 impressions.', confidence: 0.72, source: 'leo', appliesTo: ['adam', 'tom'], notePath: 'lecons/hooks-question-sommeil.md' },
    { id: 'les_2', day: 8, topic: 'support', insight: 'Renvoyer le lien de téléchargement avant de parler remboursement évite 1 remboursement sur 2.', evidence: '4 demandes « non reçu », 0 remboursement après renvoi du lien.', confidence: 0.6, source: 'lucas', appliesTo: ['lucas'], notePath: 'lecons/lien-avant-remboursement.md' },
    { id: 'les_3', day: 9, topic: 'pricing', insight: 'Passer de 14 € à 19 € n’a pas fait baisser la conversion : le profit par visiteur monte de 38 %.', evidence: 'CVR 3,3 % → 3,9 %, 1,02 € → 1,41 € par visiteur.', confidence: 0.55, source: 'raphael', appliesTo: ['clara'], notePath: 'lecons/prix-19-euros.md' },
    { id: 'les_4', day: 8, topic: 'ads', insight: 'Jamais de promesse chiffrée ou « garantie » : TikTok refuse et donne un avertissement.', evidence: 'crt_3 refusée, 1 avertissement sur le compte.', confidence: 0.95, source: 'nora', appliesTo: ['leo', 'clara', 'tom'], notePath: 'lecons/pas-de-promesse-garantie.md' },
  ];
}

function arm(key: string, alpha: number, beta: number): BanditArm {
  const pulls = Math.max(0, Math.round(alpha + beta - 2));
  return { key, alpha, beta, pulls, reward: r2(alpha - 1) };
}

function buildBandits(): Record<string, BanditArm[]> {
  return {
    [`hook_style:${NICHE}`]: [arm('question', 6.2, 2.1), arm('mistake', 3.4, 2.9), arm('pov', 2.8, 1.6), arm('stat', 1.6, 3.2), arm('story', 1.2, 1), arm('contrarian', 1, 1), arm('before_after', 1.1, 2.4), arm('listicle', 1.4, 1.3)],
    [`ad_format:${NICHE}`]: [arm('faceless_voiceover', 5.1, 2.4), arm('text_slideshow', 3.2, 3.1), arm('ugc_avatar', 1.2, 2), arm('carousel', 1.3, 1.2)],
    [`price:${NICHE}`]: [arm('9', 1, 1), arm('14', 3.1, 2.4), arm('19', 3.6, 1.5), arm('24', 1, 1), arm('29', 1, 1), arm('39', 1, 1), arm('49', 1, 1)],
    hype: [arm('0.2', 1.6, 1.4), arm('0.4', 3.2, 1.6), arm('0.6', 1.8, 2.2), arm('0.8', 1, 2.6)],
    support_tone: [arm('chaleureux', 6.4, 1.7), arm('concis', 3.1, 1.9), arm('formel', 1.4, 1.8)],
    niche: [arm(NICHE, 4.2, 1.6), arm('batch-cooking-etudiant', 1, 1), arm('reconversion-dev-35', 1, 1)],
  };
}

function buildExperiments(): Experiment[] {
  return [
    { id: 'exp_1', day: 9, owner: 'raphael', hypothesis: 'À 19 € le profit par visiteur est plus élevé qu’à 14 € sans hausse des remboursements.', dimension: 'price', variants: ['14', '19'], metric: 'roas', status: 'running', results: { '14': { n: 262, value: 1.02 }, '19': { n: 154, value: 1.41 } }, winner: null, endDay: null },
    { id: 'exp_2', day: 6, owner: 'leo', hypothesis: 'Les hooks « question » battent les hooks « mistake » sur le CTR.', dimension: 'hook_style', variants: ['question', 'mistake'], metric: 'ctr', status: 'concluded', results: { question: { n: 10900, value: 0.031 }, mistake: { n: 7300, value: 0.019 } }, winner: 'question', endDay: 9 },
  ];
}

function buildPlaybooks(): Record<string, string[]> {
  return {
    camille: ['Un seul nouveau produit à la fois tant que le premier n’est pas rentable.', 'Toujours lire le rapport de Raphaël avant le stand-up.'],
    nadia: ['Une niche étroite plutôt qu’une audience floue.'],
    elise: ['Ne jamais écrire « chaque bébé est différent »', 'Ne jamais écrire « soyez patient »'],
    zoe: ['Une couverture se lit en vignette ou pas du tout.'],
    leo: ['Privilégier le hook « question »', 'Ne jamais écrire « garanti »', 'Reprendre une phrase exacte des parents dans les 3 premières secondes.'],
    clara: ['Prix cible « 19 »', 'Tester une hausse de prix seulement après 20 ventes.', 'Niveau de promesse max « 0.4 »', 'Ne jamais écrire « miracle »'],
    gabriel: ['Pas de hausse d’enveloppe tant que le test de prix tourne.'],
    nora: ['Chaque erreur devient une règle de playbook chiffrée.'],
    adam: ['Privilégier le format « faceless_voiceover »', 'Couper une créa sous 1 % de CTR après 1 000 impressions.'],
    raphael: ['Comparer les créas à impressions égales.'],
    tom: ['Ne jamais écrire « en 3 jours »', 'Texte à l’écran lisible en 1 seconde.'],
    lucas: ['Ton support « chaleureux »', 'Toujours renvoyer le lien de téléchargement avant de proposer un remboursement.', 'Répondre en moins de 2 heures aux messages « non reçu ».'],
  };
}

function buildDeliverables(): Deliverable[] {
  return [
    { id: 'dlv_1', kind: 'pdf', title: 'Dodo serein v2 (PDF, 38 pages)', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/guide.pdf', createdBy: 'zoe', day: 9, quality: 84 },
    { id: 'dlv_2', kind: 'cover', title: 'Couverture Dodo serein', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/cover.svg', createdBy: 'zoe', day: 5, quality: 82 },
    { id: 'dlv_3', kind: 'sales_page', title: 'Page de vente Dodo serein', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/sales-page.html', createdBy: 'clara', day: 6, quality: 81 },
    { id: 'dlv_4', kind: 'ad_storyboard', title: 'Storyboard « 3 h du matin »', productId: 'prd_1', creativeId: 'crt_1', path: 'files/prd_1/ads/crt_1/frame-1.svg', createdBy: 'tom', day: 5, quality: 82 },
    { id: 'dlv_5', kind: 'ad_preview', title: 'Aperçu TikTok « 3 h du matin »', productId: 'prd_1', creativeId: 'crt_1', path: 'files/prd_1/ads/crt_1/preview.html', createdBy: 'tom', day: 5, quality: 82 },
    { id: 'dlv_6', kind: 'ad_preview', title: 'Aperçu TikTok « L’erreur n°1 »', productId: 'prd_1', creativeId: 'crt_2', path: 'files/prd_1/ads/crt_2/preview.html', createdBy: 'tom', day: 6, quality: 76 },
    { id: 'dlv_7', kind: 'report', title: 'Rapport du jour 9', productId: null, creativeId: null, path: 'brain/journal/jour-009.md', createdBy: 'raphael', day: 9, quality: null },
    { id: 'dlv_8', kind: 'research', title: 'Voix du client — sommeil bébé', productId: null, creativeId: null, path: 'brain/niches/sommeil-bebe-6-18-mois.md', createdBy: 'nadia', day: 2, quality: null },
  ];
}

// ───────────── activity ─────────────

function buildActivity(now: number): Activity[] {
  const rows: [number, string | null, ActivityKind, string, string?, Place?][] = [
    [-600, 'camille', 'thought', 'Stand-up : priorité à la rentabilité de « Dodo serein », 25 € de pub maximum aujourd’hui.'],
    [-560, 'camille', 'delegate', 'Léo, coupe les créas faibles et monte crt_1 de 20 %.', 'leo'],
    [-520, 'camille', 'delegate', 'Élise, le plan de « Siestes faciles » doit être prêt ce soir.', 'elise'],
    [-480, 'gabriel', 'finance', 'Enveloppe pub du jour : 25 €. Trésorerie : 663,50 €.'],
    [-420, 'nadia', 'brain_read', 'Lit « Règle du un » et la fiche niche sommeil bébé.'],
    [-380, 'nadia', 'brain_write', 'Note les phrases exactes des parents sur les siestes trop courtes.'],
    [-300, 'camille', 'review', 'Plan validé avec 2 corrections : chapitre bonus et exemple concret.', 'elise'],
    [-260, 'raphael', 'deliverable', 'Rapport du jour 9 publié : ROAS 4,6 après la hausse de prix.'],
    [-220, 'adam', 'ad', 'crt_1 : CTR 3,1 %, budget +20 %. crt_2 en observation.'],
    [-180, null, 'sale', 'Nouvelle vente « Dodo serein » à 19 € (TikTok Ads).'],
    [-170, null, 'event', 'Post organique qui décolle — Le POV de Tom dépasse 38 000 vues.'],
    [-150, 'lucas', 'message', 'Double débit signalé : vérification avec Gabriel avant de répondre.'],
    [-120, 'nora', 'coffee', 'Pause café avant la rétro du soir.', undefined, 'cafe'],
    [-95, 'nora', 'review', 'La promesse « siestes de 2 h » est trop forte : à reformuler.', 'elise'],
    [-60, 'zoe', 'brain_read', 'Relit « Couverture » avant de dessiner les 3 pistes.'],
    [-40, 'clara', 'walk', 'Je file au café, je reviens relire la garantie.', undefined, 'cafe'],
    [-12, 'camille', 'delegate', 'Raphaël, prépare l’analyse du test de prix pour demain matin.', 'raphael'],
    [-9, 'nadia', 'brain_read', 'Consulte « Voix du client » et les verbatims de la veille.'],
    [-7, 'elise', 'brain_read', 'Lit le plan validé de « Siestes faciles ».'],
    [-6, 'camille', 'delegate', 'Élise, le chapitre 4 passe à l’humanisation dès ce matin.', 'elise'],
    [-5, 'leo', 'delegate', 'Adam, coupe crt_2 s’il passe sous 1 % de CTR ce soir.', 'adam'],
    [-4, 'zoe', 'deliverable', 'Couverture « Siestes faciles » : 3 pistes prêtes pour validation.'],
    [-3, 'nora', 'review', 'Fact-check : le chapitre 5 renvoie bien vers le pédiatre.', 'elise'],
    [-2, 'clara', 'brain_write', 'Note ajoutée : « Les parents achètent surtout entre 21 h et 23 h ».'],
    [-1, 'tom', 'walk', 'Je passe chez Léo pour lui montrer le POV qui décolle.', undefined, 'growth'],
  ];
  return rows.map(([dt, agentId, kind, text, to, place], i) => {
    const a: Activity = { id: `act_${9000 + i}`, day: DAY, tick: TICK, at: now + dt * 1000, agentId, kind, text };
    if (to) a.toAgentId = to;
    if (place) a.place = place;
    if (kind === 'deliverable') a.refs = { productId: 'prd_2' };
    return a;
  });
}

// ───────────── scene ─────────────

const STAGES: { id: StageId; name: string }[] = [
  { id: 'survie', name: 'Survie' }, { id: 'adequation', name: 'Adéquation' }, { id: 'acceleration', name: 'Accélération' }, { id: 'portefeuille', name: 'Portefeuille' },
];
const stageView = (level: number, sinceDay: number, headcount: number): SceneView['stage'] => ({ level, total: 4, ...STAGES[level]!, sinceDay, headcount, gate: null });

function chip(id: ChannelChip['id'], state: ChannelChip['state'], share: number): ChannelChip {
  const c = CHANNELS[id];
  return { id, name: c.label, glyph: c.glyph, color: c.color, state, share };
}

function cardOf(a: AgentState): PersonCard {
  return { id: a.id, name: a.name, role: a.role, dept: a.dept, avatar: a.avatar };
}

function buildScene(agents: AgentState[]): SceneView {
  const by = (id: string) => agents.find((a) => a.id === id)!;
  const rated: [string, number, number][] = [['elise', 1584, 22], ['leo', 1561, -8], ['zoe', 1543, 15], ['nadia', 1528, 0], ['clara', 1502, -14]];
  return {
    people: {
      ...Object.fromEntries(rated.map(([id, rating, delta7d], i) => [id, { rating, rank: i + 1, of: rated.length, delta7d, contract: 'active' as const, badge: i === 0 ? 'champion' as const : i < 3 ? 'podium' as const : null }])),
      adam: { rating: 1471, rank: 2, of: 2, delta7d: -19, contract: 'probation', badge: 'probation' },
      tom: { rating: 1500, rank: 1, of: 1, delta7d: 0, contract: 'trial', badge: 'new' },
      lucas: { rating: 1500, rank: 1, of: 1, delta7d: 0, contract: 'trial', badge: 'new' },
    },
    board: rated.map(([id, rating, delta7d]) => ({ agentId: id, name: by(id).name, rating, delta7d })),
    podium: {
      season: 2,
      places: [
        { place: 1, person: cardOf(by('elise')), score: 84, gone: false },
        { place: 2, person: cardOf(by('leo')), score: 61, gone: false },
        { place: 3, person: cardOf(by('zoe')), score: 43, gone: false },
      ],
      cups: [{ season: 1, name: 'Zoé' }, { season: 2, name: 'Élise' }],
    },
    duels: [],
    recent: [
      { key: 'season:2', day: DAY - 1, kind: 'season_end', text: 'Fin de la saison 2 : Élise championne.', agentId: 'elise', numbers: { season: 2 } },
      { key: 'plan:adam', day: DAY, kind: 'probation', text: 'Adam passe en plan de progrès.', why: 'Note 1 471, en baisse de 19 points sur 7 jours.', agentId: 'adam' },
    ],
    channels: [chip('tiktok', 'open', 0.62), chip('meta', 'open', 0.38), chip('youtube', 'verifying', 0), chip('pinterest', 'banned', 0)],
    stage: stageView(1, 6, agents.length),
    team: { headcount: agents.length, payroll30d: 93.5, revenuePerHead30d: 27.5 },
    openSeats: { growth: 1, support: 1 },
    closedDepts: CLOSED_DEPTS.map((d) => ({ ...d, grid: { ...d.grid } })),
    names: { bastien: 'Bastien' },
  };
}

// ───────────── org ─────────────

const OFFICE_HOLDERS: OrgState['offices'] = {
  ceo: 'camille', chief_of_staff: 'camille', cfo: 'gabriel', accountant: 'gabriel', hr: 'nora', analyst: 'raphael', research: 'nadia', editor: 'elise',
  fact_checker: 'nora', art: 'zoe', growth: 'leo', shop: 'clara', pricing: 'clara', support: 'lucas', partners: 'nadia', red_team: 'nora',
};

/** What reconcileOrg and the hiring keep for this company. Apart from the snapshot, on purpose: `company.org` never reaches the stream (D34). */
export function mockOrgState(): OrgState {
  const rand = prng(20261031);
  const load = Array.from({ length: DAY }, (_, i) => {
    const day = i + 1;
    const here = ROWS.filter((r) => (r.hiredDay ?? 0) < day);
    return {
      day, wait: i < 5 ? {} : { reply_inbox: 2 + i, adapt_creative: 4 + i }, reviewWait: i < 5 ? {} : { write_outline: 1 }, work: { write_pdf: 3 + (i % 4), reply_inbox: i < 5 ? 0 : 3 },
      busy: Object.fromEntries(here.map((r) => [r.id, Math.floor(rand() * 10)])), headcount: here.length, payroll: r2(here.reduce((n, r) => n + MOCK_PAY[r.tier], 0)),
    };
  });
  const decision = (id: string, day: number, kind: OrgState['decisions'][number]['kind'], roleId: RoleId, agentId: string | null, text: string, numbers: Record<string, number>) => ({ id, day, kind, roleId, agentId, text, numbers });
  return {
    offices: { ...OFFICE_HOLDERS },
    deptHost: { partenariats: 'recherche', video: 'creation' },
    closedDepts: CLOSED_DEPTS.map((d) => ({ ...d, grid: { ...d.grid } })),
    load,
    pressure: [{ roleId: 'motion_designer', relief: 14.2, ownerUtil: 0.82, days: 3 }],
    positions: [
      { id: 'pos_1', roleId: 'support_agent', reason: 'bottleneck', detail: 'Réponses clients : 13 ticks d’attente par jour.', openedDay: 3, closedDay: 5, status: 'filled', candidates: [], hiredId: 'lucas', replaces: null, taskId: null },
      { id: 'pos_2', roleId: 'motion_designer', reason: 'bottleneck', detail: 'Adaptation de créa : 14 ticks d’attente par jour.', openedDay: 8, closedDay: null, status: 'open', candidates: [], hiredId: null, replaces: null, taskId: null },
    ],
    decisions: [
      decision('dec_1', 3, 'position', 'support_agent', null, 'Poste ouvert : Agent support.', { relief: 13, ownerUtil: 0.9 }),
      decision('dec_2', 5, 'hire', 'support_agent', 'lucas', 'Lucas rejoint le support.', { interview: 74, recruiting: 3.5 }),
      decision('dec_3', 7, 'refused', 'community_manager', null, 'Le CFO refuse un second poste de Community manager.', { cash: 412, margin: 18.4, payroll: 10.2 }),
    ],
    alumni: [{
      id: 'bastien', name: 'Bastien', gender: 'm', roleId: 'hook_writer', dept: 'growth', founder: false, hiredDay: 1, leftDay: 8, reason: 'Note sous la barre, plan de progrès non tenu.', level: 1, kind: 'fired', replacedBy: null,
      perf: { done: 7, approved: 4, rejected: 3, failed: 0, score: 58 }, avatar: { skin: SKIN[2], hair: HAIR[1], hairStyle: 0, accessory: 'none', shirt: '#fb7185', pants: PANTS_DEFAULT[0] },
    }],
    lastHireDay: 5, lastLayoffDay: 0, lossDays: 0,
    stats: { hires: 5, departures: 1, layoffs: 0, lastResortHats: 0, violations: 0 },
  };
}

/** What each button of the preview's « Scènes » panel does: one more line in `scene.recent`, as the server would send. */
export interface SceneAction { id: string; label: string; apply(s: CompanySnapshot): CompanySnapshot }

/** Keys stay unique past the 24 lines `recent` keeps: the drama plays a key once. */
let sceneSeq = 0;

function withScene(s: CompanySnapshot, patch: Partial<SceneView>, entry: Omit<ChronicleEntry, 'key' | 'day'> & { key: string }, company?: Partial<CompanySnapshot['company']>): CompanySnapshot {
  const scene = s.scene ?? buildScene(s.company.agents);
  return {
    ...s,
    company: { ...s.company, ...company },
    scene: { ...scene, ...patch, recent: [...(patch.recent ?? scene.recent), { ...entry, key: `${entry.key}:${++sceneSeq}`, day: s.day }].slice(-24) },
  };
}

const RECRUITS = [
  { name: 'Léa', role: 'Media buyer Facebook & Instagram', roleId: 'media_buyer_meta', kinds: ['launch_campaign', 'optimize_ads'], dept: 'growth', shirt: '#22d3ee', hair: 4, skin: 1 },
  { name: 'Yanis', role: 'Agent support', roleId: 'support_agent', kinds: ['reply_inbox', 'handle_refund'], dept: 'support', shirt: '#fdba74', hair: 1, skin: 3 },
  { name: 'Mina', role: 'Rédactrice de guides', roleId: 'ghostwriter', kinds: ['write_pdf', 'write_titles'], dept: 'studio', shirt: '#fbbf24', hair: 0, skin: 4 },
] as const;

function hire(s: CompanySnapshot): CompanySnapshot {
  const r = RECRUITS[s.company.agents.length % RECRUITS.length]!;
  const template = s.company.agents.find((a) => a.dept === r.dept) ?? s.company.agents[0]!;
  const id = `recrue-${++sceneSeq}`; // a headcount comes back after a firing, an id does not
  const agent: AgentState = {
    ...template, id, name: r.name, role: r.role, roleId: r.roleId, dept: r.dept, isChief: false, founder: false, taskKinds: [...r.kinds], hatKinds: [], hatDepts: [],
    hiredDay: s.day, rampUntilDay: s.day + RAMP_DAYS, status: 'working', place: r.dept, bubble: null, currentTaskId: null,
    avatar: { ...template.avatar, skin: SKIN[r.skin]!, hair: HAIR[r.hair]!, shirt: r.shirt },
  };
  const scene = s.scene ?? buildScene(s.company.agents);
  const openSeats = { ...scene.openSeats, [r.dept]: Math.max(0, (scene.openSeats[r.dept] ?? 1) - 1) };
  return withScene(s, { openSeats, people: { ...scene.people, [id]: { rating: 1500, rank: 1, of: 1, delta7d: 0, contract: 'trial', badge: 'new' } } },
    { key: `hire:${id}`, kind: 'hire', text: `${r.name} rejoint l’équipe.`, why: 'Poste ouvert par la charge du département.', agentId: id, person: cardOf(agent), dept: r.dept },
    { agents: [...s.company.agents, agent] });
}

function fire(s: CompanySnapshot): CompanySnapshot {
  const staff = [...s.company.agents].reverse().filter((a) => !a.isChief && !a.founder);
  const leaver = staff.find((a) => a.hiredDay < s.day) ?? staff[0]; // not the one who just walked in
  if (!leaver) return s;
  const scene = s.scene ?? buildScene(s.company.agents);
  const { [leaver.id]: _gone, ...people } = scene.people;
  return withScene(s, { people, names: { ...scene.names, [leaver.id]: leaver.name }, board: scene.board.filter((r) => r.agentId !== leaver.id) },
    { key: `fire:${leaver.id}`, kind: 'fire', text: `${leaver.name} quitte l’agence.`, why: 'Note sous la barre depuis 14 jours, plan de progrès non tenu.', agentId: leaver.id, person: cardOf(leaver), dept: leaver.dept },
    { agents: s.company.agents.filter((a) => a.id !== leaver.id) });
}

function duel(s: CompanySnapshot): CompanySnapshot {
  const scene = s.scene ?? buildScene(s.company.agents);
  const open = scene.duels[0];
  if (open) {
    return withScene(s, { duels: scene.duels.slice(1) },
      { key: `duel:${open.id}:end`, kind: 'duel_end', text: `Fin du duel : ${open.label}.`, agentId: open.a, otherId: open.b, numbers: { ratingDeltaA: 18, ratingDeltaB: -12 } });
  }
  const pair = s.company.agents.filter((a) => a.dept === 'growth').slice(0, 2);
  const [a, b] = [pair[0] ?? s.company.agents[0]!, pair[1] ?? s.company.agents[1]!];
  const id = `duel_${scene.recent.length}`;
  const label = `${a.name} contre ${b.name}`;
  return withScene(s, { duels: [{ id, a: a.id, b: b.id, label, endDay: s.day + 7 }] }, { key: `duel:${id}:open`, kind: 'duel_open', text: `Duel ouvert : ${label}.`, agentId: a.id, otherId: b.id });
}

function seasonEnd(s: CompanySnapshot): CompanySnapshot {
  const scene = s.scene ?? buildScene(s.company.agents);
  const board = scene.board.map((r, i) => ({ ...r, rating: r.rating + [6, -4, 12, 3, -9][i % 5]!, delta7d: [6, -4, 12, 3, -9][i % 5]! })).sort((x, y) => y.rating - x.rating);
  const season = (scene.podium?.season ?? 0) + 1;
  const ranked = board.slice(0, 3).flatMap((r) => {
    const a = s.company.agents.find((x) => x.id === r.agentId);
    return a ? [{ person: cardOf(a), score: r.rating - 1500 }] : [];
  });
  const places = ranked.map((r, i) => ({ place: (i + 1) as 1 | 2 | 3, ...r, gone: false }));
  const champion = places[0]?.person.name ?? '';
  return withScene(s, { board, podium: { season, places, cups: [...(scene.podium?.cups ?? []), { season, name: champion }].slice(-8) } },
    { key: `season:${season}`, kind: 'season_end', text: `Fin de la saison ${season} : ${champion} en tête.`, agentId: places[0]?.person.id ?? null, numbers: { season } });
}

function openChannel(s: CompanySnapshot): CompanySnapshot {
  const scene = s.scene ?? buildScene(s.company.agents);
  const missing = CHANNEL_IDS.find((id) => !scene.channels.some((c) => c.id === id));
  const verifying = scene.channels.find((c) => c.state === 'verifying');
  const id = missing ?? verifying?.id;
  if (!id) return s;
  const channels = missing ? [...scene.channels, chip(id, 'verifying', 0)] : scene.channels.map((c) => (c.id === id ? { ...c, state: 'open' as const, share: 0.1 } : c));
  return withScene(s, { channels }, { key: `channel:${id}`, kind: 'channel_open', text: `Canal ${CHANNELS[id].label} : ${missing ? 'compte en vérification' : 'ouvert'}.`, channel: id });
}

function growIsland(s: CompanySnapshot): CompanySnapshot {
  const biggest = [...s.company.departments].filter((d) => d.id !== 'direction').sort((a, b) => (a.deskHigh ?? 0) - (b.deskHigh ?? 0))[0];
  if (!biggest) return s;
  const team = s.company.agents.filter((a) => a.dept === biggest.id).length;
  const deskHigh = Math.max(biggest.deskHigh ?? 0, team) + 7;
  return withScene(s, {}, { key: `dept:${biggest.id}:${deskHigh}`, kind: 'dept_open', text: `${biggest.name} s’agrandit.`, dept: biggest.id },
    { departments: s.company.departments.map((d) => (d.id === biggest.id ? { ...d, deskHigh } : d)) });
}

function stageUp(s: CompanySnapshot): CompanySnapshot {
  const scene = s.scene ?? buildScene(s.company.agents);
  const level = Math.min(STAGES.length - 1, scene.stage.level + 1);
  if (level === scene.stage.level) return s;
  return withScene(s, { stage: stageView(level, s.day, s.company.agents.length) }, { key: `stage:${s.day}:${level}`, kind: 'stage_up', text: `Palier suivant : ${STAGES[level]!.name}.` });
}

export const SCENE_ACTIONS: SceneAction[] = [
  { id: 'hire', label: 'Embaucher', apply: hire },
  { id: 'fire', label: 'Renvoyer', apply: fire },
  { id: 'duel', label: 'Duel', apply: duel },
  { id: 'season', label: 'Fin de saison', apply: seasonEnd },
  { id: 'channel', label: 'Ouvrir un canal', apply: openChannel },
  { id: 'island', label: 'Agrandir l’île', apply: growIsland },
  { id: 'stage', label: 'Palier suivant', apply: stageUp },
];

// ───────────── snapshot ─────────────

export function mockSnapshot(): CompanySnapshot {
  const rand = prng(20261030);
  const now = Date.now();
  const kpis = buildKpis();
  const finance = buildFinance(kpis);
  const agents = buildAgents(rand);
  const orders = buildOrders();
  const inbox = buildInbox();
  return {
    runId: 'demo-pixel-agency',
    scenario: {
      name: 'Démo — sommeil des bébés', companyName: 'Pixel Agency', seed: 42, startingCash: 500, horizonDays: 60, difficulty: 'normal',
      mindMode: 'auto', founderApproval: false, chargeCompute: false, maxComputeEur: 5, goal: { targetProfit: 1000, byDay: 60 },
    },
    day: DAY, tick: TICK, phase: 'work', status: 'running',
    mind: { mode: 'heuristic', calls: 412, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 },
    company: {
      name: 'Pixel Agency',
      agents,
      departments: DEPTS.map((d) => ({ ...d, grid: { ...d.grid } })),
      tasks: buildTasks(),
      missions: buildMissions(),
      products: buildProducts(),
      creatives: buildCreatives(),
      campaigns: [
        { id: 'cmp_1', productId: 'prd_1', name: 'Dodo serein — test hooks', creativeIds: ['crt_1', 'crt_2'], dailyBudget: 25, status: 'active', targeting: { interests: ['parentalité', 'sommeil bébé', 'maternité'], ageMin: 24, ageMax: 40 }, startDay: 6, createdBy: 'adam' } satisfies Campaign,
      ],
      deliverables: buildDeliverables(),
      research: buildResearch(),
      lessons: buildLessons(),
      experiments: buildExperiments(),
      bandits: buildBandits(),
      playbooks: buildPlaybooks(),
      kpis,
      chats: {
        camille: [
          { id: 'chat_1', day: 9, from: 'founder', text: 'Où en est-on du premier produit ?', at: now - 3_600_000 },
          { id: 'chat_2', day: 9, from: 'camille', text: 'Rentable depuis le jour 7 : 163 € de profit cumulé, ROAS 4,2 hier. On prépare l’upsell « Siestes faciles ».', at: now - 3_590_000 },
        ],
      },
      pendingApprovals: [],
      budget: { day: DAY, adCap: 25, survival: false, note: 'Produit rentable (ROAS 4,2) : on garde 25 € de pub, pas plus tant que le test de prix tourne.' },
    },
    market: {
      inbox,
      adStats: buildAdStats(),
      organicPosts: buildOrganic(),
      creators: buildCreators(),
      partnerships: buildPartnerships(),
      events: buildEvents(),
      orders,
      adAccount: { strikes: 1, banned: false, bannedUntilDay: 0 },
      customersCount: orders.length + 1,
    },
    finance,
    ledger: buildLedger(),
    activity: buildActivity(now),
    session: { runId: 'demo-pixel-agency', playing: true, speed: 1, intervalMs: 2000, busy: false, mindMode: 'heuristic', status: 'running', day: DAY, tick: TICK, lastError: null },
    godMode: { niches: [], intents: Object.fromEntries(inbox.map((m) => [m.id, m.intent])) },
    scene: buildScene(agents),
  };
}
