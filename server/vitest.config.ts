import { defineConfig } from 'vitest/config';

/**
 * These limits catch a hang, they do not measure speed. The suite fills every core while the antivirus scans each file it
 * writes, and under that load a 150 ms test was seen at 5 s. Workers are capped for the same reason: renders and the scanner
 * need room, or the tests around them starve.
 */
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000, maxWorkers: 14 },
});
