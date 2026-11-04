import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupArticles, articleId, GROUPING_INSTRUCTIONS, GROUPING_SCHEMA, compactCheckpoint, estTokens, groupingSchema, validateAssignments, validateMerges } from '../src/grouping.ts';
import type { LlmClient, LlmRequest } from '../src/llm.ts';
import type { FeedItem } from '../src/rss.ts';

const FIXED = estTokens(GROUPING_INSTRUCTIONS) + estTokens(JSON.stringify(groupingSchema([])));
const mk = (n: number, title: string, source = 'ynet', lead = 'פתיח ' + title): FeedItem => ({
  source, sourceName: source, side: 'center', title, url: `https://${source}.example/a${n}`, summary: lead, published: new Date(Date.UTC(2026, 10, 4, 0, n)).toISOString(),
} as FeedItem);
const id = (n: number, source = 'ynet') => articleId(`https://${source}.example/a${n}`);

/** Mock model: rules is a function of the request input; records every request. */
function mock(decide: (input: any, call: number) => unknown | Error) {
  const calls: LlmRequest[] = [];
  const client: LlmClient = { async generateJson(req) { calls.push(JSON.parse(JSON.stringify(req))); const r = decide(req.input, calls.length); if (r instanceof Error) throw r; const keys=new Map<string,string>();
    if ((r as any)?.assignments) (r as any).assignments=(r as any).assignments.map((a:any)=>{
      if('target' in a || !('story_id' in a || 'new_key' in a)) return a;
      if(a.story_id&&a.new_key)return a;
      if(a.story_id)return {article_id:a.article_id,target:a.story_id};
      if(!keys.has(a.new_key))keys.set(a.new_key,'new:'+(keys.size+1));
      return {article_id:a.article_id,target:keys.get(a.new_key)};
    });
    return { json: r, usage: { promptTokenCount: 1 } }; } };
  return { client, calls };
}
// Group by an explicit event tag embedded in the title, like a perfect model would.
const tag = (t: string) => t.split(':')[0];
const perfect = (input: any) => ({
  assignments: input.new_articles.map((a: any) => {
    const hit = input.checkpoint.stories.find((s: any) => tag(s.title) === tag(a.title));
    return hit ? { article_id: a.id, story_id: hit.id } : { article_id: a.id, new_key: tag(a.title) };
  }),
});

test('article ids are stable across runs and ignore tracking params', () => {
  assert.equal(articleId('https://x.example/p?utm_source=a#frag'), articleId('https://x.example/p'));
  assert.notEqual(articleId('https://x.example/p1'), articleId('https://x.example/p2'));
});

test('single batch: model groups across outlets; originals retained under stable ids', async () => {
  const items = [mk(1, 'A: ראשון', 'ynet'), mk(2, 'A: ראשון בניסוח אחר', 'walla'), mk(3, 'B: שני', 'ynet')];
  const { client, calls } = mock(perfect);
  const r = await groupArticles(items, client);
  assert.equal(calls.length, 1);
  assert.equal(r.groups.length, 2);
  const a = r.groups.find(g => g.items.length === 2)!;
  assert.deepEqual(a.articleIds.sort(), [id(1), id(2, 'walla')].sort());
  assert.equal(a.items[0].title.startsWith('A:'), true);
  assert.equal(calls[0].label, 'Grouping');
});

test('token-bounded batches; later batch joins earlier story through compact checkpoint only', async () => {
  const items = [1, 2, 3, 4, 5, 6].map(n => mk(n, `E${n % 2}: כותרת ${n}`, 'ynet', 'x'.repeat(200)));
  const { client, calls } = mock(perfect);
  const r = await groupArticles(items, client, { batchTokens: 8000, maxArticlesPerBatch: 2, checkpointShare: 0.3, leadChars: 200 });
  assert.ok(r.batches.length >= 3, 'forced several batches');
  for (const b of r.batches) assert.ok(b.est_tokens <= 8000, 'estimated size within budget');
  assert.equal(r.groups.length, 2, 'cross-batch same events were joined');
  assert.equal(r.groups.reduce((n, g) => n + g.items.length, 0), 6);
  // New context: batch 2+ must not contain earlier articles' text or ids as new_articles, only the checkpoint.
  const first = new Set(calls[0].input && (calls[0].input as any).new_articles.map((a: any) => a.id));
  const second = calls[1].input as any;
  assert.ok(second.checkpoint.stories.length > 0);
  for (const a of second.new_articles) assert.ok(!first.has(a.id));
  assert.equal(JSON.stringify(second).includes('xxxxxxxxxx'.repeat(5)) && second.checkpoint.stories.some((s: any) => s.lead), false, 'checkpoint carries no article leads');
  assert.ok(second.checkpoint.stories.every((s: any) => !('lead' in s) && !('members' in s)));
  assert.equal(typeof calls[1].system, 'string');
  assert.ok(!('history' in calls[1]) && !('previous' in calls[1]));
});

