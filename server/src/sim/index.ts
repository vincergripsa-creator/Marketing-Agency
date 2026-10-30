/**
 * sim/ — the virtual market (hidden truth + tools). Exports exactly the SimModule contract.
 * Replace createMarketTools with real adapters to go live; the company code does not change.
 */
import type { SimModule } from '../contracts.js';
import { announcedOutageDays, isAnnouncedOutage } from './events.js';
import { financeSnapshot, lastClosedDay, recordLedger } from './finance.js';
import { createMarketState, difficultyProfile, findNiche, isScamFlag } from './market.js';
import { repayableLeft } from './ops.js';
import { GENERIC_PHRASES, guideSubstance, scoreCreative, scorePdf, scoreSalesPage, scoreSupportReply } from './quality.js';
import { tickMarket } from './tick.js';
import { createMarketTools } from './tools.js';

export {
  createMarketState, createMarketTools, tickMarket, recordLedger, financeSnapshot, lastClosedDay, announcedOutageDays, isAnnouncedOutage,
  repayableLeft, isScamFlag, scorePdf, scoreSalesPage, scoreCreative, scoreSupportReply, guideSubstance, GENERIC_PHRASES, findNiche, difficultyProfile,
};

// compile-time check that this module satisfies the contract
const _contract: SimModule = {
  createMarketState, createMarketTools, tickMarket, recordLedger, financeSnapshot, lastClosedDay, announcedOutageDays, isAnnouncedOutage,
  repayableLeft, isScamFlag, scorePdf, scoreSalesPage, scoreCreative, scoreSupportReply, guideSubstance, GENERIC_PHRASES, findNiche, difficultyProfile,
};
void _contract;
