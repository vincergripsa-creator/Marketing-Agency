/**
 * Brain notes written by the runtime (Obsidian style): niches/, produits/, post-mortems/.
 * Link targets are file basenames without ".md".
 */
import type { AgentId, Product } from '../shared.js';
import type { RuntimeCtx } from './ctx.js';
import { addDeliverable, appendNote, nicheName, writeNote } from './ctx.js';
import { productMetrics, reviewCount } from './metrics.js';
import { dec, eur, pct, round2, slugify, uniq } from './util.js';

export function nicheSlug(ctx: RuntimeCtx, nicheId: string): string {
  return slugify(nicheName(ctx, nicheId));
}

export function productSlug(ctx: RuntimeCtx, product: Product): string {
  return slugify(`${nicheName(ctx, product.nicheId)} ${product.id}`);
}

export function productNotePath(ctx: RuntimeCtx, product: Product): string {
  return `produits/${productSlug(ctx, product)}.md`;
}

const bullets = (items: readonly string[], max = 8): string =>
  items.length ? items.slice(0, max).map((s) => `- ${s}`).join('\n') : '- _(rien de remonté pour l’instant)_';

/** Rewrites niches/<slug>.md with everything the research team knows about a niche. */
export async function writeNicheNote(ctx: RuntimeCtx, nicheId: string, agentId: AgentId): Promise<string> {
  const { research } = ctx.world.company;
  const slug = nicheSlug(ctx, nicheId);
  const path = `niches/${slug}.md`;
  const name = nicheName(ctx, nicheId);
  const signal = research.trends.find((t) => t.nicheId === nicheId);
  const voc = research.voc[nicheId];
  const comps = research.competitors[nicheId] ?? [];
  const lines: string[] = [`# ${name}`, ''];
  if (signal) {
    lines.push(
      `**Public** : ${signal.audience} · **Catégorie** : ${signal.category}`,
      `**Intérêt de recherche** : ${Math.round(signal.searchInterest)}/100 · **Buzz TikTok** : ${Math.round(signal.tiktokBuzz)}/100 · **Concurrence** : ${signal.competitionHint}`,
      '',
    );
    if (signal.sampleTitles.length) lines.push('## Titres qui circulent', bullets(signal.sampleTitles, 5), '');
  }
  if (voc) {
    lines.push(
      `## Voix du client (${voc.depth === 'deep' ? 'recherche approfondie' : 'recherche rapide'})`,
      '### Douleurs', bullets(voc.pains),
      '### Leurs mots exacts', bullets(voc.phrases.map((p) => `« ${p} »`)),
      '### Objections', bullets(voc.objections, 6),
      '### Résultat désiré', bullets(voc.desiredOutcomes, 6),
      '### Matière pour le PDF',
      bullets([...voc.knowledge.steps.slice(0, 3), ...voc.knowledge.tips.slice(0, 3), ...voc.knowledge.mistakes.slice(0, 2).map((m) => `Erreur fréquente : ${m}`)], 8),
      '',
      `**Ancres de prix citées** : ${voc.priceAnchors.length ? uniq(voc.priceAnchors.map((p) => eur(p))).join(', ') : 'aucune'}`,
      `**Allégations refusées par la plateforme** : ${voc.bannedClaims.length ? voc.bannedClaims.map((b) => `« ${b} »`).join(', ') : 'aucune connue'}`,
      '',
    );
  }
  if (comps.length) {
    lines.push('## Concurrents', '| Produit | Plateforme | Prix | Avis | Note | Faiblesses |', '|---|---|---|---|---|---|');
    for (const c of comps.slice(0, 8)) {
      lines.push(`| ${c.title} | ${c.platform} | ${eur(c.price)} | ${c.reviews} | ${dec(c.rating, 1)} | ${c.weaknesses.slice(0, 2).join(' ; ') || '—'} |`);
    }
    const totalReviews = comps.reduce((s, c) => s + c.reviews, 0);
    lines.push('', `Estimation : ${totalReviews} avis au total → demande prouvée${totalReviews > 400 ? ', mais marché disputé' : ''}.`, '');
  }
  lines.push('Liens : [[Règle du un]] · [[Prix]] · [[Playbook Recherche]] · [[tendances]]');
  await writeNote(ctx, agentId, { path, title: name, tags: ['niche', slugify(signal?.category ?? 'divers')], body: lines.join('\n') });
  return path;
}

