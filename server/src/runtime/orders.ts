/**
 * The founder's orders, executed on the spot: a stop is a standing hold the plan and the handlers respect until the founder lifts
 * it, not a task that may or may not reach its goal. An order that cannot be carried out is said so, never closed as done.
 */
import type { AgentState, Campaign, ChannelId, Mission, Product, Task, WorldState } from '../shared.js';
import { CHANNELS, channelOf } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { nicheName, productOf, speak } from './ctx.js';
import { activeHolds, addHold, adsHold, firingHold, liftHolds } from './holds.js';
import { activeCampaigns, committedAdBudget, currentBudget } from './metrics.js';
import type { FounderOrder, Lowering, OrderAction, PersonOrder } from './missions.js';
import { campaignNumber, tellFounder } from './missions.js';
import { isLegacyOrg } from './org/constants.js';
import { requestDeparture } from './org/departure.js';
import { officerId } from './org/officers.js';
import { closeProductMissions, dropTask, killProduct, shelveProduct, stopPaidAds } from './pipeline.js';
import { redTeamGate } from './redteam.js';
import { growthOn } from './stages.js';
import { resumeCampaigns } from './strategy.js';
import { createTask, KIND_META, openTasks, taskById } from './tasks.js';
import { clip, eur, round2, short, sum } from './util.js';

/** How long a stop holds, in the founder's words. */
const untilText = (w: WorldState, days: number | undefined, lift: string): string => (days ? `jusqu'au jour ${w.day + days - 1} inclus` : `tant que tu ne me dis pas « ${lift} »`);

/** What is left of a campaign after « baisse le budget » with no amount: the buyer's own trim. */
const LOWER_SHARE = 0.7;
/** How long a lowering stops what is new when they give no length: a week shows on the cash, and a word said once does not starve the company. */
const LOWER_DAYS = 7;

const ASKED_FR: Partial<Record<OrderAction, string>> = {
  stop_ads: 'Je n’ai coupé aucune pub',
  lower_budget: 'Je n’ai baissé aucun budget',
  resume_ads: 'Je n’ai relancé aucune pub',
  pause_product: 'Je n’ai rien retiré de la vente',
  kill_product: 'Je n’ai rien arrêté',
  resume_product: 'Je n’ai rien remis en ligne',
};

const PERSON_FR: Record<PersonOrder, string> = {
  pin_agent: 'je n’ai protégé personne',
  unpin_agent: 'je n’ai rien changé',
  fire_agent: 'je n’ai renvoyé personne',
};

/** The founder's latest word: a pin does not protect someone from the founder who set it. */
async function fireAgent(ctx: RuntimeCtx, agent: AgentState): Promise<{ text: string; left: boolean }> {
  const w = ctx.world;
  if (isLegacyOrg(w)) return { text: `Je ne peux pas : l'équipe de cette partie est fixe, ${agent.name} reste.`, left: false };
  const outcome = await requestDeparture(ctx, agent.id, `ordre du fondateur du jour ${w.day}`, 'founder', 'founder_order');
  if (outcome === 'refused') return { text: `Je ne peux pas renvoyer ${agent.name} : personne ne peut reprendre son poste.`, left: false };
  liftHolds(w, (h) => h.kind === 'pin' && h.agentId === agent.id);
  return { text: outcome === 'left' ? `C'est fait : ${agent.name} quitte l'agence.` : `C'est noté : ${agent.name} part dès que sa relève arrive, le recrutement est ouvert.`, left: true };
}

const channelNames = (order: { channels?: readonly ChannelId[] }): string => (order.channels ?? []).map((ch) => CHANNELS[ch].label).join(', ');

/**
 * The hold of an order on ads, one per channel named: what runs stops unless it is spared, and the work leading to a launch goes. A hold
 * with an end lists what it paused, a lowering what it let run on the founder's word.
 */
