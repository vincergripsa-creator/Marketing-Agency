/**
 * Direction & co: founder missions → day-plan items (keyword routing), in-character chat,
 * and the concise daily memo.
 */
import type { AgentState, DailyKpi, DeptId, TaskKind } from '../../shared.js';
import type { DayPlanItem } from '../../contracts.js';
import { cap, clean, fit, fmtEur, fmtNum, fmtPct, lf, norm, splitSentences, type LocalRng } from '../util.js';

export const KIND_DEPT: Record<TaskKind, DeptId> = {
  plan_day: 'direction', scan_trends: 'recherche', mine_pains: 'recherche', scan_competitors: 'recherche',
  pick_opportunity: 'direction', red_team: 'rh', write_titles: 'studio', write_outline: 'studio', write_pdf: 'studio',
  humanize_pdf: 'studio', fact_check: 'studio', design_cover: 'creation', render_pdf: 'creation',
  write_sales_page: 'boutique', set_price: 'boutique', publish_product: 'boutique', design_upsell: 'boutique',
  write_ad_hooks: 'growth', produce_ad: 'growth', launch_campaign: 'growth', optimize_ads: 'growth', post_organic: 'growth',
  reply_inbox: 'support', handle_refund: 'support', find_creators: 'partenariats', negotiate_deal: 'partenariats',
  daily_report: 'analyse', run_experiment: 'analyse', budget_review: 'finance', retro: 'rh', performance_review: 'rh',
  reconcile_ledger: 'finance', weekly_pnl: 'finance', follow_missions: 'direction',
};

export const KIND_TITLE: Record<TaskKind, string> = {
  plan_day: 'Stand-up et plan du jour', scan_trends: 'Scanner les tendances et les niches', mine_pains: 'Récolter les douleurs et les mots des clients',
  scan_competitors: 'Analyser les concurrents', pick_opportunity: 'Choisir la prochaine opportunité (règle du un)', red_team: 'Red Team : essayer de tuer l’idée',
  write_titles: 'Écrire 10 titres', write_outline: 'Écrire le plan qui vend', write_pdf: 'Rédiger le guide', humanize_pdf: 'Humaniser le guide',
  fact_check: 'Fact-checker le guide', design_cover: 'Créer la couverture', render_pdf: 'Mettre en page le PDF final',
  write_sales_page: 'Écrire la page de vente', set_price: 'Ajuster le prix', publish_product: 'Publier le produit', design_upsell: 'Préparer l’upsell « La suite est ici »',
  write_ad_hooks: 'Écrire des hooks TikTok', produce_ad: 'Produire une pub TikTok', launch_campaign: 'Lancer une campagne', optimize_ads: 'Optimiser les pubs (couper / scaler)',
  post_organic: 'Publier un TikTok organique', reply_inbox: 'Répondre à la boîte mail', handle_refund: 'Traiter les remboursements',
  find_creators: 'Trouver des créateurs', negotiate_deal: 'Négocier avec un créateur', daily_report: 'Rapport chiffré', run_experiment: 'Lancer une expérience A/B',
  budget_review: 'Revue du budget', retro: 'Rétro : leçons du jour', performance_review: 'Revue RH des agents',
  reconcile_ledger: 'Rapprocher le grand livre', weekly_pnl: 'Sortir le P&L par produit', follow_missions: 'Suivre les missions et relancer',
};

