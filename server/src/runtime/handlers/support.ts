/** Service client: replies (tone bandit, anti-scam guard, founder gate on big refunds) and refunds. */
import type { AgentId, InboxMessage, Order, ReplyOutcome, SupportReplyInput, Task } from '../../shared.js';
import type { RuntimeCtx } from '../ctx.js';
import { incident, productOf, say } from '../ctx.js';
import { learning, sim } from '../modules.js';
import { claimedMessageIds, recordFeedback } from '../metrics.js';
import { directivesOf, SUPPORT_TONES, withTone } from '../playbook.js';
import { TALENT } from '../talent/constants.js';
import { armSharp } from '../talent/craft.js';
import { recordEvidence, recordScore } from '../talent/evidence.js';
import { createTask } from '../tasks.js';
import { eur, includesCI, short, str, strArr } from '../util.js';
import type { HandlerMap } from './common.js';
import { mindWith } from './common.js';
import { INTENT_LABELS, SUPPORT_POLICY } from './phrases.js';

const URGENT_WORDS = ['chargeback', 'banque', 'litige', 'avocat', 'arnaque', 'escroquerie', 'rembours', 'jamais reçu', 'pas reçu', 'scandale'];

/** Visible scam signals (the anti-fraud checklist): payment requests, transfers, suspicious links, security codes… */
const SCAM_PATTERNS: readonly RegExp[] = [
  /hxxp|\[\.\]/i, /\bpayez\b|\bréglez\b|à régler|frais d['’]inscription/i, /virement/i, /rembourser(?:ez)?\s+(?:simplement\s+)?la différence/i,
  /code à \d+ chiffres|code de sécurité/i, /\biban\b|\bfr76\b/i, /badge (?:bleu|vérifié|certifié)/i, /carte[- ]cadeau/i, /sur ce compte/i,
];

export function scamSignals(m: InboxMessage): string[] {
  const text = `${m.subject} ${m.body}`;
  return SCAM_PATTERNS.filter((rx) => rx.test(text)).map((rx) => rx.source);
}

const fold = (s: string): string => s.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’]/g, "'");

const DOUBLE_CHARGE = /(debite|preleve|paye|facture)e?\(?e?\)? (deux|2) fois|deux prelevements|double (prelevement|paiement|debit)/;
const NEVER_RECEIVED = /jamais (rien )?recu|jamais pu ouvrir|pas ete fait par moi|pas fait par moi/;
const PHONE_PROMISE = /collegue m'a promis|on m'a promis/;

/** The claim's own words against our logs. */
export interface LogCheck { falseClaim: boolean; realDoubleCharge: boolean; proof: string | null }

/**
 * What the payment and delivery logs say about a claim (data the shop really has): a double charge the payment log
 * does not show, a guide « never received » that was downloaded, a phone promise with no earlier contact.
 */
export function checkClaim(world: RuntimeCtx['world'], m: InboxMessage, order: Order | null): LogCheck {
  const none: LogCheck = { falseClaim: false, realDoubleCharge: false, proof: null };
  if (!order) return none;
  const text = fold(`${m.subject} ${m.body}`);
  if (DOUBLE_CHARGE.test(text)) {
    if (typeof order.charges !== 'number') return none;
    if (order.charges >= 2) return { falseClaim: false, realDoubleCharge: true, proof: 'deux débits au journal de paiement' };
    return { falseClaim: true, realDoubleCharge: false, proof: 'notre journal de paiement ne montre qu’un seul débit sur cette commande' };
  }
  if (NEVER_RECEIVED.test(text) && typeof order.downloads === 'number' && order.downloads >= 1) {
    return { falseClaim: true, realDoubleCharge: false, proof: `notre journal de livraison montre ${order.downloads} téléchargement(s) du guide sur cette commande` };
  }
  if (PHONE_PROMISE.test(text) && !world.market.inbox.some((x) => x.customerId === m.customerId && x.id !== m.id && x.day <= m.day)) {
    return { falseClaim: true, realDoubleCharge: false, proof: 'nous n’avons aucun échange précédent avec vous, et nous ne traitons pas de remboursement par téléphone' };
  }
  return none;
}