function holdAds(ctx: RuntimeCtx, { product, channels }: { product: Product | null; channels?: readonly ChannelId[] }, spared: readonly Campaign[], until: number | null, reason: (channel: ChannelId | null) => string, kept: readonly Campaign[] = []): { paused: number; cancelled: number } {
  const w = ctx.world;
  let paused = 0, cancelled = 0;
  for (const channel of channels?.length ? channels : [null]) {
    const stoppedBefore = new Set(w.company.campaigns.filter((c) => c.pausedFor === 'founder').map((c) => c.id));
    const stopped = stopPaidAds(ctx, product?.id ?? null, `ordre du fondateur du jour ${w.day}`, channel, spared);
    paused += stopped.paused;
    cancelled += stopped.cancelled;
    const resumes = until === null ? {} : { resumes: w.company.campaigns.filter((c) => c.pausedFor === 'founder' && !stoppedBefore.has(c.id)).map((c) => c.id) };
    const left = kept.filter((c) => !channel || channelOf(c) === channel).map((c) => c.id);
    addHold(w, { kind: 'ads', productId: product?.id ?? null, until, ...(channel ? { channel } : {}), ...resumes, ...(left.length ? { kept: left } : {}), reason: reason(channel) });
  }
  return { paused, cancelled };
}

/**
 * What « sauf » spares keeps running under the hold, on the founder's word: the hold stops what is new, and a campaign they kept is
 * not cut by the plan or the buyer. The stop-loss still reads it.
 */
function stopAds(ctx: RuntimeCtx, order: FounderOrder & { action: 'stop_ads' }, when: string): string {
  const { product, spared = [] } = order;
  const w = ctx.world;
  const names = channelNames(order);
  const until = lastDay(w, order.days);
  const { paused, cancelled } = holdAds(ctx, order, spared, until, (channel) => `les pubs${channel ? ` ${CHANNELS[channel].label}` : ''}${product ? ` de « ${short(product.title, 50)} »` : ''} sont coupées sur ordre du fondateur (jour ${w.day})`);
  const running = spared.filter((c) => c.status === 'active');
  for (const c of running) c.founderForced = true;
  const kept = running.length ? ` Restent en cours sur ton ordre : ${running.map((c) => campaignLabel(c, numberOf(ctx, c))).join(', ')}.` : '';
  const stopped = `C'est fait${when} : ${paused} campagne(s) en pause, ${cancelled} tâche(s) de pub annulée(s).${kept} Aucune ${running.length ? 'autre ' : ''}pub ne repartira${names ? ` sur ${names}` : ''}${product ? ` sur « ${short(product.title, 50)} »` : ''}`;
  return until === null ? `${stopped} tant que tu ne me dis pas « reprends ${names || 'les pubs'} ».` : `${stopped} avant le jour ${until + 1} : ce matin-là, elles repartent seules, dans l'enveloppe du CFO. Dis « reprends ${names || 'les pubs'} » pour avancer ce retour.`;
}

/** The share of what runs that the founder's words leave: an amount reads against what runs, and what cannot be lower stays where it is. */
function shareLeft(order: Lowering, running: number): number {
  if (order.amount !== undefined) return Math.min(1, order.amount / Math.max(1, running));
  if (order.less !== undefined) return Math.max(0, 1 - order.less / Math.max(1, running));
  return order.share ?? LOWER_SHARE;
}

/** On the air, or off for today's outage alone: a day off is no campaign stopped, and it comes back at what they said. */
const onAir = (c: Campaign): boolean => c.status === 'active' || c.pausedFor === 'outage';

/** The week's ceiling, which the buyer and the plan read through `scalingRoom`: down to what runs, nothing grows until the CFO's next Monday. Null before their first one. */
function capTheWeek(w: WorldState): { cap: number; review: number } | null {
  const allocation = growthOn(w) ? w.company.growth?.allocation : null;
  if (!allocation) return null;
  const cap = round2(sum(w.company.campaigns.filter(onAir).map((c) => c.dailyBudget)));
  allocation.adTarget = Math.min(allocation.adTarget, cap);
  allocation.note = `Plafond ramené à ${eur(cap)}/jour sur ordre du fondateur (jour ${w.day}) : rien ne monte avant la prochaine revue.`;
  return { cap, review: allocation.day + 7 };
}

/**
 * Less money on ads, on the founder's word: what runs goes down now and stays on, nothing new starts while the hold stands, nothing
 * grows until the CFO's next Monday, and what they did not ask to touch is said so. It takes no task: a review could scale a winner,
 * and hooks would lead to a launch. The hold is the one « sauf » uses, so the kept campaigns run under it on their word.
 */
