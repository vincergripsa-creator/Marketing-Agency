// Realistic, fully typed fake snapshot (31 agents, 11 departments, a live product, 10 days of KPIs)
// for offline previews and the shell's demo mode. Deterministic content; `at` timestamps are
// relative to now so the speech bubbles show up.
import type {
  Activity, ActivityKind, AdCreative, AgentState, AvatarSpec, BanditArm, Campaign, CompanySnapshot, CreatorProfile, DailyAdStats,
  DailyKpi, DeptDef, DeptId, Deliverable, Experiment, FinanceSnapshot, InboxMessage, LedgerEntry, Lesson, Mission, ModelTier,
  Order, OrganicPost, Partnership, PdfContent, Place, Product, RoleId, Task, TaskKind, ToolName, WorldEvent, AgentStatus,
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
  { id: 'recherche', name: 'Recherche', color: '#3b82f6', icon: 'RECHERCHE', description: 'Trouve les niches rentables : tendances, douleurs des clients, concurrents.', chiefId: 'nadia', grid: { col: 0, row: -1 } },
  { id: 'studio', name: 'Studio PDF', color: '#f59e0b', icon: 'STUDIO PDF', description: 'Écrit les guides : 10 titres, plan qui vend, rédaction, humanisation, fact-check.', chiefId: 'elise', grid: { col: -1, row: 0 } },
  { id: 'creation', name: 'Création', color: '#8b5cf6', icon: 'CRÉATION', description: 'Couvertures, mise en page du PDF, visuels et storyboards TikTok.', chiefId: 'zoe', grid: { col: 1, row: 0 } },
  { id: 'growth', name: 'Growth', color: '#ec4899', icon: 'GROWTH', description: 'Pubs TikTok, contenu organique, tests de hooks et pilotage des budgets.', chiefId: 'leo', grid: { col: -1, row: -1 } },
  { id: 'boutique', name: 'Boutique', color: '#ef4444', icon: 'BOUTIQUE', description: 'Pages de vente, prix, mise en ligne et upsell « La suite est ici ».', chiefId: 'clara', grid: { col: 1, row: -1 } },
  { id: 'support', name: 'Support', color: '#f97316', icon: 'SUPPORT', description: 'Répond aux clients, gère remboursements, arnaques et clients difficiles.', chiefId: 'ines', grid: { col: 1, row: 1 } },
  { id: 'analyse', name: 'Analyse', color: '#14b8a6', icon: 'ANALYSE', description: 'Rapports quotidiens, expériences A/B et lecture honnête des chiffres.', chiefId: 'raphael', grid: { col: 0, row: 1 } },
  { id: 'finance', name: 'Finance', color: '#65a30d', icon: 'FINANCE', description: 'Trésorerie, enveloppes de dépense, rentabilité et garde-fous budgétaires.', chiefId: 'gabriel', grid: { col: 2, row: -1 } },
  { id: 'rh', name: 'RH', color: '#f472b6', icon: 'RH', description: 'Rétro du soir, leçons, playbooks et revues de performance des agents.', chiefId: 'nora', grid: { col: -1, row: 1 } },
  { id: 'partenariats', name: 'Partenariats', color: '#06b6d4', icon: 'PARTENARIATS', description: 'Petits créateurs à la commission, négociation et détection des arnaques.', chiefId: 'rayan', grid: { col: -1, row: 2 } },
];

// ───────────── agents ─────────────

interface AgentRow {
  id: string; name: string; role: string; dept: DeptId; chief?: boolean; tier: ModelTier;
  persona: string; skills: string[]; tools: ToolName[]; kinds: TaskKind[];
  look: [skin: number, hair: number, style: AvatarSpec['hairStyle'], acc: AvatarSpec['accessory'], shirt: string, pants?: string];
  status: AgentStatus; place?: Place; bubble?: string;
}

const SKIN = ['#f8d9bd', '#f1c7a5', '#e2a97f', '#c98a5e', '#9c6440', '#6e4229'];
const HAIR = ['#2b1d16', '#4a2f22', '#7a4a2b', '#b5651d', '#e0b057', '#1b1b22', '#c9c2b8', '#a8322a'];

