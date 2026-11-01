import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentState, InboxMessage, NicheBrief, Order, PdfContent, Product, QualityReport, VoiceOfCustomer } from '../src/shared.js';
import type { MindContext, UsageEvent } from '../src/contracts.js';
import { createContentEngine, upsellTopics, type ClaudeClientLike } from '../src/minds/index.js';
import { findCliches } from '../src/minds/heuristic/editing.js';
import { isCliche } from '../src/minds/lexicon.js';
import { allText, bare, clauseLabel, endsDangling, labelOf, lf, norm, seededRng, splitSentences } from '../src/minds/util.js';
import { parsePlaybook, scrubText } from '../src/minds/playbook.js';
import { HeuristicEngine } from '../src/minds/heuristic/index.js';
import { parsePlaybook as runtimeDirectives } from '../src/runtime/playbook.js';
import { createRng } from '../src/core/index.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { createMarketTools, scorePdf } from '../src/sim/index.js';
import { genericPhraseHits, pdfText } from '../src/sim/quality.js';
import { norm as simNorm } from '../src/sim/text.js';
import { designFor } from '../src/deliverables/index.js';
import { catalogNiche, NICHE_CATALOG } from '../src/sim/niches.js';
import { parseKnowledge, parseMistake, parseStep } from '../src/minds/heuristic/knowledge.js';
import { archetypeOf, classifyArchetype, PROFILED_NICHES } from '../src/minds/heuristic/profiles.js';
import { buildNicheCtx } from '../src/minds/heuristic/niche.js';
import { heuristicPdfContent, nextStepFor, promiseOutcome, standAlone } from '../src/minds/heuristic/studio.js';
import { speakable } from '../src/minds/heuristic/voice.js';
import { ensureVisual } from '../src/minds/shapes.js';
import { nAd, nPdf } from '../src/minds/claude/normalize.js';
import { noPrice, screenText } from '../src/minds/heuristic/ads.js';
import type { UpsellContext } from '../src/contracts.js';
import { LEGACY } from './legacy.js';

// ───────────────────────────── fixtures ─────────────────────────────

function agent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 'ag_studio_1', name: 'Margaux', role: 'Rédactrice en chef', dept: 'studio', isChief: true, tier: 'sonnet',
    persona: 'Exigeante et chaleureuse, elle traque les phrases creuses.', skills: ['Rédaction', 'Structure', 'Humanisation'],
    tools: ['brain.read', 'brain.write', 'pdf.render'], taskKinds: ['write_pdf', 'humanize_pdf'],
    avatar: { skin: '#f1c27d', hair: '#3b2a1a', shirt: '#7c5cff', pants: '#333', hairStyle: 1, accessory: 'glasses' },
    status: 'idle', place: 'studio', currentTaskId: null, energy: 90, level: 2, xp: 120,
    perf: { done: 4, approved: 3, rejected: 1, failed: 0, score: 72 }, bubble: null,
    roleId: 'editor_in_chief', gender: 'f', founder: false, hatKinds: [], hatDepts: [], hiredDay: 0, rampUntilDay: 0, notice: null,
    ...over,
  };
}

function ctx(over: Partial<MindContext> = {}, agentOver: Partial<AgentState> = {}): MindContext {
  return { agent: agent(agentOver), playbook: [], brainNotes: [], lessons: [], day: 3, ...over };
}

const NICHE: NicheBrief = {
  nicheId: 'sommeil-bebe', name: 'Sommeil de bébé', audience: 'Parents épuisés de bébés de 6 à 12 mois',
  problem: 'Bébé se réveille toutes les 2 heures la nuit', category: 'parentalité', keywords: ['sommeil bébé', 'nuits', 'réveils nocturnes'],
};

const VOC: VoiceOfCustomer = {
  nicheId: 'sommeil-bebe',
  depth: 'deep',
  pains: [
    'Bébé se réveille toutes les 2 heures la nuit',
    'Je suis épuisée, je n’ai pas dormi plus de 3 h d’affilée depuis des mois',
    'Il ne s’endort que dans les bras ou au sein',
    'Les siestes sont trop courtes (30 minutes maximum)',
    'Je culpabilise de le laisser pleurer',
  ],
  phrases: [
    'il se réveille toutes les 2h',
    'je n’en peux plus',
    'on a tout essayé',
    'il ne s’endort qu’au sein',
    'je veux une méthode douce, sans le laisser pleurer',
    'mon conjoint dort dans le salon',
  ],
  objections: ['Encore un PDF écrit par ChatGPT ?', 'Je n’ai pas le temps de lire 50 pages', 'On a déjà tout essayé', 'Je refuse de le laisser pleurer'],
  desiredOutcomes: ['Bébé fait des nuits de 6 h d’affilée', 'S’endormir seul sans pleurs', 'Retrouver des soirées à deux'],
  knowledge: {
    tips: ['Coucher bébé somnolent mais éveillé', 'Garder la chambre entre 18 et 20 °C', 'Exposer bébé à la lumière du jour le matin', 'Garder le même rituel chez les grands-parents'],
    steps: [
      'Tenir un carnet de sommeil pendant 3 jours',
      'Installer un rituel du coucher de 20 minutes, toujours dans le même ordre',
      'Avancer l’heure du coucher de 15 minutes',
      'Espacer progressivement les interventions la nuit',
      'Remplacer la tétée d’endormissement par un câlin',
    ],
    mistakes: ['Coucher bébé trop tard en pensant qu’il dormira mieux', 'Changer de méthode tous les deux jours', 'Allumer la lumière pendant les réveils nocturnes'],
    examples: [
      'Camille, maman de Léo (8 mois), est passée de 5 réveils à 1 seul en trois semaines en espaçant ses interventions.',
      'Karim et Sophie ont retrouvé leurs soirées en avançant le coucher de 19 h 45 à 19 h 15.',
    ],
    facts: [
      'Entre 6 et 12 mois, un bébé a besoin de 12 à 15 h de sommeil par 24 h',
      'Les réveils nocturnes sont normaux jusqu’à 1 an : la clé est le réendormissement autonome',
      'Un bébé trop fatigué s’endort plus difficilement',
    ],
  },
  priceAnchors: [12, 15, 19, 24],
  bannedClaims: ['garanti', 'guérir', '100 %'],
};

const QUICK_VOC: VoiceOfCustomer = {
  nicheId: 'sommeil-bebe', depth: 'quick',
  pains: ['Bébé se réveille toutes les 2 heures la nuit'], phrases: ['il se réveille toutes les 2h'], objections: [], desiredOutcomes: [],
  knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [],
};

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'prd_1', nicheId: 'sommeil-bebe', title: 'Bébé se réveille toutes les 2 heures : la méthode douce en 14 nuits',
    subtitle: 'Pour les parents épuisés', audience: NICHE.audience, problem: NICHE.problem, price: 19, status: 'writing', version: 1,
    content: null, design: null, salesPage: null, files: { pdf: null, cover: null, salesPage: null }, quality: null, salesQuality: null,
    upsellProductId: null, createdDay: 1, launchedDay: null,
    stats: { views: 0, sales: 0, revenue: 0, refunds: 0, refundAmount: 0, rating: 0, reviews: [], upsellSales: 0 },
    priceHistory: [], ...over,
  };
}

function message(over: Partial<InboxMessage>): InboxMessage {
  return {
    id: 'msg_1', day: 5, customerId: 'cus_1', channel: 'email', subject: '', body: '', intent: 'question', productId: 'prd_1',
    orderId: 'ord_1', mood: 0, status: 'open', deadlineDay: 6, thread: [], resolution: null, ...over,
  };
}

const ORDER: Order = { id: 'ord_1', day: 3, customerId: 'cus_1', productId: 'prd_1', price: 19, source: 'ads', campaignId: null, creatorId: null, refunded: false, chargeback: false };

const heuristic = (seed = 42) => createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed });

