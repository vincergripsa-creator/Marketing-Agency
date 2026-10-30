/**
 * learning/ — the agency's memory and learning loop:
 *   brain vault (Obsidian-style markdown), Thompson bandits, A/B experiments,
 *   daily KPIs, evening retro (lessons → playbooks → notes), weekly HR review.
 */
import type { LearningModule } from '../contracts.js';
import { armStats, chooseArm, rewardArm } from './bandits.js';
import { computeExperimentResults, startExperiment, updateExperiments } from './experiments.js';
import { LESSON_KEYS, NICHE_WINDOW_DAYS } from './heuristics.js';
import { computeDailyKpi } from './kpi.js';
import { runRetro } from './retro.js';
import { levelForXp, MAX_LEVEL, performanceReview } from './review.js';
import { createBrainVault } from './vault.js';

export { createBrainVault, chooseArm, rewardArm, armStats, startExperiment, updateExperiments, computeExperimentResults, runRetro, performanceReview, computeDailyKpi, levelForXp, MAX_LEVEL, LESSON_KEYS, NICHE_WINDOW_DAYS };

// Compile-time check that this module satisfies its contract exactly.
const _contract: LearningModule = {
  createBrainVault, chooseArm, rewardArm, armStats, startExperiment, updateExperiments, computeExperimentResults, runRetro, performanceReview, computeDailyKpi, levelForXp, MAX_LEVEL, LESSON_KEYS, NICHE_WINDOW_DAYS,
};
void _contract;
