import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupArticles, articleId, GROUPING_INSTRUCTIONS, GROUPING_SCHEMA, compactCheckpoint, estTokens, validateAssignments, validateMerges } from '../src/grouping.ts';
import type { LlmClient, LlmRequest } from '../src/llm.ts';
import type { FeedItem } from '../src/rss.ts';

const FIXED = estTokens(GROUPING_INSTRUCTIONS) + estTokens(JSON.stringify(GROUPING_SCHEMA));
const mk = (n: number, title: string, source = 'ynet', lead = 'פתיח ' + title): FeedItem => ({
  source, sourceName: source, side: 'center', title, url: `https://${source}.example/a${n}`, summary: lead, published: new Date(Date.UTC(2026, 10, 4, 0, n)).toISOString(),
} as FeedItem);
const id = (n: number, source = 'ynet') => articleId(`https://${source}.example/a${n}`);

/** Mock model: rules is a function of the request input; records every request. */
function mock(decide: (input: any, call: number) => unknown | Error) {
  const calls: LlmRequest[] = [];
  const client: LlmClient = { async generateJson(req) { calls.push(JSON.parse(JSON.stringify(req))); const r = decide(req.input, calls.length); if (r instanceof Error) throw r; return { json: r, usage: { promptTokenCount: 1 } }; } };
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
  const r = await groupArticles(items, client, { batchTokens: FIXED + 520, checkpointShare: 0.3, leadChars: 200 });
  assert.ok(r.batches.length >= 3, 'forced several batches');
  for (const b of r.batches) assert.ok(b.est_tokens <= FIXED + 520 + 200, 'estimated size near budget');
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

test('missing, duplicate, or ambiguous assignment is rejected', () => {
  const sent = ['a_1', 'a_2'];
  const known = new Set(['s1']);
  assert.throws(() => validateAssignments({ assignments: [{ article_id: 'a_1', new_key: 'k' }] }, sent, known), /not every article/);
  assert.throws(() => validateAssignments({ assignments: [{ article_id: 'a_1', new_key: 'k' }, { article_id: 'a_1', new_key: 'k' }] }, sent, known), /duplicate/);
  assert.throws(() => validateAssignments({ assignments: [{ article_id: 'a_1', story_id: 's1', new_key: 'k' }, { article_id: 'a_2', new_key: 'k' }] }, sent, known), /exactly one/);
  assert.throws(() => validateAssignments({ assignments: [{ article_id: 'a_1', story_id: 's9' }, { article_id: 'a_2', new_key: 'k' }] }, sent, known), /unknown story/);
  assert.equal(validateAssignments({ assignments: [{ article_id: 'a_1', story_id: 's1' }, { article_id: 'a_2', new_key: 'k' }] }, sent, known).size, 2);
});

test('HTTP 503 stops further calls and leaves remaining articles ungrouped', async () => {
  const items = [1, 2, 3, 4, 5, 6].map(n => mk(n, `E: ${n}`, 'ynet', 'x'.repeat(200)));
  const m = mock((_i, c) => c === 1 ? perfect(_i) : new Error('Grouping HTTP 503: overloaded'));
  const r = await groupArticles(items, m.client, { batchTokens: FIXED + 520, checkpointShare: 0.3, leadChars: 200 });
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
  const r = await groupArticles(items, m.client, { batchTokens: FIXED + 520, checkpointShare: 0.3, leadChars: 200, maxCalls: 2 });
  assert.equal(m.calls.length, 2);
  assert.ok(r.batches.some(b => b.status === 'skipped'));
});

test('checkpoint compaction levels: brief dropped, then small stories dropped and reported', () => {
  const stories = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, title: 'כותרת ארוכה מספיק ' + i, brief: 'פתיח '.repeat(30), members: i === 0 ? ['a', 'b'] : ['a'] }));
  const full = compactCheckpoint(stories, 1e6); assert.equal(full.level, 0);
  const lvl1 = compactCheckpoint(stories, estTokens(JSON.stringify(stories.map(s => ({ id: s.id, title: s.title, count: s.members.length })))) + 5);
  assert.equal(lvl1.level, 1); assert.ok(lvl1.stories.every(s => !('brief' in s)));
  const lvl2 = compactCheckpoint(stories, 300);
  assert.equal(lvl2.level, 2); assert.ok(lvl2.dropped.length > 0);
  assert.ok(lvl2.stories.some(s => s.id === 's0'), 'multi-article story kept longest');
  assert.ok(estTokens(JSON.stringify(lvl2.stories)) <= 300);
});

test('dropped checkpoint stories cannot be referenced by the model', async () => {
  const items = [1, 2, 3, 4, 5, 6].map(n => mk(n, `E${n}: t`, 'ynet', 'x'.repeat(200)));
  const m = mock((input, c) => c === 2 ? { assignments: input.new_articles.map((a: any) => ({ article_id: a.id, story_id: 's1' })) } : perfect(input));
  const r = await groupArticles(items, m.client, { batchTokens: FIXED + 520, checkpointShare: 0.05, leadChars: 200 });
  const b = r.batches[1];
  assert.ok(b.checkpoint_dropped.includes('s1'), 'oldest single story was compacted out of the sent checkpoint');
  assert.equal(b.status, 'rejected');
  assert.match(b.error!, /unknown story id/);
  assert.equal(r.groups.reduce((n, g) => n + g.items.length, 0), 6);
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
  const custom: LlmClient = { generateJson: async req => ({ json: { assignments: (req.input as any).new_articles.map((a: any) => ({ article_id: a.id, new_key: 'same' })) } }) };
  const r = await groupArticles([mk(1, 'x'), mk(2, 'y', 'walla')], custom);
  assert.equal(r.groups.length, 1);
});
