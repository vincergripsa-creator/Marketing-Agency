import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunPaths } from '../contracts.js';

export type { RunPaths };

const here = dirname(fileURLToPath(import.meta.url));

/** <repo> root (server/src/core → ../../..). */
export function repoRoot(): string {
  return resolve(here, '..', '..', '..');
}

export function runPaths(runId: string): RunPaths {
  const root = join(repoRoot(), 'runs', runId);
  return { root, brain: join(root, 'brain'), files: join(root, 'files') };
}

/** Seed Obsidian vault committed in the repo, copied into every run. */
export function seedBrainDir(): string {
  return join(repoRoot(), 'brain');
}