const ROWS: AgentRow[] = [
  { id: 'camille', name: 'Camille', role: 'CEO & orchestratrice', dept: 'direction', chief: true, tier: 'opus', persona: 'Calme et exigeante, elle lit le cerveau chaque matin et ne lance qu’un pari à la fois.', skills: ['Stratégie', 'Arbitrage budgétaire', 'Délégation'], tools: ['brain.read', 'brain.write', 'team.delegate', 'team.review', 'finance.ledger'], kinds: ['plan_day', 'pick_opportunity', 'red_team'], look: [1, 0, 1, 'none', '#7c6cf0', '#2f2a4a'], status: 'working', bubble: 'On garde un seul produit tant qu’il n’est pas rentable.' },
  { id: 'hugo', name: 'Hugo', role: 'Directeur des opérations', dept: 'direction', tier: 'sonnet', persona: 'Organisé, il découpe les missions en tâches et relance les retards.', skills: ['Planification', 'Suivi des délais'], tools: ['brain.read', 'team.delegate', 'team.review'], kinds: ['plan_day', 'pick_opportunity'], look: [3, 1, 0, 'beard', '#4b5563', '#1f2937'], status: 'meeting', place: 'direction' },
  { id: 'nadia', name: 'Nadia', role: 'Cheffe Recherche', dept: 'recherche', chief: true, tier: 'sonnet', persona: 'Curieuse et rigoureuse, elle préfère une niche étroite à une audience floue.', skills: ['Tendances TikTok', 'Règle du un', 'Synthèse'], tools: ['market.trends', 'market.pains', 'market.competitors', 'brain.read', 'brain.write', 'team.delegate'], kinds: ['scan_trends', 'pick_opportunity', 'mine_pains'], look: [4, 5, 5, 'glasses', '#3b82f6', '#1e3a5f'], status: 'working' },
  { id: 'malo', name: 'Malo', role: 'Analyste voix du client', dept: 'recherche', tier: 'haiku', persona: 'Il collectionne les phrases exactes des clients comme d’autres collectionnent les timbres.', skills: ['Verbatims', 'Objections', 'Avis Amazon'], tools: ['market.pains', 'brain.read', 'brain.write'], kinds: ['mine_pains'], look: [0, 3, 0, 'headphones', '#60a5fa'], status: 'working', place: 'cerveau' },
  { id: 'yasmine', name: 'Yasmine', role: 'Veille concurrence', dept: 'recherche', tier: 'haiku', persona: 'Elle dissèque les best-sellers Gumroad et note ce que les acheteurs reprochent.', skills: ['Gumroad', 'Etsy', 'Analyse des avis'], tools: ['market.competitors', 'brain.write'], kinds: ['scan_competitors'], look: [3, 0, 1, 'none', '#93c5fd', '#334155'], status: 'working' },
  { id: 'elise', name: 'Élise', role: 'Rédactrice en chef', dept: 'studio', chief: true, tier: 'sonnet', persona: 'Plume précise, elle traque le flou et exige des étapes numérotées.', skills: ['Plan qui vend', 'Édition', 'Ton de marque'], tools: ['brain.read', 'brain.write', 'team.delegate', 'team.review'], kinds: ['write_titles', 'write_outline', 'write_pdf'], look: [0, 4, 2, 'glasses', '#f59e0b', '#3f3a4f'], status: 'reviewing', bubble: 'Chapitre 3 : il manque un exemple concret.' },
  { id: 'theo', name: 'Théo', role: 'Rédacteur de guides', dept: 'studio', tier: 'sonnet', persona: 'Rapide et méthodique, il transforme une recherche en chapitres actionnables.', skills: ['Rédaction', 'Étapes actionnables'], tools: ['brain.read', 'brain.write', 'pdf.render'], kinds: ['write_pdf', 'write_outline'], look: [2, 2, 0, 'glasses', '#fbbf24', '#374151'], status: 'working' },
  { id: 'lina', name: 'Lina', role: 'Humanisatrice de textes', dept: 'studio', tier: 'sonnet', persona: 'Elle coupe chaque phrase générique et la remplace par un détail vrai.', skills: ['Humanisation', 'Exemples clients'], tools: ['brain.read', 'brain.write'], kinds: ['humanize_pdf'], look: [5, 0, 3, 'none', '#fde68a', '#44403c'], status: 'working' },
  { id: 'samuel', name: 'Samuel', role: 'Fact-checker', dept: 'studio', tier: 'sonnet', persona: 'Il relit page par page et refuse toute affirmation sans source.', skills: ['Vérification', 'Conformité'], tools: ['brain.read', 'team.review'], kinds: ['fact_check'], look: [1, 6, 4, 'glasses', '#d97706', '#292524'], status: 'reviewing' },
  { id: 'zoe', name: 'Zoé', role: 'Directrice artistique', dept: 'creation', chief: true, tier: 'sonnet', persona: 'Elle veut des couvertures lisibles en vignette et jamais surchargées.', skills: ['Couverture', 'Palette', 'Mise en page'], tools: ['design.cover', 'pdf.render', 'team.delegate', 'team.review'], kinds: ['design_cover', 'render_pdf'], look: [2, 7, 5, 'none', '#8b5cf6', '#312e81'], status: 'working' },
  { id: 'kenji', name: 'Kenji', role: 'Illustrateur & mise en page', dept: 'creation', tier: 'haiku', persona: 'Il dessine des infographies simples qui expliquent en un coup d’œil.', skills: ['Infographies', 'Mise en page PDF'], tools: ['pdf.render', 'design.cover'], kinds: ['render_pdf'], look: [1, 5, 0, 'headphones', '#a78bfa'], status: 'working' },
  { id: 'maelle', name: 'Maëlle', role: 'Monteuse storyboards TikTok', dept: 'creation', tier: 'haiku', persona: 'Elle pense en plans de deux secondes et en textes à l’écran.', skills: ['Storyboard 9:16', 'Rythme'], tools: ['design.storyboard', 'brain.read'], kinds: ['produce_ad'], look: [0, 3, 1, 'none', '#c4b5fd', '#4c1d95'], status: 'coffee', place: 'cafe', bubble: 'Petite pause, je reviens sur le storyboard.' },
  { id: 'leo', name: 'Léo', role: 'Head of Growth', dept: 'growth', chief: true, tier: 'sonnet', persona: 'Obsédé par le CTR, il coupe vite ce qui ne marche pas et double ce qui marche.', skills: ['Pubs TikTok', 'Budgets', 'Tests'], tools: ['ads.campaign', 'ads.stats', 'team.delegate', 'brain.read'], kinds: ['launch_campaign', 'optimize_ads'], look: [2, 1, 0, 'cap', '#ec4899', '#1f2937'], status: 'meeting', place: 'direction' },
  { id: 'sarah', name: 'Sarah', role: 'Media buyer TikTok', dept: 'growth', tier: 'sonnet', persona: 'Elle surveille la fréquence et le CPM comme le lait sur le feu.', skills: ['Ciblage', 'Enchères', 'Fatigue créa'], tools: ['ads.campaign', 'ads.stats', 'ads.review'], kinds: ['launch_campaign', 'optimize_ads'], look: [4, 0, 1, 'headphones', '#f472b6', '#3b0764'], status: 'working' },
  { id: 'adam', name: 'Adam', role: 'Copywriter hooks', dept: 'growth', tier: 'haiku', persona: 'Il écrit vingt accroches pour en garder deux.', skills: ['Hooks', 'Scripts courts'], tools: ['brain.read', 'brain.write'], kinds: ['write_ad_hooks', 'produce_ad'], look: [5, 0, 3, 'none', '#fb7185', '#111827'], status: 'thinking' },
  { id: 'chloe', name: 'Chloé', role: 'Créatrice de contenu organique', dept: 'growth', tier: 'haiku', persona: 'Elle teste des formats TikTok gratuits sur la douleur exacte des parents.', skills: ['TikTok organique', 'Tendances sonores'], tools: ['organic.post', 'brain.read'], kinds: ['post_organic'], look: [0, 4, 5, 'none', '#f9a8d4', '#831843'], status: 'walking', place: 'growth' },
  { id: 'tom', name: 'Tom', role: 'Analyste créas & budgets', dept: 'growth', tier: 'haiku', persona: 'Il compare les créas à impressions égales, jamais au feeling.', skills: ['CTR', 'ROAS', 'Fatigue'], tools: ['ads.stats', 'brain.write'], kinds: ['optimize_ads'], look: [1, 2, 0, 'none', '#be185d', '#374151'], status: 'idle' },
  { id: 'clara', name: 'Clara', role: 'Responsable boutique', dept: 'boutique', chief: true, tier: 'sonnet', persona: 'Elle écrit avec les mots des clients et traite les objections avant qu’elles arrivent.', skills: ['Page de vente', 'Objections', 'Mise en ligne'], tools: ['store.publish', 'store.price', 'store.stats', 'web.page', 'team.delegate'], kinds: ['write_sales_page', 'publish_product', 'set_price'], look: [2, 7, 1, 'none', '#ef4444', '#3f3f46'], status: 'working' },
  { id: 'mehdi', name: 'Mehdi', role: 'Copywriter page de vente', dept: 'boutique', tier: 'sonnet', persona: 'Il refuse les promesses miracles : la vente doit tenir après l’achat.', skills: ['Copywriting', 'Garantie'], tools: ['web.page', 'brain.read'], kinds: ['write_sales_page'], look: [3, 0, 0, 'beard', '#f87171', '#1f2937'], status: 'coffee', place: 'cafe' },
  { id: 'paul', name: 'Paul', role: 'Pricing & upsell', dept: 'boutique', tier: 'haiku', persona: 'Il raisonne en profit par visiteur, pas en taux de conversion.', skills: ['Prix', 'Upsell', 'Tests de prix'], tools: ['store.price', 'store.stats'], kinds: ['set_price', 'design_upsell'], look: [0, 1, 0, 'tie', '#fca5a5', '#1e293b'], status: 'blocked', bubble: 'J’attends la validation de Gabriel pour passer à 24 €.' },
  { id: 'ines', name: 'Inès', role: 'Cheffe Support client', dept: 'support', chief: true, tier: 'sonnet', persona: 'Chaleureuse mais ferme, elle repère vite les demandes de remboursement abusives.', skills: ['Relation client', 'Désescalade'], tools: ['inbox.read', 'inbox.reply', 'inbox.refund', 'team.delegate'], kinds: ['reply_inbox', 'handle_refund'], look: [4, 0, 2, 'headphones', '#f97316', '#3f3f46'], status: 'working' },
  { id: 'lucas', name: 'Lucas', role: 'Agent support', dept: 'support', tier: 'haiku', persona: 'Il répond vite, renvoie le bon lien et garde le sourire avec les clients pressés.', skills: ['Réponses rapides', 'Liens de téléchargement'], tools: ['inbox.read', 'inbox.reply'], kinds: ['reply_inbox'], look: [1, 4, 0, 'headphones', '#fdba74', '#1f2937'], status: 'working' },
  { id: 'fatou', name: 'Fatou', role: 'Détection fraude & litiges', dept: 'support', tier: 'haiku', persona: 'Elle flaire les arnaques au chargeback et les faux créateurs.', skills: ['Fraude', 'Chargebacks'], tools: ['inbox.read', 'inbox.refund'], kinds: ['handle_refund'], look: [5, 0, 3, 'glasses', '#ea580c', '#292524'], status: 'thinking' },
  { id: 'raphael', name: 'Raphaël', role: 'Chef Analyse & data', dept: 'analyse', chief: true, tier: 'sonnet', persona: 'Il dit les mauvaises nouvelles en premier et chiffre tout.', skills: ['Rapports', 'Cohortes', 'Attribution'], tools: ['ads.stats', 'store.stats', 'finance.ledger', 'brain.write', 'team.delegate'], kinds: ['daily_report', 'run_experiment'], look: [2, 0, 0, 'glasses', '#14b8a6', '#134e4a'], status: 'working' },
  { id: 'emma', name: 'Emma', role: 'Expérimentations A/B', dept: 'analyse', tier: 'haiku', persona: 'Une hypothèse, une variable, un gagnant : elle ne déroge jamais.', skills: ['A/B tests', 'Bandits'], tools: ['store.stats', 'ads.stats', 'brain.write'], kinds: ['run_experiment'], look: [0, 3, 5, 'none', '#5eead4', '#115e59'], status: 'idle' },
  { id: 'gabriel', name: 'Gabriel', role: 'Directeur financier', dept: 'finance', chief: true, tier: 'sonnet', persona: 'Prudent, il protège la trésorerie et fixe l’enveloppe pub du jour.', skills: ['Trésorerie', 'Rentabilité', 'Garde-fous'], tools: ['finance.ledger', 'brain.read', 'team.review'], kinds: ['budget_review'], look: [1, 6, 0, 'tie', '#65a30d', '#1f2937'], status: 'meeting', place: 'direction' },
  { id: 'alice', name: 'Alice', role: 'Contrôleuse de gestion', dept: 'finance', tier: 'haiku', persona: 'Elle rapproche chaque vente, frais et remboursement du grand livre.', skills: ['Grand livre', 'Frais de paiement'], tools: ['finance.ledger'], kinds: ['budget_review'], look: [3, 4, 2, 'glasses', '#a3e635', '#365314'], status: 'working' },
  { id: 'nora', name: 'Nora', role: 'DRH & rétrospectives', dept: 'rh', chief: true, tier: 'sonnet', persona: 'Bienveillante, elle transforme chaque erreur en règle de playbook.', skills: ['Rétro', 'Coaching', 'Playbooks'], tools: ['brain.read', 'brain.write', 'team.review'], kinds: ['retro', 'performance_review'], look: [2, 1, 1, 'none', '#f472b6', '#4a044e'], status: 'coffee', place: 'cafe' },
  { id: 'axel', name: 'Axel', role: 'Red Team', dept: 'rh', tier: 'sonnet', persona: 'Son travail : essayer de tuer chaque idée avant qu’elle ne coûte de l’argent.', skills: ['Critique', 'Risques', 'Conformité'], tools: ['brain.read', 'team.review'], kinds: ['red_team'], look: [4, 5, 4, 'beard', '#db2777', '#18181b'], status: 'reviewing' },
  { id: 'rayan', name: 'Rayan', role: 'Chef Partenariats créateurs', dept: 'partenariats', chief: true, tier: 'sonnet', persona: 'Il préfère dix petits créateurs à la commission qu’une star payée d’avance.', skills: ['Prospection', 'Négociation'], tools: ['creators.search', 'creators.deal', 'team.delegate'], kinds: ['find_creators', 'negotiate_deal'], look: [3, 0, 0, 'cap', '#06b6d4', '#164e63'], status: 'working' },
  { id: 'louise', name: 'Louise', role: 'Négociatrice & vérification', dept: 'partenariats', tier: 'haiku', persona: 'Elle vérifie l’engagement réel avant toute proposition.', skills: ['Vérification d’audience', 'Contrats'], tools: ['creators.search', 'creators.deal'], kinds: ['negotiate_deal'], look: [0, 7, 1, 'none', '#67e8f9', '#0e7490'], status: 'blocked', bubble: '@maman.zen ne répond plus depuis 2 jours…' },
];

