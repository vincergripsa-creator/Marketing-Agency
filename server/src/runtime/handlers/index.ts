/** One handler per TaskKind. The cast proves nothing: pillars.test.ts checks that no kind goes without one. */
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
import { orgHandlers } from './org.js';
import { leagueHandlers } from './league.js';
import { channelHandlers } from './channels.js';
import { lifecycleHandlers } from './lifecycle.js';

export const HANDLERS = {
  ...researchHandlers, ...studioHandlers, ...creationHandlers, ...boutiqueHandlers,
  ...growthHandlers, ...supportHandlers, ...partnerHandlers, ...opsHandlers, ...orgHandlers, ...leagueHandlers, ...channelHandlers, ...lifecycleHandlers,
} as Record<TaskKind, HandlerSpec>;

export type { HandlerOutcome, HandlerSpec } from './common.js';