test('invalid answer fails closed: batch articles stay separate, run continues', async () => {
  const items = [mk(1, 'A: x'), mk(2, 'A: y', 'walla')];
  const bad = mock(() => ({ assignments: [{ article_id: 'a_invented', new_key: 'k' }] }));
  const r = await groupArticles(items, bad.client);
  assert.equal(r.groups.length, 2);
  assert.equal(r.batches[0].status, 'rejected');
  assert.match(r.batches[0].error!, /unknown article id/);
});

test('missing, duplicate, ambiguous and invented assignment IDs are rejected',()=>{
 const sent=['a_1','a_2'],known=new Set(['s1']);
 assert.throws(()=>validateAssignments({assignments:[{article_id:'a_1',target:'new:1'}]},sent,known),/not every article/);
 assert.throws(()=>validateAssignments({assignments:[{article_id:'a_1',target:'new:1'},{article_id:'a_1',target:'new:1'}]},sent,known),/duplicate/);
 assert.throws(()=>validateAssignments({assignments:[{target:'new:1'}]},sent,known),/unknown article/);
 assert.throws(()=>validateAssignments({assignments:[{article_id:'a_1',target:'s9'}]},sent,known),/unknown target/);
 assert.throws(()=>validateAssignments({assignments:[{article_id:'a_1',target:'new:3'}]},sent,known),/unknown target/);
 assert.throws(()=>validateAssignments({assignments:[{article_id:'a_1',target:'s1',new_key:'x'}]},sent,known),/unexpected/);
 assert.equal(validateAssignments({assignments:[{article_id:'a_1',target:'s1'},{article_id:'a_2',target:'new:1'}]},sent,known).size,2);
});

test('HTTP 503 stops further calls and leaves remaining articles ungrouped', async () => {
  const items = [1, 2, 3, 4, 5, 6].map(n => mk(n, `E: ${n}`, 'ynet', 'x'.repeat(200)));
  const m = mock((_i, c) => c === 1 ? perfect(_i) : new Error('Grouping HTTP 503: overloaded'));
  const r = await groupArticles(items, m.client, { batchTokens: 8000, maxArticlesPerBatch: 2, checkpointShare: 0.3, leadChars: 200 });
  assert.equal(m.calls.length, 2, 'no calls after the 503');
  assert.ok(r.batches.some(b => b.status === 'unavailable'));
  assert.equal(r.groups.reduce((n, g) => n + g.items.length, 0), 6, 'no article lost');
});

test('no provider configured: every article is its own story, zero calls', async () => {
  const r = await groupArticles([mk(1, 'A'), mk(2, 'A', 'walla')], undefined);
  assert.equal(r.groups.length, 2); assert.equal(r.calls, 0);
});

test('call cap is enforced', async () => {
  const items = [1, 2, 3, 4, 5, 6].map(n => mk(n, `E${n}: t`, 'ynet', 'x'.repeat(200)));
  const m = mock(perfect);
  const r = await groupArticles(items, m.client, { batchTokens: 8000, maxArticlesPerBatch: 2, checkpointShare: 0.3, leadChars: 200, maxCalls: 2, maxArticlesPerBatch: 1 });
  assert.equal(m.calls.length, 2);
  assert.ok(r.batches.some(b => b.status === 'skipped'));
});