const ROUTES: { re: RegExp; kinds: TaskKind[] }[] = [
  { re: /nouveau (pdf|guide|produit)|nouvelle niche|lance(r|z)? un (pdf|guide|produit)|(2e|deuxieme|second|autre) (pdf|guide|produit)/, kinds: ['scan_trends', 'mine_pains', 'scan_competitors', 'pick_opportunity'] },
  { re: /upsell|la suite est ici|produit suivant|suite du guide/, kinds: ['design_upsell'] },
  { re: /recherch|tendance|niche|etude de marche|concurren/, kinds: ['scan_trends', 'mine_pains', 'scan_competitors'] },
  { re: /titre/, kinds: ['write_titles'] },
  { re: /reecri|v2|version 2|ameliore(r|z)? (le|ce) (pdf|guide)|corrige(r|z)? (le|ce) (pdf|guide)/, kinds: ['write_pdf', 'humanize_pdf', 'fact_check'] },
  { re: /humanis|moins ia|trop generique/, kinds: ['humanize_pdf'] },
  { re: /fact.?check|verifi(e|er|ez) les (chiffres|sources)/, kinds: ['fact_check'] },
  { re: /couverture|cover|design/, kinds: ['design_cover'] },
  { re: /page de vente|landing|boutique/, kinds: ['write_sales_page'] },
  { re: /\bprix\b|tarif|baisse(r|z)? (le|les) prix|augmente(r|z)? (le|les) prix|promo/, kinds: ['set_price'] },
  { re: /publie(r|z)? (le|ce) (pdf|guide|produit)|mets? en ligne|mise en ligne/, kinds: ['publish_product'] },
  { re: /hook|accroche/, kinds: ['write_ad_hooks'] },
  { re: /\bpubs?\b|publicite|\bads\b|campagne|creative|creas?\b/, kinds: ['write_ad_hooks', 'produce_ad', 'launch_campaign'] },
  { re: /coupe(r|z)?|scale|optimis|stop.?loss|roas/, kinds: ['optimize_ads'] },
  { re: /organique|post(e|er|ez)? (un |des )?(tiktok|video)|contenu gratuit/, kinds: ['post_organic'] },
  { re: /rembours/, kinds: ['handle_refund'] },
  { re: /support|clients?\b|mails?\b|inbox|messages|boite/, kinds: ['reply_inbox'] },
  { re: /createur|influenceu|partenariat|affili|commission/, kinds: ['find_creators', 'negotiate_deal'] },
  { re: /rapport|bilan|kpi|chiffres|stats|tableau de bord/, kinds: ['daily_report'] },
  { re: /experience|test a\/?b|\bteste(r|z)?\b|a\/b/, kinds: ['run_experiment'] },
  { re: /budget|depense|tresorerie|finance|cash|runway/, kinds: ['budget_review'] },
  { re: /compta|grand livre|rapprochement|ecart/, kinds: ['reconcile_ledger'] },
  { re: /p&l|pnl|compte de resultat|marge|rentabilite|tresorerie|finance/, kinds: ['weekly_pnl'] },
  { re: /suivi|relance|bloque|en retard|ou en sont les missions/, kinds: ['follow_missions'] },
  { re: /lecon|retro|retrospective|post.?mortem/, kinds: ['retro'] },
  { re: /evaluation|\brh\b|performance des agents|revue des agents/, kinds: ['performance_review'] },
  { re: /tue(r|z)? (le|ce|l')|kill|arrete(r|z)? (le|ce) produit|red team/, kinds: ['red_team'] },
];

export function heuristicMission(input: { text: string; allowedKinds: TaskKind[] }): DayPlanItem[] {
  const text = clean(input.text);
  const n = norm(text);
  const allowed = new Set(input.allowedKinds ?? []);
  if (!text || allowed.size === 0) return [];
  const urgent = /urgent|vite|maintenant|tout de suite|immediatement|asap|aujourd'hui/.test(n);
  const priceM = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|euros?)/.exec(text);
  const price = priceM ? Number(priceM[1]!.replace(',', '.')) : null;
  const kinds: TaskKind[] = [];
  for (const r of ROUTES) if (r.re.test(n)) for (const k of r.kinds) if (allowed.has(k) && !kinds.includes(k)) kinds.push(k);
  const why = `Le fondateur a demandé : « ${fit(text, 140)} »`;
  if (kinds.length === 0) {
    const fb = (['daily_report', 'scan_trends', 'plan_day'] as TaskKind[]).find((k) => allowed.has(k)) ?? input.allowedKinds[0]!;
    return [{ kind: fb, title: KIND_TITLE[fb], dept: KIND_DEPT[fb], priority: urgent ? 1 : 2, input: { missionText: text }, why: `${why}. Mission floue : on commence par un état des lieux chiffré.` }];
  }
  return kinds.slice(0, 6).map((k, i) => ({
    kind: k,
    title: k === 'set_price' && price ? `Passer le prix à ${fmtEur(price)}` : KIND_TITLE[k],
    dept: KIND_DEPT[k],
    priority: (urgent || i === 0 ? 1 : i < 3 ? 2 : 3) as 1 | 2 | 3,
    input: { missionText: text, ...(price !== null && k === 'set_price' ? { price } : {}) },
    why,
  }));
}

// ───────────────────────────── chat ─────────────────────────────

const TOPICS: { re: RegExp; keys: RegExp }[] = [
  { re: /vente|chiffre|ca\b|revenu|argent|profit|rentab|combien|tresorerie|cash|budget/, keys: /vente|ca\b|revenu|profit|€|roas|marge|tresorerie|cash|runway/ },
  { re: /pub|tiktok|campagne|hook|ctr|creative/, keys: /pub|campagne|ctr|roas|hook|creative|cpm/ },
  { re: /tache|fais|travaill|occupe|en cours|aujourd'hui|quoi de neuf|ca va/, keys: /tache|en cours|mission|travail|redige|prepare|relecture/ },
  { re: /client|mail|support|rembours|ticket/, keys: /ticket|client|mail|rembours|message/ },
  { re: /produit|pdf|guide|boutique/, keys: /produit|pdf|guide|boutique|note/ },
  { re: /lecon|appris|erreur|retro/, keys: /lecon/ },
];

/** System-prompt material that must never be read back to the founder (« Tu es Camille, CEO… »). */
const PERSONA_LINE = /^\s*(?:#+\s|tu es\b|you are\b|personnalit[ée]|comp[ée]tences\s*:|outils connect|ton r[ôo]le|r[ôo]le\s*:|ton playbook|format de r[ée]ponse|garde-fous|style d'[ée]criture)/iu;

/** How each department looks at a problem: answers to the same question differ by who is asked. */
const ROLE_LENS: Record<DeptId, string> = {
  direction: 'Je tranche ce qu’on en fait au prochain stand-up.',
  recherche: 'De mon côté, je vérifie si la demande tient toujours dans nos signaux de marché.',
  studio: 'De mon côté, je regarde si le contenu du guide y est pour quelque chose.',
  creation: 'De mon côté, je regarde si la couverture et la mise en page jouent un rôle.',
  growth: 'De mon côté, je regarde d’abord les campagnes : ce qu’on coupe et ce qu’on pousse.',
  boutique: 'De mon côté, je regarde la page de vente et le prix.',
  support: 'De mon côté, je regarde ce que les clients écrivent dans la boîte mail.',
  analyse: 'De mon côté, je recoupe avec les chiffres avant de conclure.',
  finance: 'De mon côté, je cale l’enveloppe et la trésorerie de demain sur ces chiffres.',
  rh: 'De mon côté, j’en fais une leçon à la rétro du soir.',
  partenariats: 'De mon côté, je regarde si les créateurs peuvent compenser.',
};

/** Line prefixes of the situation built by the runtime: the answer to a precise question is a line, not a summary. */
const CAUSE = /^Cause d'hier\s*:/iu;
const BEST = /^Meilleur produit sur 7 jours\s*:/iu;
const MISSION = /^Mission du fondateur\b/iu;
const MY_POST = /^Mon poste\s*:/iu;

const STATUS_ASK = /\bou en (est|sont|es)\b|\bmission|\bavancement\b|\bstatut\b|\betat d'avancement\b/;
const WHY_ASK = /\bpourquoi\b|\bcomment ca se fait\b|\braison\b|\bcause\b|\bexplique\b/;
const BEST_ASK = /\bmeilleur|\bbest.?seller|\brapporte le plus\b|\bmarche le mieux\b|\btop produit\b/;

/** Words that do not tell one mission from another. */
const GENERIC_WORD = /^(guide|guides|pdf|produit|produits|mission|missions|lance|lancer|lancez|nouveau|nouvelle|sur|pour|les|des|une|est|sont|quoi|avec|dans|notre|nos|votre|vos|mon|mes|quel|quelle|quels|quelles|qui|que|pourquoi|comment|hier|aujourd|hui|fais|faire|ecris|ecrire)$/;
const topicWords = (s: string): string[] => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORD.test(w)).map((w) => w.replace(/s$/, ''));

/**
 * Founder missions the question is about: one word in common for « où en est X », two otherwise (one shared word
 * in a question about something else proves nothing). A plain « où en sont les missions » gets all of them.
 */
function missionsAsked(ask: string, missions: string[]): string[] {
  const words = new Set(topicWords(ask));
  const inner = (l: string) => /«\s*(.+?)\s*»/u.exec(l)?.[1] ?? l;
  const status = STATUS_ASK.test(ask);
  const shared = (m: string) => topicWords(inner(m)).filter((w) => words.has(w)).length;
  const top = Math.max(0, ...missions.map(shared));
  if (top >= (status ? 1 : 2)) return missions.filter((m) => shared(m) === top);
  return status && /mission/.test(ask) ? missions : [];
}

/** One fact of the situation, in the agent's own voice. */
function voiced(line: string): string {
  const l = clean(line).replace(/[.;]+$/, '');
  return l
    .replace(/^Mon poste\s*:\s*/iu, '')
    .replace(/^Cause d'hier\s*:\s*/iu, '')
    .replace(/^Meilleur produit sur 7 jours\s*:\s*aucun, /iu, 'on n’a pas de meilleur produit : ')
    .replace(/^Meilleur produit sur 7 jours\s*:\s*/iu, 'notre meilleur produit sur 7 jours est ')
    .replace(/^Mission du fondateur \(jour (\d+)\)\s*/iu, 'ta mission du jour $1, ')
    .replace(/^Marché d'hier\s*:\s*/iu, 'côté marché, ')
    .replace(/^Ma tâche en cours\s*:\s*(.+?)\s*\((en cours|en relecture|à faire)\)$/iu, (_m, t: string, s: string) => `je suis sur ${t}${s === 'en cours' ? '' : ` (${s})`}`)
    .replace(/^Pas de tâche en cours pour moi ce jour (\d+)$/iu, 'je n’ai pas de tâche en cours aujourd’hui')
    .replace(/^Hier\s*:\s*/iu, 'hier, on a fait ')
    .replace(/^Trésorerie\s+/iu, 'la trésorerie est à ')
    .replace(/^En boutique\s*:\s*/iu, 'en boutique, on a ')
    .replace(/^Leçon récente\s*:\s*/iu, 'la dernière leçon retenue : ')
    .replace(/^Pas encore de chiffres de vente$/iu, 'on n’a pas encore de chiffres de vente')
    .replace(/^Aucun produit en ligne pour l’instant$/iu, 'on n’a encore aucun produit en ligne');
}

function sentencesCount(s: string): number {
  return (s.match(/[.!?…](\s|$)/g) ?? []).length;
}

/**
 * In-character, first-person reply in 2 to 4 sentences, grounded in the situation lines built by the
 * runtime. Persona / system lines are never quoted back.
 */
export function heuristicChat(input: { history: { from: string; text: string }[]; text: string; situation: string }, agent: AgentState | null | undefined, rng: LocalRng, brand = 'l’agence'): string {
  const ask = norm(input.text ?? '');
  const raw = String(input.situation ?? '').split(/\n+|(?<=[.;])\s+(?=\p{Lu})/u).map(clean).filter((l) => l.length > 3);
  const lines = raw.filter((l) => !PERSONA_LINE.test(l) && !/\btu es\s+\p{Lu}/u.test(l) && !/^contexte\s*:/i.test(l));
  const topic = TOPICS.find((t) => t.re.test(ask));
  const generic = lines.filter((l) => !CAUSE.test(l) && !BEST.test(l) && !MISSION.test(l));
  const relevant = topic ? generic.filter((l) => topic.keys.test(norm(l))) : [];
  // A precise question gets its line: the mission named, the top product, the cause of the day.
  const missions = missionsAsked(ask, lines.filter((l) => MISSION.test(l)));
  const best = BEST_ASK.test(ask) ? lines.filter((l) => BEST.test(l)) : [];
  const causes = WHY_ASK.test(ask) ? lines.filter((l) => CAUSE.test(l)) : [];
  const precise = missions.length ? missions.slice(0, 2) : best.length ? best : causes.slice(0, 2);
  const facts = (precise.length ? precise : relevant.length ? relevant.slice(0, 2) : generic.slice(0, 2)).map(voiced).filter(Boolean);
  const role = clean(agent?.role) || 'membre de l’équipe';
  const name = clean(agent?.name);
  const direct = /direct|franc|cash|sec|concis|tranche/.test(norm(agent?.persona ?? ''));
  const open = direct ? '' : rng.pick(['Bonne question. ', 'Je fais le point. ', 'Merci de demander. ']);
  const s1 = facts.length
    ? `${open}${cap(facts.join(' ; '))}.`
    : `${open}Je n’ai pas encore de chiffres solides sur ce point dans mes notes du jour.`;
  const skills = (agent?.skills ?? []).slice(0, 2).map((s) => lf(s)).filter(Boolean);
  const analysis = precise.length > 0 || WHY_ASK.test(ask) || /\bcomment\b/.test(ask);
  const myPost = lines.find((l) => MY_POST.test(l));
  const lens = (agent?.dept && ROLE_LENS[agent.dept]) || `En tant que ${lf(role)}, je reprends ces chiffres avec l’équipe.`;
  const s2 = analysis
    ? `${myPost && !facts.includes(voiced(myPost)) ? `${cap(voiced(myPost))}. ` : ''}${lens}`
    : `${name ? `Ici ${name}, ` : 'De mon côté, '}${lf(role)} chez ${brand} : je m’occupe surtout ${skills.length ? skills.map(deOf).join(' et ') : 'de ma partie'}.`;
  const s3 = /\b(peux|pourrais|pouvez|veux|voudrais)\b.*\?|\b(fais|lance|change|ajoute|arrete|coupe)\b/.test(ask)
    ? 'Si tu veux que ça devienne une priorité, confie la mission au CEO et je m’y mets dès le prochain créneau.'
    : 'Je ne m’appuie que sur nos données internes : pour le reste, je préfère ne rien inventer.';
  let out = [s1, s2, s3].join(' ').replace(/\s+/g, ' ').trim();
  // never read the system persona back, never more than 4 sentences
  out = splitSentences(out).filter((s) => !/\btu es\s+\p{Lu}/u.test(s)).slice(0, 4).join(' ');
  if (sentencesCount(out) < 2) out = `${out} Je reviens vers toi dès que j’ai du nouveau.`.trim();
  return out;
}

function deOf(w: string): string {
  return /^[aeiouyàâéèêëîïôûùh]/i.test(w) ? `d’${w}` : `de ${w}`;
}

// ───────────────────────────── daily memo ─────────────────────────────

export function heuristicMemo(input: { day: number; kpi: DailyKpi; notes: string[] }): string {
  const k = input.kpi;
  const sign = (v: number) => `${v >= 0 ? '+' : '−'}${fmtEur(Math.abs(v))}`;
  const head = `Jour ${input.day} — CA ${fmtEur(k.revenue)}, pub ${fmtEur(k.adSpend)}, résultat ${sign(k.profit)} (cumul ${sign(k.cumulativeProfit)}), trésorerie ${fmtEur(k.cash)}.`;
  const funnel = `${fmtNum(k.sales)} vente${k.sales > 1 ? 's' : ''}, ${fmtNum(k.refunds)} remboursement${k.refunds > 1 ? 's' : ''}, CTR ${fmtPct(k.ctr)}, conversion ${fmtPct(k.cvr)}, ROAS ${fmtNum(k.roas, 2)}${k.cac > 0 ? `, CAC ${fmtEur(k.cac)}` : ''}.`;
  const ops = `${k.liveProducts} produit${k.liveProducts > 1 ? 's' : ''} en ligne, ${k.openTickets} ticket${k.openTickets > 1 ? 's' : ''} ouvert${k.openTickets > 1 ? 's' : ''}, ${k.tasksDone} tâche${k.tasksDone > 1 ? 's' : ''} terminée${k.tasksDone > 1 ? 's' : ''}, ${k.lessonsLearned} leçon${k.lessonsLearned > 1 ? 's' : ''} apprise${k.lessonsLearned > 1 ? 's' : ''}.`;
  const notes = (input.notes ?? []).map(clean).filter(Boolean).slice(0, 3);
  let priority: string;
  if (k.liveProducts === 0) priority = 'publier un premier guide : sans produit en ligne, aucune vente possible.';
  else if (k.adSpend > 0 && k.roas < 0.8) priority = 'couper les pubs sous ROAS 0,8 et tester de nouveaux hooks avant de remettre du budget.';
  else if (k.refunds > 0 && k.sales > 0 && k.refunds / k.sales > 0.08) priority = 'faire baisser les remboursements : aligner la promesse de la page de vente sur le contenu.';
  else if (k.openTickets > 5) priority = 'vider la boîte mail avant toute nouvelle dépense : un message ignoré devient un mauvais avis.';
  else if (k.profit > 0 && k.roas >= 1.5) priority = 'augmenter progressivement (+20-30 %) le budget des créas gagnantes.';
  else priority = 'tester une nouvelle accroche et continuer l’organique pour trouver le prochain levier.';
  return [head, funnel, ops, notes.length ? `Points clés : ${notes.map((x) => x.replace(/[.;]$/, '')).join(' ; ')}.` : '', `Priorité de demain : ${priority}`]
    .filter(Boolean).join('\n');
}