/** Template glitches that must never reach a reader. */
const BROKEN = /\bnull\b|undefined|NaN|\[object|\s[,.]\s|«\s*»|\.\.(?!\.)|…\./;

async function draft(seed = 42, voc = VOC) {
  const eng = heuristic(seed);
  const c = ctx();
  const outline = await eng.writeOutline({ title: 'Bébé se réveille toutes les 2 heures : la méthode douce en 14 nuits', niche: NICHE, voc }, c);
  return eng.writePdfContent({ title: outline.title, outline, niche: NICHE, voc, upsellTitle: 'Les siestes sans larmes (6-12 mois)' }, c);
}

// ───────────────────────────── heuristic: studio ─────────────────────────────

describe('heuristic studio', () => {
  it('writes 10 distinct titles that use the customer words', async () => {
    const titles = await heuristic().writeTitles({ niche: NICHE, voc: VOC, count: 10 }, ctx());
    expect(titles).toHaveLength(10);
    expect(new Set(titles).size).toBe(10);
    expect(titles.some((t) => t.includes('« '))).toBe(true);
    expect(titles.filter((t) => /parents|bébé/i.test(t)).length).toBeGreaterThanOrEqual(6);
  });

  it('writes an outline that sells (5-7 chapters, bonus, next step)', async () => {
    const o = await heuristic().writeOutline({ title: 'Titre', niche: NICHE, voc: VOC }, ctx());
    expect(o.chapters.length).toBeGreaterThanOrEqual(5);
    expect(o.chapters.length).toBeLessThanOrEqual(7);
    expect(o.chapters.every((c) => c.points.length >= 2)).toBe(true);
    expect(o.bonusTitle).toMatch(/^Bonus/);
    // the next guide's title only: « La suite est ici » is printed by the layout (PDF page, product card)
    expect(o.nextStepTitle.length).toBeGreaterThan(5);
    expect(o.nextStepTitle).not.toMatch(/^La suite est ici/i);
  });

  it('writes a complete, rich first draft', async () => {
    const pdf = await draft();
    expect(pdf.chapters.length).toBeGreaterThanOrEqual(5);
    expect(pdf.chapters.length).toBeLessThanOrEqual(7);
    expect(pdf.wordCount).toBeGreaterThanOrEqual(2000);
    expect(pdf.wordCount).toBeLessThanOrEqual(4500);
    expect(pdf.introduction.length).toBeGreaterThanOrEqual(3);
    for (const ch of pdf.chapters) {
      expect(ch.steps.length).toBeGreaterThanOrEqual(3);
      expect(ch.steps.length).toBeLessThanOrEqual(8);
      expect(ch.checklist.length).toBeGreaterThan(0);
      expect(ch.visual).not.toBeNull();
      expect(ch.paragraphs.length).toBeGreaterThanOrEqual(2);
      if (ch.visual!.type === 'bar_chart') expect(ch.visual!.values.every((v) => v >= 0 && v <= 100)).toBe(true);
    }
    expect(pdf.bonus.steps.length).toBeGreaterThan(0);
    expect(pdf.nextStep.title).toContain('Les siestes sans larmes');
    // the customer words are in there
    expect(VOC.phrases.some((p) => allText(pdf).includes(`« ${p}`))).toBe(true);
    expect(allText(pdf)).toContain('Camille');
    expect(allText(pdf)).not.toMatch(BROKEN);
  });

  it('is deterministic for the same seed and varies with the seed', async () => {
    const a = await draft(7);
    const b = await draft(7);
    const c = await draft(8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('a generated id changes no text: one more sale earlier in the run does not rewrite the page and the ads', async () => {
    const pdf = await draft(7);
    const write = async (id: string) => {
      const eng = heuristic(7);
      const p = product({ id, content: pdf });
      return {
        page: await eng.writeSalesPage({ product: p, content: pdf, voc: VOC, hype: 0.4 }, ctx()),
        hooks: await eng.writeAdHooks({ product: p, voc: VOC, styles: ['pov', 'mistake'] }, ctx()),
        ad: await eng.writeAd({ product: p, voc: VOC, hook: '', hookStyle: 'pov', format: 'carousel', bannedClaims: [] }, ctx()),
      };
    };
    expect(await write('prd_101')).toEqual(await write('prd_102'));
  });

  it('first draft is "correct mais plat": it contains 4-8 generic clichés', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const found = findCliches(await draft(seed));
      expect(found.length).toBeGreaterThanOrEqual(4);
      expect(found.length).toBeLessThanOrEqual(8);
    }
  });

  it('richer research yields richer content; thin research still yields a usable guide', async () => {
    const rich = await draft(3, VOC);
    const thin = await draft(3, QUICK_VOC);
    expect(thin.chapters.length).toBeGreaterThanOrEqual(5);
    expect(thin.wordCount).toBeGreaterThanOrEqual(2000);
    expect(allText(thin)).not.toMatch(BROKEN);
    expect(allText(rich)).not.toMatch(BROKEN);
    expect(rich.chapters.length).toBeGreaterThan(thin.chapters.length);
    expect(rich.chapters.filter((c) => c.example).length).toBeGreaterThan(thin.chapters.filter((c) => c.example).length - 1);
  });

  it('humanize removes every flagged cliché and keeps the structure', async () => {
    const eng = heuristic(11);
    for (const seed of [11, 12, 13]) {
      const pdf = await draft(seed);
      const flagged = findCliches(pdf);
      expect(flagged.length).toBeGreaterThan(0);
      const h = await eng.humanize({ content: pdf, flagged, voc: VOC }, ctx());
      const text = allText(h);
      for (const f of flagged) expect(text).not.toContain(f);
      for (const p of [...h.introduction, ...h.chapters.flatMap((c) => c.paragraphs)]) {
        for (const s of splitSentences(p)) expect(isCliche(s)).toBe(false);
      }
      expect(h.chapters).toHaveLength(pdf.chapters.length);
      expect(h.wordCount).toBeGreaterThan(1800);
    }
  });

  it('humanize also removes phrases flagged by an external QA list', async () => {
    const pdf = await draft(5);
    const target = pdf.chapters[1]!.paragraphs[0]!;
    const sentence = splitSentences(target)[0]!;
    const h = await heuristic().humanize({ content: pdf, flagged: [sentence], voc: VOC }, ctx());
    expect(allText(h)).not.toContain(sentence);
  });

  it('factCheck catches risky and unsourced claims and softens them', async () => {
    const pdf = await draft(1);
    pdf.chapters[0]!.paragraphs.push('Cette méthode permet de guérir les réveils nocturnes dans 100 % des cas, résultat garanti dès la première nuit.');
    pdf.introduction.push('Plus de 90 % des parents voient une différence en 3 jours seulement.');
    const { issues, content } = await heuristic().factCheck({ content: pdf, voc: VOC }, ctx());
    expect(issues.length).toBeGreaterThanOrEqual(2);
    const t = norm(allText(content));
    expect(t).not.toMatch(/garanti|guerir|100 ?%|90 ?%|des la premiere nuit|3 jours seulement/);
    // sourced numbers survive
    expect(allText(content)).toContain('12 à 15 h de sommeil');
  });
});

// ───────────────────────────── heuristic: commerce, ads ─────────────────────────────

describe('heuristic boutique & growth', () => {
  it('sales page uses verbatim customer words, honest guarantee at low hype, stronger at high hype', async () => {
    const pdf = await draft(2);
    const eng = heuristic();
    const low = await eng.writeSalesPage({ product: product({ content: pdf }), content: pdf, voc: VOC, hype: 0.2 }, ctx());
    expect(low.painBullets.some((b) => VOC.phrases.includes(b))).toBe(true);
    expect(low.chapterBlurbs).toHaveLength(pdf.chapters.length);
    expect(low.objections.length).toBeGreaterThanOrEqual(3);
    expect(low.hypeLevel).toBe(0.2);
    expect(norm(allText(low))).not.toMatch(/garanti/);
    expect(low.cta).toContain('19 €');
    const high = await eng.writeSalesPage({ product: product({ content: pdf }), content: pdf, voc: VOC, hype: 0.9 }, ctx());
    expect(norm(allText(high))).toMatch(/garanti/);
    const capped = await eng.writeSalesPage({ product: product({ content: pdf }), content: pdf, voc: VOC, hype: 0.9 }, ctx({ playbook: ['Niveau de promesse max « 0.4 »', 'Ne jamais écrire « garanti »'] }));
    expect(capped.hypeLevel).toBe(0.4);
    expect(norm(allText(capped))).not.toMatch(/garanti/);
  });

  it('writes one TikTok hook per style, ≤ 90 chars', async () => {
    const styles = ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'] as const;
    const hooks = await heuristic().writeAdHooks({ product: product(), voc: VOC, styles: [...styles] }, ctx());
    expect(hooks.map((h) => h.hookStyle).sort()).toEqual([...styles].sort());
    for (const h of hooks) {
      expect(h.hook.length).toBeLessThanOrEqual(90);
      expect(h.hook.length).toBeGreaterThan(15);
    }
  });

  it('writeAd builds a valid 12-30 s script', async () => {
    const ad = await heuristic().writeAd({ product: product(), voc: VOC, hook: 'Tu te dis « je n’en peux plus » ? Regarde ça avant ce soir.', hookStyle: 'question', format: 'text_slideshow', bannedClaims: [] }, ctx());
    expect(ad.scenes.length).toBeGreaterThanOrEqual(4);
    expect(ad.scenes.length).toBeLessThanOrEqual(6);
    const total = ad.scenes.reduce((a, s) => a + s.durationSec, 0);
    expect(total).toBeGreaterThanOrEqual(12);
    expect(total).toBeLessThanOrEqual(30);
    expect(ad.scenes.every((s) => s.onScreenText.length <= 50)).toBe(true);
    expect(ad.hashtags.length).toBeGreaterThanOrEqual(4);
    expect(ad.hashtags.length).toBeLessThanOrEqual(6);
    expect(ad.hashtags.every((h) => h.startsWith('#'))).toBe(true);
  });

  it('writeAd: unconstrained hype styles sometimes slip « garanti », never when banned (50 seeds)', async () => {
    let slipped = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const eng = heuristic(seed);
      const base = { product: product(), voc: { ...VOC, bannedClaims: [] }, hook: 'Avant : « je n’en peux plus ». Après 14 nuits : des nuits calmes.', format: 'faceless_voiceover' as const };
      for (const hookStyle of ['before_after', 'stat'] as const) {
        const free = await eng.writeAd({ ...base, hookStyle, bannedClaims: [] }, ctx());
        if (/garanti|100 ?%|à coup sûr|3 jours seulement/i.test(allText(free))) slipped++;
        const banned = await eng.writeAd({ ...base, hookStyle, bannedClaims: ['garanti', '100 %'] }, ctx());
        expect(norm(allText(banned))).not.toMatch(/garanti|100 ?%/);
        const rule = await eng.writeAd({ ...base, hookStyle, bannedClaims: [] }, ctx({ playbook: ['Ne jamais écrire « garanti »'] }));
        expect(norm(allText(rule))).not.toContain('garanti');
      }
    }
    expect(slipped).toBeGreaterThan(5);
    expect(slipped).toBeLessThan(50);
  });

  it('banned playbook words never appear anywhere in that agent’s outputs', async () => {
    const eng = heuristic(9);
    const c = ctx({ playbook: ['Ne jamais écrire « méthode »', 'Ne jamais écrire « garanti »'] });
    const pdf = await eng.writePdfContent({ title: 'Une méthode garantie', outline: await eng.writeOutline({ title: 'x', niche: NICHE, voc: VOC }, c), niche: NICHE, voc: VOC, upsellTitle: null }, c);
    expect(norm(allText(pdf))).not.toMatch(/methode|garanti/);
    const titles = await eng.writeTitles({ niche: NICHE, voc: VOC, count: 10 }, c);
    expect(norm(titles.join(' '))).not.toMatch(/methode/);
  });

  it('outreach DM mentions the creator, the guide and the offer', async () => {
    const dm = await heuristic().writeOutreach({
      creator: { id: 'cr_1', handle: 'maman.zen', nicheId: 'sommeil-bebe', followers: 12000, avgViews: 4500, engagement: 0.06, askUpfront: 0, askCommission: 0.3, redFlags: [] },
      product: product(), offer: { upfront: 0, commission: 0.3 },
    }, ctx({}, { name: 'Inès', role: 'Responsable partenariats', dept: 'partenariats' }));
    expect(dm).toContain('@maman.zen');
    expect(dm).toContain('30 %');
    expect(dm).toContain('Inès');
    expect(dm.length).toBeLessThan(700);
  });
});

// ───────────────────────────── heuristic: support, direction ─────────────────────────────

describe('heuristic support & direction', () => {
  const sup = ctx({}, { id: 'ag_sup', name: 'Léa', role: 'Chargée de support', dept: 'support', tier: 'haiku' });
  const reply = (m: Partial<InboxMessage>, order: Order | null = ORDER, c = sup) =>
    heuristic().writeSupportReply({ message: message(m), product: product(), order, policy: ['Remboursements accordés sans discuter sous 14 jours'] }, c);

  it('blocks an obvious scam', async () => {
    const r = await reply({ channel: 'dm', subject: 'Offre exclusive', body: 'Payez 300 € par virement et je vous fais 1 M de vues garanties sur TikTok. Cliquez ici : http://bit.ly/boost', orderId: null });
    expect(r.detectedIntent).toBe('arnaque');
    expect(r.action).toBe('block');
  });

  it('resends the link for « je n’ai jamais reçu le pdf »', async () => {
    const r = await reply({ subject: 'Commande', body: "Bonjour, j'ai payé hier mais je n'ai jamais reçu le pdf. Julie" });
    expect(r.detectedIntent).toBe('non_recu');
    expect(r.action).toBe('resend_link');
    expect(r.text).toContain('Bonjour Julie');
    expect(r.text).toContain('— Léa, Service client Pixel Agency');
  });

  it('follows the policy for refunds, chargebacks, trolls and partnerships', async () => {
    expect((await reply({ body: 'Je veux être remboursée, ce guide ne me convient pas.' })).action).toBe('refund');
    expect((await reply({ body: 'Je veux un remboursement.', day: 30 })).action).toBe('none');
    expect((await reply({ body: 'Si je ne suis pas remboursé je fais opposition auprès de ma banque (chargeback).' })).action).toBe('refund');
    const troll = await reply({ channel: 'commentaire_tiktok', body: 'mdr qui achète ce truc, bande de clowns 🤡', orderId: null }, null);
    expect(troll.action).toBe('ignore');
    expect(troll.text.length).toBeLessThan(80);
    expect((await reply({ channel: 'dm', body: 'Bonjour, je suis créatrice UGC (40k abonnés), une collaboration vous intéresse ?', orderId: null }, null)).action).toBe('escalate');
  });

  it('honours the support tone rule', async () => {
    const formal = await reply({ body: "Je n'ai pas reçu le lien de téléchargement." }, ORDER, ctx({ playbook: ['Ton support « formel »'] }, { name: 'Léa', dept: 'support' }));
    expect(formal.text).toMatch(/Nous vous prions|Madame, Monsieur/);
  });

  it('routes a founder mission to task kinds', async () => {
    const items = await heuristic().interpretMission({ text: 'Lance une nouvelle pub TikTok et baisse le prix à 14 €, c’est urgent', allowedKinds: ['write_ad_hooks', 'produce_ad', 'launch_campaign', 'set_price', 'daily_report'] }, ctx());
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain('set_price');
    expect(kinds).toContain('produce_ad');
    expect(items.find((i) => i.kind === 'set_price')!.input.price).toBe(14);
    expect(items.every((i) => i.priority === 1)).toBe(true);
    expect(await heuristic().interpretMission({ text: 'bonjour', allowedKinds: [] }, ctx())).toEqual([]);
  });

  it('ranks opportunities, excludes niches and starts the price low', async () => {
    const r = await heuristic().rankOpportunities({
      signals: [
        { nicheId: 'sommeil-bebe', name: 'Sommeil bébé', audience: 'Parents de bébés de 6 à 12 mois', category: 'parentalité', searchInterest: 70, tiktokBuzz: 80, competitionHint: 'moyenne', sampleTitles: [] },
        { nicheId: 'chien-reactif', name: 'Chien réactif', audience: 'Propriétaires de chiens réactifs', category: 'animaux', searchInterest: 40, tiktokBuzz: 35, competitionHint: 'forte', sampleTitles: [] },
        { nicheId: 'deja-fait', name: 'Déjà fait', audience: 'x', category: 'x', searchInterest: 99, tiktokBuzz: 99, competitionHint: 'faible', sampleTitles: [] },
      ],
      competitors: { 'sommeil-bebe': [{ id: 'c1', nicheId: 'sommeil-bebe', title: 'Le sommeil de bébé', price: 27, reviews: 340, rating: 3.8, ageDays: 400, platform: 'gumroad', weaknesses: ['trop généraliste', 'aucun plan concret'] }] },
      voc: { 'sommeil-bebe': VOC },
      excludeNicheIds: ['deja-fait'],
    }, ctx());
    expect(r.ranked.map((x) => x.nicheId)).toEqual(['sommeil-bebe', 'chien-reactif']);
    expect(r.ranked[0]!.suggestedPrice).toBe(14);
    expect(r.ranked[0]!.angle).toMatch(/Un seul problème/);
    expect(r.ranked[0]!.audience).toMatch(/6 à 12 mois/);
    expect((await heuristic().rankOpportunities({ signals: [], competitors: {}, voc: {}, excludeNicheIds: [] }, ctx())).ranked).toEqual([]);
  });

  it('red team verdicts follow the quality report', async () => {
    const q = (over: Partial<QualityReport>): QualityReport => ({ overall: 80, specificity: 80, structure: 80, actionability: 80, humanTone: 80, design: 80, promiseMatch: 80, compliance: 80, issues: [], evaluator: 'heuristic', ...over });
    const eng = heuristic();
    expect((await eng.redTeam({ subject: 'pdf', summary: 'Guide sommeil pour parents de bébés de 6 à 12 mois', quality: q({}) }, ctx())).verdict).toBe('go');
    expect((await eng.redTeam({ subject: 'pdf', summary: 'Guide sommeil pour parents de bébés de 6 à 12 mois', quality: q({ overall: 62, humanTone: 40 }) }, ctx())).verdict).toBe('fix');
    expect((await eng.redTeam({ subject: 'ad', summary: 'Pub avec promesses', quality: q({ compliance: 20 }) }, ctx())).verdict).toBe('kill');
    expect((await eng.redTeam({ subject: 'idea', summary: 'Un guide de bien-être pour tout le monde', quality: null }, ctx())).verdict).toBe('kill');
  });

  it('planDay returns the heuristic plan, chat stays in character, memo is concise', async () => {
    const eng = heuristic();
    const plan = { focus: 'Lancer le guide', memo: 'On publie.', items: [] };
    expect(await eng.planDay({ day: 1, finance: {} as never, kpis: [], products: [], openTasks: [], lessons: [], founderMissions: [], heuristicPlan: plan }, ctx())).toBe(plan);
    const answer = await eng.chat({ history: [], text: 'Combien de ventes aujourd’hui ?', situation: 'Ventes du jour : 3 (57 €). ROAS 1,4. Tâche en cours : rédiger le guide v2.' }, ctx());
    expect(answer).toMatch(/3 \(57 €\)/);
    expect(splitSentences(answer).length).toBeGreaterThanOrEqual(2);
    expect(splitSentences(answer).length).toBeLessThanOrEqual(4);
    const memo = await eng.dailyMemo({ day: 4, kpi: { day: 4, cash: 431.2, revenue: 57, adSpend: 40, profit: 17, cumulativeProfit: -68.8, sales: 3, refunds: 0, impressions: 5000, clicks: 60, ctr: 0.012, cvr: 0.05, roas: 1.42, cac: 13.3, openTickets: 2, avgReplyScore: 80, liveProducts: 1, tasksDone: 9, lessonsLearned: 1 }, notes: ['Le hook « erreur » performe'] }, ctx());
    expect(memo).toMatch(/^Jour 4/);
    expect(memo).toContain('57 €');
    expect(memo).toContain('Priorité de demain');
    const lessons = [{ topic: 'ads' as const, insight: 'x', evidence: 'y', confidence: 0.5, appliesToRoles: [] }];
    expect(await eng.extractLessons({ kpis: [], experiments: [], incidents: [], heuristicLessons: lessons }, ctx())).toEqual(lessons);
  });

  it('counts calls even in heuristic mode', async () => {
    const eng = heuristic();
    await eng.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, ctx());
    await eng.dailyMemo({ day: 1, kpi: { day: 1, cash: 500, revenue: 0, adSpend: 0, profit: 0, cumulativeProfit: 0, sales: 0, refunds: 0, impressions: 0, clicks: 0, ctr: 0, cvr: 0, roas: 0, cac: 0, openTickets: 0, avgReplyScore: 0, liveProducts: 0, tasksDone: 0, lessonsLearned: 0 }, notes: [] }, ctx());
    expect(eng.usage()).toEqual({ calls: 2, inputTokens: 0, outputTokens: 0, costEur: 0, fallbacks: 0 });
  });
});

