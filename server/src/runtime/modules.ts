/**
 * The runtime talks to the other blocks ONLY through their public index.ts, typed by contracts.ts.
 * Binding them here keeps the contract check in one place.
 */
import * as simNs from '../sim/index.js';
import * as deliverablesNs from '../deliverables/index.js';
import * as learningNs from '../learning/index.js';
import type { DeliverablesModule, LearningModule, SimModule } from '../contracts.js';

export const sim: SimModule = simNs;
export const deliverables: DeliverablesModule = deliverablesNs;
export const learning: LearningModule = learningNs;
