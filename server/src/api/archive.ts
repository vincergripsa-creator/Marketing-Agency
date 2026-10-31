/**
 * What compaction took out of the world, on disk: runs/<id>/archive/<collection>.ndjson. Rows land before the world is saved, so a
 * crash between the two writes the same rows again, and the reader keeps each id once. The sim never reads this folder, and the
 * route guard of /runs/ never serves it (D51): customers lie here with their archetype.
 */
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import type { ArchiveBatch, ArchiveCollection, CompanyOptions } from '../contracts.js';
import { mergeJournals } from '../learning/vault.js';
import { COMPACT } from '../runtime/compaction.js';

const ARCHIVE_DIR = 'archive';

function archiveFile(root: string, collection: ArchiveCollection): string {
  return join(root, ARCHIVE_DIR, `${collection}.ndjson`);
}

/** A run-relative path that stays inside the run, or null: `dropFiles` come from a save file. */
function insideRun(root: string, rel: string): string | null {
  const clean = normalize(rel);
  return clean.startsWith('..') || clean.split(sep).includes('..') ? null : join(root, clean);
}

/** Appends a batch, then lets go of the files of the creatives it archived and folds the old journals of the brain. */
export async function appendArchive(root: string, batch: ArchiveBatch): Promise<void> {
  const collections = Object.entries(batch.rows) as [ArchiveCollection, unknown[]][];
  if (collections.length) await mkdir(join(root, ARCHIVE_DIR), { recursive: true });
  for (const [collection, rows] of collections) {
    if (rows.length) await appendFile(archiveFile(root, collection), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  }
  for (const rel of batch.dropFiles) {
    const file = insideRun(root, rel);
    if (file) await rm(file, { force: true });
  }
  await mergeJournals({ root, brain: join(root, 'brain'), files: join(root, 'files') }, batch.day, COMPACT.journalDays);
}

/** The rows of a collection, each id once: the last line wins. A torn last line is a crash mid-append, and its row comes again. */
export async function readArchive(root: string, collection: ArchiveCollection): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(archiveFile(root, collection), 'utf8');
  } catch {
    return [];
  }
  const rows = new Map<string, unknown>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { id?: unknown };
      if (typeof row?.id === 'string') rows.set(row.id, row);
    } catch { /* see above */ }
  }
  return [...rows.values()];
}

/** The sink `mountWorld` hands to the company. */
export function runArchive(root: string): NonNullable<CompanyOptions['archive']> {
  return (batch) => appendArchive(root, batch);
}