/** Stable title of a product note (the product title itself changes once the 10 titles are written). */
export function productNoteTitle(ctx: RuntimeCtx, product: Product): string {
  const sameNiche = ctx.world.company.products.filter((p) => p.nicheId === product.nicheId);
  const rank = sameNiche.findIndex((p) => p.id === product.id);
  return `Fiche produit — ${nicheName(ctx, product.nicheId)}${rank > 0 ? ` (guide ${rank + 1})` : ''}`;
}

/** Creates the product note on first call, then appends a dated section. */
export async function productNote(ctx: RuntimeCtx, product: Product, agentId: AgentId, section: string, body: string): Promise<string> {
  const path = productNotePath(ctx, product);
  const niche = nicheSlug(ctx, product.nicheId);
  const title = productNoteTitle(ctx, product);
  const header = [
    `# ${title}`,
    '',
    `**Produit** : ${product.id} · **Niche** : [[${niche}]] · **Public** : ${product.audience} · **Problème** : ${product.problem}`,
    '',
    'Liens : [[Règle du un]] · [[Structure d\'un PDF qui vend]] · [[Page de vente]] · [[Prix]]',
    '',
  ].join('\n');
  const text = `\n## ${section} (jour ${ctx.world.day})\n${body}\n`;
  const exists = await ctx.brain.read(path).catch(() => null);
  if (exists) await appendNote(ctx, agentId, { path, title, tags: ['produit'], body: text }, { productId: product.id });
  else await writeNote(ctx, agentId, { path, title, tags: ['produit', niche], body: header + text }, { productId: product.id });
  return path;
}

/** post-mortems/<slug>.md for a killed product, with the numbers that killed it. */
export async function writePostMortem(ctx: RuntimeCtx, product: Product, reason: string, by: AgentId): Promise<string> {
  const m = productMetrics(ctx.world, product.id);
  const slug = productSlug(ctx, product);
  const path = `post-mortems/${slug}.md`;
  const daysLive = product.launchedDay ? ctx.world.day - product.launchedDay + 1 : 0;
  const roas = Number.isFinite(m.roas) ? dec(m.roas) : '∞';
  const body = [
    `# Post-mortem — ${product.title}`,
    '',
    `**Décision** : produit arrêté le jour ${ctx.world.day} par ${ctx.world.company.agents.find((a) => a.id === by)?.name ?? by}.`,
    `**Raison** : ${reason}`,
    '',
    '## Les chiffres',
    `| Indicateur | Valeur |`, `|---|---|`,
    `| Jours en ligne | ${daysLive} |`,
    `| Ventes | ${product.stats.sales} |`,
    `| Chiffre d'affaires net | ${eur(round2(product.stats.revenue - product.stats.refundAmount))} |`,
    `| Dépense pub | ${eur(m.spend)} |`,
    `| ROAS | ${roas} |`,
    `| CTR des pubs | ${pct(m.ctr, 2)} |`,
    `| Remboursements | ${product.stats.refunds} (${pct(product.stats.sales ? product.stats.refunds / product.stats.sales : 0)}) |`,
    `| Note moyenne | ${product.stats.rating ? dec(product.stats.rating, 1) : '—'} (${reviewCount(product)} avis) |`,
    `| Qualité PDF / page de vente | ${product.quality?.overall ?? '—'} / ${product.salesQuality?.overall ?? '—'} |`,
    '',
    '## Ce qu’on retient',
    `- Niche : [[${nicheSlug(ctx, product.nicheId)}]] — exclue des prochaines sélections.`,
    m.spend > 0 && m.ctr < 0.01 ? '- Les hooks n’ont pas accroché (CTR < 1 %) : le problème ne parle pas assez à ce public sur TikTok.' : '- Le trafic est arrivé, mais la page ou le prix n’a pas converti.',
    product.quality && product.quality.overall < 65 ? `- Le guide était trop faible (${product.quality.overall}/100) : ${product.quality.issues.slice(0, 2).join(' ; ') || 'à retravailler'}.` : '- La qualité du guide n’était pas le frein principal.',
    '',
    'Liens : [[Règle du un]] · [[Playbook Direction]] · [[Objectifs]]',
  ].join('\n');
  await writeNote(ctx, by, { path, title: `Post-mortem — ${product.title}`, tags: ['post-mortem', 'produit'], body }, { productId: product.id });
  addDeliverable(ctx, { kind: 'note', title: `Post-mortem « ${product.title} »`, productId: product.id, creativeId: null, path: `brain/${path}`, createdBy: by, quality: null });
  return path;
}