test('checkpoint compaction never drops a story: brief, then short titles; reports when it cannot fit', () => {
  const stories = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, title: 'כותרת ארוכה מספיק '.repeat(6) + i, brief: 'פתיח '.repeat(30), members: i === 0 ? ['a', 'b'] : ['a'] }));
  const full = compactCheckpoint(stories, 1e6); assert.equal(full.level, 0); assert.equal(full.stories.length, 40);
  const noBrief = estTokens(JSON.stringify(stories.map(s => ({ id: s.id, title: s.title, count: s.members.length }))));
  const l1 = compactCheckpoint(stories, noBrief + 5);
  assert.equal(l1.level, 1); assert.ok(l1.stories.every(s => !('brief' in s)));
  const l2 = compactCheckpoint(stories, 100, 1e6);
  assert.equal(l2.level, 2); assert.equal(l2.stories.length, 40, 'no story evicted'); assert.ok(l2.stories.every(s => s.title.length <= 50));
  assert.deepEqual(l2.stories.map(s => s.id), stories.map(s => s.id)); assert.equal(l2.stories[0].count, 2, 'counts and ids kept');
  assert.equal(l2.fits, true);
  assert.equal(compactCheckpoint(stories, 100, 100).fits, false, 'cannot fit: caller must stop');
});

test('every sent checkpoint contains EVERY story known so far (no eviction)', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map(n => mk(n, `E${n}: t`, 'ynet', 'x'.repeat(200)));
  const r = await groupArticles(items, mock(perfect).client, { batchTokens: 10000, checkpointShare: 0.9, maxArticlesPerBatch: 2, leadChars: 200 });
  let known = 0;
  for (const b of r.batches) { assert.equal(b.checkpoint_story_ids.length, known); known += b.article_ids.length; }
  assert.ok(r.batches.length > 1);
  assert.equal(r.complete, true); assert.equal(r.unvalidated_articles, 0);
  assert.ok(r.groups.every(g => g.grouping === 'schema_assigned'));
});

test('checkpoint that cannot fit the budget stops semantic grouping, marks the rest unresolved, not complete', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8].map(n => mk(n, `E${n}: t`, 'ynet', 'x'.repeat(200)));
  const m = mock(perfect);
  const r = await groupArticles(items, m.client, { batchTokens: FIXED + 330, checkpointShare: 0.1, leadChars: 200 });
  const un = r.batches.find(b => b.status === 'unresolved')!;
  assert.ok(un, 'an unresolved batch is recorded'); assert.match(un.error!, /cannot fit/);
  assert.equal(m.calls.length, r.batches.length - 1, 'no call for the unresolved remainder');
  assert.equal(r.complete, false); assert.ok(r.unvalidated_articles > 0);
  assert.equal(r.groups.reduce((n, g) => n + g.items.length, 0), 8, 'no article lost');
  assert.equal(r.groups.filter(g => g.grouping === 'unvalidated').length, r.unvalidated_articles);
});

test('transport failure, rejection and no provider yield unvalidated placeholders, never validated groups', async () => {
  const items = [mk(1, 'A: x'), mk(2, 'A: y', 'walla')];
  const r = await groupArticles(items, mock(() => new Error('Grouping HTTP 503: x')).client);
  assert.equal(r.complete, false); assert.equal(r.unvalidated_articles, 2);
  assert.ok(r.groups.every(g => g.grouping === 'unvalidated'));
  const r2 = await groupArticles(items, mock(() => ({ assignments: [] })).client);
  assert.ok(r2.groups.every(g => g.grouping === 'unvalidated'));
  const r3 = await groupArticles(items, undefined);
  assert.equal(r3.complete, false); assert.ok(r3.groups.every(g => g.grouping === 'unvalidated'));
});

test('budget covers instructions + schema + checkpoint + articles + output reserve (heuristic estimate)', async () => {
  const items = Array.from({ length: 12 }, (_, i) => mk(i + 1, `E${i}: t`, 'ynet', 'x'.repeat(250)));
  const BT = 8000;
  const r = await groupArticles(items, mock(perfect).client, { batchTokens: BT, maxArticlesPerBatch: 2, checkpointShare: 0.6, leadChars: 250 });
  for (const b of r.batches.filter(x => x.input)) {
    const sent = estTokens(GROUPING_INSTRUCTIONS) + estTokens(JSON.stringify(GROUPING_SCHEMA)) + estTokens(JSON.stringify(b.input));
    assert.ok(sent + b.est_output_reserve <= BT, `input ${sent} + output reserve ${b.est_output_reserve} within ${BT}`);
  }
  assert.ok(r.batches.length > 1);
});

