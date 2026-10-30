/** Builder for catalog niches: fills ids and the repeated nicheId/depth fields. */
import type { AdFormat, CompetitorProduct, HookStyle, NicheTruth, VoiceOfCustomer } from '../../shared.js';

export interface NicheSpec {
  id: string;
  name: string;
  audience: string;
  problem: string;
  category: string;
  keywords: string[];
  demand: number;
  wtp: { min: number; sweet: number; max: number };
  competition: number;
  tiktokAffinity: number;
  cpmBase: number;
  hookAffinity: Record<HookStyle, number>;
  formatAffinity: Partial<Record<AdFormat, number>>;
  refundSensitivity: number;
  complianceRisk: number;
  seasonality: [number, number, number, number, number, number, number]; // lundi … dimanche
  voc: Omit<VoiceOfCustomer, 'nicheId' | 'depth'>;
  competitors: Omit<CompetitorProduct, 'id' | 'nicheId'>[];
}

export function defineNiche(s: NicheSpec): NicheTruth {
  return {
    id: s.id, name: s.name, audience: s.audience, problem: s.problem, category: s.category, keywords: s.keywords,
    demand: s.demand, wtp: s.wtp, competition: s.competition, tiktokAffinity: s.tiktokAffinity, cpmBase: s.cpmBase,
    hookAffinity: s.hookAffinity, formatAffinity: s.formatAffinity,
    refundSensitivity: s.refundSensitivity, complianceRisk: s.complianceRisk, seasonality: s.seasonality,
    voc: { nicheId: s.id, depth: 'deep', ...s.voc },
    competitors: s.competitors.map((c, i) => ({ id: `cmp_${s.id}_${i + 1}`, nicheId: s.id, ...c })),
  };
}