function lowerBudget(ctx: RuntimeCtx, order: FounderOrder & { action: 'lower_budget' }): string {
  const w = ctx.world;
  const { product, channels, campaigns } = order;
  const running = campaigns?.map((c) => c.campaign).filter(onAir) ?? w.company.campaigns.filter((c) => onAir(c) && (!product || c.productId === product.id) && (!channels?.length || channels.includes(channelOf(c))));
  const before = sum(running.map((c) => c.dailyBudget));
  const left = shareLeft(order, before);
  const lowered = running.filter((c) => {
    const next = round2(Math.max(CHANNELS[channelOf(c)].minDailyBudget, c.dailyBudget * left));
    if (next >= c.dailyBudget || !ctx.tools.updateCampaign(c.id, { dailyBudget: next }).ok) return false;
    c.founderCap = next; // approval mode: more than this asks them first
    return true;
  });
  const after = sum(running.map((c) => c.dailyBudget));
  const names = channelNames(order);
  const where = `${names ? ` sur ${names}` : ''}${product ? ` sur « ${clip(product.title, 50)} »` : ''}`;
  const floor = order.amount !== undefined && after > order.amount ? ` Plus bas que ${eur(order.amount)}/jour, les minimums des canaux refusent.` : '';
  const said = lowered.length ? `C'est fait${where} : ${lowered.length} campagne(s) baissée(s), de ${eur(before)} à ${eur(after)}/jour.${lowered.length < running.length ? ` ${running.length - lowered.length} autre(s) déjà au minimum du canal.` : ''}${floor}`
    : running.length ? `Je n'ai rien baissé${where} : ${running.length} campagne(s) déjà au niveau demandé ou au minimum du canal (${eur(before)}/jour).` : `Rien à baisser${where} : aucune campagne ne tourne.`;
  const back = w.scenario.founderApproval ? 'une hausse passera par toi' : 'une campagne qui gagne peut remonter de 30 % par jour au plus';
  const week = campaigns || !lowered.length ? null : capTheWeek(w);
  const envelope = eur(currentBudget(w).adCap);
  const kept = week ? `Plafond de la semaine ramené à ${eur(week.cap)}/jour, tous canaux confondus : rien ne monte avant la revue du CFO du jour ${week.review}. L'enveloppe du jour (${envelope}) suit la trésorerie, je n'y touche pas.` : `Je ne touche pas à l'enveloppe du CFO (${envelope}/jour) : ${back}.`;
  if (campaigns) return `${said} ${kept} Les autres campagnes continuent.`;
  if (!running.length) return said; // nothing went down: a freeze here would be a stop nobody ordered
  const until = lastDay(w, order.days ?? LOWER_DAYS)!;
  const carried = new Set(activeHolds(w).flatMap((h) => h.kept ?? []));
  const { cancelled } = holdAds(ctx, order, running, until, (channel) => `nouvelles pubs${channel ? ` ${CHANNELS[channel].label}` : ''}${product ? ` de « ${clip(product.title, 50)} »` : ''} gelées, budget baissé sur ordre du fondateur (jour ${w.day})`, running.filter((c) => !c.founderForced || carried.has(c.id)));
  for (const c of running) c.founderForced = true;
  return `${said} Aucune nouvelle pub ne démarre${where} jusqu'au jour ${until} inclus${cancelled ? `, ${cancelled} tâche(s) de pub annulée(s)` : ''}. ${kept} Dis « reprends ${names || 'les pubs'} » pour que les nouvelles pubs repartent plus tôt, « coupe ${names || 'les pubs'} » pour tout arrêter.`;
}

/** What a lowering kept is the company's again once nothing the founder said stands over it, whatever stopped it meanwhile. Read over every hold: a stop can outlive the lowering. */
function freeKept(w: WorldState): void {
  for (const id of (w.company.holds ?? []).flatMap((h) => h.kept ?? [])) {
    const c = w.company.campaigns.find((x) => x.id === id);
    if (c && !adsHold(w, c.productId, channelOf(c))) delete c.founderForced;
  }
}

