/**
 * The founder's orders, executed on the spot: a stop is a standing hold the plan and the handlers respect until he lifts
 * it, not a task that may or may not reach its goal. An order that cannot be carried out is said so, never closed as done.
 */
import type { AgentState, ChannelId, Mission, Task } from '../shared.js';
import { CHANNELS } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { addHold, adsHold, firingHold, liftHolds } from './holds.js';
import { committedAdBudget, currentBudget } from './metrics.js';
import type { FounderOrder, OrderAction, PersonOrder } from './missions.js';
import { tellFounder } from './missions.js';
import { isLegacyOrg } from './org/constants.js';
import { requestDeparture } from './org/departure.js';
import { officerId } from './org/officers.js';
import { closeProductMissions, dropTask, killProduct, shelveProduct, stopPaidAds } from './pipeline.js';
import { redTeamGate } from './redteam.js';
import { resumeCampaigns } from './strategy.js';
import { createTask, openTasks, taskById } from './tasks.js';
import { eur, short } from './util.js';

const ASKED_FR: Partial<Record<OrderAction, string>> = {
  stop_ads: 'Je n’ai coupé aucune pub',
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

/** His latest word: a pin does not protect someone from the founder who set it. */
async function fireAgent(ctx: RuntimeCtx, agent: AgentState): Promise<{ text: string; left: boolean }> {
  const w = ctx.world;
  if (isLegacyOrg(w)) return { text: `Je ne peux pas : l'équipe de cette partie est fixe, ${agent.name} reste.`, left: false };
  const outcome = await requestDeparture(ctx, agent.id, `ordre du fondateur du jour ${w.day}`, 'founder', 'founder_order');
  if (outcome === 'refused') return { text: `Je ne peux pas renvoyer ${agent.name} : personne ne peut reprendre son poste.`, left: false };
  liftHolds(w, (h) => h.kind === 'pin' && h.agentId === agent.id);
  return { text: outcome === 'left' ? `C'est fait : ${agent.name} quitte l'agence.` : `C'est noté : ${agent.name} part dès que sa relève arrive, le recrutement est ouvert.`, left: true };
}

const channelNames = (order: { channels?: readonly ChannelId[] }): string => (order.channels ?? []).map((ch) => CHANNELS[ch].label).join(', ');

function stopAds(ctx: RuntimeCtx, order: FounderOrder & { action: 'stop_ads' }, when: string): string {
  const { product, channels } = order;
  const names = channelNames(order);
  let paused = 0, cancelled = 0;
  for (const channel of channels?.length ? channels : [null]) {
    const stopped = stopPaidAds(ctx, product?.id ?? null, `ordre du fondateur du jour ${ctx.world.day}`, channel);
    paused += stopped.paused;
    cancelled += stopped.cancelled;
    addHold(ctx.world, { kind: 'ads', productId: product?.id ?? null, until: null, ...(channel ? { channel } : {}), reason: `les pubs${channel ? ` ${CHANNELS[channel].label}` : ''}${product ? ` de « ${short(product.title, 50)} »` : ''} sont coupées sur ordre du fondateur (jour ${ctx.world.day})` });
  }
  return `C'est fait${when} : ${paused} campagne(s) en pause, ${cancelled} tâche(s) de pub annulée(s). Aucune pub ne repartira${names ? ` sur ${names}` : ''}${product ? ` sur « ${short(product.title, 50)} »` : ''} tant que tu ne me dis pas « reprends ${names || 'les pubs'} ».`;
}

/** « Reprends Meta » lifts what he said about Meta: an order on every channel still stands, and he is told so. */
function resumeAds(ctx: RuntimeCtx, order: FounderOrder & { action: 'resume_ads' }): { text: string; resumed: boolean } {
  const w = ctx.world;
  const { product, channels } = order;
  const lifted = liftHolds(w, (h) => h.kind === 'ads' && (!product || h.productId === null || h.productId === product.id) && (!channels || (!!h.channel && channels.includes(h.channel))));
  const stands = (channels ?? []).map((ch) => adsHold(w, product?.id ?? null, ch)).find(Boolean);
  if (stands) return { text: `Je n'ai rien relancé : ${stands.reason}. Dis « reprends les pubs » pour lever cet ordre.`, resumed: false };
  const { resumed, left } = resumeCampaigns(ctx, 'founder', product?.id, channels);
  return { text: `C'est reparti${channels ? ` sur ${channelNames(order)}` : ''} : ${lifted.length} blocage(s) levé(s), ${resumed.length} campagne(s) relancée(s)${left.length ? `, ${left.length} restée(s) en pause (produit, budget ou règles de la pub)` : ''}. Le plan de demain reprend les lancements.`, resumed: true };
}

/** Every order of one sentence on one mission: he reads each answer, and one refused order shows on it. */
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
    case 'no_agent':
      refuse(order.left ? `${order.left.name} a quitté l'agence le jour ${order.left.leftDay} : ${PERSON_FR[order.asked]}.` : `Personne ne s'appelle ${order.name} dans l'équipe : ${PERSON_FR[order.asked]}.`);
      return;
    case 'stop_firing':
      if (!firingHold(w)) addHold(w, { kind: 'firing', productId: null, until: null, reason: `aucun départ ni remplacement sur ordre du fondateur (jour ${w.day})` });
      done('C’est noté : personne ne part tant que tu ne me dis pas « tu peux virer ». Ni remplacement, ni licenciement, ni nouveau plan d’amélioration.');
      return;
    case 'allow_firing':
      done(liftHolds(w, (h) => h.kind === 'firing').length ? 'C’est noté : la ligue reprend ses remplacements à la prochaine clôture de saison.' : 'Rien à lever : aucun gel des départs n’était en cours.');
      return;
    case 'stop_hiring':
      liftHolds(w, (h) => h.kind === 'hiring'); // a refusal's cooldown ends by itself, his order does not
      addHold(w, { kind: 'hiring', productId: null, until: null, reason: `embauches gelées sur ordre du fondateur (jour ${w.day})` });
      done('C’est noté : plus aucune embauche tant que tu ne me dis pas « reprends les embauches ». Seule la relève d’un départ reste possible.');
      return;
    case 'resume_hiring':
      liftHolds(w, (h) => h.kind === 'hiring');
      done('C’est noté : les embauches reprennent, aux conditions habituelles du CFO.');
      return;
    case 'pin_agent': {
      const { agent } = order;
      liftHolds(w, (h) => h.kind === 'pin' && h.agentId === agent.id); // a refused swap pins for 14 days, his order does not end
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
      const text = stopAds(ctx, { action: 'stop_ads', product: null }, ' pour la pub');
      addHold(w, { kind: 'advances', productId: null, until: null, reason: `plus aucune avance aux créateurs sur ordre du fondateur (jour ${w.day})` });
      done(`${text} Plus aucune avance aux créateurs non plus. Restent les frais fixes de la boutique et des outils : je ne peux pas les couper sans fermer la boutique.`);
      return;
    }
    case 'stop_launches': {
      addHold(w, { kind: 'launches', productId: null, until: null, reason: `plus de nouveau guide sur ordre du fondateur (jour ${w.day})` });
      const open = openTasks(w, (t: Task) => (t.kind === 'pick_opportunity' && !t.input.nicheId) || t.kind === 'design_upsell');
      for (const t of open) dropTask(ctx, t, `ordre du fondateur du jour ${w.day}`);
      const inWork = w.company.products.filter((p) => !['live', 'killed', 'paused'].includes(p.status));
      done(`C'est noté : aucun nouveau guide ne démarre tant que tu ne me dis pas « reprends les lancements ».${inWork.length ? ` Déjà en production, je le termine sauf contre-ordre : ${inWork.map((p) => `« ${short(p.title, 50)} »`).join(', ')}.` : ''}`);
      return;
    }
    case 'pause_product': {
      const p = order.product!;
      const cancelled = shelveProduct(ctx, p, `le fondateur l'a retiré le jour ${w.day}`);
      done(`C'est fait : « ${short(p.title, 60)} » n'est plus en vente ni en production (${cancelled} tâche(s) annulée(s)). Dis « remets le guide en ligne » pour le reprendre.`);
      return;
    }
    case 'kill_product': {
      const p = order.product!;
      closeProductMissions(ctx, p, `le fondateur l'a arrêté le jour ${w.day}`);
      await killProduct(ctx, p, `décision du fondateur du jour ${w.day}`);
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
      resumeCampaigns(ctx, 'founder');
      done(`C'est noté : ${lifted.length} ordre(s) levé(s).`);
      return;
    }
    case 'resume_product': {
      const p = order.product!;
      liftHolds(w, (h) => h.productId === p.id);
      // His word stands for the Red Team's: a guide held at its gate ships on his signature.
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
