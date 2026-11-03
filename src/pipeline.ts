/**
 * Daily news pipeline: fetch RSS -> extract full text -> cluster stories -> site/data.json.
 * Dependency-free TypeScript; runs directly on Node >= 22.18 (built-in type stripping).
 *
 * Coverage semantics (product contract):
 * - A source's political side comes only from sources.yaml, confirmed by the owner.
 * - monitored_sides = confirmed sides with at least one source that fetched OK this run.
 * - A monitored side with no articles on a story is "no coverage found".
 * - A side with no healthy sources (or no confirmed label) is NOT part of the
 *   percentage at all - the UI shows it as "not monitored", never as 0%.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, CONFIRMED_SIDES } from './config.ts';
import { httpGet, sleep } from './http.ts';
import { parseFeed, type FeedItem } from './rss.ts';
import { extractFulltext } from './extract.ts';
import { clusterItems } from './cluster.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface StoryArticle {
  source: string; side: string; title: string; url: string;
  extraction: string; summary: string;
}

interface Story {
  headline: string; summary: string; counts: Record<string, number>;
  total: number; articles: StoryArticle[];
}

/** Trim to ~max chars at a sentence boundary, never mid-word. */
function trimSentence(text: string, max = 400): string {
  const t = text.slice(0, max);
  if (text.length <= max) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('। '));
  if (cut > max * 0.4) return t.slice(0, cut + 1);
  const sp = t.lastIndexOf(' ');
  return (sp > max * 0.5 ? t.slice(0, sp) : t) + '…';
}

function storySummary(items: FeedItem[]): string {
  const best = items.reduce((a, b) =>
    ((b.fulltext || b.summary).length > (a.fulltext || a.summary).length ? b : a));
  return trimSentence(best.fulltext || best.summary);
}

async function main() {
  const cfg = loadConfig(ROOT);
  const items: FeedItem[] = [];
  const sourceHealth: Record<string, { ok: boolean; items: number; side: string; name: string; status: string }> = {};
  for (const s of cfg.sources) {
    try {
      const got = parseFeed(await httpGet(s.rss), s)
        .filter(i => { const age = Date.now() - Date.parse(i.published); return Number.isFinite(age) && age >= -300000 && age <= cfg.windowHours * 3600000; })
        .slice(0, cfg.maxArticlesPerSource);
      items.push(...got);
      sourceHealth[s.id] = { ok: got.length > 0, items: got.length, side: s.side, name: s.name, status: got.length ? 'ok' : 'no_recent_items' };
      console.error(`${s.id}: ${got.length} items`);
    } catch (e) {
      sourceHealth[s.id] = { ok: false, items: 0, side: s.side, name: s.name, status: 'fetch_failed' };
      console.error(`${s.id}: FAILED ${(e as Error).message}`);
    }
  }
  for (const it of items) {
    const { text, status } = await extractFulltext(it.url, it.title);
    it.fulltext = text;
    it.extraction = status;
    await sleep(400);
  }
  const monitoredSides = [...new Set(
    Object.values(sourceHealth)
      .filter((h) => h.ok && (CONFIRMED_SIDES as readonly string[]).includes(h.side))
      .map((h) => h.side),
  )].sort();
  const stories: Story[] = [];
  for (const c of clusterItems(items)) {
    const counts: Record<string, number> = {};
    for (const i of c.items) {
      if (monitoredSides.includes(i.side)) counts[i.side] = (counts[i.side] ?? 0) + 1;
    }
    stories.push({
      headline: c.items.reduce((a, b) => (b.title.length > a.title.length ? b : a)).title,
      summary: storySummary(c.items),
      counts,
      total: c.items.length,
      articles: c.items.map((i) => ({
        source: i.sourceName, side: i.side, title: i.title, url: i.url,
        extraction: i.extraction ?? 'lead_only', summary: i.summary.slice(0, 300),
      })),
    });
  }
  stories.sort((a, b) => b.total - a.total);
  const out = {
    generated_at: new Date().toISOString(),
    window_hours: cfg.windowHours,
    monitored_sides: monitoredSides,
    source_health: sourceHealth,
    stories: stories.slice(0, 30),
  };
  const dest = join(ROOT, 'site', 'data.json');
  writeFileSync(dest, JSON.stringify(out, null, 1));
  const nFull = items.filter((i) => i.extraction === 'full').length;
  console.error(`wrote ${stories.length} stories, ${items.length} items (${nFull} full-text) -> ${dest}`);
}

main();
