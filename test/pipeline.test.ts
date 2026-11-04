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
  const b = { ...a, source: 'other', sourceName: 'Other', title: 'ראש הממשלה נפגש עם השר', url: 'https://other.example/x' };
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

test('ambiguous near-match chain stays separate before synthesis', () => {
 const a = {...parseFeed(FEED,SRC)[0],title:'אלפא בטא גמא דלתא',summary:''};
 const b = {...a,url:'https://example.com/b',title:'אלפא בטא אפסילון זטא'};
 const c = {...a,url:'https://example.com/c',title:'אפסילון זטא אתא תטא'};
 const groups=clusterItems([a,b,c]);
 assert.equal(groups.length,3);
 assert.equal(groups[0].items.length,1);
});

import { validateSynthesis, synthesisInput } from '../src/synthesis.ts';
test('synthesis rejects invented evidence and attribution to absent side', () => {
 const items=[{...parseFeed(FEED,SRC)[0],side:'left'}];
 const valid={sides:{left:{summary:[]},center:{summary:[]},right:{summary:[]}}};
 assert.doesNotThrow(()=>validateSynthesis(valid,items));
 assert.throws(()=>validateSynthesis({...valid,sides:{...valid.sides,left:{summary:[{text:'Invented',article_ids:[99]}]}}},items));
 assert.throws(()=>validateSynthesis({...valid,sides:{...valid.sides,right:{summary:[{text:'Wrong side',article_ids:[0]}]}}},items));
 assert.equal(synthesisInput(items)[0].access,'lead_only');
});


import { readFileSync } from 'node:fs';
test('real free-model duration hallucination is rejected, not published', () => {
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/rejected-duration.json',import.meta.url),'utf8'));
 const current={sides:fixture.output.sides};
 assert.throws(()=>validateSynthesis(current,fixture.input),/Unsupported number/);
 // This is a narrow regression check, not proof of semantic accuracy.

});
test('side-only output rejects generated event/comparison fields', () => {
 const items=[{...parseFeed(FEED,SRC)[0],side:'left'}];
 const value={sides:{left:{summary:[]},center:{summary:[]},right:{summary:[]}},event:[]};
 assert.throws(()=>validateSynthesis(value,items),/Unexpected synthesis field/);
});

import { validateVerdicts } from '../src/verification.ts';
test('verifier requires one explicit verdict per candidate and reasons for rejection',()=>{
 assert.throws(()=>validateVerdicts({verdicts:[]},['a']),/Incomplete/);
 assert.throws(()=>validateVerdicts({verdicts:[{id:'a',supported:false,reasons:[]}]},['a']),/Invalid/);
 assert.throws(()=>validateVerdicts({verdicts:[{id:'a',supported:true,reasons:[]},{id:'a',supported:true,reasons:[]}]},['a','b']),/Incomplete/);
 assert.equal(validateVerdicts({verdicts:[{id:'a',supported:false,reasons:['Reversed negation']}]},['a'])[0].supported,false);
});

import { numberClaims } from '../src/synthesis.ts';
test('quantity normalization accepts Hebrew digit paraphrase but not changed quantities',()=>{
 assert.deepEqual(numberClaims('כתשע שנים בשתי קדנציות'),new Set(['9','2']));
 assert.deepEqual(numberClaims('כ-9 שנים בשתי קדנציות'),new Set(['9','2']));
 assert.ok(!numberClaims('19 שנים').has('9'));
 assert.ok(numberClaims('לאחר כשעתיים').has('duration:2hours'));
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/rejected-duration.json',import.meta.url),'utf8'));
 const value={sides:{left:{summary:[{text:'כ-9 שנים בשתי קדנציות',article_ids:[0]}]},center:{summary:[]},right:{summary:[]}}};
 assert.doesNotThrow(()=>validateSynthesis(value,fixture.input));
 value.sides.left.summary[0].text='כ-5 שנים';
 assert.throws(()=>validateSynthesis(value,fixture.input),/Unsupported number/);
 value.sides.left.summary[0].text='לאחר כשעתיים';
 assert.throws(()=>validateSynthesis(value,fixture.input),/Unsupported number/);
});

import { accessCaveats } from '../src/synthesis.ts';
test('access caveats are deterministic metadata, not generated prose',()=>{
 const a=parseFeed(FEED,SRC)[0];
 assert.deepEqual(accessCaveats([{...a,extraction:'lead_only'}]),['חלק מהמידע מבוסס על פתיחי כתבות בלבד.']);
 assert.deepEqual(accessCaveats([{...a,extraction:'full'}]),[]);
 const value={sides:{left:{summary:[]},center:{summary:[]},right:{summary:[]}},caveats:['הדיווח הוא בגדר מזלג']};
 assert.throws(()=>validateSynthesis(value,[a]),/Unexpected synthesis field/);
});

import { synthesizeStory } from '../src/synthesis.ts';
import { verifyCandidates } from '../src/verification.ts';
test('final sides-only model and verifier contract accepts evidence and fails closed',async()=>{
 const original=globalThis.fetch;
 const items=[{...parseFeed(FEED,SRC)[0],side:'left'}];
 const value={sides:{left:{summary:[{text:'ראש הממשלה נפגש עם השר',article_ids:[0]}]},center:{summary:[]},right:{summary:[]}}};
 const reply=(v:unknown)=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(v)}]}}]}));
 try {
  globalThis.fetch=async(_url,init)=>{
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(body.generationConfig.responseSchema.required,['sides']);
   return reply(value);
  };
  assert.deepEqual(await synthesizeStory(items,'test-not-a-key'),value);
  globalThis.fetch=async()=>reply({verdicts:[{id:'summary',supported:false,reasons:['Unsupported attribution']}]});
  assert.equal((await verifyCandidates(items,[{id:'summary',summary:value}],'test-not-a-key'))[0].supported,false);
  globalThis.fetch=async()=>reply({verdicts:[]});
  await assert.rejects(()=>verifyCandidates(items,[{id:'summary',summary:value}],'test-not-a-key'),/Incomplete/);
  globalThis.fetch=async()=>new Response('{}',{status:429});
  await assert.rejects(()=>verifyCandidates(items,[{id:'summary',summary:value}],'test-not-a-key'),/HTTP 429/);
 }finally{globalThis.fetch=original;}
});

test('distinct traffic accidents from the same outlet do not share a story',()=>{
 const a={...parseFeed(FEED,SRC)[0],title:'שבעה פצועים בתאונת דרכים בדימונה ביניהם אישה במצב קשה',summary:'',url:'https://example.com/dimona'};
 const b={...a,title:'שלושה פצועים בתאונת דרכים סמוך לגניגר אחד במצב קשה',url:'https://example.com/ginegar'};
 assert.equal(clusterItems([a,b]).length,2);
});

test('same generic accident wording across outlets with different locations stays separate',()=>{
 const a={...parseFeed(FEED,SRC)[0],title:'תאונת דרכים בדימונה שבעה פצועים',summary:'',url:'https://example.com/d'};
 const b={...a,source:'other',title:'תאונת דרכים בגניגר שלושה פצועים',url:'https://other.example/g'};
 assert.equal(clusterItems([a,b]).length,2);
});
