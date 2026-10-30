/** One handler per TaskKind. */
import type { TaskKind } from '../../shared.js';
import type { HandlerSpec } from './common.js';
import { researchHandlers } from './research.js';
import { studioHandlers } from './studio.js';
import { creationHandlers } from './creation.js';
import { boutiqueHandlers } from './boutique.js';
import { growthHandlers } from './growth.js';
import { supportHandlers } from './support.js';
import { partnerHandlers } from './partners.js';
import { opsHandlers } from './ops.js';

export const HANDLERS = {
  ...researchHandlers, ...studioHandlers, ...creationHandlers, ...boutiqueHandlers,
  ...growthHandlers, ...supportHandlers, ...partnerHandlers, ...opsHandlers,
} as Record<TaskKind, HandlerSpec>;

export type { HandlerOutcome, HandlerSpec } from './common.js';
