/**
 * Direction & co: founder missions → day-plan items (keyword routing), in-character chat,
 * and the concise daily memo.
 */
import type { AgentState, DailyKpi, DeptId, TaskKind } from '../../shared.js';
import type { DayPlanItem } from '../../contracts.js';
import { cap, clean, fit, fmtEur, fmtNum, fmtPct, norm, type LocalRng } from '../util.js';

export const KIND_DEPT: Record<TaskKind, DeptId> = {
  plan_day: 'direction', scan_trends: 'recherche', mine_pains: 'recherche', scan_competitors: 'recherche',
  pick_opportunity: 'direction', red_team: 'rh', write_titles: 'studio', write_outline: 'studio', write_pdf: 'studio',
  humanize_pdf: 'studio', fact_check: 'studio', design_cover: 'creation', render_pdf: 'creation',
  write_sales_page: 'boutique', set_price: 'boutique', publish_product: 'boutique', design_upsell: 'boutique',
  write_ad_hooks: 'growth', produce_ad: 'growth', launch_campaign: 'growth', optimize_ads: 'growth', post_organic: 'growth',
  reply_inbox: 'support', handle_refund: 'support', find_creators: 'partenariats', negotiate_deal: 'partenariats',
  daily_report: 'analyse', run_experiment: 'analyse', budget_review: 'finance', retro: 'rh', performance_review: 'rh',
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
  { re: /vente|chiffre|ca\b|revenu|argent|profit|rentab|combien/, keys: /vente|ca\b|revenu|profit|€|roas|marge|tresorerie|cash/ },
  { re: /pub|tiktok|campagne|hook|ctr/, keys: /pub|campagne|ctr|roas|hook|creative|cpm/ },
  { re: /tache|fais|travaill|occupe|en cours|aujourd'hui/, keys: /tache|en cours|mission|travail|redige|prepare/ },
  { re: /client|mail|support|rembours/, keys: /ticket|client|mail|rembours|message/ },
  { re: /produit|pdf|guide/, keys: /produit|pdf|guide|vente|note/ },
];

export function heuristicChat(input: { history: { from: string; text: string }[]; text: string; situation: string }, agent: AgentState, rng: LocalRng): string {
  const ask = norm(input.text ?? '');
  const lines = clean(input.situation).split(/\n+|(?<=[.;])\s+/).map(clean).filter((l) => l.length > 3);
  const topic = TOPICS.find((t) => t.re.test(ask));
  const relevant = topic ? lines.filter((l) => topic.keys.test(norm(l))) : [];
  const facts = (relevant.length ? relevant : lines).slice(0, 2);
  const direct = /direct|franc|cash|sec|concis/.test(norm(agent.persona ?? ''));
  const greet = direct ? '' : rng.pick(['Bonne question. ', 'Merci de demander. ', 'Je fais le point. ']);
  const s1 = facts.length
    ? `${greet}${cap(facts.map((f) => f.replace(/[.;]$/, '')).join(' ; '))}.`
    : `${greet}Je n’ai pas encore de chiffres solides sur ce point dans mes notes du jour.`;
  const s2 = /\?/.test(input.text ?? '') && /pourquoi|comment/.test(ask)
    ? `Mon analyse, en tant que ${agent.role.toLowerCase()} : on avance par petits tests, on garde ce qui marche et on coupe vite le reste.`
    : `De mon côté, en tant que ${agent.role.toLowerCase()}, je m’occupe de ${agent.skills.slice(0, 2).map((s) => s.toLowerCase()).join(' et ') || 'ma partie'}.`;
  const s3 = 'Je ne vois que nos données internes et la simulation du marché : pour le reste, je préfère ne rien inventer.';
  const s4 = /\b(peux|pourrais|pouvez|veux|voudrais)\b.*\?|fais|lance|change/.test(ask)
    ? 'Si tu veux que ça devienne une priorité, donne la mission au CEO et je m’y mets dès le prochain créneau.'
    : '';
  return [s1, s2, s3, s4].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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

