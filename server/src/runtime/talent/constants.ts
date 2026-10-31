/**
 * The talent pillar's numbers (talent §3 to §7, D12, D15). sim/balance.ts stays frozen: each pillar keeps its own.
 * `founderMean`, `marketMean` and `offRoleMean` say what the truth looks like: they never reach the UI (§2.9).
 * `par` and `sd` are estimates until S14 measures them, once, from `league.parStats`.
 */
import type { Skill } from '../../shared.js';

export const TALENT = {
  // Who has talent (§3, D15)
  founderMean: 0.56, marketMean: 0.52, offRoleMean: 0.30,
  personSd: 0.09, skillSd: 0.12,
  founderFloor: 0.15, marketFloor: 0.10, cap: 0.92,
  ceilingGain: 0.10, ceilingCap: 0.97,

  // What it changes (§4)
  flawBase: 0.5, flawPower: 1.5,
  eyeSd: 8,
  sharpSpan: 4,
  reachBase: 0.4, reachSpan: 0.6,
  passes: { three: 0.8, two: 0.5 },
  rampDays: 7, rampFrom: 0.7,

  // Claude mode (§4.9): the tier and the effort a talent is worth
  claude: { lowBelow: 0.34, highFrom: 0.67, highDraws: 2 },

  // Reading a campaign (§4.5)
  prune: { windowDays: 4, minImp: 3000, minImpSlope: 2000, ratio: 0.55, ratioSlope: 0.3, zNeed: 2.4, zNeedSlope: 1, dayNoise: 0.16 },
  shrink: { k: 25, prior: 1.3 },

  // Getting better (§4.10)
  practiceRate: 0.25,
  coach: { gain: 0.02, overCeiling: 0.05, energy: 10, everyDays: 7 },

  // The rating (§5.1)
  rating: { par: 1500, rd: 200, rdMin: 70, rdPerEvidence: 6, rdSeasonGrowth: 1.1, kOverRd: 4, kMin: 12, kMax: 50, hireRd: 150, hirePerPoint: 8, hireSpread: 150, historyMax: 40 },

  // Evidence (§5.2, D12): par and sd of the raw x, keyed `${skill}:${source}` like `league.parStats`, then what each weighs
  par: {
    'copy:qa': 88, 'video:cut': 80, 'longform:qa': 80, 'longform:market': 4.3, 'polish:qa': 3, 'polish:market': 4.3,
    'page:qa': 80, 'page:market': 0, 'design:visual': 75, 'buying:focus': 0.5, 'buying:market': 0, 'support:reply': 85,
  } as Record<string, number>,
  sd: {
    'copy:qa': 5, 'video:cut': 12, 'longform:qa': 6, 'longform:market': 0.35, 'polish:qa': 3, 'polish:market': 0.35,
    'page:qa': 6, 'page:market': 0.35, 'design:visual': 10, 'buying:focus': 0.15, 'buying:market': 0.5, 'support:reply': 15,
  } as Record<string, number>,
  weight: {
    'copy:qa': 1, 'copy:rejected': 1, 'copy:natural': 0.4, 'copy:duel': 1, 'video:cut': 1, 'longform:qa': 1.5, 'longform:market': 1,
    'polish:qa': 1, 'polish:market': 0.5, 'page:qa': 1.5, 'page:market': 0.7, 'design:visual': 1, 'buying:focus': 0.5,
    'research:pick': 1, 'support:reply': 0.25, 'support:chargeback': 0.5,
  } as Record<string, number>,
  evidence: { eventsMax: 300, reviewsMin: 6, pageViewsMin: 150, buyingEveryDays: 7, buyingMinDays: 3, spendFull: 60, spendFloor: 0.2, pickDays: 14 },

  // Competition (§6)
  seasonDays: 14,
  natural: { minImp: 1500, kept: 200, armMinPulls: 3 },
  duel: { everyDays: 7, day: 3, k: 32, tenureDays: 7, minBudget: 10, maxCreatives: 2, dropAbove: 0.85, drawBelow: 0.7, drawAbove: 0.3 },
  routePerPoint: 100, perkRouting: 1, perkDraws: 1,

  // Consequences (§7)
  plan: {
    gateRd: 0.75, tenureDays: 14, days: 14, targetSd: 0.5, metRating: 1490,
    perFamily: 1, perSeason: 3,
  },
  challenge: {
    margin: 3, replacementsPerSeason: 2, replacementsPerFamily: 1, sameRoleDays: 28, horizonGuard: 10, disruptedDays: 3, refusalPinDays: 14,
    cloneRating: 1550, cloneMean: -0.02, cloneSd: 0.06,
  },
};

/** Under this sample a person is « échantillon insuffisant » and can neither enter nor fail a plan (§5.3, D12). Support's 4 is a weighted sum: 16 replies. */
export const MIN_SEASON_N: Record<Skill, number> = { copy: 4, video: 4, longform: 2, polish: 2, page: 2, design: 2, buying: 3, research: 1, support: 4 };
