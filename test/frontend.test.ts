import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
function context(search = '') {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: '',
        innerHTML: '',
        classList: { remove() {}, add() {} },
        addEventListener() {},
      });
    return nodes.get(id);
  };
  const location = { search, href: 'https://example.com/' + search, hash: '' };
  const ctx = vm.createContext({
    URL,
    URLSearchParams,
    location,
    history: {
      replaceState(_a, _b, url) {
        location.href = url.href;
        location.search = url.search;
      },
    },
    document: {
      getElementById: node,
      createElement() {
        return {
          set textContent(v) {
            this.innerHTML = String(v || '').replace(/</g, '&lt;');
          },
        };
      },
    },
    window: { addEventListener() {} },
    fetch: () => new Promise(() => {}),
    console,
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  return { ctx, node, location, run: (s) => vm.runInContext(s, ctx) };
}
test('URL query initializes exact affiliations, Unicode search and combined same-article matching', () => {
  const c = context('?side=center_left&q=%D7%9B%D7%A1%D7%A3');
  c.run('syncControls()');
  assert.equal(c.node('search').value, 'כסף');
  assert.equal(c.node('affiliation').value, 'center_left');
  c.run(
    `globalThis.story={articles:[{side:'left',title:'כסף',summary:'בדיקה',source:'מקור'},{side:'right',title:'אחר',summary:'משהו',source:'source'}]}`,
  );
  assert.equal(c.run(`matchesStory(story,{q:'כסף בדיקה',side:'left'})`), true);
  assert.equal(c.run(`matchesStory(story,{q:'כסף',side:'right'})`), false);
  assert.equal(c.run(`matchesStory(story,{q:'SOURCE',side:'right'})`), true);
  assert.equal(c.run(`matchesStory(story,{q:'לא נמצא',side:''})`), false);
});
test('filter query encoding preserves hash and unrelated params; clear removes only q and side', () => {
  const c = context('?keep=1');
  c.location.href += '&q=old#/story/3';
  c.node('search').value = 'צה"ל & test';
  c.node('affiliation').value = 'center_right';
  c.run('updateFilters()');
  const url = new URL(c.location.href);
  assert.equal(url.searchParams.get('q'), 'צה"ל & test');
  assert.equal(url.searchParams.get('side'), 'center_right');
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(url.hash, '#/story/3');
  c.node('search').value = '';
  c.node('affiliation').value = '';
  c.run('updateFilters()');
  assert.equal(new URL(c.location.href).searchParams.has('q'), false);
  assert.equal(new URL(c.location.href).searchParams.get('keep'), '1');
});
test('unified feed renders each matching story once and retains original detail index', () => {
  const c = context('?side=left');
  c.run(
    `DATA={generated_at:new Date().toISOString(),window_hours:24,monitored_sides:['left','right'],source_health:{},stories:[{headline:'One',summary:'lead',total:2,counts:{left:1,right:1},articles:[{side:'left',title:'left'},{side:'right',title:'right'}]},{headline:'Two',summary:'other',total:1,counts:{right:1},articles:[{side:'right',title:'right'}]}]};renderFeed();`,
  );
  const feed = c.node('feed').innerHTML;
  assert.equal((feed.match(/class="card"/g) || []).length, 1);
  assert.ok(feed.includes('#/story/0'));
  assert.ok(feed.includes('1 מתוך 2'));
  assert.ok(!feed.includes('class="grp'));
});

test('published full-feed data has every completed group and no article duplicates', () => {
  const data = JSON.parse(readFileSync(new URL('../site/data.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(data.stories));
  const urls = data.stories.flatMap((s) => s.articles.map((a) => a.url));
  assert.equal(new Set(urls).size, urls.length);
  const pipeline = readFileSync(new URL('../src/pipeline.ts', import.meta.url), 'utf8');
  assert.ok(!/slice\(0,\s*30\)/.test(pipeline));
});

test('partial digest shows bars from published articles with partial label, warns with omitted count and avoids absence claims', () => {
  const c = context();
  c.run(
    `DATA={generated_at:new Date().toISOString(),window_hours:12,grouping:{partial:true,omitted_articles:14},monitored_sides:['left','right'],source_health:{},stories:[{headline:'Valid',summary:'source',total:1,counts:{left:1},articles:[{side:'left',title:'left'}]}]};renderFeed();`,
  );
  const feed = c.node('feed').innerHTML;
  assert.ok(feed.includes('14 כתבות הושמטו'));
  assert.ok(feed.includes('seg-left'));
  assert.ok(feed.includes('האחוזים משקפים רק את הכתבות שפורסמו'));
  assert.ok(c.run('sideSummariesHtml(DATA.stories[0])').includes('אין להסיק שלא דווח'));
});

test('complete digest shows bars without the partial label', () => {
  const c = context();
  c.run(
    `DATA={generated_at:new Date().toISOString(),window_hours:12,grouping:{partial:false,omitted_articles:0},monitored_sides:['left','right'],source_health:{},stories:[{headline:'Valid',summary:'source',total:1,counts:{left:1},articles:[{side:'left',title:'left'}]}]};renderFeed();`,
  );
  const feed = c.node('feed').innerHTML;
  assert.ok(feed.includes('seg-left'));
  assert.ok(!feed.includes('האחוזים משקפים רק את הכתבות שפורסמו'));
});

test('edition selector lists past editions, validates the edition param and builds URLs', () => {
  const c = context('?edition=2026-11-13T06-00-00Z');
  c.run(
    `EDITIONS=[{id:'2026-11-14T06-00-00Z',generated_at:'2026-11-14T06:00:00.000Z',stories:20},{id:'2026-11-13T06-00-00Z',generated_at:'2026-11-13T06:00:00.000Z',stories:18}];populateEditions();`,
  );
  assert.equal(c.run('readEdition()'), '2026-11-13T06-00-00Z');
  assert.equal(c.run(`editionUrl('')`), 'data.json');
  assert.equal(c.run(`editionUrl('2026-11-13T06-00-00Z')`), 'history/2026-11-13T06-00-00Z.json');
  const html = c.node('edition').innerHTML;
  assert.ok(html.includes('המהדורה האחרונה'));
  assert.ok((html.match(/<option/g) || []).length === 3);
  assert.ok(html.includes('value="2026-11-14T06-00-00Z"'));
  assert.equal(c.node('edition-row').hidden, false);
  const c2 = context('?edition=unknown');
  c2.run(`EDITIONS=[];populateEditions();`);
  assert.equal(c2.run('readEdition()'), '');
  assert.equal(c2.node('edition-row').hidden, true);
});

test('viewing a past edition shows the old-edition banner and suppresses the stale warning', () => {
  const c = context('?edition=old');
  c.run(
    `EDITIONS=[{id:'old',generated_at:'2026-11-10T06:00:00.000Z',stories:1}];populateEditions();`,
  );
  c.run(
    `CURRENT_EDITION='old';applyData({generated_at:new Date(Date.now()-72*36e5).toISOString(),window_hours:12,monitored_sides:['left','right'],source_health:{},stories:[{headline:'Old',summary:'lead',total:1,counts:{left:1},articles:[{side:'left',title:'t'}]}]});`,
  );
  const banner = c.node('edition-banner');
  assert.equal(banner.hidden, false);
  assert.ok(banner.innerHTML.includes('מוצגת מהדורה ישנה'));
  assert.ok(!c.node('feed').innerHTML.includes('מושהית'));
  c.run(
    `CURRENT_EDITION='';applyData({generated_at:new Date(Date.now()-72*36e5).toISOString(),window_hours:12,monitored_sides:['left','right'],source_health:{},stories:[{headline:'New',summary:'lead',total:1,counts:{left:1},articles:[{side:'left',title:'t'}]}]});`,
  );
  assert.equal(c.node('edition-banner').hidden, true);
  assert.ok(c.node('feed').innerHTML.includes('מושהית'));
});

test('switching editions updates the query string and keeps filters', () => {
  const c = context('?q=%D7%9B%D7%A1%D7%A3&side=left');
  c.run(
    `EDITIONS=[{id:'e1',generated_at:'2026-11-13T06:00:00.000Z',stories:1}];populateEditions();`,
  );
  c.run(`switchEdition('e1')`);
  const url = new URL(c.location.href);
  assert.equal(url.searchParams.get('edition'), 'e1');
  assert.equal(url.searchParams.get('q'), 'כסף');
  assert.equal(url.searchParams.get('side'), 'left');
});

test('comparison section: bullets, one-side phrasing, explicit no-difference and absent states', () => {
  const c = context();
  const story = {
    articles: [
      { source: 'ימין א', side: 'right', url: 'https://r1.example.com' },
      { source: 'ימין ב', side: 'right', url: 'https://r2.example.com' },
      { source: 'שמאל א', side: 'left', url: 'https://l1.example.com' },
    ],
    comparison: {
      status: 'ready',
      bullets: [
        {
          right: { text: 'דרישת רוטציה', article_ids: [0, 1] },
          left: { text: 'הצעה ללא רוטציה', article_ids: [2] },
        },
        { right: { text: 'ועדה לביטול חוקים', article_ids: [1] } },
      ],
    },
  };
  c.run(`globalThis.s1=${JSON.stringify(story)}`);
  const html = c.run('comparisonHtml(s1)');
  assert.ok(html.includes('מה שונה בסיקור'));
  assert.ok(html.includes('<b class="r">ימין</b>: דרישת רוטציה'));
  assert.ok(html.includes('<b class="l">שמאל</b>: הצעה ללא רוטציה'));
  assert.ok(html.includes('ועדה לביטול חוקים - הוזכר רק ב<b class="r">ימין</b>'));
  assert.ok(html.includes('href="https://r1.example.com"'));
  assert.ok(html.includes('href="https://l1.example.com"'));
  assert.ok(html.includes('>ימין א</a>'));
  assert.ok(html.includes('>שמאל א</a>'));
  assert.ok(html.includes('על בסיס הטקסט שנאסף בלבד'));

  c.run(`globalThis.s2={articles:s1.articles,comparison:{status:'no_difference',bullets:[]}}`);
  const none = c.run('comparisonHtml(s2)');
  assert.ok(none.includes('לא נמצאו הבדלים ברורים'));
  assert.ok(!none.includes('<ul>'));

  c.run(`globalThis.s3={articles:s1.articles}`);
  assert.equal(c.run('comparisonHtml(s3)'), '');

  // Escaping: fragment text must not inject markup.
  c.run(
    `globalThis.s4={articles:s1.articles,comparison:{status:'ready',bullets:[{left:{text:'<img src=x>',article_ids:[2]}}]}}`,
  );
  const escaped = c.run('comparisonHtml(s4)');
  assert.ok(!escaped.includes('<img'));
  assert.ok(escaped.includes('&lt;img'));
});
