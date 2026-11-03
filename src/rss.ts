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
        title, url: link, summary, published: pick(x, 'pubDate'),
      });
    }
  }
  return items;
}
