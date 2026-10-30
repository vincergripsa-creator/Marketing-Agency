/** Hidden talent (talent §3). Stub until P3.1: `talentMode` stays 'off' whatever the scenario says (D47), so the rest is never reached. */
import type { LeagueState, TalentMode, TalentTruth, WorldState } from '../../shared.js';

export function talentMode(_w: WorldState): TalentMode {
  return 'off';
}

export function seedTruth(_w: WorldState): TalentTruth {
  throw new Error('not landed');
}

export function emptyLeague(_w: WorldState): LeagueState {
  throw new Error('not landed');
}

export function coachTick(_w: WorldState): void {
  /* P3.1 */
}

export function practice(_w: WorldState): void {
  /* P3.1 */
}

export function sampleTalent(_w: WorldState): void {
  /* P3.1 */
}
