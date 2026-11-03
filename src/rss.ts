import type { Source } from './config.ts';

export interface FeedItem {
  source: string;
  sourceName: string;
  side: string;
  title: string;
  url: string;
  summary: string;
  published: string;
  fulltext?: string;
  extraction?: 'full' | 'partial' | 'lead_only';
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&hellip;/g, '...').replace(/&[nm]dash;/g, '-')
    .replace(/&times;/g, 'x').replace(/&deg;/g, ' deg ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function pick(itemXml: string, tag: string): string {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
}

export function parseFeed(xml: string, source: Source): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const title = decodeEntities(pick(x, 'title'));
    const link = decodeEntities(pick(x, 'link'));
    const summary = decodeEntities(pick(x, 'description')).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (title && link) {
      items.push({
        source: source.id, sourceName: source.name, side: source.side,
        title, url: link, summary, published: decodeEntities(pick(x, 'pubDate')),
      });
    }
  }
  return items;
}


/** i24's public updates contain repeated links; use each article's own metadata once. */
export function parseI24News(json: string, source: Source): FeedItem[] {
  const rows = JSON.parse(json);
  if (!Array.isArray(rows)) throw new Error('Invalid i24 updates payload');
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const row of rows) {
    const c = row?.content;
    if (!c?.frontendUrl || !c?.title || !c?.publishedAt) continue;
    const url = new URL(c.frontendUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.i24news.tv' || seen.has(url.href)) continue;
    seen.add(url.href);
    items.push({ source: source.id, sourceName: source.name, side: source.side,
      title: c.title, url: url.href, summary: c.excerpt || '', published: c.publishedAt });
  }
  return items;
}
