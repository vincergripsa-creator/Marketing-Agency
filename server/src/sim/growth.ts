/**
 * What the market does with an agency that grows (scale §6): a list it owns, a kit at checkout, rivals who copy its winners.
 * Hidden from the UI like every market number. Starting values: they move once, in the final bounded calibration.
 */
export const GROWTH = {
  email: {
    optin: { ads: 0.035, organic: 0.02, creator: 0.05 },   // × page factor
    page: { ref: 85, max: 1.2 },                            // page factor = min(max, page quality / ref)
    buyerOptin: 0.85,
    open: { lead: 0.30, buyer: 0.40, welcome: 0.50, ageDays: 180, floor: 0.08 },
    click: { lead: 0.05, buyer: 0.07, welcome: 0.10 },
    cvrMult: { lead: 4, buyer: 5 },                         // on baseCvr: about 10-12 %
    crossCategory: 0.5,                                     // same category, other niche
    fatiguePerSend: 0.08, fatigueDecayDaily: 0.02,
    unsub: { base: 0.004, fatigue: 0.02, noLinkFactor: 3 },
    costPer1000Daily: 0.2, freeSubscribers: 500,            // tool_subscription, ref email:<day>
    maxSendsPerWeek: 2, bucketMonths: 6, sentKept: 120,
  },
  bump: { rate: 0.22, priceShare: 0.3, minPrice: 5, maxPrice: 9 },
  rivals: { baseDaily: 0.02, refSalesPerDay: 4, pressureMin: 0.06, pressureMax: 0.10, halfLifeDays: 60, maxTotal: 0.3, refreshCut: 0.5, maxListed: 12 },
};

/** What the kit asks at checkout, from its guide's price. */
export function kitPrice(parentPrice: number): number {
  const { priceShare, minPrice, maxPrice } = GROWTH.bump;
  return Math.min(maxPrice, Math.max(minPrice, Math.round(priceShare * parentPrice)));
}