test('output reserve also bounds articles per call by maxOutputTokens', async () => {
  const items = Array.from({ length: 12 }, (_, i) => mk(i + 1, `E${i}: t`, 'ynet', 'y'));
  const r = await groupArticles(items, mock(perfect).client, { batchTokens: 100000, maxOutputTokens: 400 });
  for (const b of r.batches) assert.ok(b.est_output_reserve === 400);
  assert.ok(r.batches.length > 1);
});

test('optional reconciliation merges via validated ids only and is off by default', async () => {
  const items = [mk(1, 'A: x'), mk(2, 'B: y', 'walla')];
  const off = mock(perfect);
  assert.equal((await groupArticles(items, off.client)).reconcile, undefined);
  const m = mock((input, c) => c === 1 ? perfect(input) : { merges: [{ keep: 's1', absorb: ['s2'] }] });
  const r = await groupArticles(items, m.client, { reconcile: true });
  assert.equal(r.reconcile!.status, 'ok'); assert.equal(r.groups.length, 1);
  const bad = mock((input, c) => c === 1 ? perfect(input) : { merges: [{ keep: 's1', absorb: ['s77'] }] });
  const r2 = await groupArticles(items, bad.client, { reconcile: true });
  assert.equal(r2.reconcile!.status, 'rejected'); assert.equal(r2.groups.length, 2, 'rejected merge changes nothing');
  assert.throws(() => validateMerges({ merges: [{ keep: 's1', absorb: ['s1'] }] }, new Set(['s1'])), /reused/);
});

test('the transport is the only provider-specific piece: a custom client drives grouping unchanged', async () => {
  const custom: LlmClient = { generateJson: async req => ({ json: { assignments: (req.input as any).new_articles.map((a: any) => ({ article_id: a.id, target: 'new:1' })) } }) };
  const r = await groupArticles([mk(1, 'x'), mk(2, 'y', 'walla')], custom);
  assert.equal(r.groups.length, 1);
});

test('a later assignment cannot validate a failed-batch placeholder member', async () => {
  const items = Array.from({ length: 6 }, (_, i) => mk(i + 1, `E${i}: title`, 'ynet', 'x'.repeat(200)));
  const m = mock((input, call) => call === 1 ? { assignments: [] } : {
    assignments: input.new_articles.map((a: any) => ({ article_id: a.id, story_id: input.checkpoint.stories[0].id }))
  });
  const r = await groupArticles(items, m.client, { batchTokens: 8000, maxArticlesPerBatch: 2, checkpointShare: .3, leadChars: 200 });
  assert.ok(r.batches.length > 1);
  assert.equal(r.batches[0].status, 'rejected');
  assert.ok(r.batches.some(b => b.status === 'ok'));
  assert.ok(r.groups.some(g => g.items.length > 1), 'regression must exercise mixed membership');
  assert.ok(r.groups.every(g => g.grouping === 'unvalidated'), 'one unvalidated member taints the whole group');
  assert.equal(r.complete, false);
});

test('schema-valid assignment is not semantic event validation: captured false merges stay evaluation negatives', async () => {
  const { readFileSync } = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/free-router-false-merges.json', import.meta.url), 'utf8'));
  assert.ok(fixture.cases.length >= 3);
  for (const c of fixture.cases) {
    assert.equal(c.expected_same_event, false);
    const items = c.articles.map((a: any, i: number) => ({ ...a, sourceName: a.source, side: 'center', published: new Date(Date.UTC(2026,10,4,0,i)).toISOString() }));
    const m = mock(input => ({ assignments: input.new_articles.map((a: any) => ({ article_id: a.id, new_key: 'wrong-event' })) }));
    const r = await groupArticles(items, m.client);
    // Deliberately demonstrates the limit: valid IDs/schema alone cannot reject these false merges.
    assert.equal(r.groups.length, 1);
    assert.equal(r.groups[0].grouping, 'schema_assigned');
    assert.notEqual(r.groups[0].grouping, 'event_verified');
  }
});

