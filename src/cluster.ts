import type { FeedItem } from './rss.ts';
import { normTokens } from './extract.ts';

export interface Cluster {
  tokens: Set<string>;
  items: FeedItem[];
}

/**
 * Baseline cross-source story clustering: containment similarity over
 * normalized title+summary-lead tokens. An LLM step can replace this later.
 */
export function clusterItems(items: FeedItem[], threshold = 0.45): Cluster[] {
  const clusters: Cluster[] = [];
  const seenUrls = new Set<string>();
  for (const it of items) {
    const url = new URL(it.url);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
    }
    if (seenUrls.has(url.href)) continue;
    seenUrls.add(url.href);
    const toks = normTokens(it.title + ' ' + it.summary.slice(0, 120));
    let best: Cluster | null = null;
    let bestSim = 0;
    for (const c of clusters) {
      const inter = [...toks].filter((t) => c.tokens.has(t)).length;
      const sim = inter / (Math.min(toks.size, c.tokens.size) || 1);
      if (sim > bestSim) { best = c; bestSim = sim; }
    }
    if (best && bestSim >= threshold) {
      best.items.push(it);
      // Keep the first article as the anchor: union expansion can drift into a new event.
    } else {
      clusters.push({ tokens: new Set(toks), items: [it] });
    }
  }
  return clusters;
}
