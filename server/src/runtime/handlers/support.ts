/** Service client: replies (tone bandit, anti-scam guard, founder gate on big refunds) and refunds. */
import type { InboxMessage, Order, SupportReplyInput } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { incident, productOf, say } from '../ctx.js';
import { learning } from '../modules.js';
import { claimedMessageIds } from '../metrics.js';
import { directivesOf, SUPPORT_TONES, withTone } from '../playbook.js';
import { createTask } from '../tasks.js';
import { eur, includesCI, short, str, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { mindWith } from './common.js';
import { INTENT_LABELS, SUPPORT_POLICY } from './phrases.js';

const URGENT_WORDS = ['chargeback', 'banque', 'litige', 'avocat', 'arnaque', 'escroquerie', 'rembours', 'jamais reçu', 'pas reçu', 'scandale'];

/** Visible scam signals (Fatou's checklist): payment requests, transfers, suspicious links, security codes… */
const SCAM_PATTERNS: readonly RegExp[] = [
  /hxxp|\[\.\]/i, /\bpayez\b|\bréglez\b|à régler|frais d['’]inscription/i, /virement/i, /rembourser(?:ez)?\s+(?:simplement\s+)?la différence/i,
  /code à \d+ chiffres|code de sécurité/i, /\biban\b|\bfr76\b/i, /badge (?:bleu|vérifié|certifié)/i, /carte[- ]cadeau/i, /sur ce compte/i,
];

export function scamSignals(m: InboxMessage): string[] {
  const text = `${m.subject} ${m.body}`;
  return SCAM_PATTERNS.filter((rx) => rx.test(text)).map((rx) => rx.source);
}

/** Urgency from what the agent can SEE (deadline, mood, channel, words) — never the hidden intent. */
export function urgency(m: InboxMessage, day: number): number {
  let u = 0;
  u += Math.max(0, 3 - (m.deadlineDay - day)) * 2;
  u += m.mood < -0.5 ? 3 : m.mood < 0 ? 1 : 0;
  if (m.channel === 'avis') u += 2;
  if (URGENT_WORDS.some((w) => includesCI(`${m.subject} ${m.body}`, w))) u += 2;
  return u;
}

function customerName(ctx: RuntimeCtx, m: InboxMessage): string {
  return ctx.world.market.customers.find((c) => c.id === m.customerId)?.name ?? 'un client';
}

function runningToneExperiment(ctx: RuntimeCtx) {
  return ctx.world.company.experiments.find((e) => e.status === 'running' && e.dimension === 'support_tone') ?? null;
}

export function openMessages(ctx: RuntimeCtx): InboxMessage[] {
  let list: InboxMessage[];
  try { list = ctx.tools.listInbox('open'); } catch { list = ctx.world.market.inbox.filter((m) => m.status === 'open'); }
  return list.filter((m) => m.status === 'open');
}

export const supportHandlers: HandlerMap = {
  reply_inbox: {
    async run(ctx, task, agent, mind) {
      const open = openMessages(ctx);
      const wanted = strArr(task.input.messageIds);
      let batch: InboxMessage[];
      if (wanted.length) batch = wanted.map((id) => open.find((m) => m.id === id)).filter((m): m is InboxMessage => !!m);
      else {
        const claimed = claimedMessageIds(ctx.world);
        batch = open.filter((m) => !claimed.has(m.id)).sort((a, b) => urgency(b, ctx.world.day) - urgency(a, ctx.world.day) || a.day - b.day).slice(0, 6);
      }
      if (!batch.length) return { summary: 'Boîte de réception vide : rien à répondre.', skipReview: true, output: { replies: [] } };
      const learnedTone = directivesOf(ctx.world, agent.id).tone;
      const exp = runningToneExperiment(ctx);
      const policy = [...SUPPORT_POLICY, ...mind.playbook.filter((r) => !/^Ne jamais écrire/.test(r))];
      const replies: Record<string, unknown>[] = [];
      let scoreSum = 0;
      for (const [i, msg] of batch.entries()) {
        const product = productOf(ctx, msg.productId) ?? null;
        const order: Order | null = msg.orderId ? ctx.world.market.orders.find((o) => o.id === msg.orderId) ?? null : null;
        const tone = exp && exp.variants.length ? exp.variants[i % exp.variants.length]! : learnedTone ?? learning.chooseArm(ctx.world, 'support_tone', SUPPORT_TONES, ctx.rng);
        const toneMind = mindWith({ ...mind, playbook: withTone(mind.playbook, tone) }, []);
        let reply: SupportReplyInput = await ctx.engine.writeSupportReply({ message: msg, product, order, policy }, toneMind);
        // Guards from the playbook: never pay/click for a scam, never refund without a real order, big refunds need the founder.
        const signals = scamSignals(msg);
        const moneyOut = reply.action === 'refund' || reply.action === 'discount_code';
        const suspicious = (reply.detectedIntent === 'arnaque' && reply.action !== 'block' && reply.action !== 'ignore')
          || (moneyOut && (!order || (signals.length >= 2 && order.refunded)))
          || (!order && signals.length >= 2 && reply.action !== 'block' && reply.action !== 'ignore');
        if (suspicious) {
          const caught = reply.detectedIntent !== 'arnaque';
          reply = {
            text: `Bonjour,\n\nNous ne donnons pas suite à cette demande. Bonne journée.\n\n— ${agent.name}, Service client ${ctx.world.company.name}`,
            action: 'block', detectedIntent: 'arnaque',
          };
          if (caught) say(ctx, agent.id, `${agent.name} bloque une demande suspecte : « ${short(msg.subject, 50)} » (aucune commande réelle${signals.length ? ', signaux d’arnaque' : ''})`, 'thought', { messageId: msg.id });
        }
        let gated = false;
        if (reply.action === 'refund' && order && order.price > 50 && ctx.world.scenario.founderApproval) {
          reply = { ...reply, action: 'escalate' };
          gated = true;
          createTask(ctx.world, {
            kind: 'handle_refund', title: `Rembourser ${eur(order.price)} à ${customerName(ctx, msg)}`,
            input: { orderId: order.id, messageId: msg.id, productId: msg.productId, reason: 'Demande de remboursement de bonne foi' },
            createdBy: agent.id, missionId: task.missionId, priority: 1,
          });
        }
        const outcome = ctx.tools.replyToMessage(msg.id, reply, agent.id);
        learning.rewardArm(ctx.world, 'support_tone', tone, Math.max(0, Math.min(1, outcome.score / 100)));
        scoreSum += outcome.score;
        const label = INTENT_LABELS[reply.detectedIntent] ?? reply.detectedIntent;
        say(ctx, agent.id, `${agent.name} répond à ${customerName(ctx, msg)} (${label}, ton ${tone}) : ${short(outcome.customerReaction, 70)} (score ${Math.round(outcome.score)}/100)`, 'message', { messageId: msg.id, ...(msg.productId ? { productId: msg.productId } : {}) });
        if (outcome.consequence === 'refund' || reply.action === 'refund') say(ctx, agent.id, `Remboursement accordé à ${customerName(ctx, msg)}${order ? ` (${eur(order.price)})` : ''}`, 'refund', { messageId: msg.id });
        if (outcome.consequence === 'scam_loss') incident(ctx, `Arnaque : ${agent.name} a perdu ${eur(outcome.cost)} face à « ${short(msg.subject, 40)} »`);
        if (outcome.consequence === 'chargeback') incident(ctx, `Chargeback de ${customerName(ctx, msg)} malgré la réponse de ${agent.name} (${eur(outcome.cost)})`);
        if (outcome.consequence === 'bad_review') incident(ctx, `Mauvais avis après une réponse support (${label}, score ${Math.round(outcome.score)}/100)`);
        if (outcome.score < 40) incident(ctx, `Réponse support faible (${Math.round(outcome.score)}/100, ton ${tone}) sur « ${short(msg.subject, 40)} »`);
        if (reply.detectedIntent === 'plainte_qualite' && product) say(ctx, agent.id, `${agent.name} remonte une plainte qualité au Studio : « ${short(msg.body, 70)} »`, 'thought', { productId: product.id, messageId: msg.id });
        replies.push({ messageId: msg.id, productId: msg.productId, detected: reply.detectedIntent, action: reply.action, tone, score: outcome.score, consequence: outcome.consequence, gated, complaint: reply.detectedIntent === 'plainte_qualite' ? short(msg.body, 160) : null });
      }
      const avg = Math.round(scoreSum / batch.length);
      return { summary: `${batch.length} message(s) traité(s), score moyen ${avg}/100.`, output: { replies, avgScore: avg } };
    },
  },

  handle_refund: {
    async run(ctx, task, agent) {
      const orderId = str(task.input.orderId);
      const order = orderId ? ctx.world.market.orders.find((o) => o.id === orderId) : undefined;
      if (!order) return { summary: 'Commande introuvable : rien à rembourser.', skipReview: true, output: { skipped: true } };
      if (order.refunded || order.chargeback) return { summary: 'Commande déjà remboursée.', skipReview: true, output: { skipped: true, already: true } };
      if (order.price > 50 && ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: `Remboursement de ${eur(order.price)} prêt : en attente du fondateur.`, awaitFounder: `Rembourser ${eur(order.price)} (commande ${order.id})` };
      }
      const reason = str(task.input.reason) ?? 'Remboursement de bonne foi';
      const res = ctx.tools.issueRefund(order.id, reason);
      if (!res.ok) return { fail: `Remboursement refusé par la boutique : ${res.message}`, summary: res.message };
      say(ctx, agent.id, `${agent.name} rembourse ${eur(order.price)} (commande ${order.id}) : ${short(reason, 60)}`, 'refund', { productId: order.productId, ...(str(task.input.messageId) ? { messageId: str(task.input.messageId) } : {}) });
      return { summary: `Remboursement de ${eur(order.price)} effectué.`, output: { orderId: order.id, amount: order.price } };
    },
  },
};