// ───────────────────────────── facade & Claude path (mocked, no network) ─────────────────────────────

function fakeMessage(json: unknown, over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
    usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...over,
  } as unknown as Anthropic.Message;
}

describe('createContentEngine facade', () => {
  it('auto without key is heuristic; claude without key falls back to heuristic', () => {
    expect(createContentEngine({ mode: 'auto', maxComputeEur: 3, seed: 1 }).mode).toBe('heuristic');
    expect(createContentEngine({ mode: 'auto', apiKey: '   ', maxComputeEur: 3, seed: 1 }).mode).toBe('heuristic');
    const logs: string[] = [];
    expect(createContentEngine({ mode: 'claude', maxComputeEur: 3, seed: 1, log: (m) => logs.push(m) }).mode).toBe('heuristic');
    expect(createContentEngine({ mode: 'auto', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client: { messages: { create: async () => fakeMessage({}) } } }).mode).toBe('claude');
  });

  it('falls back to the heuristic on API errors and counts fallbacks', async () => {
    let called = 0;
    const client: ClaudeClientLike = { messages: { create: async () => { called++; throw new Error('boom'); } } };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 42, client, log: () => {} });
    const titles = await eng.writeTitles({ niche: NICHE, voc: VOC, count: 10 }, ctx());
    expect(titles).toEqual(await heuristic(42).writeTitles({ niche: NICHE, voc: VOC, count: 10 }, ctx()));
    const r = await eng.writeSupportReply({ message: message({ body: "Je n'ai jamais reçu le pdf" }), product: product(), order: ORDER, policy: [] }, ctx());
    expect(r.action).toBe('resend_link');
    expect(called).toBe(2);
    expect(eng.usage()).toMatchObject({ calls: 2, fallbacks: 2, inputTokens: 0, costEur: 0 });
  });

  it('falls back on invalid JSON, refusals and truncation', async () => {
    const replies = [
      { ...fakeMessage({}), content: [{ type: 'text', text: 'pas du json', citations: null }] },
      fakeMessage({ titles: ['x'] }, { stop_reason: 'refusal' as Anthropic.Message['stop_reason'] }),
      fakeMessage({ titles: ['x'] }, { stop_reason: 'max_tokens' }),
    ] as Anthropic.Message[];
    const client: ClaudeClientLike = { messages: { create: async () => replies.shift()! } };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client, log: () => {} });
    for (let i = 0; i < 3; i++) expect(await eng.writeTitles({ niche: NICHE, voc: VOC, count: 4 }, ctx())).toHaveLength(4);
    expect(eng.usage().fallbacks).toBe(3);
    expect(eng.usage().calls).toBe(3);
  });

  it('uses valid Claude JSON, tracks tokens and cost, sends a cached system prompt and a schema', async () => {
    const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const events: UsageEvent[] = [];
    const client: ClaudeClientLike = {
      messages: {
        create: async (body) => {
          bodies.push(body);
          return fakeMessage({ titles: ['Titre Claude A', 'Titre Claude B'] });
        },
      },
    };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client, onUsage: (u) => events.push(u), log: () => {} });
    const titles = await eng.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, ctx({ playbook: ['Ne jamais écrire « miracle »'] }));
    expect(titles[0]).toBe('Titre Claude A');
    expect(titles).toHaveLength(3); // completed from the heuristic
    const body = bodies[0]!;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(Array.isArray(body.system)).toBe(true);
    const sys = body.system as Anthropic.TextBlockParam[];
    expect(sys[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sys[0]!.text).toContain('Margaux');
    expect(sys[1]!.text).toContain('Ne jamais écrire « miracle »');
    expect(body.output_config?.format?.type).toBe('json_schema');
    const u = eng.usage();
    expect(u).toMatchObject({ calls: 1, fallbacks: 0, inputTokens: 1000, outputTokens: 500 });
    // sonnet 5.5: (1000 × 2 + 500 × 10) / 1e6 USD × 0.92
    expect(u.costEur).toBeCloseTo(0.007 * 0.92, 6);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tier: 'sonnet', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 500 });
  });

  it('enforces maxComputeEur: once reached, every call is heuristic and counted as fallback', async () => {
    let called = 0;
    const client: ClaudeClientLike = { messages: { create: async () => { called++; return fakeMessage({ titles: ['A', 'B', 'C'] }, { usage: { input_tokens: 100_000, output_tokens: 50_000 } as Anthropic.Usage }); } } };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 0.01, seed: 1, client, models: { opus: 'claude-opus-5-5' }, log: () => {} });
    const c = ctx({}, { tier: 'opus' });
    await eng.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, c);
    await eng.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, c);
    await eng.writeTitles({ niche: NICHE, voc: VOC, count: 3 }, c);
    expect(called).toBe(1);
    expect(eng.usage().fallbacks).toBe(2);
    expect(eng.usage().calls).toBe(3);
    expect(eng.usage().costEur).toBeGreaterThan(0.01);
  });

  it('normalises a partial Claude ad and still honours banned claims', async () => {
    const client: ClaudeClientLike = {
      messages: {
        create: async () => fakeMessage({
          hook: 'Résultat garanti en 14 nuits, promis', format: 'carousel',
          scenes: [{ visual: 'v', onScreenText: 'Un texte bien trop long pour tenir sur un écran de téléphone', voiceover: 'Garanti à 100 %', durationSec: 40 }],
          caption: 'Caption', hashtags: ['sommeil', '#bébé'], cta: 'Lien en bio',
        }),
      },
    };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client, log: () => {} });
    const ad = await eng.writeAd({ product: product(), voc: VOC, hook: 'Tu te dis « je n’en peux plus » ?', hookStyle: 'question', format: 'faceless_voiceover', bannedClaims: ['garanti', '100 %'] }, ctx());
    expect(ad.format).toBe('faceless_voiceover');
    expect(ad.scenes.length).toBeGreaterThanOrEqual(4);
    const total = ad.scenes.reduce((a, s) => a + s.durationSec, 0);
    expect(total).toBeGreaterThanOrEqual(12);
    expect(total).toBeLessThanOrEqual(30);
    expect(norm(allText(ad))).not.toMatch(/garanti|100 ?%/);
  });
});

// ───────────────────────────── robustness ─────────────────────────────

describe('robustness on thin / malformed inputs', () => {
  const EMPTY_VOC = { nicheId: 'x', depth: 'quick', pains: [], phrases: [], objections: [], desiredOutcomes: [], knowledge: { tips: [], steps: [], mistakes: [], examples: [], facts: [] }, priceAnchors: [], bannedClaims: [] } as VoiceOfCustomer;
  const BARE_NICHE = { nicheId: 'x', name: '', audience: '', problem: '', category: '', keywords: [] } as NicheBrief;

  it('never throws and never leaks template glitches, across seeds and research depths', async () => {
    for (const seed of [1, 2, 3, 17, 99]) {
      for (const voc of [VOC, QUICK_VOC, EMPTY_VOC]) {
        const eng = heuristic(seed);
        const c = ctx();
        const titles = await eng.writeTitles({ niche: voc === EMPTY_VOC ? BARE_NICHE : NICHE, voc, count: 10 }, c);
        expect(titles).toHaveLength(10);
        const outline = await eng.writeOutline({ title: titles[0]!, niche: NICHE, voc }, c);
        const pdf = await eng.writePdfContent({ title: titles[0]!, outline, niche: NICHE, voc, upsellTitle: null }, c);
        expect(pdf.chapters.length).toBeGreaterThanOrEqual(5);
        expect(pdf.wordCount).toBeGreaterThanOrEqual(2000);
        const h = await eng.humanize({ content: pdf, flagged: findCliches(pdf), voc }, c);
        const fc = await eng.factCheck({ content: h, voc }, c);
        const sp = await eng.writeSalesPage({ product: product({ content: fc.content }), content: fc.content, voc, hype: seed / 100 }, c);
        const hooks = await eng.writeAdHooks({ product: product(), voc, styles: ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'] }, c);
        const ad = await eng.writeAd({ product: product(), voc, hook: hooks[seed % hooks.length]!.hook, hookStyle: hooks[seed % hooks.length]!.hookStyle, format: 'carousel', bannedClaims: [] }, c);
        for (const out of [titles, outline, pdf, h, fc, sp, hooks, ad]) expect(allText(out)).not.toMatch(BROKEN);
        expect(hooks.every((x) => x.hook.length <= 90)).toBe(true);
        expect(ad.scenes.every((s) => s.onScreenText.length <= 50)).toBe(true);
      }
    }
  });

  it('accepts a broken outline, missing product fields and empty messages', async () => {
    const eng = heuristic(5);
    const pdf = await eng.writePdfContent({ title: '', outline: { title: '', chapters: [], bonusTitle: '', nextStepTitle: '' }, niche: NICHE, voc: VOC, upsellTitle: null }, ctx());
    expect(pdf.chapters.length).toBeGreaterThanOrEqual(5);
    expect(pdf.title.length).toBeGreaterThan(5);
    const sp = await eng.writeSalesPage({ product: { id: 'p' } as Product, content: null as unknown as Parameters<typeof eng.writeSalesPage>[0]['content'], voc: EMPTY_VOC, hype: Number.NaN }, ctx());
    expect(sp.objections.length).toBeGreaterThan(0);
    expect(sp.hypeLevel).toBeGreaterThanOrEqual(0);
    const r = await eng.writeSupportReply({ message: message({ body: '', subject: '' }), product: null, order: null, policy: [] }, ctx());
    expect(r.detectedIntent).toBeTruthy();
    expect(r.text).toContain('Service client');
    const fc = await eng.factCheck({ content: {} as never, voc: EMPTY_VOC }, ctx());
    expect(fc.issues).toEqual([]);
  });
});

describe('Claude path details (mocked)', () => {
  it('writePdfContent streams, then completes a partial answer from the heuristic draft', async () => {
    let streamed = 0;
    const fb = await draft(42);
    const partial = {
      ...fb,
      title: 'Titre Claude',
      chapters: fb.chapters.map((c, i) => (i === 0 ? { ...c, title: 'Chapitre Claude', visual: { type: 'bar_chart', title: 'T', labels: ['a', 'b'], values: [140, -3] } } : { ...c, steps: [] })),
      bonus: { title: 'Bonus Claude' },
    };
    const client: ClaudeClientLike = {
      messages: {
        create: async () => { throw new Error('should stream'); },
        stream: () => ({ finalMessage: async () => { streamed++; return fakeMessage(partial); } }),
      },
    };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 42, client, log: () => {} });
    const c = ctx();
    const outline = await heuristic(42).writeOutline({ title: 'Bébé se réveille toutes les 2 heures : la méthode douce en 14 nuits', niche: NICHE, voc: VOC }, c);
    const pdf = await eng.writePdfContent({ title: outline.title, outline, niche: NICHE, voc: VOC, upsellTitle: 'Les siestes sans larmes (6-12 mois)' }, c);
    expect(streamed).toBe(1);
    expect(pdf.title).toBe('Titre Claude');
    expect(pdf.chapters[0]!.title).toBe('Chapitre Claude');
    expect(pdf.chapters[0]!.visual!.values).toEqual([100, 0]);
    expect(pdf.chapters.every((ch) => ch.steps.length >= 3)).toBe(true); // empty steps filled from the heuristic
    expect(pdf.bonus.title).toBe('Bonus Claude');
    expect(pdf.bonus.steps.length).toBeGreaterThan(0);
    expect(pdf.wordCount).toBeGreaterThan(2000);
    expect(eng.usage().fallbacks).toBe(0);
  });

  it('humanize applies Claude replacements and still removes every remaining cliché', async () => {
    const pdf = await draft(4);
    const flagged = findCliches(pdf);
    const first = flagged[0]!;
    const client: ClaudeClientLike = {
      messages: { create: async () => fakeMessage({ issues: ['1 phrase remplacée'], replacements: [{ original: first, replacement: 'Une maman nous a écrit « je n’en peux plus » à 3 h du matin.' }] }) },
    };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 4, client, log: () => {} });
    const h = await eng.humanize({ content: pdf, flagged, voc: VOC }, ctx());
    const text = allText(h);
    expect(text).toContain('à 3 h du matin');
    for (const f of flagged) expect(text).not.toContain(f);
  });

  it('support reply from Claude keeps a valid action and gets the signature', async () => {
    const client: ClaudeClientLike = { messages: { create: async () => fakeMessage({ detectedIntent: 'non_recu', action: 'resend_link', text: 'Bonjour Julie, voici votre lien.' }) } };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client, log: () => {} });
    const r = await eng.writeSupportReply({ message: message({ body: "Je n'ai jamais reçu le pdf. Julie" }), product: product(), order: ORDER, policy: [] }, ctx({}, { name: 'Léa', dept: 'support', tier: 'haiku' }));
    expect(r).toMatchObject({ detectedIntent: 'non_recu', action: 'resend_link' });
    expect(r.text).toContain('— Léa, Service client Pixel Agency');
    expect(eng.usage().costEur).toBeCloseTo((1000 * 0.1 + 500 * 0.5) / 1e6 * 0.92, 9);
  });

  it('planDay never drops a runtime item; interpretMission only keeps allowed kinds', async () => {
    const plan = { focus: 'f', memo: 'm', items: [
      { kind: 'reply_inbox' as const, title: 'A', dept: 'support' as const, priority: 2 as const, input: {}, why: 'w' },
      { kind: 'optimize_ads' as const, title: 'B', dept: 'growth' as const, priority: 2 as const, input: { campaignId: 'cmp_1' }, why: 'w' },
    ] };
    const replies = [
      fakeMessage({ focus: 'Rentabiliser les pubs', memo: 'On coupe ce qui perd.', items: [{ index: 1, priority: 1, why: 'ROAS sous 0,8' }, { index: 7, priority: 1, why: 'x' }] }),
      fakeMessage({ items: [{ kind: 'set_price', title: 'Prix à 14 €', priority: 1, why: 'demande', price: 14 }, { kind: 'retro', title: 'x', priority: 2, why: 'x', price: null }] }),
    ];
    const client: ClaudeClientLike = { messages: { create: async () => replies.shift()! } };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 1, client, log: () => {} });
    const p = await eng.planDay({ day: 2, finance: {} as never, kpis: [], products: [], openTasks: [], lessons: [], founderMissions: [], heuristicPlan: plan }, ctx({}, { tier: 'opus' }));
    expect(p.focus).toBe('Rentabiliser les pubs');
    expect(p.items.map((i) => i.kind)).toEqual(['optimize_ads', 'reply_inbox']);
    expect(p.items[0]!.priority).toBe(1);
    expect(p.items[0]!.input).toEqual({ campaignId: 'cmp_1' });
    const items = await eng.interpretMission({ text: 'Baisse le prix à 14 €', allowedKinds: ['set_price', 'daily_report'] }, ctx());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'set_price', dept: 'boutique', priority: 1, input: { missionText: 'Baisse le prix à 14 €', price: 14 } });
  });
});