test('article batch cap is independent of completion allowance',async()=>{
 const items=Array.from({length:10},(_,i)=>mk(i+1,`E${i}: title`));
 const m=mock(perfect);
 const r=await groupArticles(items,m.client,{batchTokens:6000,maxOutputTokens:2000,maxArticlesPerBatch:5,maxCalls:2});
 assert.equal(r.calls,2);assert.deepEqual(r.batches.map(b=>b.article_ids.length),[5,5]);
 assert.ok(m.calls.every(c=>c.maxOutputTokens===2000));
});

test('each call constrains story IDs to its checkpoint and retains invalid IDs for diagnostics',async()=>{
 const items=Array.from({length:4},(_,i)=>mk(i+1,`E${i}: title`));
 const m=mock((input,c)=>c===1?perfect(input):{assignments:input.new_articles.map((a:any)=>({article_id:a.id,story_id:'fabricated-story'}))});
 const r=await groupArticles(items,m.client,{maxArticlesPerBatch:2,maxCalls:2});
 for(let i=0;i<m.calls.length;i++){
  const input:any=m.calls[i].input;const schema:any=m.calls[i].schema;
  assert.deepEqual(schema.properties.assignments.items.properties.target.enum,[...input.checkpoint.stories.map((s:any)=>s.id),...input.new_articles.map((_:any,j:number)=>'new:'+(j+1))]);
 }
 assert.equal(r.batches[1].status,'rejected');
 assert.match(r.batches[1].error!,/fabricated-story/);
 assert.equal((r.batches[1].assignment_output as any)[0].target,'fabricated-story');
 assert.ok(r.groups.filter(g=>g.items.some(a=>[items[2].url,items[3].url].includes(a.url))).every(g=>g.grouping==='unvalidated'));
});

test('source round-robin fills batches across outlets, preserving cursor and outlet chronology',async()=>{
 const items=[mk(1,'a1','alpha'),mk(2,'a2','alpha'),mk(3,'a3','alpha'),mk(4,'b1','beta'),mk(5,'b2','beta'),mk(6,'c1','gamma'),mk(7,'c2','gamma')];
 const m=mock(perfect);const r=await groupArticles(items,m.client,{maxArticlesPerBatch:2,maxCalls:4});
 const actual=r.batches.map(b=>b.article_ids.map(id=>items.find(x=>articleId(x.url)===id)!.source));
 assert.deepEqual(actual,[['alpha','beta'],['gamma','alpha'],['beta','gamma'],['alpha']]);
 const sent=r.batches.flatMap(b=>b.article_ids);assert.equal(new Set(sent).size,items.length);
 assert.deepEqual(sent.filter(id=>items.find(x=>articleId(x.url)===id)!.source==='alpha'),[1,2,3].map(n=>articleId(`https://alpha.example/a${n}`)));
});

test('every fitting full-source round contains one article from each active outlet',async()=>{
 const items=['alpha','beta','gamma'].flatMap((s,i)=>[mk(i*2+1,s+':one',s),mk(i*2+2,s+':two',s)]);
 const r=await groupArticles(items,mock(perfect).client,{maxArticlesPerBatch:3,maxCalls:2});
 assert.equal(r.batches.length,2);
 for(const b of r.batches)assert.equal(new Set(b.article_ids.map(id=>items.find(x=>articleId(x.url)===id)!.source)).size,3);
});

test('flat schema requires article ID and one target, with no branching',()=>{
 const item=groupingSchema(['s1'],['a','b']).properties.assignments.items;
 assert.deepEqual(item.required,['article_id','target']);assert.equal(item.oneOf,undefined);
 assert.deepEqual(item.properties.article_id.enum,['a','b']);assert.deepEqual(item.properties.target.enum,['s1','new:1','new:2']);
 assert.throws(()=>validateAssignments({assignments:[{article_id:'a',story_id:'s1',new_key:'x'}]},['a'],new Set(['s1'])),/unexpected/);
});

