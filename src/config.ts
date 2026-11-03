import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Source {
  id: string;
  name: string;
  side: 'right' | 'center' | 'left' | 'unknown';
  rss: string;
  extraction?: 'rss_only';
  format?: 'i24_json';
}

export interface Config {
  sources: Source[];
  windowHours: number;
  maxArticlesPerSource: number;
}

export const CONFIRMED_SIDES = ['right', 'center', 'left'] as const;
export type Side = typeof CONFIRMED_SIDES[number];
const VALID_SIDES = new Set<string>([...CONFIRMED_SIDES, 'unknown']);
/** Owner-typo guard: an unrecognized side is treated as unknown (never as a new side). */
export function normalizeSide(s: string): Source['side'] {
  return (VALID_SIDES.has(s) ? s : 'unknown') as Source['side'];
}

/** Minimal parser for our flat sources.yaml shape - no external deps. */
export function loadConfig(root: string): Config {
  const text = readFileSync(join(root, 'sources.yaml'), 'utf8');
  const sources: Source[] = [];
  const opts: Record<string, string> = {};
  let cur: Record<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('  - id:')) {
      cur = { id: line.split(':', 2)[1].trim() };
      sources.push(cur as unknown as Source);
    } else if (cur && line.startsWith('    ') && line.includes(':')) {
      const i = line.indexOf(':');
      cur[line.trim().slice(0, line.trim().indexOf(':')).trim()] = line.trim().slice(line.trim().indexOf(':') + 1).trim();
    } else if (line.includes(':') && !line.startsWith(' ') && !line.startsWith('#')) {
      const i = line.indexOf(':');
      opts[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  for (const src of sources) src.side = normalizeSide(src.side as string);
  return {
    sources,
    windowHours: parseInt(opts['window_hours'] ?? '24', 10),
    maxArticlesPerSource: parseInt(opts['max_articles_per_source'] ?? '15', 10),
  };
}