describe('machine-readable playbook rules', () => {
  it('honours « Privilégier le hook » and « Prix cible »', async () => {
    const eng = heuristic(3);
    const c = ctx({ playbook: ['Privilégier le hook « mistake »', 'Prix cible « 24 »', 'Une règle libre qui ne change rien'] });
    const hooks = await eng.writeAdHooks({ product: product(), voc: VOC, styles: ['question', 'pov'] }, c);
    expect(hooks[0]!.hookStyle).toBe('mistake');
    expect(hooks.map((h) => h.hookStyle)).toEqual(expect.arrayContaining(['question', 'pov']));
    const r = await eng.rankOpportunities({ signals: [{ nicheId: 'sommeil-bebe', name: 'S', audience: 'Parents', category: 'p', searchInterest: 50, tiktokBuzz: 50, competitionHint: 'faible', sampleTitles: [] }], competitors: {}, voc: { 'sommeil-bebe': VOC }, excludeNicheIds: [] }, c);
    expect(r.ranked[0]!.suggestedPrice).toBe(24);
  });
});

// ───────────────────────────── content regressions (founder review) ─────────────────────────────

/** The playbook the bal-normal-42 retro really wrote for the Studio (its « n'hésitez pas à » rule used to delete every « n »). */
const REAL_STUDIO_PLAYBOOK = [
  'Ne jamais écrire « il est important de noter »',
  "Ne jamais écrire « n'hésitez pas à »",
  'Ne jamais écrire « soyez patient »',
  'Chaque chapitre : étapes numérotées, un exemple réel tiré de la recherche, une checklist.',
];
/** « Ce ’est », « il ’associe », « ’hésitez » : an apostrophe left alone after a deleted « n ». */
const ORPHAN_APOSTROPHE = /(^|[\s(«])['’][a-zà-ÿ]/i;
/** « Erreur °1 » (lost « n »), but « 20 °C » is fine. */
const LOST_N_DEGREE = /(^|[^n])°(?!C)/;
const REAL_NICHES = ['sommeil-bebe', 'proprete-chiot', 'urssaf-micro'] as const;

function realResearch(seed: number, nicheId: string): { brief: NicheBrief; voc: VoiceOfCustomer } {
  const world = createWorld(defaultScenario({ ...LEGACY, seed }), `test-content-${seed}`);
  const tools = createMarketTools(world, createRng(seed));
  return { brief: tools.nicheBrief(nicheId)!, voc: tools.minePains(nicheId, 'deep') };
}

/** The Studio pipeline exactly as the runtime chains it (flagged = sim GENERIC_PHRASES hits). */
async function studioPipeline(seed: number, brief: NicheBrief, voc: VoiceOfCustomer, playbook = REAL_STUDIO_PLAYBOOK) {
  const eng = heuristic(seed);
  const c = ctx({ playbook });
  const titles = await eng.writeTitles({ niche: brief, voc, count: 10 }, c);
  const outline = await eng.writeOutline({ title: titles[0]!, niche: brief, voc }, c);
  const pdf = await eng.writePdfContent({ title: titles[0]!, outline, niche: brief, voc, upsellTitle: null }, c);
  const flagged = genericPhraseHits(simNorm(pdfText(pdf))).found;
  const human = await eng.humanize({ content: pdf, flagged, voc }, c);
  const fc = await eng.factCheck({ content: human, voc }, c);
  return { eng, titles, outline, pdf, final: fc.content };
}

/** Body text of the guide outside the cover / promise page (title, subtitle and promise excluded). */
function bodyText(p: PdfContent): string {
  return allText({ introduction: p.introduction, chapters: p.chapters, bonus: p.bonus, next: p.nextStep.text });
}

function count(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n++;
  return n;
}

describe('the Red Team\'s verdict', () => {
  it('quotes a reason once: the head of a kill carries it, the list does not print it again', async () => {
    const eng = createContentEngine({ mode: 'heuristic', maxComputeEur: 0, seed: 7 });
    const facts = { title: 'Un guide', audience: 'parents', problem: 'sommeil', price: 9, competitors: { count: 3, medianPrice: 6, avgRating: 4, reviews: 20 }, voc: { pains: 5, medianAnchor: 6, sensitiveClaims: 0 } };
    const v = await eng.redTeam({ subject: 'idea', summary: 'Guide sommeil pour parents de bébés de 6 à 12 mois', quality: null, facts }, {} as MindContext);
    expect(v.verdict).toBe('kill');
    expect(v.reasons.filter((r) => r.includes('Marché trop bon marché'))).toHaveLength(1);
    expect(v.reasons.join(' ')).not.toContain('….');
  });
});

describe('a platform\'s rule stays with the ads', () => {
  const RULE = 'Sur Facebook & Instagram, ne jamais écrire « ventre »';

  it('reads apart from a rule for every text, in both parsers', () => {
    expect(parsePlaybook([RULE])).toMatchObject({ banned: [], platformBanned: ['ventre'] });
    expect(parsePlaybook(['Ne jamais écrire « garanti » dans une pub'])).toMatchObject({ banned: ['garanti'], platformBanned: [] });
    expect(parsePlaybook(['Sur Facebook & Instagram, ne jamais écrire « ventre » : la plateforme refuse la pub, et sa règle n\'est pas celle de TikTok.']).platformBanned).toEqual(['ventre']);
    expect(runtimeDirectives([RULE])).toMatchObject({ banned: [], platformBanned: ['ventre'] });
  });

  it('a guide and its lead magnet keep the word, an ad loses it', async () => {
    const engine = new HeuristicEngine({ seed: 7 });
    const ctx = { playbook: [RULE] } as MindContext;
    const content = { title: 'SOS Ventre', subtitle: '', audience: 'Femmes de 40 ans', promise: 'Le ventre s’installe malgré les efforts', introduction: ['Le ventre s’installe.'], chapters: [] } as unknown as PdfContent;
    const checked = await engine.factCheck({ content, voc: { nicheId: 'n', pains: [], desires: [], objections: [], phrases: [], priceAnchors: [], bannedClaims: [], reviewsSampled: 0 } as unknown as VoiceOfCustomer }, ctx);
    expect(checked.content.promise).toContain('ventre');
    expect(scrubText('Le ventre s’installe', parsePlaybook([RULE]).banned)).toBe('Le ventre s’installe');
    expect(scrubText('Le ventre s’installe', parsePlaybook([RULE]).platformBanned)).not.toContain('ventre');
  });
});

describe('content regressions: negations, fragments, repetitions', () => {
  it('a banned phrase with an apostrophe is parsed whole, never as the word « n »', () => {
    const rules = parsePlaybook(REAL_STUDIO_PLAYBOOK);
    expect(rules.banned).toContain("n'hésitez pas à");
    expect(rules.banned.every((b) => norm(b).replace(/[^a-z]/g, '').length >= 3)).toBe(true);
    // a stray one-letter rule is ignored instead of wrecking the text
    expect(parsePlaybook(['Ne jamais écrire « n »']).banned).toEqual([]);
    const text = 'Ce n’est ni un manque de volonté ni un manque d’amour. N’hésitez pas à adapter ces conseils. Nous ne les avons pas inventées : erreur n°1, la nuit.';
    const out = scrubText(text, rules.banned);
    expect(out).toBe('Ce n’est ni un manque de volonté ni un manque d’amour. Nous ne les avons pas inventées : erreur n°1, la nuit.');
    // a banned phrase inside a single sentence (list item) is removed with its sentence start re-capitalised
    expect(scrubText("N'hésitez pas à demander de l'aide", rules.banned)).toBe("Demander de l'aide");
  });

  it('negations survive the whole pipeline: 10 seeds × 3 real niches, with the real studio playbook', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const nicheId of REAL_NICHES) {
        const { brief, voc } = realResearch(seed, nicheId);
        const { titles, outline, pdf, final } = await studioPipeline(seed, brief, voc);
        for (const [label, v] of [['titles', titles], ['outline', outline], ['draft', pdf], ['final', final]] as const) {
          const text = allText(v);
          expect(text, `${nicheId}/${seed}/${label}`).not.toMatch(ORPHAN_APOSTROPHE);
          expect(text, `${nicheId}/${seed}/${label}`).not.toMatch(LOST_N_DEGREE);
        }
        const text = allText(final);
        expect(text).toContain('Erreur n°1');
        // the framing changes from one niche to the next: the negations themselves are what must survive
        expect(text).toMatch(/\bn[e’'][^.]{0,60}\b(pas|ni|jamais|plus|rien)\b/);
        expect((text.match(/\bn(?:e\b|['’])/g) ?? []).length).toBeGreaterThan(15);
        expect(norm(text)).not.toContain("n'hesitez pas a");
      }
    }
  });

  it('titles, labels and quotes are whole phrases; the promise is not repeated; scores stay ≥ 75', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const nicheId of REAL_NICHES) {
        const { brief, voc } = realResearch(seed, nicheId);
        const { titles, final } = await studioPipeline(seed, brief, voc);
        const where = `${nicheId}/${seed}`;
        for (const t of titles) {
          expect(t.length, `${where} « ${t} »`).toBeLessThanOrEqual(95);
          expect(t, where).not.toMatch(/…|\.\.\./);
          expect((t.match(/\s:\s/g) ?? []).length, `${where} « ${t} »`).toBeLessThanOrEqual(1);
          expect(endsDangling(t.replace(/\s*\([^)]*\)$/, '')), `${where} « ${t} »`).toBe(false);
        }
        expect(final.title.length).toBeLessThanOrEqual(95);
        // the introduction describes the PAIN, never the promise
        const promised = norm(final.promise.split(' : ').slice(1).join(' : '));
        expect(promised.length).toBeGreaterThan(8);
        expect(norm(final.introduction[0]!), where).not.toContain(promised);
        expect([brief.problem, ...voc.pains].some((p) => norm(final.introduction[0]!).includes(norm(p).slice(0, 30))), where).toBe(true);
        expect(count(norm(bodyText(final)), promised), `${where} promesse répétée`).toBeLessThanOrEqual(2);
        expect(norm(allText(final))).not.toContain('ce que decrivent ceux qui ont reussi');
        // « La suite est ici » is the layout's, not the title's
        expect(final.nextStep.title).not.toMatch(/^la suite est ici/i);
        expect(final.nextStep.title.length).toBeGreaterThan(5);
        for (const ch of [...final.chapters, final.bonus]) {
          const v = ch.visual;
          if (!v) continue;
          for (const l of v.labels) {
            expect(l, `${where} ${v.type}`).not.toMatch(/…/);
            expect(endsDangling(l.replace(/^À (?:faire|éviter) : /, '')), `${where} ${v.type} « ${l} »`).toBe(false);
          }
          if (v.type === 'bar_chart') {
            expect(v.labels.every((l) => l.length <= 40), `${where} ${v.labels.join(' | ')}`).toBe(true);
            expect(v.values).toHaveLength(v.labels.length);
            expect(v.values.every((x) => x >= 0 && x <= 100)).toBe(true);
          }
          if (v.type === 'do_dont') expect(v.labels.every((l) => /^À (faire|éviter) : \S/.test(l)), v.labels.join(' | ')).toBe(true);
          if (v.type === 'do_dont') expect(v.labels.some((l) => l.startsWith('À faire')) && v.labels.some((l) => l.startsWith('À éviter'))).toBe(true);
          if (v.type === 'quote') { expect(v.labels[0]).not.toMatch(/[«»]/); expect(v.labels.length).toBeGreaterThanOrEqual(2); }
          if (v.type === 'timeline') expect(v.labels.every((l) => /^.{2,32}? : \S/.test(l)), v.labels.join(' | ')).toBe(true);
        }
        // the pull-quote of a chapter is not repeated by the example right under it
        for (const ch of final.chapters) {
          if (ch.visual?.type === 'quote' && ch.example) expect(norm(ch.example)).not.toContain(norm(ch.visual.labels[0]!));
        }
        const q = scorePdf(final, { audience: brief.audience, problem: brief.problem, voc, design: designFor({ nicheName: brief.name, category: brief.category, seed }) });
        expect(q.overall, `${where} ${q.issues.join(" | ")}`).toBeGreaterThanOrEqual(75); // the v1: the scorer asks more than a first draft holds, the rework gets it higher
      }
    }
  });

  it('an upsell brief whose « problem » is a desired outcome still opens on the pain', async () => {
    const { brief, voc } = realResearch(42, 'proprete-chiot');
    const goal = voc.desiredOutcomes[0]!;
    const upsell = { ...brief, problem: goal };
    const { final } = await studioPipeline(42, upsell, voc);
    expect(norm(final.introduction[0]!)).not.toContain(norm(goal));
    expect(count(norm(bodyText(final)), norm(goal))).toBeLessThanOrEqual(2);
  });

  it('sales page, hooks and ad never show a cut fragment or an ellipsis', async () => {
    for (const nicheId of REAL_NICHES) {
      for (const seed of [2, 7]) {
        const { brief, voc } = realResearch(seed, nicheId);
        const { eng, final } = await studioPipeline(seed, brief, voc);
        const prod = product({ nicheId, title: final.title, audience: brief.audience, problem: brief.problem, content: final });
        const sp = await eng.writeSalesPage({ product: prod, content: final, voc, hype: 0.4 }, ctx());
        expect(new Set(sp.objections.map((o) => o.a)).size).toBe(sp.objections.length); // no copy-pasted answer
        const hooks = await eng.writeAdHooks({ product: prod, voc, styles: ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'] }, ctx());
        for (const h of hooks) {
          expect(h.hook.length).toBeLessThanOrEqual(90);
          expect(h.hook, `${nicheId} ${h.hookStyle}`).not.toMatch(/…/);
          expect(h.hook).not.toMatch(/ce n’est pas « normal » que/);
        }
        const ad = await eng.writeAd({ product: prod, voc, hook: hooks[0]!.hook, hookStyle: hooks[0]!.hookStyle, format: 'text_slideshow', bannedClaims: voc.bannedClaims }, ctx());
        for (const s of ad.scenes) {
          expect(s.onScreenText.length).toBeLessThanOrEqual(50);
          expect(s.onScreenText, nicheId).not.toMatch(/…/);
        }
        expect(allText(sp)).not.toMatch(ORPHAN_APOSTROPHE);
      }
    }
  });
});

describe('content regressions: chat persona, niche-scoped rules, brand and customer name', () => {
  it('the heuristic chat never reads the system persona back and answers in the first person', async () => {
    const eng = heuristic(3);
    const situation = [
      'Tu es Camille, CEO chez Pixel Agency (département direction, chef de département).',
      'Personnalité et façon de travailler : Calme, exigeante et obsédée par la rentabilité.',
      'Ma tâche en cours : « Stand-up et plan du jour » (en cours).',
      'Hier : 4 ventes, 76 € de CA, 30 € de pub, ROAS 2,5.',
      'Trésorerie 512 €, profit cumulé 12 €.',
      'Contexte : Camille, CEO (Direction) chez Pixel Agency, jour 5.',
    ].join('\n');
    for (const text of ['Combien de ventes hier ?', 'Tu fais quoi en ce moment ?', 'Salut', 'Pourquoi le ROAS baisse ?']) {
      const r = await eng.chat({ history: [], text, situation }, ctx({ brand: 'Pixel Agency' }, { id: 'camille', name: 'Camille', role: 'CEO', dept: 'direction', skills: ['Stratégie', 'Arbitrage'] }));
      expect(r, text).not.toMatch(/\bTu es\b/);
      expect(r).not.toMatch(/Personnalité|Contexte :/);
      expect(splitSentences(r).length, r).toBeGreaterThanOrEqual(2);
      expect(splitSentences(r).length, r).toBeLessThanOrEqual(4);
      expect(r).toMatch(/\b(je|j’|j'|mon|ma|on)\b/i);
    }
    const sales = await eng.chat({ history: [], text: 'Combien de ventes hier ?', situation }, ctx({}, { name: 'Camille', role: 'CEO' }));
    expect(sales).toContain('4 ventes');
  });

  it('the heuristic chat answers from the line that matches the question, and each role adds its own angle', async () => {
    const eng = heuristic(4);
    const situation = [
      'Ma tâche en cours : « Rapport du jour 11 » (en cours).',
      'Hier : 0 ventes, 0 € de CA, 40 € de pub, ROAS 0,00, résultat -60 €.',
      'Mon poste : Budget : enveloppe pub du jour 120 €.',
      'Meilleur produit sur 7 jours : « Le guide du sommeil » avec 150 € de profit (5 ventes, 150 € de CA, ROAS 3,00).',
      "Cause d'hier : panne de paiement du jour 11, annoncée par le prestataire, aucune vente possible ce jour-là, 40 € de pub perdus.",
      'Mission du fondateur (jour 8) « Lance un guide sur le potager sur le balcon » : en cours, produit « Mon balcon » en rédaction, 4/20 tâches terminées.',
      'Mission du fondateur (jour 9) « Baisse le prix du guide » : terminée.',
    ].join('\n');
    const as = (id: string, name: string, role: string, dept: string) => ctx({}, { id, name, role, dept } as never);
    const ask = (text: string, who = as('gabriel', 'Gabriel', 'CFO', 'finance')) => eng.chat({ history: [], text, situation }, who);
    expect(await ask('Pourquoi on a perdu de l’argent hier ?')).toMatch(/panne de paiement du jour 11/i);
    expect(await ask('Quel est notre meilleur produit et pourquoi ?')).toMatch(/notre meilleur produit sur 7 jours est « Le guide du sommeil » avec 150 € de profit/i);
    const mission = await ask('Où en est le guide sur le potager ?');
    expect(mission).toMatch(/potager/);
    expect(mission).toMatch(/4\/20 tâches/);
    expect(mission).not.toMatch(/Baisse le prix/);
    expect(await ask('Où en sont les missions ?')).toMatch(/Baisse le prix/);
    // A question that shares one word with a mission is not about it.
    expect(await ask('Quel prix pour le guide ?')).not.toMatch(/Mission du fondateur|ta mission/);
    const cfo = await ask('Pourquoi on a perdu de l’argent hier ?');
    const growth = await ask('Pourquoi on a perdu de l’argent hier ?', as('leo', 'Léo', 'Head of growth', 'growth'));
    expect(cfo).toMatch(/enveloppe/);
    expect(growth).toMatch(/campagnes/);
    expect(cfo).not.toBe(growth);
    for (const r of [cfo, growth, mission]) {
      expect(splitSentences(r).length, r).toBeGreaterThanOrEqual(2);
      expect(splitSentences(r).length, r).toBeLessThanOrEqual(4);
      expect(r).not.toMatch(/Mon poste|Mon analyse/);
    }
  });

  it('niche-scoped machine rules apply to their niche only; unscoped rules apply everywhere', async () => {
    const eng = heuristic(5);
    const playbook = [
      'Prix cible « 24 » sur « Relooker un meuble ancien sans le rater » : 0,63 € de profit par visiteur contre 0,51 € à 29 €.',
      'Privilégier le hook « pov » (POV) sur « Chat qui griffe le canapé » : CTR 5,21 % contre 3,13 %.',
    ];
    const sig = (nicheId: string, name: string) => ({ nicheId, name, audience: 'x', category: 'c', searchInterest: 50, tiktokBuzz: 50, competitionHint: 'faible' as const, sampleTitles: [] });
    const r = await eng.rankOpportunities({ signals: [sig('relooker-meuble', 'Relooker un meuble ancien sans le rater'), sig('sommeil-bebe', 'Sommeil de bébé')], competitors: {}, voc: { 'sommeil-bebe': VOC }, excludeNicheIds: [] }, ctx({ playbook }));
    expect(r.ranked.find((x) => x.nicheId === 'relooker-meuble')!.suggestedPrice).toBe(24);
    expect(r.ranked.find((x) => x.nicheId === 'sommeil-bebe')!.suggestedPrice).not.toBe(24);
    const chat = product({ nicheId: 'chat-griffe-canape', title: 'Le chat détruit le canapé : la méthode simple en 14 jours', problem: 'Le chat détruit le canapé et les meubles en les griffant', audience: "Propriétaires d'un chat d'intérieur" });
    expect((await eng.writeAdHooks({ product: chat, voc: VOC, styles: ['question', 'mistake'] }, ctx({ playbook })))[0]!.hookStyle).toBe('pov');
    const bebe = await eng.writeAdHooks({ product: product(), voc: VOC, styles: ['question', 'mistake'] }, ctx({ playbook }));
    expect(bebe.map((h) => h.hookStyle)).toEqual(['question', 'mistake']);
    // unscoped: everywhere
    const all = await eng.writeAdHooks({ product: product(), voc: VOC, styles: ['question'] }, ctx({ playbook: ['Privilégier le hook « stat » : il gagne l’expérience.'] }));
    expect(all[0]!.hookStyle).toBe('stat');
    expect(parsePlaybook(['Prix cible « 19 »', 'Prix cible « 29 » sur « Sommeil de bébé »'], ['sommeil-bebe', 'Sommeil de bébé']).targetPrice).toBe(29);
    expect(parsePlaybook(['Prix cible « 19 »', 'Prix cible « 29 » sur « Sommeil de bébé »'], ['proprete-chiot', 'Propreté du chiot']).targetPrice).toBe(19);
  });

  it('uses ctx.brand in signatures, outreach and sales pages, and greets the customer by name', async () => {
    const eng = heuristic(2);
    const c = ctx({ brand: 'Atelier Lumen' });
    const r = await eng.writeSupportReply({ message: message({ subject: 'PDF', body: "Je n'ai jamais reçu le PDF" }), product: product(), order: ORDER, policy: [], customer: { name: 'Sophie M.', archetype: 'normal' } }, c);
    expect(r.text.startsWith('Bonjour Sophie,')).toBe(true);
    expect(r.text).toContain('Service client Atelier Lumen');
    const anon = await eng.writeSupportReply({ message: message({ subject: 'PDF', body: "je n'ai jamais reçu le pdf" }), product: product(), order: ORDER, policy: [] }, ctx({ brand: 'Atelier Lumen', playbook: ['Ton support « formel »'] }));
    expect(anon.text.startsWith('Bonjour,')).toBe(true);
    const dm = await eng.writeOutreach({ creator: { id: 'c', handle: 'lea', nicheId: 'n', followers: 1000, avgViews: 500, engagement: 0.05, askUpfront: 0, askCommission: 0.3, redFlags: [] }, product: product(), offer: { upfront: 0, commission: 0.3 } }, c);
    expect(dm).toContain('Atelier Lumen');
    const sp = await eng.writeSalesPage({ product: product(), content: await draft(2), voc: VOC, hype: 0.2 }, c);
    expect(sp.guarantee).toContain('Atelier Lumen');
  });

  it('Claude output is normalised to the same conventions (nextStep title, do/don’t prefixes, quotes)', async () => {
    const fb = await draft(6);
    const ch = fb.chapters.map((x, i) => (i === 0 ? { ...x, visual: { type: 'do_dont', title: 'T', labels: ['Gronder après coup', 'Crier', 'Récompenser dehors', 'Sortir après la sieste'], values: [] } }
      : i === 1 ? { ...x, visual: { type: 'quote', title: 'Q', labels: ['« il se réveille toutes les 2h »', 'Un parent'], values: [] } } : x));
    const client: ClaudeClientLike = { messages: { create: async () => fakeMessage({ ...fb, chapters: ch, nextStep: { title: 'La suite est ici : Les siestes sans larmes', text: fb.nextStep.text } }) } };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 6, client, log: () => {} });
    const out = await eng.writePdfContent({ title: fb.title, outline: { title: fb.title, chapters: fb.chapters.map((c) => ({ title: c.title, points: c.steps })), bonusTitle: fb.bonus.title, nextStepTitle: 'x' }, niche: NICHE, voc: VOC, upsellTitle: 'Les siestes sans larmes' }, ctx());
    expect(out.nextStep.title).toBe('Les siestes sans larmes');
    expect(out.chapters[0]!.visual!.labels).toEqual(['À éviter : gronder après coup', 'À éviter : crier', 'À faire : récompenser dehors', 'À faire : sortir après la sieste']);
    expect(out.chapters[1]!.visual!.labels[0]).toBe('il se réveille toutes les 2h');
  });
});

// ───────────────────────────── one guide per niche, not one template (founder review) ─────────────────────────────

/** Sentences of a guide, normalised; a sentence under 5 words is not a sentence the reader would spot. */
function sentencesOf(p: PdfContent): string[] {
  const texts = [...p.introduction, ...[...p.chapters, p.bonus].flatMap((c) => [c.intro, ...c.paragraphs, ...c.steps, c.example ?? '', ...c.checklist]), p.nextStep.text];
  return texts.flatMap((t) => splitSentences(t)).map((x) => norm(x).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()).filter((x) => x.split(' ').length >= 5);
}

function shared(a: PdfContent, b: PdfContent): number {
  const x = sentencesOf(a);
  const y = new Set(sentencesOf(b));
  return x.filter((s) => y.has(s)).length / Math.min(x.length, y.size);
}

async function fullGuide(nicheId: string, seed: number, upsellOf: UpsellContext | null = null): Promise<{ brief: NicheBrief; voc: VoiceOfCustomer; pdf: PdfContent }> {
  const { brief, voc } = realResearch(seed, nicheId);
  const eng = heuristic(seed);
  const c = ctx();
  const titles = await eng.writeTitles({ niche: brief, voc, count: 10, upsellOf }, c);
  const outline = await eng.writeOutline({ title: titles[0]!, niche: brief, voc, upsellOf }, c);
  const draft0 = await eng.writePdfContent({ title: titles[0]!, outline, niche: brief, voc, upsellTitle: null, upsellOf }, c);
  const h = await eng.humanize({ content: draft0, flagged: findCliches(draft0), voc }, c);
  return { brief, voc, pdf: (await eng.factCheck({ content: h, voc }, c)).content };
}

const ALL_NICHES = NICHE_CATALOG.map((n) => n.id);
const planOf = (p: PdfContent) => p.chapters.find((c) => c.visual?.type === 'grid' && (c.visual.grid?.columns.at(-1) === 'Fait'))!;

describe('every niche gets its own guide', () => {
  it('each niche of the catalog names its archetype, and the writer finds it from the public brief alone', () => {
    expect(PROFILED_NICHES.slice().sort()).toEqual(ALL_NICHES.slice().sort());
    for (const n of NICHE_CATALOG) {
      expect(n.voc.knowledge.archetype, n.id).toBeTruthy();
      const { brief, voc } = realResearch(3, n.id);
      expect(voc.knowledge.archetype).toBeUndefined(); // the research tool does not forward it yet
      expect(archetypeOf(brief, voc), n.id).toBe(n.voc.knowledge.archetype);
      expect(classifyArchetype(brief), `${n.id} sans profil`).toBe(n.voc.knowledge.archetype);
    }
  });

  it('two different niches share under 20 % of their sentences', async () => {
    const guides = await Promise.all(ALL_NICHES.map((id) => fullGuide(id, 5)));
    for (let i = 0; i < guides.length; i++) {
      for (let j = i + 1; j < guides.length; j++) {
        expect(shared(guides[i]!.pdf, guides[j]!.pdf), `${ALL_NICHES[i]} / ${ALL_NICHES[j]}`).toBeLessThan(0.2);
      }
    }
  });

  it('a one-off project never reads like a change of habit, and its bonus fits it', async () => {
    const { pdf } = await fullGuide('relooker-meuble', 8);
    const text = norm(allText(pdf));
    expect(text).not.toMatch(/au meme moment|chaque jour|jour apres jour|sans rien changer|habitude/);
    expect(pdf.chapters.map((c) => norm(c.title)).join(' ')).not.toMatch(/recommence|observation/);
    expect(norm(pdf.bonus.title)).toMatch(/preparation|sous-couche|finition/);
    expect(pdf.bonus.visual?.grid?.rows).toContain('Bois verni');
  });

  it('no sentence is repeated inside a guide, draft or final', async () => {
    for (const id of ALL_NICHES) {
      for (const seed of [2, 9]) {
        const { pdf } = await fullGuide(id, seed);
        const list = sentencesOf(pdf).filter((x) => x.split(' ').length >= 6);
        const seen = new Set<string>();
        const dup = list.filter((x) => (seen.has(x) ? true : (seen.add(x), false)));
        expect(dup, `${id}/${seed}`).toEqual([]);
      }
    }
  });

  it('no tip is used twice, the introduction included', async () => {
    for (const id of ['batch-cooking-budget', 'proprete-chiot', 'stress-bac']) {
      const { voc, pdf } = await fullGuide(id, 4);
      const { core } = parseKnowledge(voc.knowledge);
      const prose = [...pdf.introduction, ...[...pdf.chapters, pdf.bonus].flatMap((c) => [...c.paragraphs, ...c.steps])].map((x) => norm(x)).join(' \n ');
      for (const tip of core.tips) {
        const key = norm(tip).replace(/[.:].*$/, '').slice(0, 34);
        expect((prose.match(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, tip).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a quote inside a quote never breaks the guillemets', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const text of [allText((await fullGuide('mariage-moins-10k', seed)).pdf), allText((await fullGuide('freelance-linkedin', seed)).pdf)]) {
        expect(text).not.toMatch(/«[^»]*«/);
      }
    }
  });

  it('guillemets stay balanced in every text of every guide, whatever the editing passes do', async () => {
    expect(bare('Viser « toutes les entreprises »')).toBe('Viser « toutes les entreprises »');
    expect(bare('« il hurle dès qu’on le pose »')).toBe('il hurle dès qu’on le pose');
    expect(splitSentences('« Vous êtes là ? » Soyez patient.')).toEqual(['« Vous êtes là ? »', 'Soyez patient.']);
    for (const id of ['freelance-linkedin', 'oral-aide-soignante', 'revendre-vinted']) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { pdf } = await fullGuide(id, seed);
        const texts = [...pdf.introduction, ...[...pdf.chapters, pdf.bonus].flatMap((c) => [c.intro, ...c.paragraphs, ...c.steps, c.example ?? '', ...c.checklist])];
        for (const t of texts) expect((t.match(/«/g) ?? []).length, `${id}/${seed} ${t}`).toBe((t.match(/»/g) ?? []).length);
      }
    }
  });

  it('customer slang is cleaned before being quoted, and the quote stays recognisable', async () => {
    expect(speakable('le tapis éducateur il le mange lol')).toBe('le tapis éducateur il le mange');
    expect(speakable('jai un congélateur minuscule')).toBe('j’ai un congélateur minuscule');
    expect(speakable('jsuis en PLS à 2 mois du bac')).toBe('je suis en PLS à 2 mois du bac');
    expect(speakable('200 balles de courses par semaine')).toBe('200 € de courses par semaine');
    expect(speakable('il mange assez ??')).toBe('il mange assez ?');
    for (const id of ['proprete-chiot', 'batch-cooking-budget', 'stress-bac', 'dme-diversification']) {
      for (const seed of [1, 6, 11]) {
        const text = allText((await fullGuide(id, seed)).pdf);
        expect(text, id).not.toMatch(/\blol\b|\bjai\b|\bjsuis\b|\bjveux\b|\bballes\b|\bgosses\b|\?\?/i);
      }
    }
  });
});

describe('mistakes, plan, charts and bonus keep their promises', () => {
  it('stores each mistake with its own fix, and renders exactly what the title announces', async () => {
    for (const n of NICHE_CATALOG) {
      for (const raw of n.voc.knowledge.mistakes) expect(parseMistake(raw.replace(/^\[[a-z-]+\]\s*/, '')).fix, raw).toBeTruthy();
    }
    for (const id of ALL_NICHES) {
      const { voc, pdf } = await fullGuide(id, 7);
      const { core } = parseKnowledge(voc.knowledge);
      const ch = pdf.chapters.find((c) => c.paragraphs.some((p) => /Erreur n°1 :/.test(p)))!;
      const announced = Number(/(\d+)/.exec(ch.title)![1]);
      const errors = ch.paragraphs.filter((p) => /Erreur n°\d+ :/.test(p));
      expect(errors, id).toHaveLength(announced);
      for (const para of errors) {
        const pair = core.pairs.find((x) => norm(para).includes(norm(x.mistake).slice(0, 30)))!;
        expect(pair, para).toBeTruthy();
        expect(norm(para), para).toContain(norm(pair.fix!).replace(/\s+:\s+/g, ' — ').replace(/\.$/, '').slice(0, 30));
      }
    }
  });

  it('the plan keeps every method step and never repeats the diagnostic', async () => {
    for (const id of ALL_NICHES) {
      for (const seed of [3, 12]) {
        const { voc, pdf } = await fullGuide(id, seed);
        const method = parseKnowledge(voc.knowledge).core.steps;
        const plan = planOf(pdf);
        expect(plan, id).toBeTruthy();
        const body = norm([...plan.steps, ...(plan.visual!.grid!.cells ?? []).flat().filter(Boolean)].join(' \n '));
        for (const s of method.filter((x) => !x.diagnostic).slice(0, 8)) expect(body, `${id} : ${s.text}`).toContain(norm(s.text).replace(/\s+:\s+/g, ' — ').slice(0, 28));
        for (const s of method.filter((x) => x.diagnostic)) expect(body, id).not.toContain(norm(s.text).slice(0, 28));
      }
    }
  });

  it('« jour après jour » is a real line per day; other plans are titled honestly', async () => {
    for (const id of ALL_NICHES) {
      const { pdf } = await fullGuide(id, 4);
      const plan = planOf(pdf);
      const g = plan.visual!.grid!;
      const m = /\bde (\d+) (jours|nuits|semaines), (?:jour|nuit|semaine) apr[eè]s (?:jour|nuit|semaine)/i.exec(plan.title);
      if (m) {
        expect(g.rows, id).toHaveLength(Number(m[1]));
        expect(g.cells!.every((row) => !!row[0]), id).toBe(true);
      } else {
        expect(norm(plan.title), id).not.toMatch(/jour apres jour|nuit apres nuit/);
      }
    }
    const { pdf } = await fullGuide('relooker-meuble', 4);
    expect(norm(planOf(pdf).title)).toMatch(/etape par etape/);
  });

  it('habits run in parallel from day 1; a project is a true sequence with its durations', async () => {
    const chiot = planOf((await fullGuide('proprete-chiot', 2)).pdf);
    const first = chiot.visual!.grid!.cells![0]![0]!;
    expect((first.match(/;/g) ?? []).length, first).toBeGreaterThanOrEqual(1);
    const meuble = planOf((await fullGuide('relooker-meuble', 2)).pdf);
    expect(meuble.steps.join(' ')).toMatch(/\d+ (h|min)\b/);
    expect(meuble.visual!.grid!.rows.length).toBeGreaterThanOrEqual(4);
  });

  it('merged research passes cannot shuffle the method: the rank restores its order', () => {
    const k = { tips: [], mistakes: [], examples: [], facts: [], steps: ['Peindre. (étape 3 ; jour 2)', 'Dégraisser. (étape 2 ; jour 1)', 'Inspecter. (étape 1 ; diagnostic)'] };
    const { core } = parseKnowledge(k);
    expect(core.steps.map((s) => s.text)).toEqual(['Inspecter', 'Dégraisser', 'Peindre']);
    expect(parseStep('Notez tout. (étape 1 ; jours 1 à 14)', 0)).toMatchObject({ from: 1, to: 14, diagnostic: false });
  });

  it('a mistake never appears as a bare label under a neutral title', async () => {
    const { voc, pdf } = await fullGuide('dme-diversification', 8);
    const mistakes = parseKnowledge(voc.knowledge).core.pairs.map((p) => norm(p.mistake).slice(0, 18));
    for (const ch of [...pdf.chapters, pdf.bonus]) {
      if (ch.visual?.type !== 'icon_grid' && ch.visual?.type !== 'steps_diagram') continue;
      for (const l of ch.visual.labels) expect(mistakes.some((m) => norm(l).startsWith(m)), l).toBe(false);
    }
  });

  it('no chart carries a number that was not measured', async () => {
    for (const id of ALL_NICHES) {
      const { pdf } = await fullGuide(id, 6);
      for (const ch of [...pdf.chapters, pdf.bonus]) {
        expect(ch.visual?.type, id).not.toBe('bar_chart');
        expect(ch.visual?.values ?? [], id).toEqual([]);
      }
    }
    // a chart received without its numbers becomes a list: nothing fills the gap with invented bars
    const v = ensureVisual({ type: 'bar_chart', title: 'T', labels: ['a', 'b'] }, null)!;
    expect(v.type).toBe('icon_grid');
    expect(v.values).toEqual([]);
  });

  it('persona stories are labelled as examples and never claim a result; no « exemples réels » anywhere', async () => {
    for (const n of NICHE_CATALOG) {
      for (const ex of n.voc.knowledge.examples) {
        if (/^(\[[a-z-]+\] )?Modèle/.test(ex)) continue;
        expect(norm(ex), ex).not.toMatch(/ont cesse|a disparu|sont passes? de|ont ete admis|a obtenu|a gagne|gagne \d+ points|en \d+ semaines|depuis un mois/);
      }
    }
    for (const id of ['proprete-chiot', 'ventre-apres-40', 'toeic-800']) {
      const { pdf } = await fullGuide(id, 3);
      for (const ch of pdf.chapters) if (ch.example) expect(ch.example, id).toMatch(/^(Exemple type|Mise en situation) :/);
      expect(norm(allText(pdf))).not.toMatch(/exemples? reels?/);
      const prod = product({ nicheId: id, content: pdf, title: pdf.title });
      const eng = heuristic(3);
      const page = await eng.writeSalesPage({ product: prod, content: pdf, voc: VOC, hype: 0.3 }, ctx());
      expect(norm(allText(page))).not.toMatch(/exemples? reels?/);
      const ad = await eng.writeAd({ product: prod, voc: realResearch(3, id).voc, hook: 'Regarde ça avant ce soir.', hookStyle: 'question', format: 'carousel', bannedClaims: [] }, ctx());
      expect(allText(ad), id).not.toMatch(/Un cas concret|Sophie|Manon|Nathalie|Éric|Hugo/);
    }
  });

  it('the bonus exists in the guide as a fillable sheet, and the ad promises that same bonus', async () => {
    for (const id of ALL_NICHES) {
      const { pdf, voc } = await fullGuide(id, 5);
      const v = pdf.bonus.visual!;
      expect(v.type, id).toBe('grid');
      expect(v.labels, id).toEqual([]);
      expect(v.grid!.columns.length, id).toBeGreaterThanOrEqual(2);
      expect(v.grid!.rows.length, id).toBeGreaterThanOrEqual(4);
      const promised = /\b(\d+) (jours|nuits|semaines)\b/.exec(pdf.bonus.title);
      if (promised) expect(v.grid!.rows, `${id} : ${pdf.bonus.title}`).toHaveLength(Number(promised[1]));
      for (const ch of [...pdf.chapters, pdf.bonus]) expect(ch.visual?.type, id).not.toBe('checklist_card');
      const prod = product({ nicheId: id, content: pdf, title: pdf.title, audience: pdf.audience });
      const bonusName = norm(pdf.bonus.title.replace(/^Bonus : /, ''));
      let seen = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const text = norm(allText(await heuristic(seed).writeAd({ product: prod, voc, hook: 'Regarde ça avant ce soir.', hookStyle: 'question', format: 'carousel', bannedClaims: [] },ctx())));
        expect(text, id).not.toContain('fiche sos');
        if (text.includes(bonusName)) seen++;
      }
      expect(seen, id).toBeGreaterThan(0);
    }
  });

  it('a heuristic draft stays valid through the shape guards, grid included', async () => {
    const { pdf } = await fullGuide('urssaf-micro', 9);
    const again = nPdf(JSON.parse(JSON.stringify(pdf)), pdf);
    expect(again.bonus.visual?.grid).toEqual(pdf.bonus.visual?.grid);
    expect(again.chapters.map((c) => c.steps.length)).toEqual(pdf.chapters.map((c) => c.steps.length));
    expect(ensureVisual({ type: 'grid', title: 'T', labels: [], values: [], grid: { columns: ['Jour'], rows: ['1'] } }, null)).toBeNull();
    // Claude dropped the printable the bonus promises: it comes back
    const lazy = JSON.parse(JSON.stringify(pdf));
    lazy.bonus.visual = { type: 'checklist_card', title: 'x', labels: ['a'], values: [] };
    expect(nPdf(lazy, pdf).bonus.visual?.type).toBe('grid');
  });
});

describe('the cover names the guide\'s real problem', () => {
  it('the opportunity ranking gives the main problem of the niche, not the first pain of the sample', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const { voc } = realResearch(seed, 'sommeil-bebe');
      const r = await heuristic(seed).rankOpportunities({ signals: [{ nicheId: 'sommeil-bebe', name: 'Sommeil', audience: 'Parents', category: 'p', searchInterest: 50, tiktokBuzz: 50, competitionHint: 'faible', sampleTitles: [] }], competitors: {}, voc: { 'sommeil-bebe': voc }, excludeNicheIds: [] }, ctx());
      expect(r.ranked[0]!.problem).toBe('Bébé se réveille plusieurs fois par nuit');
    }
  });
});

describe('the last page and the follow-up guide', () => {
  it('the next step is honest with or without a follow-up, and can be recomputed when one is linked', async () => {
    const none = nextStepFor({ audience: 'les parents', upsell: null });
    expect(none.upsellProductId).toBeNull();
    expect(none.title).toBe('Votre prochaine étape');
    expect(norm(none.text)).not.toMatch(/en preparation|reprend|disponible|notre prochain guide/);
    const linked = nextStepFor({ audience: 'les parents', upsell: { title: 'Objectif « Un chiot propre »', productId: 'prd_9' } });
    expect(linked.upsellProductId).toBe('prd_9');
    expect(linked.title).toBe('Objectif « Un chiot propre »');
    expect(linked.text).toContain('“Un chiot propre”');
    expect(linked.text).not.toMatch(/« [^»]*«/);
    const { pdf } = await fullGuide('proprete-chiot', 3);
    expect(pdf.nextStep).toMatchObject({ title: 'Votre prochaine étape', upsellProductId: null });
  });

  it('an upsell is a different guide on a distinct sub-problem', async () => {
    for (const id of ALL_NICHES) {
      const parent = (await fullGuide(id, 8)).pdf;
      const upsellOf: UpsellContext = { parentTitle: parent.title, parentPromise: parent.promise, parentChapterTitles: parent.chapters.map((c) => c.title) };
      const { pdf } = await fullGuide(id, 8, upsellOf);
      expect(norm(pdf.title), id).not.toBe(norm(parent.title));
      expect(norm(pdf.promise), id).not.toBe(norm(parent.promise));
      const titles = new Set(parent.chapters.map((c) => norm(c.title)));
      expect(pdf.chapters.filter((c) => titles.has(norm(c.title))), id).toEqual([]);
      expect(norm(pdf.bonus.title), id).not.toBe(norm(parent.bonus.title));
      const a = sentencesOf(pdf);
      const b = new Set(sentencesOf(parent));
      expect(a.filter((s) => b.has(s)).length / a.length, id).toBeLessThan(0.2);
      expect(pdf.wordCount, id).toBeGreaterThanOrEqual(1300);
      expect(pdf.chapters.length, id).toBeGreaterThanOrEqual(5);
    }
  });

  it('a second follow-up does not rewrite the first one', async () => {
    const parent = (await fullGuide('toeic-800', 6)).pdf;
    const first = (await fullGuide('toeic-800', 6, { parentTitle: parent.title, parentPromise: parent.promise, parentChapterTitles: parent.chapters.map((c) => c.title) })).pdf;
    const second = (await fullGuide('toeic-800', 6, { parentTitle: first.title, parentPromise: first.promise, parentChapterTitles: first.chapters.map((c) => c.title) })).pdf;
    expect(norm(second.title)).not.toBe(norm(first.title));
    expect(norm(second.promise)).not.toBe(norm(first.promise));
  });

  it('the writer follows the subject chosen for the product: a customer pain keeps away from the prepared sub-problem', async () => {
    const parent = await fullGuide('proprete-chiot', 8);
    const pain = 'L’odeur d’urine reste malgré les nettoyages';
    const upsellOf: UpsellContext = { parentTitle: parent.pdf.title, parentPromise: parent.pdf.promise, parentChapterTitles: parent.pdf.chapters.map((c) => c.title), topicId: null };
    const brief = { ...parent.brief, problem: pain };
    const c = buildNicheCtx(brief, parent.voc, upsellOf);
    expect(c.topic).toBeNull();
    expect(c.problem).toBe(lf(pain));
    expect(norm(c.goal ?? '')).not.toBe('');
    expect(norm(parent.pdf.promise)).not.toContain(norm(c.goal ?? ''));
    const eng = heuristic(3);
    const titles = await eng.writeTitles({ niche: brief, voc: parent.voc, count: 5, upsellOf }, ctx());
    const outline = await eng.writeOutline({ title: titles[0]!, niche: brief, voc: parent.voc, upsellOf }, ctx());
    const pdf = await eng.writePdfContent({ title: titles[0]!, outline, niche: brief, voc: parent.voc, upsellTitle: null, upsellOf }, ctx());
    expect(norm(pdf.promise)).not.toBe(norm(parent.pdf.promise));
    expect(norm(pdf.promise.split(' : ').pop()!)).not.toBe(norm(parent.pdf.promise.split(' : ').pop()!));
    const named = { ...upsellOf, topicId: upsellTopics('proprete-chiot')[0]!.id };
    expect(buildNicheCtx(brief, parent.voc, named).topic?.id).toBe(named.topicId);
  });

  it('a main guide leaves the outcome of its follow-up to the follow-up', () => {
    const niche = catalogNiche('ventre-apres-40')!;
    const brief = { nicheId: niche.id, name: niche.name, audience: niche.audience, problem: niche.problem, category: niche.category, keywords: niche.keywords };
    const voc = { ...niche.voc, desiredOutcomes: ['Arrêter le grignotage du soir', 'Retrouver de l’énergie au quotidien'] };
    expect(norm(promiseOutcome(buildNicheCtx(brief, voc)))).toBe(norm('retrouver de l’énergie au quotidien'));
    // nothing else on offer: the guide still promises something
    expect(norm(promiseOutcome(buildNicheCtx(brief, { ...voc, desiredOutcomes: ['Arrêter le grignotage du soir'] })))).toContain('grignotage');
  });

  it('a niche without prepared sub-problem still produces a different title and chapters', async () => {
    const eng = heuristic(2);
    const upsellOf: UpsellContext = { parentTitle: 'Bébé se réveille toutes les 2 heures', parentPromise: 'Un plan de 14 nuits', parentChapterTitles: ['Pourquoi ça recommence malgré vos efforts'] };
    const niche = { ...NICHE, nicheId: 'inconnue' };
    const titles = await eng.writeTitles({ niche, voc: VOC, count: 5, upsellOf }, ctx());
    expect(titles.map(norm)).not.toContain(norm(upsellOf.parentTitle));
    const outline = await eng.writeOutline({ title: titles[0]!, niche, voc: VOC, upsellOf }, ctx());
    expect(outline.chapters.map((c) => c.title)).not.toContain(upsellOf.parentChapterTitles[0]);
    expect(buildNicheCtx(niche, VOC, upsellOf).pbClause).not.toBe(norm(upsellOf.parentTitle));
    const pdf = heuristicPdfContent({ title: titles[0]!, outline, niche, voc: VOC, upsellTitle: null, upsellOf }, seededRng(2, 'x'), { banned: [] });
    expect(pdf.chapters.length).toBeGreaterThanOrEqual(5);
  });

  it('the Claude path receives the sub-problem, and falls back when it repeats the parent', async () => {
    const { brief, voc, pdf: parent } = await fullGuide('proprete-chiot', 4);
    const upsellOf: UpsellContext = { parentTitle: parent.title, parentPromise: parent.promise, parentChapterTitles: parent.chapters.map((c) => c.title) };
    const prompts: string[] = [];
    const copy = { ...parent };
    const client: ClaudeClientLike = {
      messages: {
        create: async (body) => { prompts.push(JSON.stringify(body.messages)); return fakeMessage({ titles: [parent.title, 'Autre titre'] }); },
        stream: (body) => ({ finalMessage: async () => { prompts.push(JSON.stringify(body.messages)); return fakeMessage(copy); } }),
      },
    };
    const eng = createContentEngine({ mode: 'claude', apiKey: 'sk-test', maxComputeEur: 3, seed: 4, client, log: () => {} });
    const titles = await eng.writeTitles({ niche: brief, voc, count: 4, upsellOf }, ctx());
    expect(titles.map(norm)).not.toContain(norm(parent.title));
    const fb = await heuristic(4).writeOutline({ title: titles[0]!, niche: brief, voc, upsellOf }, ctx());
    const out = await eng.writePdfContent({ title: titles[0]!, outline: fb, niche: brief, voc, upsellTitle: null, upsellOf }, ctx());
    expect(prompts.join(' ')).toContain('sous-problème');
    expect(norm(out.title)).not.toBe(norm(parent.title));
    expect(norm(out.promise)).not.toBe(norm(parent.promise));
    expect(out.chapters.map((c) => c.title)).not.toContain(parent.chapters[0]!.title);
  });
});

// ───────────────────────────── labels and on-screen text keep their meaning ─────────────────────────────

describe('a label never flips or dangles', () => {
  it('stops before a contrast clause instead of inside it (exact string of the review)', () => {
    const s = "Nettoyer les accidents avec un produit enzymatique, jamais avec de l'eau de Javel ou de l'ammoniaque.";
    expect(labelOf(s, 64)).toBe('Nettoyer les accidents avec un produit enzymatique');
    expect(clauseLabel(s, 64)).toBe('Nettoyer les accidents avec un produit enzymatique');
  });

  it('a word that merely starts with « ne » is not a negation', () => {
    expect(clauseLabel('Nettoyer le tapis puis aérer la pièce, sans attendre le soir', 40)).toBe('Nettoyer le tapis puis aérer la pièce');
    expect(clauseLabel('Le nez de bébé, après le bain', 20)).toBe('Le nez de bébé');
  });

  it('contrast words are dangling ends, a closing negation is not', () => {
    for (const s of ['Récompenser dehors, pas', 'Le chiot, jamais', 'Arroser le matin, sauf', 'Sans sel ni', 'Tout sauf']) expect(endsDangling(s), s).toBe(true);
    for (const s of ['Bébé ne dort pas', 'Il ne mange jamais', 'Ça n’avance pas', 'Pas de sel']) expect(endsDangling(s), s).toBe(false);
  });

  it('a line with no sentence around it stands on its own: a whole sentence or the head of an order, nothing that leans on what came before', () => {
    expect(standAlone(['À chaque changement de rythme, reprenez un seul geste pendant une semaine complète et notez ce qui bouge dans le carnet.'])).toEqual([]);
    expect(standAlone(['Il dit à quel moment placer la sortie.', 'Elles demandent de la stratégie, pas du vocabulaire.', 'C’est votre première économie.', 'Passez tout de suite à la suivante.'])).toEqual([]);
    expect(standAlone(['Viser un vendredi soir plutôt qu’un lundi matin quand la semaine a été chargée pour tout le monde à la maison.'])).toEqual([]);
    expect(standAlone(['Notez la hauteur griffée, le moment de la journée et ce qui s’est passé juste avant, sur la même page du carnet.'])).toEqual(['Notez la hauteur griffée']);
    expect(standAlone(['Gardez les repas à heures fixes. Il comprend vite.'])).toEqual(['Gardez les repas à heures fixes']);
    expect(standAlone(['Tester la peinture sur l’arrière du meuble.', 'Tester la peinture sur l’arrière du meuble.'])).toEqual(['Tester la peinture sur l’arrière du meuble']);
  });

  it('never ends on one of them, whatever the cut', () => {
    const cases: [string, number][] = [
      ['Arroser le matin, sauf quand il a plu pendant la nuit et que la terre est encore humide', 40],
      ['Ne jamais laisser le chiot seul plus de deux heures, ni le punir au retour de la promenade', 50],
      ['Récompenser dehors, pas après être rentré à la maison et avoir refermé la porte derrière lui', 40],
      ['Couper le téléphone, ni notification ni écran pendant toute la séance de révision du soir', 34],
      ['Donner une friandise sans attendre plus de deux secondes après le pipi au bon endroit', 40],
    ];
    for (const [s, max] of cases) {
      const l = labelOf(s, max);
      expect(l.length, s).toBeLessThanOrEqual(max);
      expect(endsDangling(l), `${s} → ${l}`).toBe(false);
      expect(l, s).not.toMatch(/\b(?:jamais|sauf|ni|pas|sans|deux)$/i);
      expect(l, s).not.toMatch(/[:,;]$/);
    }
  });

  it('a prohibition keeps its limit: the cut never widens it', () => {
    const s = 'Ne pas nourrir le chiot juste avant de sortir pour la dernière promenade du soir';
    expect(clauseLabel(s, 36)).toBeNull();
    expect(labelOf(s, 36)).not.toBe('Ne pas nourrir le chiot');
  });

  it('after a colon, the meaning is what stays', () => {
    expect(clauseLabel('Ce qui change tout : garder le même coin dehors pendant les 14 jours du plan pour installer le réflexe', 34)).toBe('Garder le même coin dehors');
    expect(clauseLabel('L’erreur de presque tous : rentrer tout de suite après la sortie', 40)).toBe('Rentrer tout de suite après la sortie');
  });

  it('a checklist line keeps every item of a list when it fits on two lines of the page', async () => {
    const step = 'Sortir le chiot dans les 10 minutes qui suivent le réveil, le repas, le jeu ou la sieste';
    const voc = { ...VOC, knowledge: { ...VOC.knowledge, steps: [`${step}. Le rythme évite l’accident. (étape 1 ; jours 1 à 14)`, ...VOC.knowledge.steps] } };
    const eng = heuristic(3);
    const outline = await eng.writeOutline({ title: 'Un guide', niche: NICHE, voc }, ctx());
    const pdf = await eng.writePdfContent({ title: 'Un guide', outline, niche: NICHE, voc, upsellTitle: null }, ctx());
    expect(pdf.chapters.flatMap((c) => c.checklist).join(' | ')).toContain('le repas, le jeu ou la sieste');
  });
});

describe('on-screen ad text', () => {
  it('keeps the payoff of the exact hooks of the review, and never ends on a colon', () => {
    expect(screenText('Avant : l’épuisement. Après 14 jours de plan : plus de flaque au réveil.')).toBe('Après 14 jours : plus de flaque au réveil');
    expect(screenText('L’erreur que font presque tous les nouveaux : rentrer dès qu’il a fait.')).toBe('L’erreur : rentrer dès qu’il a fait');
    expect(screenText('1 erreur, 14 jours, 1 plan : voilà comment on s’en sort.')).toBe('1 erreur, 14 jours, 1 plan : on s’en sort.');
  });

  it('a mistake alone never reads as an instruction', () => {
    expect(screenText('Si tu fais ça, arrête tout de suite : nettoyer à la Javel ou à l’ammoniaque.')).toBe('Stop : nettoyer à la Javel ou à l’ammoniaque');
    expect(screenText('Au début, tout le monde fait la même erreur : laisser le chiot libre dans tout l’appartement.')).toMatch(/^L’erreur : /);
  });

  it('customer quotes stay whole and closed', () => {
    expect(screenText('« Faut du cash ou la carte passe partout ? » Voilà ce que personne ne te dit.')).toBe('« Faut du cash ou la carte passe partout ? »');
    expect(screenText('« Je perds tous mes moyens devant un jury » : voilà ce que personne ne te dit.')).toBe('« Je perds tous mes moyens devant un jury »');
    expect(screenText('Un commentaire nous a marqués : « tout a grillé pendant la canicule ». Voilà ce qu’on a répondu.')).toBe('« tout a grillé pendant la canicule »');
  });

  it('a question stays a question, a wish stays whole', () => {
    expect(screenText('Pourquoi le chiot fait ses besoins partout dans l’appartement ? Voici la vraie raison.')).toBe('Pourquoi le chiot fait ses besoins partout ?');
    expect(screenText('Tu veux un bébé qui se rendort seul en moins de 10 minutes ? Commence par ça.')).toBe('Un bébé qui se rendort seul en moins de 10 min');
  });

  it('every hook of every niche gives a whole on-screen line', async () => {
    const styles = ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'] as const;
    for (const id of ALL_NICHES) {
      const { brief, voc } = realResearch(3, id);
      const prod = product({ nicheId: id, title: brief.name, audience: brief.audience, problem: brief.problem });
      for (let seed = 1; seed <= 4; seed++) {
        for (const h of await heuristic(seed).writeAdHooks({ product: prod, voc, styles: [...styles] }, ctx())) {
          const s = screenText(h.hook);
          expect(s.length, h.hook).toBeLessThanOrEqual(50);
          expect(s, h.hook).not.toMatch(/:\s*$/);
          expect((s.match(/«/g) ?? []).length, h.hook).toBe((s.match(/»/g) ?? []).length);
          expect(s, h.hook).not.toMatch(/\s(?:de|du|des|la|le|les|à|au|aux|pour|par|sur|et|ou|un|une|avec|sans|dans|ni|sauf)[.?!]?$/i);
        }
      }
    }
  });
});

describe('ads stay true after the day they are made', () => {
  it('never print the price, on any niche or format', async () => {
    for (const id of ALL_NICHES) {
      const { pdf, voc, brief } = await fullGuide(id, 5);
      const prod = product({ nicheId: id, content: pdf, title: pdf.title, audience: brief.audience, price: 24 });
      for (const format of ['carousel', 'text_slideshow', 'faceless_voiceover', 'ugc_avatar'] as const) {
        const ad = await heuristic(5).writeAd({ product: prod, voc, hook: 'Regarde ça avant ce soir.', hookStyle: 'question', format, bannedClaims: [] }, ctx());
        expect(ad.scenes.at(-1)!.onScreenText, id).toBe('Guide PDF — lien en bio');
        expect(allText(ad.scenes.map((s) => s.onScreenText)), id).not.toMatch(/\b24\s*€/);
      }
    }
  });

  it('name the bonus of the guide, on screen too, and invent none', async () => {
    const { pdf, voc, brief } = await fullGuide('proprete-chiot', 5);
    const prod = product({ nicheId: 'proprete-chiot', content: pdf, title: pdf.title, audience: brief.audience });
    expect(pdf.bonus.title).toContain('carnet de suivi de 14 jours');
    let seen = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const ad = await heuristic(seed).writeAd({ product: prod, voc, hook: 'Regarde ça avant ce soir.', hookStyle: 'question', format: 'carousel', bannedClaims: [] }, ctx());
      const bonus = ad.scenes.find((s) => /bonus/i.test(s.onScreenText));
      if (!bonus) continue;
      seen++;
      expect(bonus.onScreenText).toBe('Bonus : le carnet de suivi de 14 jours');
      expect(bonus.voiceover).toContain('le carnet de suivi de 14 jours à imprimer');
    }
    expect(seen).toBeGreaterThan(0);
    for (let seed = 1; seed <= 8; seed++) {
      const ad = await heuristic(seed).writeAd({ product: product({ content: null }), voc: VOC, hook: 'Regarde ça avant ce soir.', hookStyle: 'question', format: 'carousel', bannedClaims: [] }, ctx());
      expect(allText(ad), `graine ${seed}`).not.toMatch(/\bbonus\b/i);
    }
  });

  it('use a real review as the only social proof, never a persona', async () => {
    const reviews = [
      { id: 'r1', day: 4, customerId: 'cus_1', rating: 5 as const, text: 'Clair, bien illustré, et pas de blabla.' },
      { id: 'r2', day: 5, customerId: 'cus_2', rating: 1 as const, text: 'Arnaque. Fuyez.' },
      { id: 'r3', day: 6, customerId: 'cus_3', rating: 5 as const, text: 'Service client au top : réponse rapide, humaine et efficace.' },
      { id: 'r4', day: 7, customerId: 'cus_4', rating: 5 as const, text: 'On voit la différence dès la première nuit.' },
    ];
    const prod = product({ stats: { ...product().stats, rating: 4.5, reviews } });
    const ad = await heuristic(3).writeAd({ product: prod, voc: VOC, hook: 'Regarde ça avant ce soir.', hookStyle: 'question', format: 'carousel', bannedClaims: [] }, ctx());
    const text = allText(ad);
    expect(text).toContain('Clair, bien illustré, et pas de blabla');
    expect(text).not.toMatch(/Arnaque|Service client|dès la première nuit/);
    expect(text).not.toMatch(/\p{Lu}\p{Ll}+, \d{2} ans/u);
  });

  it('a Claude script keeps none of it: price, named case, cut text', () => {
    const fb = {
      hook: 'Regarde ça.', hookStyle: 'question' as const, format: 'carousel' as const, caption: 'Le guide est en lien.', hashtags: ['#a', '#b', '#c', '#d'], cta: 'Télécharge le guide (lien en bio)',
      scenes: [0, 1, 2, 3].map((k) => ({ visual: `Plan ${k}`, onScreenText: `Texte ${k}`, voiceover: `Voix ${k}`, durationSec: 4 })),
    };
    const raw = {
      hook: 'Le guide à 24 € qui change tout',
      caption: 'Seulement 24 € pour en finir.',
      cta: 'Guide PDF 24 € — lien en bio',
      scenes: [
        { visual: 'v', onScreenText: 'Guide PDF 24 € — lien en bio', voiceover: 'Le guide coûte 24 euros, lien en bio.', durationSec: 4 },
        { visual: 'v', onScreenText: 'Sophie, 45 ans, problème réglé en 10 jours', voiceover: 'Sophie, 45 ans, a tout réglé en 10 jours.', durationSec: 4 },
        { visual: 'v', onScreenText: 'L’erreur que font presque tous les nouveaux :', voiceover: 'Une erreur.', durationSec: 4 },
        { visual: 'v', onScreenText: 'Des courses à 100 € par semaine', voiceover: 'Des courses à 100 € par semaine pour toute la famille.', durationSec: 4 },
      ],
    };
    const ad = nAd(raw, fb, { hookStyle: 'question', format: 'carousel', product: product({ price: 24 }) });
    expect(allText(ad)).not.toMatch(/24\s*(?:€|euros)/);
    expect(ad.scenes[0]!.onScreenText).toBe('Guide PDF — lien en bio');
    expect(ad.scenes[1]).toMatchObject({ onScreenText: 'Texte 1', voiceover: 'Voix 1' });
    expect(ad.scenes[2]!.onScreenText).not.toMatch(/:\s*$/);
    expect(ad.scenes[3]!.onScreenText).toBe('Des courses à 100 € par semaine'); // a figure of the niche is not the price
  });

  it('noPrice only removes the price of the guide', () => {
    expect(noPrice('Guide PDF 24 € — lien en bio', null)).toBe('Guide PDF — lien en bio');
    expect(noPrice('Le plan à 19,90 € et le bonus', 19.9)).toBe('Le plan et le bonus');
    expect(noPrice('Un mariage à moins de 10 000 €', 24)).toBe('Un mariage à moins de 10 000 €');
  });

  it('a named case in the research never reaches a hook', async () => {
    const voc = { ...VOC, knowledge: { ...VOC.knowledge, facts: ['Sophie, 45 ans, a réglé le problème en 10 jours', ...VOC.knowledge.facts] } };
    for (let seed = 1; seed <= 12; seed++) {
      const ad = await heuristic(seed).writeAd({ product: product(), voc, hook: '', hookStyle: 'stat', format: 'carousel', bannedClaims: [] }, ctx());
      expect(allText(ad)).not.toContain('Sophie');
    }
  });
});

