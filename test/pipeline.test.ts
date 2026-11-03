import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, decodeEntities } from '../src/rss.ts';
import { clusterItems } from '../src/cluster.ts';
import { normTokens } from '../src/extract.ts';
import type { Source } from '../src/config.ts';

const SRC: Source = { id: 't', name: 'Test', side: 'unknown', rss: 'https://example.com/rss' };

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[ראש הממשלה נפגש עם השר]]></title><link>https://example.com/a1</link><description>תקציר קצר</description><pubDate>Mon, 03 Nov 2026 10:00:00 +0200</pubDate></item>
<item><title>Second &amp; title</title><link>https://example.com/a2</link><description><p>desc with tags</p></description></item>
</channel></rss>`;

test('parseFeed extracts items with CDATA and entities', () => {
  const items = parseFeed(FEED, SRC);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'ראש הממשלה נפגש עם השר');
  assert.equal(items[0].url, 'https://example.com/a1');
  assert.equal(items[1].title, 'Second & title');
  assert.equal(items[1].summary, 'desc with tags');
});

test('normTokens strips Hebrew prefixes on long tokens', () => {
  const t = normTokens('והממשלה אישרה');
  assert.ok(t.has('ממשלה'));
});

test('clusterItems merges cross-source same-story titles', () => {
  const a = parseFeed(FEED, SRC)[0];
  const b = { ...a, source: 'other', sourceName: 'Other', title: 'ראש הממשלה נפגש עם השר במשרדו', url: 'https://other.example/x' };
  const clusters = clusterItems([a, b]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 2);
});

test('clusterItems keeps different stories apart', () => {
  const a = parseFeed(FEED, SRC)[0];
  const b = { ...a, title: 'משחק הכדורגל הסתיים בתיקו', summary: 'תוצאה', url: 'https://other.example/y' };
  assert.equal(clusterItems([a, b]).length, 2);
});

test('decodeEntities handles numeric entities', () => {
  assert.equal(decodeEntities('a&#45;b'), 'a-b');
});
