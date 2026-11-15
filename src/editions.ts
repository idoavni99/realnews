import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Past digests kept alongside the live one. The live data.json is never counted here. */
export const MAX_PAST_EDITIONS = 3;
export const HISTORY_DIR = 'history';
export const INDEX_FILE = 'index.json';

export interface EditionEntry {
  id: string;
  generated_at: string;
  stories: number;
}

/** Filesystem- and URL-safe edition id from the digest timestamp, at second precision. */
export function editionId(generatedAt: string): string {
  const ms = Date.parse(generatedAt);
  if (!Number.isFinite(ms)) throw new Error('Invalid edition timestamp: ' + generatedAt);
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

export function readEditionIndex(siteDir: string): EditionEntry[] {
  try {
    const value = JSON.parse(readFileSync(join(siteDir, HISTORY_DIR, INDEX_FILE), 'utf8'));
    if (!value || !Array.isArray(value.editions)) return [];
    return value.editions.filter((e: EditionEntry) =>
      e && typeof e.id === 'string' && typeof e.generated_at === 'string' && Number.isSafeInteger(e.stories));
  } catch {
    return [];
  }
}

/**
 * Archive the currently published digest into site/history before it is replaced.
 * Keeps at most `max` past editions, newest first, and deletes older history files.
 * Returns the archived entry, or null when there is nothing valid to archive.
 */
export function archiveCurrentEdition(root: string, max = MAX_PAST_EDITIONS): EditionEntry | null {
  const siteDir = join(root, 'site');
  const currentPath = join(siteDir, 'data.json');
  if (!existsSync(currentPath)) return null;
  const raw = readFileSync(currentPath, 'utf8');
  let data: { generated_at?: unknown; stories?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data.generated_at !== 'string' || !Number.isFinite(Date.parse(data.generated_at))) return null;
  const entry: EditionEntry = {
    id: editionId(data.generated_at),
    generated_at: data.generated_at,
    stories: Array.isArray(data.stories) ? data.stories.length : 0,
  };
  const historyDir = join(siteDir, HISTORY_DIR);
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(join(historyDir, entry.id + '.json'), raw);
  const kept = [entry, ...readEditionIndex(siteDir)
    .filter((e) => e.id !== entry.id && existsSync(join(historyDir, e.id + '.json')))]
    .slice(0, max);
  for (const file of readdirSync(historyDir)) {
    if (file.endsWith('.json') && file !== INDEX_FILE && !kept.some((e) => e.id + '.json' === file)) {
      rmSync(join(historyDir, file));
    }
  }
  writeFileSync(join(historyDir, INDEX_FILE), JSON.stringify({ editions: kept }, null, 1) + '\n');
  return entry;
}