/** A lowering keeps what runs: once the stop-loss has taken all of it, its hold would be a stop nobody ordered. New ads start again, under the week's cap. */
function endEmptyLowerings(ctx: RuntimeCtx): void {
  const w = ctx.world;
  const alive = (id: string): boolean => w.company.campaigns.some((c) => c.id === id && (c.status === 'active' || !!c.pausedFor));
  for (const h of activeHolds(w).filter((x) => x.kept && ![...x.kept, ...x.resumes ?? []].some(alive))) {
    liftHolds(w, (x) => x.id === h.id);
    speak(ctx, 'growth', `plus aucune des campagnes gardées le jour ${h.day} ne tourne : le gel des nouvelles pubs s'arrête ce matin, le plafond du CFO tient jusqu'à sa revue.`, 'founder');
  }
}

/** The last day of an order given a length, today counted. Null: until it is lifted. */
const lastDay = (w: WorldState, days: number | undefined): number | null => (days ? w.day + days - 1 : null);

/** The morning after a stop with an end: what it paused starts again, unless another founder order still stands over it. */
export function endTimedStops(ctx: RuntimeCtx): void {
  const w = ctx.world;
  endEmptyLowerings(ctx);
  freeKept(w);
  for (const h of (w.company.holds ?? []).filter((x) => x.resumes && x.until === w.day - 1 && x.liftedDay === undefined)) {
    const free = h.resumes!.filter((id) => {
      const c = w.company.campaigns.find((x) => x.id === id);
      if (c?.pausedFor !== 'founder') return false;
      const stands = adsHold(w, c.productId, channelOf(c)); // what still holds it brings it back in turn: « reprends » reads every pause, a length only its list
      if (stands?.resumes && !stands.resumes.includes(id)) stands.resumes.push(id);
      return !stands;
    });
    if (!free.length) continue;
    let back = 0;
    for (const campaignId of free) back += resumeCampaigns(ctx, 'founder', { campaignId }).resumed.length;
    speak(ctx, 'growth', `fin de l'arrêt que tu as demandé le jour ${h.day} : ${back} campagne(s) repartent ce matin${back < free.length ? `, ${free.length - back} reste(nt) en pause (produit, budget ou règles de la pub)` : ''}.`, 'founder');
  }
}

/** « Reprends Meta » lifts what the founder said about Meta: an order on every channel still stands, and they are told so. */
function resumeAds(ctx: RuntimeCtx, order: FounderOrder & { action: 'resume_ads' }): { text: string; resumed: boolean } {
  const w = ctx.world;
  const { product, channels, spared } = order;
  const lifted = liftHolds(w, (h) => h.kind === 'ads' && (!product || h.productId === null || h.productId === product.id) && (!channels || (!!h.channel && channels.includes(h.channel))));
  freeKept(w);
  const stands = (channels ?? []).map((ch) => adsHold(w, product?.id ?? null, ch)).find(Boolean);
  if (stands) return { text: `Je n'ai rien relancé : ${stands.reason}. Dis « reprends les pubs » pour lever cet ordre.`, resumed: false };
  const { resumed, left } = resumeCampaigns(ctx, 'founder', { productId: product?.id, channels, spared });
  return { text: `C'est reparti${channels ? ` sur ${channelNames(order)}` : ''} : ${lifted.length} blocage(s) levé(s), ${resumed.length} campagne(s) relancée(s)${left.length ? `, ${left.length} restée(s) en pause (produit, budget ou règles de la pub)` : ''}. Le plan de demain reprend les lancements.`, resumed: true };
}

const campaignLabel = (c: Campaign, number: number): string => `n° ${number} « ${short(c.name, 60)} »`;

const numberOf = (ctx: RuntimeCtx, c: Campaign): number => campaignNumber(c, ctx.world.company.campaigns.indexOf(c));

/**
 * One campaign, on the founder's word: the others go on, and no hold stops the company from running them. The plan may give the same
 * guide a new campaign the next days, and the founder is told so with the sentence that stops it for good.
 */
function stopCampaign(ctx: RuntimeCtx, c: Campaign, number: number): string {
  if (c.status !== 'active') return `La campagne ${campaignLabel(c, number)} ne tourne pas : je n'ai rien changé.`;
  try { ctx.tools.updateCampaign(c.id, { status: 'paused' }); } catch { /* the runtime status below is authoritative */ }
  c.status = 'paused';
  c.pausedFor = 'founder';
  const product = productOf(ctx, c.productId);
  const forGood = product ? ` L'équipe peut relancer une autre campagne sur ce guide : pour l'arrêter pour de bon, dis « coupe les pubs du guide ${nicheName(ctx, product.nicheId)} ».` : '';
  return `C'est fait : la campagne ${campaignLabel(c, number)} est en pause, les autres continuent.${forGood} Dis « reprends la campagne ${number} » pour la relancer.`;
}

