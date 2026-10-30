/**
 * Every tunable number of the virtual market lives here, so balancing the game never means
 * hunting constants across files. Money in EUR, rates in 0..1.
 */
import type { CustomerArchetype, Difficulty } from '../shared.js';
import type { DifficultyProfile } from '../contracts.js';

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  facile: { cpmMultiplier: 0.8, annoyingShare: 0.15, scamRate: 0.08, eventRate: 0.12, refundBase: 0.025, inboxPerSale: 0.1 },
  normal: { cpmMultiplier: 1, annoyingShare: 0.3, scamRate: 0.18, eventRate: 0.2, refundBase: 0.04, inboxPerSale: 0.16 },
  cauchemar: { cpmMultiplier: 1.35, annoyingShare: 0.55, scamRate: 0.4, eventRate: 0.34, refundBase: 0.12, inboxPerSale: 0.28 },
};

/** Hidden-parameter variation applied to the catalog when a run starts (±15 %). */
export const NICHE_VARIATION = 0.15;

export const CREATORS = {
  perNicheMin: 3,
  perNicheMax: 6,
  scamShare: { facile: 0.15, normal: 0.25, cauchemar: 0.4 } as Record<Difficulty, number>,
  stealthScamShare: { facile: 0.2, normal: 0.35, cauchemar: 0.55 } as Record<Difficulty, number>, // scammers without any explicit red flag
  stealth: {                        // a big, attractive profile whose numbers overlap the honest ranges: each signal alone is noisy
    followersMedian: 60000,                   // honest: 16 000
    viewRate: { min: 0.04, max: 0.11 },       // avgViews / followers (honest: 0.08-0.35)
    engagement: { min: 0.02, max: 0.05 },     // honest: 0.03-0.09
    upfrontPerKViews: { min: 28, max: 60 },   // honest: 12-30
    commissions: [0.1, 0.15, 0.15, 0.2],      // honest: 0.2-0.45
    minUpfront: 60,
  },
  softFlagShare: 0.18,              // legit creators showing an ambiguous (harmless) flag
  upfrontPerKViews: { min: 12, max: 30 }, // EUR a legit creator asks per 1 000 average views
  deliveryDelayDays: 1,             // accepted deal → video published the next market close
  tail: [1, 0.4, 0.18, 0.08, 0.04], // share of the video's traffic per day after publication
  clickRate: { min: 0.012, max: 0.024 },
  cvrMultiplier: 1.4,               // a trusted creator converts better than an ad
  offNicheReach: 0.4,               // creator promoting a product outside its niche
};

export const ADS = {
  baseCtr: 0.0055,                 // × quality × affinity^affinityExp × TikTok fit × fatigue: ≈ 1,5-2 % untested, 3-4 % on a learned angle
  qualityRef: 70,
  qualityExp: 1.3,
  fatigueImpressions: 60000,        // fatigue = 1 / (1 + imps / this): a creative loses half its CTR after ~60 000 impressions
  affinityExp: 2,                   // CTR ∝ (hookAffinity × formatAffinity)^this: how much the right angle matters
  minCtr: 0.0008,
  maxCtr: 0.08,
  landingRate: 0.85,
  deliveryMin: 0.9,                 // share of the daily budget actually delivered
  deliveryMax: 1,
  cpmNoiseSd: 0.12,
  ctrNoiseSd: 0.16,
  narrowAgeCpm: 1.12,               // age range < 10 years → pricier inventory
  minCpm: 1.5,
  dayOfWeekCpm: [1, 0.97, 0.98, 1, 1.05, 1.12, 1.1], // lundi … dimanche
  commentsPerImpressions: 1300,
  maxCommentsPerRow: 6,
  minDailyBudget: 5,
  maxDailyBudget: 5000,
  reachBase: 40000,                 // audience reach used for the frequency indicator
  reachDemand: 120000,
  minImpressionsForStats: 1,
  banDays: 7,
  strikesBeforeBan: 3,
  falsePositiveRate: 0.12,          // × complianceRisk : compliant ads sometimes refused (no strike)
};