describe('hooks do not run out', () => {
  const STYLES = ['question', 'contrarian', 'story', 'stat', 'pov', 'mistake', 'before_after', 'listicle'] as const;
  const hooksOf = async (id: string, days: number) => {
    const { brief, voc } = realResearch(3, id);
    const prod = product({ nicheId: id, title: brief.name, audience: brief.audience, problem: brief.problem });
    const out = new Map<string, Set<string>>(STYLES.map((s) => [s, new Set<string>()]));
    for (let day = 1; day <= days; day++) {
      for (const h of await heuristic(7).writeAdHooks({ product: prod, voc, styles: [...STYLES] }, ctx({ day }))) out.get(h.hookStyle)!.add(h.hook);
    }
    return out;
  };

  it('each style has fresh texts for two weeks of daily posts, on every niche', async () => {
    for (const id of ALL_NICHES) {
      const hooks = await hooksOf(id, 14);
      for (const s of STYLES) expect(hooks.get(s)!.size, `${id} ${s}`).toBeGreaterThanOrEqual(2);
      expect([...hooks.values()].reduce((n, set) => n + set.size, 0), id).toBeGreaterThanOrEqual(28);
    }
  });

  it('a story belongs to its niche: two audiences never get the same sentence', async () => {
    const stories = new Map<string, Set<string>>();
    for (const id of ALL_NICHES) stories.set(id, (await hooksOf(id, 8)).get('story')!);
    for (const [a, sa] of stories) {
      for (const [b, sb] of stories) {
        if (a >= b) continue;
        expect([...sa].filter((h) => sb.has(h)), `${a} / ${b}`).toEqual([]);
      }
    }
  });

  it('agrees with its audience and with « tu »', async () => {
    const femmes = await hooksOf('ventre-apres-40', 20);
    const all = [...femmes.values()].flatMap((s) => [...s]);
    expect(all.join(' | ')).not.toMatch(/tous les femmes/);
    const urssaf = await hooksOf('urssaf-micro', 20);
    expect([...urssaf.values()].flatMap((s) => [...s]).join(' | ')).not.toMatch(/Tu veux faire sa /);
  });
});
