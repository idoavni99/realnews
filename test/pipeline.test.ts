import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, decodeEntities, parseI24News } from '../src/rss.ts';
import { clusterItems } from '../src/cluster.ts';
import { normTokens, extractArticlePage } from '../src/extract.ts';
import { loadConfig, normalizeSide, type Source } from '../src/config.ts';

const SRC: Source = { id: 't', name: 'Test', side: 'unknown', rss: 'https://example.com/rss' };

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[ראש הממשלה נפגש עם השר]]></title><link>https://example.com/a1</link><description>תקציר קצר</description><pubDate>Tue, 03 Nov 2026 10:00:00 +0200</pubDate></item>
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

test('real sources.yaml parses with valid neutral sides', () => {
  const cfg = loadConfig(new URL('..', import.meta.url).pathname);
  assert.ok(cfg.sources.length >= 5);
  for (const s of cfg.sources) {
    assert.ok(['right', 'center', 'left', 'unknown'].includes(s.side));
    assert.ok(s.rss.startsWith('https://'));
  }
});

test('normalizeSide coerces typos to unknown', () => {
  assert.equal(normalizeSide('rigth'), 'unknown');
  assert.equal(normalizeSide('left'), 'left');
});


test('article extraction rejects page boilerplate even with title overlap', () => {
  const title = 'הממשלה אישרה תקציב חדש';
  const page = `<title>${title}</title><nav>${title} ${'חדשות ספורט אוכל '.repeat(100)}</nav>`;
  assert.deepEqual(extractArticlePage(page, title), { text: '', status: 'lead_only' });
});

test('article extraction parses escaped quotes as complete JSON, without navigation', () => {
  const body = 'הממשלה אישרה תקציב חדש. השר אמר: "נמשיך לפעול", אחרי הדיון. '.repeat(15);
  const page = `<nav>navigation</nav><script type="application/ld+json">${JSON.stringify({articleBody: body})}</script>`;
  const result = extractArticlePage(page, 'הממשלה אישרה תקציב חדש');
  assert.equal(result.status, 'full');
  assert.equal(result.text, body.trim());
  assert.ok(!result.text.includes('navigation'));
});

test('decodeEntities handles hexadecimal apostrophes', () => {
  assert.equal(decodeEntities('ג&#x27;קסון'), "ג'קסון");
});


test('RSS publication dates unwrap CDATA for the real time window', () => {
 const xml = FEED.replace('Tue, 03 Nov 2026 10:00:00 +0200', '<![CDATA[Tue, 03 Nov 2026 10:00:00 +0200]]>');
 assert.ok(Number.isFinite(Date.parse(parseFeed(xml, SRC)[0].published)));
});


test('Haaretz remains RSS-only to respect premium access', () => {
 const cfg = loadConfig(new URL('..', import.meta.url).pathname);
 assert.equal(cfg.sources.find(s => s.id === 'haaretz')?.extraction, 'rss_only');
});


test('i24 uses article metadata, deduplicates links and excludes unlinked flashes', () => {
 const article = {title:'Article headline', frontendUrl:'https://www.i24news.tv/he/news/test', publishedAt:'2026-11-03T12:00:00Z', excerpt:'Article lead'};
 const rows = [{title:'Different flash',content:article},{content:article},{title:'Unlinked',content:null}];
 const a = parseI24News(JSON.stringify(rows), SRC);
 assert.equal(a.length, 1);
 assert.equal(a[0].title, 'Article headline');
 assert.equal(a[0].summary, 'Article lead');
 assert.equal(a[0].published, article.publishedAt);
});


test('cluster URL dedup ignores tracking and fragments', () => {
 const a = parseFeed(FEED, SRC)[0];
 const b = {...a, url: a.url + '?utm_source=test#top'};
 assert.equal(clusterItems([a,b])[0].items.length,1);
});

test('cluster anchor does not expand through a chain into another event', () => {
 const a = {...parseFeed(FEED,SRC)[0],title:'אלפא בטא גמא דלתא',summary:''};
 const b = {...a,url:'https://example.com/b',title:'אלפא בטא אפסילון זטא'};
 const c = {...a,url:'https://example.com/c',title:'אפסילון זטא אתא תטא'};
 const groups=clusterItems([a,b,c]);
 assert.equal(groups.length,2);
 assert.equal(groups[0].items.length,2);
});

import { validateSynthesis, synthesisInput } from '../src/synthesis.ts';
test('synthesis rejects invented evidence and attribution to absent side', () => {
 const items=[{...parseFeed(FEED,SRC)[0],side:'left'}];
 const valid={event:[{text:'Reported fact',article_ids:[0]}],sides:{left:{summary:[]},center:{summary:[]},right:{summary:[]}},differences:[],caveats:[]};
 assert.doesNotThrow(()=>validateSynthesis(valid,items));
 assert.throws(()=>validateSynthesis({...valid,event:[{text:'Invented',article_ids:[99]}]},items));
 assert.throws(()=>validateSynthesis({...valid,sides:{...valid.sides,right:{summary:[{text:'Wrong side',article_ids:[0]}]}}},items));
 assert.equal(synthesisInput(items)[0].access,'lead_only');
});


import { readFileSync } from 'node:fs';
test('real free-model duration hallucination is rejected, not published', () => {
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/rejected-duration.json',import.meta.url),'utf8'));
 assert.throws(()=>validateSynthesis(fixture.output,fixture.input),/Unsupported number word/);
 // This is a narrow regression check, not proof of semantic accuracy.
 const hours=structuredClone(fixture.output);
 hours.sides.left.summary=[];
 hours.event[0].text='הודיע על סיום תפקידו לאחר כשעתיים מצטברות בשתי קדנציות של כ-9 שנים.';
 assert.throws(()=>validateSynthesis(hours,fixture.input),/Unsupported number word/);
});
test('a single-side story cannot manufacture a cross-side difference', () => {
 const items=[{...parseFeed(FEED,SRC)[0],side:'left'}];
 const value={event:[{text:'Reported fact',article_ids:[0]}],sides:{left:{summary:[]},center:{summary:[]},right:{summary:[]}},differences:[{text:'Difference',article_ids:[0]}],caveats:[]};
 assert.throws(()=>validateSynthesis(value,items),/multiple sides/);
});
