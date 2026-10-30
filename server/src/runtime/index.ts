/**
 * runtime/ — the company: roster, task system, delegation, reviews, CEO strategy, daily loop.
 * Pure orchestration over sim/, deliverables/, learning/ (imported) and the ContentEngine + BrainVault (injected).
 */
import type { RuntimeModule } from '../contracts.js';
import { Company } from './company.js';
import { createWorld, defaultScenario } from './world.js';

export { createWorld, Company, defaultScenario };

// Compile-time check that this module satisfies its contract exactly.
const _contract: RuntimeModule = { createWorld, Company, defaultScenario };
void _contract;