test('active source heads are time-ordered each round without a hard time cutoff',async()=>{
 const {sourceRoundRobin}=await import('../src/grouping.ts');
 const a=mk(1,'a early','alpha'),a2=mk(9,'a late','alpha'),b=mk(2,'b early','beta'),b2=mk(3,'b next','beta');
 const rows=sourceRoundRobin([a2,b2,b,a]);
 assert.deepEqual(rows.map(x=>x.title),['a early','b early','b next','a late']);
 assert.equal(rows.length,4,'late article retained regardless of time gap');
});

test('invalid numeric bounds fail before any model call',async()=>{
 const m=mock(perfect);
 for(const cfg of [{maxArticlesPerBatch:0},{maxArticlesPerBatch:NaN},{batchTokens:NaN},{maxCalls:Infinity},{leadChars:-1},{delayMs:-1},{checkpointShare:1},{maxOutputTokens:0}])
   await assert.rejects(groupArticles([mk(1,'A')],m.client,cfg),/Invalid grouping config/);
 assert.equal(m.calls.length,0);
});
test('actual candidate schema, payload and requested completion allowance determine budget',async()=>{
 const m=mock(perfect); const items=Array.from({length:150},(_,i)=>mk(i+1,'A: same'));
 const r=await groupArticles(items,m.client,{batchTokens:6000,maxArticlesPerBatch:1,maxCalls:1});
 assert.equal(m.calls.length,1,'remaining queue enum does not prevent first call');
 const req=m.calls[0];const batch=r.batches[0];
 assert.equal(batch.est_tokens,estTokens(req.system)+estTokens(JSON.stringify(req.schema))+estTokens(JSON.stringify(req.input))+req.maxOutputTokens);
 assert.equal((req.schema as any).properties.assignments.items.properties.article_id.enum.length,1);
 assert.equal(r.groups.flatMap(g=>g.articleIds).length,150,'all articles retained after call cap');
});
test('checkpoint retains publication range and latest evidence through compaction',async()=>{
 const m=mock(perfect); const items=[mk(1,'A: first'),mk(2,'A: latest'),mk(3,'B: next')];
 await groupArticles(items,m.client,{batchTokens:10000,maxArticlesPerBatch:1});
 const ck=(m.calls[2].input as any).checkpoint.stories[0];
 assert.equal(ck.published_from,items[0].published);assert.equal(ck.published_to,items[1].published);assert.equal(ck.latest.title,'A: latest');
 assert.equal((m.calls[0].input as any).new_articles[0].published,items[0].published);
 const missing=mock(perfect);await groupArticles([{...mk(1,'A'),published:''}],missing.client);
 assert.equal((missing.calls[0].input as any).new_articles[0].published,null);
});

test('unknown publication times skip temporal ordering but retain continuous source round-robin',async()=>{
 const {sourceRoundRobin}=await import('../src/grouping.ts');
 const items=[mk(9,'late A','one'),{...mk(7,'unknown B','two'),published:''},mk(1,'early A','one'),mk(2,'early B','two')];
 assert.deepEqual(sourceRoundRobin(items).map(a=>a.title),['late A','unknown B','early A','early B']);
 const m=mock(perfect);const r=await groupArticles(items,m.client,{maxArticlesPerBatch:1,checkpointShare:.001,batchTokens:10000});
 assert.deepEqual(m.calls.flatMap(c=>(c.input as any).new_articles.map((a:any)=>a.title)),['late A','unknown B','early A','early B']);
 assert.ok(r.batches.some(b=>b.checkpoint_level>0),'compaction remains independent of missing dates');
});


test('110 distinct articles retain every checkpoint ID within bounded full-feed context',async()=>{
 const items=Array.from({length:110},(_,i)=>mk(i+1,`E${i}: `+'כותרת ארוכה '.repeat(12),'source'+i%10,'פתיח '.repeat(80)));
 const r=await groupArticles(items,mock(perfect).client,{batchTokens:24000,maxArticlesPerBatch:6,maxCalls:30});
 assert.equal(r.complete,true);assert.equal(r.groups.length,110);assert.ok(r.calls<=30);
 assert.ok(r.batches.every(b=>b.est_tokens<=24000&&b.article_ids.length<=6));
 let known=0;for(const b of r.batches){assert.equal(b.checkpoint_story_ids.length,known);known+=b.article_ids.length;}
});
