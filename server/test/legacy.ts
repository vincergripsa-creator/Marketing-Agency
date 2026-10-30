/**
 * The company as it was before V1: every test that names an agent or pins old behaviour runs on this scenario, so the
 * default can flip under it (D42).
 */
import type { ScenarioConfig } from '../src/shared.js';

export const LEGACY: Partial<ScenarioConfig> = {
  org: { team: 'legacy31', autoHire: false, payroll: false },
  talent: 'off', channelControl: 'tiktok_only', videoModel: 'off', visualModel: 'off', scaling: false,
};