export const CONVERSION = {
  base: 0.018,                      // ≈ 2 % of paid visitors buy a well-priced, well-sold guide
  salesQualityRef: 85,
  salesQualityExp: 1.5,
  salesQualityMin: 0.4,
  salesQualityMax: 1.3,
  priceBelowBoost: 0.25,            // factor at wtp.min = 1 + this
  priceBelowCap: 1.3,
  priceAboveDrop: 0.45,             // factor at wtp.max = 1 - this
  priceAboveExp: 1.5,
  priceOverMaxDecay: 0.15,          // exp decay scale beyond max: at least this × wtp.max…
  priceOverMaxDecayMax: 0.25,       // …at most this × wtp.max (between both: slope-continuous at max)
  ratingNone: 0.8,
  ratingHigh: 1.2,                  // average ≥ 4.5
  ratingLow: 0.6,                   // average < 3.5
  storeMinReviews: 8,               // reviews the whole store needs before its reputation counts on a guide without reviews
  storeTrust: 0.6,                  // share of the store rating effect a guide without reviews inherits
  specificityMin: 0.8,              // factor = min + span * specificity/100
  specificitySpan: 0.3,
  demandMin: 0.5,                   // factor = min + span * demand
  demandSpan: 0.8,
  competitionWeight: 0.4,
  hypeBoost: 0.35,
  noiseSd: 0.15,
  maxCvr: 0.25,
  poolBase: 120,                    // daily landing views a niche absorbs before saturating
  poolDemand: 450,
  organicCvrMultiplier: 0.6,        // cold, broad organic audience
  seasonalBoost: 1.2,
  seasonalBoostDays: 5,
};

export const ORGANIC = {
  maxPostsPerDay: 5,
  medianViews: 300,
  viewsSigma: 0.9,
  sameDayDecay: 0.35,               // reach / (1 + decay * (n - 1)) for the n-th post of the day
  viralChance: 0.015,
  viralMin: 30000,
  viralMax: 300000,
  clickRate: { min: 0.004, max: 0.012 },
  viralClickRate: { min: 0.0025, max: 0.005 },
  likeRate: { min: 0.03, max: 0.09 },
  bannedReach: 0.3,                 // post containing banned claims gets throttled
  keepPosts: 300,
};

/** Share of what customers say that one listening pass collects: research is never complete, a second pass finds more. */
export const RESEARCH = { deep: 0.85, quick: 0.4 };

export const UPSELL = {
  minRate: 0.06,
  maxRate: 0.15,
  priceExp: 2,                      // take rate ∝ priceFactor^this: a buyer who just paid is pickier than a visitor
  echoTolerated: 0.2,               // share of the first guide a follow-up may repeat before its buyer feels cheated (real ones: 6-10 %)
};

export const FEES = {
  paymentPct: 0.015,                // Stripe-like EU card fees
  paymentFixed: 0.25,
  boutiqueDaily: 0.97,              // 29 €/mois
  toolsDaily: 0.4,                  // 12 €/mois
  setupCost: 60,                     // one-off launch costs booked at the first market close (ref 'setup')
  chargebackFee: 15,
  paymentHoldShare: 0.3,
  paymentHoldMaxCashShare: 0.5,     // a reserve never freezes more than half of the cash
  paymentHoldDays: 7,
};

export const MIN_BUDGET_DAYS = 30;  // days of fixed costs a new run must be able to pay, on top of the launch costs

/** Lowest budget a run may start with: launch costs + MIN_BUDGET_DAYS of fixed costs, rounded up to the next 10 €. */
export function minStartingCash(): number {
  return Math.ceil((FEES.setupCost + MIN_BUDGET_DAYS * (FEES.boutiqueDaily + FEES.toolsDaily)) / 10) * 10;
}

