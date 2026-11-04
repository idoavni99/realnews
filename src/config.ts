import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Source {
  id: string;
  name: string;
  side: 'right' | 'center_right' | 'center' | 'center_left' | 'left' | 'unknown';
  rss: string;
  extraction?: 'rss_only';
  format?: 'i24_json';
}

export interface Config {
  sources: Source[];
  windowHours: number;
  maxArticlesPerSource: number;
}

export const CONFIRMED_SIDES = ['right', 'center_right', 'center', 'center_left', 'left'] as const;
export type Side = typeof CONFIRMED_SIDES[number];
const VALID_SIDES = new Set<string>([...CONFIRMED_SIDES, 'unknown']);
/** Feed/summary groups. Group membership follows the raw owner label. */
export type Group = 'left' | 'center' | 'right';
export const GROUPS: readonly Group[] = ['left', 'center', 'right'];
export function groupOf(side: string): Group | null {
  if (side === 'left' || side === 'center_left') return 'left';
  if (side === 'right' || side === 'center_right') return 'right';
  if (side === 'center') return 'center';
  return null;
}
/** Coverage weight: center_left = 0.5 left + 0.5 center, center_right = 0.5 right + 0.5 center. */
const WEIGHTS: Record<string, Partial<Record<Group, number>>> = {
  left: { left: 1 }, center: { center: 1 }, right: { right: 1 },
  center_left: { left: 0.5, center: 0.5 }, center_right: { right: 0.5, center: 0.5 },
};
/** Weighted coverage from actual per-raw-side article counts. Denominator = sum of weights = articles with a confirmed, monitored label. */
export function weightedCoverage(counts: Record<string, number>): { left: number; center: number; right: number; denominator: number } {
  const out = { left: 0, center: 0, right: 0, denominator: 0 };
  for (const [side, n] of Object.entries(counts)) {
    const w = WEIGHTS[side]; if (!w) continue;
    for (const g of GROUPS) { out[g] += (w[g] ?? 0) * n; out.denominator += (w[g] ?? 0) * n; }
  }
  return out;
}
/** Owner-typo guard: an unrecognized side is treated as unknown (never as a new side). */
export function normalizeSide(s: string): Source['side'] {
  // Owner tags may be written center-left / center-right; accept that spelling as the same category.
  const k = String(s).trim().toLowerCase().replace(/-/g, '_');
  return (VALID_SIDES.has(k) ? k : 'unknown') as Source['side'];
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