/** The founder's order on all the ads still stands over one campaign: they lift it first. A refused resume keeps their stop: the next try reads it. */
function resumeCampaign(ctx: RuntimeCtx, c: Campaign, number: number): { text: string; resumed: boolean } {
  const hold = adsHold(ctx.world, c.productId, channelOf(c));
  if (hold) return { text: `Je n'ai rien relancé : ${hold.reason}. Dis « reprends les pubs » pour lever cet ordre.`, resumed: false };
  const stopped = c.pausedFor;
  const { resumed } = resumeCampaigns(ctx, 'founder', { campaignId: c.id });
  if (resumed.length) return { text: `C'est reparti : la campagne ${campaignLabel(c, number)} tourne de nouveau.`, resumed: true };
  if (stopped) c.pausedFor = stopped;
  return { text: `Je n'ai pas relancé la campagne ${campaignLabel(c, number)} : ${stopped === 'founder' ? 'son produit, son budget ou les règles de la pub l\'en empêchent pour l\'instant' : 'elle n\'est pas en pause sur ton ordre'}.`, resumed: false };
}

/** Every order of one sentence on one mission: the founder reads each answer, and one refused order shows on it. */
export async function executeOrders(ctx: RuntimeCtx, m: Mission, orders: readonly FounderOrder[]): Promise<void> {
  const answers: string[] = [];
  const statuses: Mission['status'][] = [];
  for (const order of orders) {
    m.status = 'open';
    await executeOrder(ctx, m, order);
    answers.push(m.outcome ?? '');
    statuses.push(m.status);
  }
  m.outcome = answers.join(' ');
  m.status = statuses.includes('failed') ? 'failed' : statuses.includes('open') ? 'open' : 'done';
}

