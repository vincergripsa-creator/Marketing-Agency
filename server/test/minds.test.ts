import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { AgentState, InboxMessage, NicheBrief, Order, PdfContent, Product, QualityReport, VoiceOfCustomer } from '../src/shared.js';
import type { MindContext, UsageEvent } from '../src/contracts.js';
import { createContentEngine, type ClaudeClientLike } from '../src/minds/index.js';
import { findCliches } from '../src/minds/heuristic/editing.js';
import { isCliche } from '../src/minds/lexicon.js';
import { allText, endsDangling, norm, splitSentences } from '../src/minds/util.js';
import { parsePlaybook, scrubText } from '../src/minds/playbook.js';
import { createRng } from '../src/core/index.js';
import { createWorld, defaultScenario } from '../src/runtime/index.js';
import { createMarketTools, scorePdf } from '../src/sim/index.js';
import { genericPhraseHits, pdfText } from '../src/sim/quality.js';
import { norm as simNorm } from '../src/sim/text.js';
import { designFor } from '../src/deliverables/index.js';

// ───────────────────────────── fixtures ─────────────────────────────

function agent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 'ag_studio_1', name: 'Margaux', role: 'Rédactrice en chef', dept: 'studio', isChief: true, tier: 'sonnet',
    persona: 'Exigeante et chaleureuse, elle traque les phrases creuses.', skills: ['Rédaction', 'Structure', 'Humanisation'],
    tools: ['brain.read', 'brain.write', 'pdf.render'], taskKinds: ['write_pdf', 'humanize_pdf'],
    avatar: { skin: '#f1c27d', hair: '#3b2a1a', shirt: '#7c5cff', pants: '#333', hairStyle: 1, accessory: 'glasses' },
    status: 'idle', place: 'studio', currentTaskId: null, energy: 90, level: 2, xp: 120,
    perf: { done: 4, approved: 3, rejected: 1, failed: 0, score: 72 }, bubble: null,
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
      expect(ch.steps.length).toBeLessThanOrEqual(6);
      expect(ch.checklist.length).toBeGreaterThan(0);
      expect(ch.visual).not.toBeNull();
      expect(ch.paragraphs.length).toBeGreaterThanOrEqual(2);
      if (ch.visual!.type === 'bar_chart') expect(ch.visual!.values.every((v) => v >= 0 && v <= 100)).toBe(true);
    }
    expect(pdf.bonus.steps.length).toBeGreaterThan(0);
    expect(pdf.nextStep.title).toContain('Les siestes sans larmes');
    // the customer words are in there
    expect(allText(pdf)).toContain('« il se réveille toutes les 2h »');
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
  const world = createWorld(defaultScenario({ seed }), `test-content-${seed}`);
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
        expect(text).toContain('Le problème ne s’arrête jamais à un seul symptôme');
        expect(text).toMatch(/Ce n’est ni un manque de volonté ni un manque d/);
        expect(text).toContain('Erreur n°1');
        expect(text).toMatch(/\bnous ne les avons pas inventées\b/i);
        expect((text.match(/\bn(?:e\b|['’])/g) ?? []).length).toBeGreaterThan(15);
        expect(norm(text)).not.toContain("n'hesitez pas a");
      }
    }
  });

  it('titles, labels and quotes are whole phrases; the promise is not repeated; scores stay ≥ 85', async () => {
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
        expect(q.overall, `${where} ${q.issues.join(' | ')}`).toBeGreaterThanOrEqual(85);
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