const PANTS_DEFAULT = ['#2f3a56', '#3a3f5c', '#43405a', '#2b3445'];

/** Role and gender of each row, then the eight founders. */
const PEOPLE: Record<string, [RoleId, 'f' | 'm']> = {
  camille: ['ceo', 'f'], hugo: ['chief_of_staff', 'm'],
  nadia: ['research_lead', 'f'], malo: ['competitor_analyst', 'm'], yasmine: ['voc_analyst', 'f'],
  elise: ['editor_in_chief', 'f'], theo: ['ghostwriter', 'm'], lina: ['humanizer', 'f'], samuel: ['fact_checker', 'm'],
  zoe: ['art_director', 'f'], kenji: ['cover_designer', 'm'], maelle: ['layout_designer', 'f'],
  leo: ['growth_lead', 'm'], sarah: ['hook_writer', 'f'], adam: ['media_buyer_tiktok', 'm'], chloe: ['video_editor', 'f'], tom: ['community_manager', 'm'],
  clara: ['shop_lead', 'f'], mehdi: ['sales_copywriter', 'm'], paul: ['pricing_manager', 'm'],
  ines: ['support_lead', 'f'], lucas: ['support_agent', 'm'], fatou: ['support_agent', 'f'],
  raphael: ['data_analyst', 'm'], emma: ['experiment_analyst', 'f'],
  gabriel: ['cfo', 'm'], alice: ['accountant', 'f'],
  nora: ['hr_lead', 'f'], axel: ['red_teamer', 'm'],
  rayan: ['partnerships_lead', 'm'], louise: ['partner_manager', 'f'],
};
const FOUNDERS = new Set(['camille', 'nadia', 'elise', 'zoe', 'leo', 'clara', 'gabriel', 'nora']);

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
      taskKinds: r.kinds,
      avatar: { skin: SKIN[skin], hair: HAIR[hair], hairStyle: style, accessory: acc, shirt, pants: pants ?? PANTS_DEFAULT[i % PANTS_DEFAULT.length] },
      status: r.status,
      place,
      currentTaskId: ['working', 'reviewing', 'thinking', 'blocked'].includes(r.status) ? `tsk_${200 + i}` : null,
      energy: r.status === 'coffee' ? 38 + Math.floor(rand() * 15) : 55 + Math.floor(rand() * 40),
      level,
      xp: done * 35 + Math.floor(rand() * 30),
      perf: { done, approved: done - rejected, rejected, failed, score: Math.round(62 + rand() * 33) },
      bubble: r.bubble ?? null,
      roleId: PEOPLE[r.id]![0],
      gender: PEOPLE[r.id]![1],
      founder: FOUNDERS.has(r.id),
      hatKinds: [],
      hatDepts: [],
      hiredDay: 0,
      rampUntilDay: 0,
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
  const base = { productId: 'prd_1', caption: 'Le plan doux pour des nuits complètes 🌙', hashtags: ['#sommeilbebe', '#parents', '#maman', '#bebe'], cta: 'Lien dans la bio', createdBy: 'adam' };
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
    m(2, 8, 'email', 'Remboursement', 'Je n’ai pas le temps de lire 40 pages, remboursez-moi.', 'remboursement', -0.5, 'resolved', ['ines', 'Bonjour, c’est noté, le remboursement est en cours. Le chapitre 2 se lit en 5 minutes si vous voulez retenter.']),
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
    { id: 'evt_4', day: 10, kind: 'viral_organic', title: 'Post organique qui décolle', description: 'Le POV de Chloé dépasse 38 000 vues.', severity: 'good', refs: { productId: 'prd_1' } },
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
    t(203, 'mine_pains', 'Voix du client : siestes trop courtes (verbatims)', 'recherche', 'malo', 'in_progress', 0.4),
    t(205, 'write_outline', 'Plan qui vend — « Siestes faciles »', 'studio', 'elise', 'review', 0.9, 'camille', 9),
    t(206, 'write_pdf', 'Rédiger les chapitres 1 à 3 de « Siestes faciles »', 'studio', 'theo', 'in_progress', 0.35),
    t(207, 'humanize_pdf', 'Humaniser le chapitre 4 de « Dodo serein » v2', 'studio', 'lina', 'in_progress', 0.7),
    t(208, 'fact_check', 'Fact-check des conseils médicaux (chapitre 5)', 'studio', 'samuel', 'review', 0.8, 'elise'),
    t(209, 'design_cover', 'Couverture « Siestes faciles » — 3 pistes', 'creation', 'zoe', 'in_progress', 0.5),
    t(211, 'produce_ad', 'Storyboard du hook « POV première nuit complète »', 'creation', 'maelle', 'pending', 0.1),
    t(213, 'optimize_ads', 'Couper les créas sous 1 % de CTR, monter le budget de crt_1', 'growth', 'sarah', 'in_progress', 0.55),
    t(214, 'write_ad_hooks', '10 nouveaux hooks « question » pour la niche sommeil', 'growth', 'adam', 'in_progress', 0.3),
    t(217, 'set_price', 'Test de prix 19 € → 24 €', 'boutique', 'paul', 'awaiting_founder', 0.2, 'gabriel'),
    t(220, 'reply_inbox', 'Répondre aux 3 messages ouverts (dont double débit)', 'support', 'ines', 'in_progress', 0.4),
    t(223, 'daily_report', 'Rapport du jour 9 : ROAS 4,6 après la hausse de prix', 'analyse', 'raphael', 'done', 1),
    t(229, 'red_team', 'Red Team : la promesse de « Siestes faciles » tient-elle ?', 'rh', 'axel', 'review', 0.85, 'camille'),
    t(230, 'negotiate_deal', 'Proposition à @papa_en_galere : 20 € + 20 %', 'partenariats', 'rayan', 'in_progress', 0.5),
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
    { id: 'les_1', day: 7, topic: 'ads', insight: 'Les hooks « question » font 2× plus de clics que les hooks « stat » sur la niche sommeil.', evidence: 'CTR 3,1 % contre 1,4 % sur 4 200 impressions.', confidence: 0.72, source: 'tom', appliesTo: ['adam', 'sarah'], notePath: 'lecons/hooks-question-sommeil.md' },
    { id: 'les_2', day: 8, topic: 'support', insight: 'Renvoyer le lien de téléchargement avant de parler remboursement évite 1 remboursement sur 2.', evidence: '4 demandes « non reçu », 0 remboursement après renvoi du lien.', confidence: 0.6, source: 'ines', appliesTo: ['lucas', 'ines'], notePath: 'lecons/lien-avant-remboursement.md' },
    { id: 'les_3', day: 9, topic: 'pricing', insight: 'Passer de 14 € à 19 € n’a pas fait baisser la conversion : le profit par visiteur monte de 38 %.', evidence: 'CVR 3,3 % → 3,9 %, 1,02 € → 1,41 € par visiteur.', confidence: 0.55, source: 'emma', appliesTo: ['paul', 'clara'], notePath: 'lecons/prix-19-euros.md' },
    { id: 'les_4', day: 8, topic: 'ads', insight: 'Jamais de promesse chiffrée ou « garantie » : TikTok refuse et donne un avertissement.', evidence: 'crt_3 refusée, 1 avertissement sur le compte.', confidence: 0.95, source: 'axel', appliesTo: ['adam', 'mehdi', 'maelle'], notePath: 'lecons/pas-de-promesse-garantie.md' },
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
    { id: 'exp_1', day: 9, owner: 'emma', hypothesis: 'À 19 € le profit par visiteur est plus élevé qu’à 14 € sans hausse des remboursements.', dimension: 'price', variants: ['14', '19'], metric: 'roas', status: 'running', results: { '14': { n: 262, value: 1.02 }, '19': { n: 154, value: 1.41 } }, winner: null, endDay: null },
    { id: 'exp_2', day: 6, owner: 'tom', hypothesis: 'Les hooks « question » battent les hooks « mistake » sur le CTR.', dimension: 'hook_style', variants: ['question', 'mistake'], metric: 'ctr', status: 'concluded', results: { question: { n: 10900, value: 0.031 }, mistake: { n: 7300, value: 0.019 } }, winner: 'question', endDay: 9 },
  ];
}

