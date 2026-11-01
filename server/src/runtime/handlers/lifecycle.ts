/**
 * What keeps a buyer: the guide offered for an address, the welcome sequence, the mail to the list, the kit at checkout
 * (scale §6.2, §6.3). Nothing here spends money. A reviewer has nothing to read: the market scores every mail itself, and
 * the mailing tool refuses a banned claim, whoever wrote it. In approval mode a draft waits in the task for the founder, so
 * he approves the text that goes out, not a new one.
 */
import type { EmailStep, Product, Task } from '../../shared.js';
import { nextId } from '../../core/index.js';
import { kitContent, kitOffer, kitSheets, renderSequenceHtml } from '../../deliverables/kit.js';
import { kitPrice } from '../../sim/growth.js';
import { angleDimension, angleRng, EMAIL_ANGLES, emailBlock, LAUNCH_ANGLE } from '../audience.js';
import type { RuntimeCtx } from '../ctx.js';
import { absPath, addDeliverable, nicheName, productOf, say, versionDir, vocOf, writeRunFile } from '../ctx.js';
import { deliverables, learning, sim } from '../modules.js';
import { productNote } from '../notes.js';
import { officerId } from '../org/officers.js';
import { directivesOf } from '../playbook.js';
import { createTask } from '../tasks.js';
import { mean, round2, short, str, uniq } from '../util.js';
import { refreshSalesPage } from './boutique.js';
import type { HandlerMap, HandlerOutcome } from './common.js';
import { NO_PRODUCT, requireProduct, studioMind } from './common.js';
import { ensureCoverFile, ensureDesign, writePreviews } from './creation.js';
import { COMPLIANCE_WORDS } from './phrases.js';

interface BroadcastDraft { subject: string; body: string; hasUnsubscribe: boolean; angle: string }

const quiet = (summary: string, output: Record<string, unknown> = {}): HandlerOutcome => ({ summary, skipReview: true, output: { skipped: true, ...output } });

/** What this writer may not say: the list follows the same rules as the ads. */
function bannedFor(ctx: RuntimeCtx, nicheId: string, agentId: string): string[] {
  return uniq([...vocOf(ctx, nicheId).bannedClaims, ...directivesOf(ctx.world, agentId).banned, ...COMPLIANCE_WORDS]);
}

const needsYes = (ctx: RuntimeCtx, task: Task): boolean => ctx.world.scenario.founderApproval && task.input.founderApproved !== true;

const scoreOf = (ctx: RuntimeCtx, subject: string, body: string, nicheId: string, banned: readonly string[]): number => sim.scoreEmail(subject, body, vocOf(ctx, nicheId), banned).score;

/** A product of its own, so the guide's price, its pricing evidence and its refunds keep their meaning. It wears the guide's art. */
function newKit(ctx: RuntimeCtx, parent: Product, content: NonNullable<Product['content']>): Product {
  const w = ctx.world;
  return {
    id: nextId(w, 'prd'), nicheId: parent.nicheId, kind: 'kit', title: content.title, subtitle: content.subtitle, audience: parent.audience, problem: parent.problem,
    price: kitPrice(parent.price), status: 'ready', version: 1, content, design: structuredClone(parent.design), salesPage: null, files: { pdf: null, cover: null, salesPage: null },
    quality: null, salesQuality: null, upsellProductId: null, createdDay: w.day, launchedDay: null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 }, priceHistory: [{ day: w.day, price: kitPrice(parent.price) }],
  };
}