export const REFUNDS = {
  windowDays: 14,
  decayDays: 3,                     // hazard weight ∝ exp(-(age-1)/decayDays)
  sensitivityMin: 0.6,              // base × (min + span × refundSensitivity)
  sensitivitySpan: 0.8,
  gapWeight: 0.45,                  // cumulative refund prob added per unit of hype/quality gap
  lowQualityThreshold: 85,
  lowQualityWeight: 0.35,
  overpriceWeight: 0.15,            // cumulative refund prob added at twice the niche's max price (0 up to the max)
  echoWeight: 0.4,                  // cumulative refund prob added when an upsell repeats the guide its buyer owns word for word
  maxCumulative: 0.6,
  hunterRequestChance: 0.3,         // per day (age 1..4) for 'chasseur_de_remboursement'
  hunterWindow: 4,
  archetypeBonus: { sceptique: 0.04, karen: 0.05, superfan: -0.03, menace_chargeback: 0.06, impatient: 0.01 } as Partial<Record<CustomerArchetype, number>>,
};

export const REVIEWS = {
  minAge: 2,
  maxAge: 5,
  dailyChance: 0.03,                // ≈ 12 % of buyers over the 4-day window
  archetypeChance: { superfan: 0.1, karen: 0.06, troll: 0.05, sceptique: 0.04 } as Partial<Record<CustomerArchetype, number>>,
  refundedChance: 0.05,
  ratingIntercept: -0.28,
  ratingSlope: 0.06,                // × pdf quality (0..100)
  ratingSd: 0.75,
  promiseGapPenalty: 1.2,
  overpricePenalty: 1.2,            // stars lost at twice the niche's max price (0 up to the max)
  echoPenalty: 2,                   // stars lost when an upsell repeats the guide its buyer owns word for word
};

export const INBOX = {
  baseNoise: { facile: 0.25, normal: 0.45, cauchemar: 0.9 } as Record<Difficulty, number>,
  commentToMessage: { question: 0.3, troll: 0.12, negative: 0.06, positive: 0 } as const,
  maxFollowUps: 2,
  followUpChance: { karen: 0.8, impatient: 0.65, menace_chargeback: 0.7, chasseur_de_remboursement: 0.6 } as Partial<Record<CustomerArchetype, number>>,
  followUpDefault: 0.35,
  quietCloseDays: 3,                // replied, no follow-up for N days → resolved
  keepDays: 60,
};

export const ESCALATION = {
  chargeback: { non_recu: 0.35, remboursement: 0.5, menace_chargeback: 0.85, bug_paiement: 0.4 } as Record<string, number>,
  angryArchetypeBoost: 0.3,         // karen / menace_chargeback
  badReview: { plainte_qualite: 0.8, non_recu: 0.6, remboursement: 0.5, question: 0.25, sur_mesure: 0.2, bug_paiement: 0.4 } as Record<string, number>,
};

export const EVENTS = {
  cpmSpike: { multiplier: 1.4, days: 3 },
  cpmDrop: { multiplier: 0.75, days: 3 },
  cloneCompetition: 0.1,
  trendShift: { down: 0.78, up: 1.22 },
  secondEventShare: 0.33,
  keepEvents: 200,
};

export const SCAM = {
  defaultAmount: 49,
  discountLossMultiplier: 2,        // a discount code handed to a scammer gets resold
  friendlyFraudPerRate: 0.08,       // × difficulty scamRate = share of orders followed by a false claim from the real buyer
  friendlyFraudWindowDays: 4,       // the claim arrives within this many days after the purchase
  friendlyDisputeRefused: 0.25,     // × (1 - reply score): a refused fraudster who still goes to his bank
  friendlyDisputeIgnored: 0.3,      // same, when the claim is left unanswered
};

export const CUSTOMER_ARCHETYPES = {
  calm: [['normal', 0.75], ['superfan', 0.12], ['perdu', 0.13]] as [CustomerArchetype, number][],
  annoying: [
    ['impatient', 0.24], ['sceptique', 0.19], ['chasseur_de_remboursement', 0.15], ['karen', 0.15],
    ['troll', 0.05], ['menace_chargeback', 0.1], ['demande_sur_mesure', 0.12],
  ] as [CustomerArchetype, number][],
};

export const STATS = { keepAdStatsDays: 90 };