function buildPlaybooks(): Record<string, string[]> {
  return {
    camille: ['Un seul nouveau produit à la fois tant que le premier n’est pas rentable.', 'Toujours lire le rapport de Raphaël avant le stand-up.'],
    adam: ['Privilégier le hook « question »', 'Ne jamais écrire « garanti »', 'Reprendre une phrase exacte des parents dans les 3 premières secondes.'],
    sarah: ['Privilégier le format « faceless_voiceover »', 'Couper une créa sous 1 % de CTR après 1 000 impressions.'],
    paul: ['Prix cible « 19 »', 'Tester une hausse de prix seulement après 20 ventes.'],
    mehdi: ['Niveau de promesse max « 0.4 »', 'Ne jamais écrire « miracle »'],
    ines: ['Ton support « chaleureux »', 'Toujours renvoyer le lien de téléchargement avant de proposer un remboursement.'],
    lucas: ['Ton support « chaleureux »', 'Répondre en moins de 2 heures aux messages « non reçu ».'],
    lina: ['Ne jamais écrire « chaque bébé est différent »', 'Ne jamais écrire « soyez patient »'],
    maelle: ['Ne jamais écrire « en 3 jours »', 'Texte à l’écran lisible en 1 seconde.'],
  };
}

function buildDeliverables(): Deliverable[] {
  return [
    { id: 'dlv_1', kind: 'pdf', title: 'Dodo serein v2 (PDF, 38 pages)', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/guide.pdf', createdBy: 'kenji', day: 9, quality: 84 },
    { id: 'dlv_2', kind: 'cover', title: 'Couverture Dodo serein', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/cover.svg', createdBy: 'zoe', day: 5, quality: 82 },
    { id: 'dlv_3', kind: 'sales_page', title: 'Page de vente Dodo serein', productId: 'prd_1', creativeId: null, path: 'files/prd_1/v2/sales-page.html', createdBy: 'clara', day: 6, quality: 81 },
    { id: 'dlv_4', kind: 'ad_storyboard', title: 'Storyboard « 3 h du matin »', productId: 'prd_1', creativeId: 'crt_1', path: 'files/prd_1/ads/crt_1/frame-1.svg', createdBy: 'maelle', day: 5, quality: 82 },
    { id: 'dlv_5', kind: 'ad_preview', title: 'Aperçu TikTok « 3 h du matin »', productId: 'prd_1', creativeId: 'crt_1', path: 'files/prd_1/ads/crt_1/preview.html', createdBy: 'maelle', day: 5, quality: 82 },
    { id: 'dlv_6', kind: 'ad_preview', title: 'Aperçu TikTok « L’erreur n°1 »', productId: 'prd_1', creativeId: 'crt_2', path: 'files/prd_1/ads/crt_2/preview.html', createdBy: 'maelle', day: 6, quality: 76 },
    { id: 'dlv_7', kind: 'report', title: 'Rapport du jour 9', productId: null, creativeId: null, path: 'brain/journal/jour-009.md', createdBy: 'raphael', day: 9, quality: null },
    { id: 'dlv_8', kind: 'research', title: 'Voix du client — sommeil bébé', productId: null, creativeId: null, path: 'brain/niches/sommeil-bebe-6-18-mois.md', createdBy: 'malo', day: 2, quality: null },
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
    [-380, 'nadia', 'delegate', 'Malo, récupère les phrases exactes sur les siestes trop courtes.', 'malo'],
    [-300, 'elise', 'review', 'Plan validé avec 2 corrections : chapitre bonus et exemple concret.', 'theo'],
    [-260, 'raphael', 'deliverable', 'Rapport du jour 9 publié : ROAS 4,6 après la hausse de prix.'],
    [-220, 'sarah', 'ad', 'crt_1 : CTR 3,1 %, budget +20 %. crt_2 en observation.'],
    [-180, null, 'sale', 'Nouvelle vente « Dodo serein » à 19 € (TikTok Ads).'],
    [-170, null, 'event', 'Post organique qui décolle — Le POV de Chloé dépasse 38 000 vues.'],
    [-150, 'ines', 'message', 'Double débit signalé : vérification avec Alice avant de répondre.'],
    [-120, 'nora', 'coffee', 'Pause café avant la rétro du soir.', undefined, 'cafe'],
    [-95, 'axel', 'review', 'La promesse « siestes de 2 h » est trop forte : à reformuler.', 'elise'],
    [-60, 'zoe', 'brain_read', 'Relit « Couverture » avant de dessiner les 3 pistes.'],
    [-40, 'mehdi', 'walk', 'Je file au café, je reviens relire la garantie.', undefined, 'cafe'],
    [-12, 'camille', 'delegate', 'Raphaël, prépare l’analyse du test de prix pour demain matin.', 'raphael'],
    [-9, 'malo', 'brain_read', 'Consulte « Voix du client » et les verbatims de la veille.'],
    [-7, 'theo', 'brain_read', 'Lit le plan validé de « Siestes faciles ».'],
    [-6, 'elise', 'delegate', 'Lina, viens à ton bureau : on humanise le chapitre 4 ensemble.', 'lina'],
    [-5, 'leo', 'delegate', 'Adam, 10 hooks « question » pour ce soir s’il te plaît.', 'adam'],
    [-4, 'zoe', 'deliverable', 'Couverture « Siestes faciles » : 3 pistes prêtes pour validation.'],
    [-3, 'samuel', 'review', 'Fact-check : le chapitre 5 renvoie bien vers le pédiatre.', 'elise'],
    [-2, 'clara', 'brain_write', 'Note ajoutée : « Les parents achètent surtout entre 21 h et 23 h ».'],
    [-1, 'chloe', 'walk', 'Je remonte chez Growth pour monter le POV qui décolle.', undefined, 'growth'],
  ];
  return rows.map(([dt, agentId, kind, text, to, place], i) => {
    const a: Activity = { id: `act_${9000 + i}`, day: DAY, tick: TICK, at: now + dt * 1000, agentId, kind, text };
    if (to) a.toAgentId = to;
    if (place) a.place = place;
    if (kind === 'deliverable') a.refs = { productId: 'prd_2' };
    return a;
  });
}

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
        { id: 'cmp_1', productId: 'prd_1', name: 'Dodo serein — test hooks', creativeIds: ['crt_1', 'crt_2'], dailyBudget: 25, status: 'active', targeting: { interests: ['parentalité', 'sommeil bébé', 'maternité'], ageMin: 24, ageMax: 40 }, startDay: 6, createdBy: 'sarah' } satisfies Campaign,
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
  };
}