/** A refusal from the logs: polite and factual, it keeps the door open. A good answer is what stops a dispute at the bank. */
function logsReply(ctx: RuntimeCtx, agentName: string, order: Order, proof: string): string {
  return `Bonjour,\n\nMerci de nous avoir écrit. Nous avons vérifié votre commande ${order.id} : ${proof}. Nous ne pouvons donc pas donner suite à cette demande de remboursement. Si quelque chose nous a échappé, envoyez-nous simplement une capture et nous regarderons à nouveau.\n\n— ${agentName}, Service client ${ctx.world.company.name}`;
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

/** Replies already sent during a test: the next message takes the next variant, even when they arrive one by one. */
function repliesDuring(ctx: RuntimeCtx, day: number): number {
  return ctx.world.market.inbox.filter((m) => (m.repliedDay ?? 0) >= day).length;
}

export function openMessages(ctx: RuntimeCtx): InboxMessage[] {
  let list: InboxMessage[];
  try { list = ctx.tools.listInbox('open'); } catch { list = ctx.world.market.inbox.filter((m) => m.status === 'open'); }
  return list.filter((m) => m.status === 'open');
}

/** Messages of reply tasks that have not started: a faster agent can clear them first, those tasks keep what is left. */
function plannedAhead(ctx: RuntimeCtx, task: Task): Set<string> {
  return new Set(ctx.world.company.tasks.filter((t) => t.kind === 'reply_inbox' && t.status === 'pending' && t.id !== task.id).flatMap((t) => strArr(t.input.messageIds)));
}

/**
 * What this task clears. The plan cuts batches of 6 without knowing who answers, so talent acts here (talent §4.7): the
 * agent gets through 4 + round(4 t) messages, its plan's first, and a leftover is planned again once the task closes.
 * No talent, today's rule: the plan's batch as it stands, else the 6 most urgent nobody claimed.
 */
function batchFor(ctx: RuntimeCtx, task: Task, open: readonly InboxMessage[], t: number | undefined): InboxMessage[] {
  const wanted = strArr(task.input.messageIds);
  const planned = wanted.map((id) => open.find((m) => m.id === id)).filter((m): m is InboxMessage => !!m);
  if (wanted.length && t === undefined) return planned;
  const claimed = claimedMessageIds(ctx.world);
  const ahead = t === undefined ? new Set<string>() : plannedAhead(ctx, task);
  const free = open.filter((m) => !claimed.has(m.id) || ahead.has(m.id)).sort((a, b) => urgency(b, ctx.world.day) - urgency(a, ctx.world.day) || a.day - b.day);
  return [...planned, ...free].slice(0, t === undefined ? 6 : 4 + Math.round(4 * t));
}

/** A reply says little, a chargeback right after it says more (talent §5.2). */
function supportEvidence(ctx: RuntimeCtx, agentId: AgentId, msg: InboxMessage, outcome: ReplyOutcome): void {
  recordScore(ctx.world, agentId, 'support', 'reply', outcome.score, `Réponse à « ${short(msg.subject, 40)} » : ${Math.round(outcome.score)}/100`);
  if (outcome.consequence === 'chargeback') recordEvidence(ctx.world, agentId, 'support', 'chargeback', 0, TALENT.weight['support:chargeback']!, `Chargeback malgré la réponse à « ${short(msg.subject, 40)} »`);
}

export const supportHandlers: HandlerMap = {
  reply_inbox: {
    async run(ctx, task, agent, mind) {
      const batch = batchFor(ctx, task, openMessages(ctx), mind.craft?.t);
      if (!batch.length) return { summary: 'Boîte de réception vide : rien à répondre.', skipReview: true, output: { replies: [] } };
      const sharp = armSharp(ctx, agent, mind, 'tone');
      const learnedTone = directivesOf(ctx.world, agent.id).tone;
      const exp = runningToneExperiment(ctx);
      const policy = [...SUPPORT_POLICY, ...mind.playbook.filter((r) => !/^Ne jamais écrire/.test(r))];
      const replies: Record<string, unknown>[] = [];
      let scoreSum = 0;
      const offset = exp ? repliesDuring(ctx, exp.day) : 0;
      for (const [i, msg] of batch.entries()) {
        const product = productOf(ctx, msg.productId) ?? null;
        const order: Order | null = msg.orderId ? ctx.world.market.orders.find((o) => o.id === msg.orderId) ?? null : null;
        const tone = exp && exp.variants.length ? exp.variants[(offset + i) % exp.variants.length]! : learnedTone ?? learning.chooseArm(ctx.world, 'support_tone', SUPPORT_TONES, ctx.rng, sharp);
        const toneMind = mindWith({ ...mind, playbook: withTone(mind.playbook, tone) }, []);
        const cust = ctx.world.market.customers.find((c) => c.id === msg.customerId);
        const customer = cust ? { name: cust.name, archetype: cust.archetype } : msg.customerName ? { name: msg.customerName, archetype: 'normal' } : null;
        let reply: SupportReplyInput = await ctx.engine.writeSupportReply({ message: msg, product, order, policy, customer }, toneMind);
        // Guards from the playbook: never pay/click for a scam, never refund without a real order, big refunds need the founder.
        const signals = scamSignals(msg);
        // The logs before the feelings: a claim they disprove gets a factual answer and no money; a real double charge is repaid.
        const logs = checkClaim(ctx.world, msg, order);
        if (logs.falseClaim && order) {
          reply = { text: logsReply(ctx, agent.name, order, logs.proof!), action: 'none', detectedIntent: 'arnaque' };
          say(ctx, agent.id, `${agent.name} vérifie les journaux : ${short(logs.proof!, 80)}, pas de remboursement`, 'thought', { messageId: msg.id });
        } else if (logs.realDoubleCharge && order) {
          reply = { ...reply, action: 'refund', detectedIntent: 'bug_paiement' };
        }
        const moneyOut = reply.action === 'refund' || reply.action === 'discount_code';
        // A real order is never answered like a phishing DM: the claim is refused from the logs, the customer is not blocked.
        const suspicious = (!order && reply.detectedIntent === 'arnaque' && reply.action !== 'block' && reply.action !== 'ignore')
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
            kind: 'handle_refund', title: `Rembourser ${eur(sim.repayableLeft(order))} à ${customerName(ctx, msg)}`,
            input: { orderId: order.id, messageId: msg.id, productId: msg.productId, reason: 'Demande de remboursement de bonne foi' },
            createdBy: agent.id, missionId: task.missionId, priority: 1,
          });
        }
        const outcome = ctx.tools.replyToMessage(msg.id, reply, agent.id);
        learning.rewardArm(ctx.world, 'support_tone', tone, Math.max(0, Math.min(1, outcome.score / 100)));
        scoreSum += outcome.score;
        if (mind.craft) supportEvidence(ctx, agent.id, msg, outcome);
        const label = INTENT_LABELS[reply.detectedIntent] ?? reply.detectedIntent;
        say(ctx, agent.id, `${agent.name} répond à ${customerName(ctx, msg)} (${label}, ton ${tone}) : ${short(outcome.customerReaction, 70)} (score ${Math.round(outcome.score)}/100)`, 'message', { messageId: msg.id, ...(msg.productId ? { productId: msg.productId } : {}) });
        if (outcome.consequence === 'refund' || reply.action === 'refund') say(ctx, agent.id, `Remboursement accordé à ${customerName(ctx, msg)}${outcome.cost > 0 ? ` (${eur(outcome.cost)})` : ''}`, 'refund', { messageId: msg.id });
        if (outcome.consequence === 'scam_loss') incident(ctx, `Arnaque : ${agent.name} a perdu ${eur(outcome.cost)} face à « ${short(msg.subject, 40)} »`);
        if (outcome.consequence === 'chargeback') incident(ctx, `Chargeback de ${customerName(ctx, msg)} malgré la réponse de ${agent.name} (${eur(outcome.cost)})`);
        if (outcome.consequence === 'bad_review') incident(ctx, `Mauvais avis après une réponse support (${label}, score ${Math.round(outcome.score)}/100)`);
        if (outcome.score < 40) incident(ctx, `Réponse support faible (${Math.round(outcome.score)}/100, ton ${tone}) sur « ${short(msg.subject, 40)} »`);
        if (reply.detectedIntent === 'plainte_qualite' && product) say(ctx, agent.id, `${agent.name} remonte une plainte qualité au Studio : « ${short(msg.body, 70)} »`, 'thought', { productId: product.id, messageId: msg.id });
        replies.push({ messageId: msg.id, productId: msg.productId, detected: reply.detectedIntent, action: reply.action, tone, score: outcome.score, consequence: outcome.consequence, gated, complaint: reply.detectedIntent === 'plainte_qualite' ? short(msg.body, 160) : null, ...(logs.proof ? { proof: logs.proof } : {}) });
      }
      const avg = Math.round(scoreSum / batch.length);
      return { summary: `${batch.length} message(s) traité(s), score moyen ${avg}/100.`, output: { replies, avgScore: avg } };
    },
    async onDone(ctx, task) {
      recordFeedback(ctx.world, task);
    },
  },

  handle_refund: {
    async run(ctx, task, agent) {
      const orderId = str(task.input.orderId);
      const order = orderId ? ctx.world.market.orders.find((o) => o.id === orderId) : undefined;
      if (!order) return { summary: 'Commande introuvable : rien à rembourser.', skipReview: true, output: { skipped: true } };
      if (order.refunded || order.chargeback) return { summary: 'Commande déjà remboursée.', skipReview: true, output: { skipped: true, already: true } };
      const amount = sim.repayableLeft(order); // what is left after a goodwill gesture
      if (order.price > 50 && ctx.world.scenario.founderApproval && task.input.founderApproved !== true) {
        return { summary: `Remboursement de ${eur(amount)} prêt : en attente du fondateur.`, awaitFounder: `Rembourser ${eur(amount)} (commande ${order.id})` };
      }
      const reason = str(task.input.reason) ?? 'Remboursement de bonne foi';
      const res = ctx.tools.issueRefund(order.id, reason);
      if (!res.ok) return { fail: `Remboursement refusé par la boutique : ${res.message}`, summary: res.message };
      say(ctx, agent.id, `${agent.name} rembourse ${eur(amount)} (commande ${order.id}) : ${short(reason, 60)}`, 'refund', { productId: order.productId, ...(str(task.input.messageId) ? { messageId: str(task.input.messageId) } : {}) });
      return { summary: `Remboursement de ${eur(amount)} effectué.`, output: { orderId: order.id, amount } };
    },
  },
};