async function executeOrder(ctx: RuntimeCtx, m: Mission, order: FounderOrder): Promise<void> {
  const w = ctx.world;
  const ceo = officerId(w, 'ceo');
  const done = (text: string): void => { m.status = 'done'; tellFounder(ctx, ceo, m, text); };
  const refuse = (text: string): void => { m.status = 'failed'; tellFounder(ctx, ceo, m, text); };
  switch (order.action) {
    case 'no_target': {
      const titles = w.company.products.filter((p) => p.status !== 'killed').slice(-4).map((p) => `« ${short(p.title, 50)} »`);
      refuse(`${ASKED_FR[order.asked] ?? 'Je n’ai rien fait'} : ${order.topic ? `je ne trouve aucun guide sur « ${order.topic} »` : 'je ne sais pas de quel guide tu parles'}.${titles.length ? ` Nos guides : ${titles.join(', ')}.` : ''}`);
      return;
    }
    case 'no_campaign': {
      const running = w.company.campaigns.flatMap((c, i) => (c.status === 'active' ? [campaignLabel(c, campaignNumber(c, i))] : []));
      refuse(`${ASKED_FR[order.asked] ?? 'Je n’ai rien fait'} : aucune campagne ne porte le n° ${order.number}.${running.length ? ` En cours : ${running.slice(0, 6).join(', ')}.` : ''}`);
      return;
    }
    case 'negated':
      done(`Compris (« ${short(order.text.trim(), 80)} ») : je ne change rien.`);
      return;
    case 'left_out':
      done(`Pas fait : « ${short(order.text.trim(), 80)} ». Une demande à la fois : redis-la-moi et je m'y mets.`);
      return;
    case 'budget_asked':
      done(`Je n'ai rien changé : l'enveloppe pub du jour est de ${eur(currentBudget(w).adCap)}, ${eur(committedAdBudget(w))} engagés sur ${activeCampaigns(w).length} campagne(s). Dis « baisse le budget pub » pour que je le fasse.`);
      return;
    case 'lower_budget':
      done(lowerBudget(ctx, order));
      return;
    case 'trim_ads':
      m.taskIds.push(createTask(w, { kind: 'optimize_ads', title: KIND_META.optimize_ads.label, input: order.channel ? { channel: order.channel } : {}, createdBy: 'founder', missionId: m.id, priority: 1 }).id);
      done('C’est noté : on coupe ce qui ne rapporte pas, le reste continue.');
      return;
    case 'stop_campaign':
      done(stopCampaign(ctx, order.campaign, order.number));
      return;
    case 'resume_campaign': {
      const { text, resumed } = resumeCampaign(ctx, order.campaign, order.number);
      if (resumed) done(text); else refuse(text);
      return;
    }
    case 'no_agent':
      refuse(order.left ? `${order.left.name} a quitté l'agence le jour ${order.left.leftDay} : ${PERSON_FR[order.asked]}.` : `Personne ne s'appelle ${order.name} dans l'équipe : ${PERSON_FR[order.asked]}.`);
      return;
    case 'stop_firing':
      if (!firingHold(w)) addHold(w, { kind: 'firing', productId: null, until: lastDay(w, order.days), reason: `aucun départ ni remplacement sur ordre du fondateur (jour ${w.day})` });
      done(`C’est noté : personne ne part ${untilText(w, order.days, 'tu peux virer')}. Ni remplacement, ni licenciement, ni nouveau plan d’amélioration.`);
      return;
    case 'allow_firing':
      done(liftHolds(w, (h) => h.kind === 'firing').length ? 'C’est noté : la ligue reprend ses remplacements à la prochaine clôture de saison.' : 'Rien à lever : aucun gel des départs n’était en cours.');
      return;
    case 'stop_hiring':
      liftHolds(w, (h) => h.kind === 'hiring'); // a refusal's cooldown ends by itself, the founder's order does not
      addHold(w, { kind: 'hiring', productId: null, until: lastDay(w, order.days), reason: `embauches gelées sur ordre du fondateur (jour ${w.day})` });
      done(`C’est noté : plus aucune embauche ${untilText(w, order.days, 'reprends les embauches')}. Seule la relève d’un départ reste possible.`);
      return;
    case 'resume_hiring':
      liftHolds(w, (h) => h.kind === 'hiring');
      done('C’est noté : les embauches reprennent, aux conditions habituelles du CFO.');
      return;
    case 'pin_agent': {
      const { agent } = order;
      liftHolds(w, (h) => h.kind === 'pin' && h.agentId === agent.id); // a refused swap pins for 14 days, the founder's order does not end
      addHold(w, { kind: 'pin', productId: null, until: null, agentId: agent.id, reason: `${agent.name} ne part pas, sur ordre du fondateur (jour ${w.day})` });
      done(`C’est noté : ${agent.name} ne passera ni en plan d’amélioration ni en remplacement tant que tu ne me dis pas le contraire.`);
      return;
    }
    case 'unpin_agent': {
      const { agent } = order;
      const lifted = liftHolds(w, (h) => h.kind === 'pin' && h.agentId === agent.id);
      if (lifted.length) done(`C’est noté : ${agent.name} repasse sous les règles de la ligue.`);
      else refuse(`${agent.name} n’était pas ${agent.gender === 'f' ? 'protégée' : 'protégé'} : je n’ai rien changé.`);
      return;
    }
    case 'fire_agent': {
      const { text, left } = await fireAgent(ctx, order.agent);
      if (left) done(text); else refuse(text);
      return;
    }
    case 'stop_ads':
      done(stopAds(ctx, { ...order, action: 'stop_ads' }, ''));
      return;
    case 'stop_spending': {
      const text = stopAds(ctx, { action: 'stop_ads', product: null, days: order.days }, ' pour la pub');
      addHold(w, { kind: 'advances', productId: null, until: lastDay(w, order.days), reason: `plus aucune avance aux créateurs sur ordre du fondateur (jour ${w.day})` });
      done(`${text} Plus aucune avance aux créateurs non plus. Restent les frais fixes de la boutique et des outils : je ne peux pas les couper sans fermer la boutique.`);
      return;
    }
    case 'stop_launches': {
      addHold(w, { kind: 'launches', productId: null, until: lastDay(w, order.days), reason: `plus de nouveau guide sur ordre du fondateur (jour ${w.day})` });
      const open = openTasks(w, (t: Task) => (t.kind === 'pick_opportunity' && !t.input.nicheId) || t.kind === 'design_upsell');
      for (const t of open) dropTask(ctx, t, `ordre du fondateur du jour ${w.day}`);
      const inWork = w.company.products.filter((p) => !['live', 'killed', 'paused'].includes(p.status));
      done(`C'est noté : aucun nouveau guide ne démarre ${untilText(w, order.days, 'reprends les lancements')}.${inWork.length ? ` Déjà en production, je le termine sauf contre-ordre : ${inWork.map((p) => `« ${short(p.title, 50)} »`).join(', ')}.` : ''}`);
      return;
    }
    case 'pause_product': {
      const p = order.product!;
      const cancelled = shelveProduct(ctx, p, `le fondateur l'a retiré le jour ${w.day}`);
      done(`C'est fait : « ${short(p.title, 60)} » n'est plus en vente ni en production (${cancelled} tâche(s) annulée(s)). ${order.days ? `Je ne sais pas le remettre seul dans ${order.days} jour(s) : le moment venu, dis` : 'Dis'} « remets le guide en ligne » pour le reprendre.`);
      return;
    }
    case 'kill_product': {
      const p = order.product!;
      closeProductMissions(ctx, p, `le fondateur l'a arrêté le jour ${w.day}`);
      await killProduct(ctx, p, `décision du fondateur du jour ${w.day}`);
      // The founder's word is no wait: the niche this kill closed stays closed, no timer gives it back to the team. A follow-up or a kit closes nothing.
      const niche = w.company.growth?.niches[p.nicheId];
      if (niche?.lastEndDay === w.day) niche.reopenDay = null;
      done(`C'est fait : « ${short(p.title, 60)} » est arrêté définitivement.`);
      return;
    }
    case 'resume_ads': {
      const { text, resumed } = resumeAds(ctx, { ...order, action: 'resume_ads' });
      if (resumed) done(text); else refuse(text);
      return;
    }
    case 'resume_launches':
      liftHolds(w, (h) => h.kind === 'launches');
      done('C’est noté : les nouveaux guides reprennent au prochain stand-up.');
      return;
    case 'resume_all': {
      const lifted = liftHolds(w, (h) => h.kind !== 'product');
      freeKept(w);
      resumeCampaigns(ctx, 'founder');
      done(`C'est noté : ${lifted.length} ordre(s) levé(s).`);
      return;
    }
    case 'resume_product': {
      const p = order.product!;
      liftHolds(w, (h) => h.productId === p.id);
      // The founder's word stands for the Red Team's: a guide held at its gate ships on their signature.
      const gate = redTeamGate(w, p);
      const last = gate.state === 'blocked' && gate.taskId ? taskById(w, gate.taskId) : undefined;
      if (last) last.output = { ...(last.output ?? {}), waiver: { day: w.day, by: 'founder', reasons: [] } };
      const complete = !!p.content && !!p.salesPage && !!p.files.pdf && p.price > 0;
      p.status = p.launchedDay === null && !complete ? 'writing' : 'ready';
      if (complete || p.launchedDay !== null) createTask(w, { kind: 'publish_product', title: `Remettre en ligne — « ${short(p.title, 42)} »`, input: { productId: p.id, nicheId: p.nicheId, founderApproved: true, ...(p.launchedDay !== null ? { republish: true } : {}) }, createdBy: 'founder', missionId: m.id, priority: 1 });
      m.productId = p.id;
      tellFounder(ctx, ceo, m, complete ? `C'est reparti : « ${short(p.title, 60)} » retourne en ligne.` : `C'est reparti : la production de « ${short(p.title, 60)} » reprend au prochain stand-up.`);
      if (!complete) m.status = 'done';
      return;
    }
    case 'raise_budget': {
      const b = currentBudget(w);
      const committed = committedAdBudget(w);
      refuse(`Je ne monte pas le budget d'un ordre : l'enveloppe pub du jour est plafonnée par le CFO à ${eur(b.adCap)}, ${eur(committed)} sont déjà engagés, et une campagne monte de 30 % au plus quand ses chiffres suivent. Dis-moi si tu veux lancer une campagne de plus dans ce qui reste.`);
      return;
    }
  }
}
