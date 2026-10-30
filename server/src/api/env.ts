import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../core/index.js';
import type { MindMode, ModelTier } from '../shared.js';

export type ConfigMindMode = 'auto' | MindMode;

export interface AppConfig {
  port: number;
  apiKey: string | undefined;
  mindMode: ConfigMindMode;
  maxComputeEur: number;
  models: Partial<Record<ModelTier, string>>;
}

export const DEFAULT_PORT = 4317;
export const DEFAULT_MAX_COMPUTE_EUR = 3;

/** Parses a .env file: KEY=VALUE lines, `#` comments, optional `export`, single/double quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const source = text.replace(/^﻿/, '');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2) {
      const end = value.indexOf(quote, 1);
      if (end > 0) {
        value = value.slice(1, end);
        if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    } else {
      // Unquoted: an inline comment needs whitespace before the '#'.
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

/** File values only fill what the real environment does not define (process.env wins). */
export function mergeEnv(fileVars: Record<string, string>, processEnv: Record<string, string | undefined>): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...fileVars };
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined) merged[k] = v;
  return merged;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
}

function nonNegative(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat((raw ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function parseMindMode(raw: string | undefined): ConfigMindMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'heuristic' || v === 'claude' || v === 'auto' ? v : 'auto';
}

export function buildConfig(env: Record<string, string | undefined>): AppConfig {
  const key = (env.ANTHROPIC_API_KEY ?? '').trim();
  const models: Partial<Record<ModelTier, string>> = {};
  const opus = env.MODEL_OPUS?.trim();
  const sonnet = env.MODEL_SONNET?.trim();
  const haiku = env.MODEL_HAIKU?.trim();
  if (opus) models.opus = opus;
  if (sonnet) models.sonnet = sonnet;
  if (haiku) models.haiku = haiku;
  return {
    port: positiveInt(env.PORT, DEFAULT_PORT, 65535),
    apiKey: key || undefined,
    mindMode: parseMindMode(env.MIND_MODE),
    maxComputeEur: nonNegative(env.MAX_COMPUTE_EUR, DEFAULT_MAX_COMPUTE_EUR),
    models,
  };
}

export function envFilePath(): string {
  return join(repoRoot(), '.env');
}

/** Reads <repo>/.env (if any), fills missing process.env keys with it, returns the merged view. */
export function loadEnv(file = envFilePath()): Record<string, string | undefined> {
  let fileVars: Record<string, string> = {};
  try {
    if (existsSync(file)) fileVars = parseEnvFile(readFileSync(file, 'utf8'));
  } catch {
    fileVars = {};
  }
  for (const [k, v] of Object.entries(fileVars)) if (process.env[k] === undefined) process.env[k] = v;
  return mergeEnv(fileVars, process.env);
}

export const config: AppConfig = buildConfig(loadEnv());

/** French label of the effective mind mode, for logs. */
export function mindModeLabel(mode: ConfigMindMode | MindMode, hasKey = Boolean(config.apiKey)): string {
  if (mode === 'claude') return 'Claude (API Anthropic)';
  if (mode === 'heuristic') return 'heuristique (hors-ligne, gratuit)';
  return hasKey ? 'auto → Claude (clé API détectée)' : 'auto → heuristique (aucune clé API)';
}
