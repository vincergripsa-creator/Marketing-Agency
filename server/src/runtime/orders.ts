/**
 * The founder's orders, executed on the spot: a stop is a standing hold the plan and the handlers respect until he lifts
 * it, not a task that may or may not reach its goal. An order that cannot be carried out is said so, never closed as done.
 */
import type { Mission, Task } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { addHold, liftHolds } from './holds.js';
import { committedAdBudget, currentBudget } from './metrics.js';
import type { FounderOrder, OrderAction } from './missions.js';
import { tellFounder } from './missions.js';
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

function stopAds(ctx: RuntimeCtx, order: FounderOrder & { action: 'stop_ads' }, when: string): string {
  const { product } = order;
  const { paused, cancelled } = stopPaidAds(ctx, product?.id ?? null, `ordre du fondateur du jour ${ctx.world.day}`);
  addHold(ctx.world, { kind: 'ads', productId: product?.id ?? null, until: null, reason: `les pubs${product ? ` de « ${short(product.title, 50)} »` : ''} sont coupées sur ordre du fondateur (jour ${ctx.world.day})` });
  return `C'est fait${when} : ${paused} campagne(s) en pause, ${cancelled} tâche(s) de pub annulée(s). Aucune pub ne repartira${product ? ` sur « ${short(product.title, 50)} »` : ''} tant que tu ne me dis pas « reprends les pubs ».`;
}

export async function executeOrder(ctx: RuntimeCtx, m: Mission, order: FounderOrder): Promise<void> {
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
      const lifted = liftHolds(w, (h) => h.kind === 'ads' && (!order.product || h.productId === null || h.productId === order.product.id));
      const { resumed, left } = resumeCampaigns(ctx, 'founder', order.product?.id);
      done(`C'est reparti : ${lifted.length} blocage(s) levé(s), ${resumed.length} campagne(s) relancée(s)${left.length ? `, ${left.length} restée(s) en pause (produit, budget ou règles de la pub)` : ''}. Le plan de demain reprend les lancements.`);
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