export const lifecycleHandlers: HandlerMap = {
  write_lead_magnet: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      if (product.leadMagnet) return quiet(`« ${short(product.title, 50)} » a déjà son aimant.`);
      if (!product.content) return { fail: 'Impossible d’écrire l’aimant : le guide n’existe pas encore.', summary: 'Pas de contenu.' };
      const held = emailBlock(ctx.world, product);
      if (held) return quiet(`Pas d'aimant : ${held}.`);
      const rel = `${versionDir(product)}/aimant.pdf`;
      let title = str(task.input.magnetTitle);
      if (!title) {
        const content = await ctx.engine.writeLeadMagnet({ product, content: product.content, voc: vocOf(ctx, product.nicheId) }, studioMind(ctx, task, mind));
        const res = await deliverables.renderLeadMagnet({ product, content, design: ensureDesign(ctx, product), brand: ctx.world.company.name, outFile: absPath(ctx, rel) });
        addDeliverable(ctx, { kind: 'lead_magnet', title: `Aimant « ${short(content.title, 50)} » (${res.pages} pages)`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: null }, task);
        title = content.title;
      }
      if (needsYes(ctx, task)) {
        task.input.magnetTitle = title;
        return { summary: `Aimant prêt : en attente du fondateur.`, awaitFounder: `Offrir « ${short(title, 60)} » en échange d'une adresse, sur la page de « ${short(product.title, 40)} »` };
      }
      product.leadMagnet = { title, file: rel, day: ctx.world.day };
      await productNote(ctx, product, agent.id, 'Aimant à prospects', `- **${title}** : \`${rel}\`. La page de vente prend désormais les adresses.`);
      say(ctx, agent.id, `${agent.name} : « ${short(title, 60)} » est offert sur la page de « ${short(product.title, 40)} »`, 'deliverable', { productId: product.id });
      return { summary: `Aimant en place : ${short(title, 80)}.`, output: { path: rel, title } };
    },
  },

  write_email_sequence: {
    async run(ctx, task, agent, mind) {
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const held = emailBlock(ctx.world, product);
      if (held) return quiet(`Pas de séquence : ${held}.`);
      const banned = bannedFor(ctx, product.nicheId, agent.id);
      const draft = (task.input.draft as Omit<EmailStep, 'score'>[] | undefined) ?? await ctx.engine.writeEmailSequence({ product, voc: vocOf(ctx, product.nicheId), bannedClaims: banned }, studioMind(ctx, task, mind));
      const steps: EmailStep[] = draft.map((s) => ({ ...s, score: scoreOf(ctx, s.subject, s.body, product.nicheId, banned) }));
      const score = Math.round(mean(steps.map((s) => s.score)));
      if (needsYes(ctx, task)) {
        task.input.draft = draft;
        return { summary: `Séquence prête (${score}/100) : en attente du fondateur.`, awaitFounder: `Activer ${steps.length} e-mails de bienvenue sur « ${short(product.title, 50)} »` };
      }
      const res = ctx.tools.activateSequence({ nicheId: product.nicheId, productId: product.id, steps, createdBy: agent.id });
      if (!res.ok) return { fail: res.message, summary: res.message };
      const rel = `files/${product.id}/emails/sequence-${res.id}.html`;
      await writeRunFile(ctx, rel, renderSequenceHtml({ title: `Séquence de bienvenue, ${short(product.title, 60)}`, steps, brand: ctx.world.company.name }));
      addDeliverable(ctx, { kind: 'email_sequence', title: `Séquence de bienvenue « ${short(product.title, 50)} » (${steps.length} e-mails)`, productId: product.id, creativeId: null, path: rel, createdBy: agent.id, quality: score }, task);
      return { summary: `${res.message} Qualité ${score}/100.`, output: { sequenceId: res.id, path: rel, steps: steps.length, score } };
    },
  },

  send_broadcast: {
    async run(ctx, task, agent, mind) {
      const w = ctx.world;
      const product = requireProduct(ctx, task);
      if (!product) return NO_PRODUCT;
      const held = emailBlock(w, product);
      if (held) return quiet(`Pas d'e-mail : ${held}.`);
      const audience = task.input.audience === 'launch' ? 'launch' : 'niche';
      const banned = bannedFor(ctx, product.nicheId, agent.id);
      let draft = task.input.draft as BroadcastDraft | undefined;
      if (!draft) {
        const angle = audience === 'launch' ? LAUNCH_ANGLE : learning.chooseArm(w, angleDimension(product.nicheId), EMAIL_ANGLES, angleRng(w, product.nicheId));
        draft = { ...await ctx.engine.writeBroadcast({ product, voc: vocOf(ctx, product.nicheId), angle, audience, bannedClaims: banned }, studioMind(ctx, task, mind)), angle };
      }
      if (needsYes(ctx, task)) {
        task.input.draft = draft;
        return { summary: `E-mail prêt : en attente du fondateur.`, awaitFounder: `Envoyer « ${short(draft.subject, 60)} » à la liste de ${short(nicheName(ctx, product.nicheId), 40)}` };
      }
      const res = ctx.tools.sendBroadcast({ nicheId: product.nicheId, productId: product.id, audience, ...draft });
      // A week already full or a claim the tool refuses: nothing went out, and it costs the writer nothing but the mail.
      if (!res.ok) return quiet(res.message, { refused: true });
      say(ctx, agent.id, `${agent.name} écrit à la liste : « ${short(draft.subject, 60)} »`, 'deliverable', { productId: product.id });
      return { summary: res.message, skipReview: true, output: { broadcastId: res.id, angle: draft.angle, audience, score: scoreOf(ctx, draft.subject, draft.body, product.nicheId, banned) } };
    },
  },

  design_bump: {
    async run(ctx, task, agent) {
      const w = ctx.world;
      const parent = requireProduct(ctx, task);
      if (!parent) return NO_PRODUCT;
      const existing = productOf(ctx, parent.bumpProductId);
      if (existing && existing.status !== 'killed') return quiet(`Le kit « ${short(existing.title, 50)} » existe déjà.`, { bumpProductId: existing.id, existing: true });
      const content = kitContent(parent);
      if (!content || !parent.design) return quiet(`« ${short(parent.title, 50)} » n'a pas de fiche à imprimer.`, { noSheets: true });
      const kit = newKit(ctx, parent, content);
      const voc = vocOf(ctx, parent.nicheId);
      await ensureCoverFile(ctx, kit);
      const rel = `${versionDir(kit)}/kit.pdf`;
      const res = await deliverables.renderKit({ product: kit, content, design: kit.design!, brand: w.company.name, outFile: absPath(ctx, rel) });
      kit.files.pdf = rel;
      kit.files.previews = await writePreviews(ctx, kit, res.previews);
      kit.pdfFacts = { pages: res.pages, sheets: kitSheets(content).length };
      kit.quality = sim.scorePdf(content, { audience: kit.audience, problem: kit.problem, voc, design: kit.design });
      kit.salesPage = { ...kitOffer(kit, parent), priceWritten: kit.price };
      kit.salesQuality = sim.scoreSalesPage(kit.salesPage, kit, voc);
      kit.files.salesPage = `${versionDir(kit)}/sales-page.html`;
      await refreshSalesPage(ctx, kit);
      w.company.products.push(kit);
      parent.bumpProductId = kit.id;
      addDeliverable(ctx, { kind: 'pdf', title: `Kit « ${short(parent.title, 50)} » (${res.pages} pages)`, productId: kit.id, creativeId: null, path: rel, createdBy: agent.id, quality: kit.quality.overall }, task);
      await productNote(ctx, parent, agent.id, 'Kit à imprimer', `- **${kit.title}** à ${round2(kit.price)} € à la commande : ${res.pages} pages, \`${rel}\`.`);
      return { summary: `Kit prêt : ${res.pages} pages, ${round2(kit.price)} € à la commande.`, output: { bumpProductId: kit.id, path: rel, pages: res.pages, bytes: res.bytes, score: kit.quality.overall } };
    },
    /** Its guide was read before it: the kit goes straight to the shop's door, where the founder's own gate still stands. */
    async onDone(ctx, task) {
      const kit = productOf(ctx, task.output?.bumpProductId);
      if (!kit || kit.status === 'killed' || task.output?.existing === true) return;
      createTask(ctx.world, {
        kind: 'publish_product', title: `Mettre en ligne le kit — « ${short(kit.title, 42)} »`, input: { productId: kit.id, nicheId: kit.nicheId },
        createdBy: officerId(ctx.world, 'shop'), missionId: task.missionId, reviewer: null,
      });
    },
  },
};
