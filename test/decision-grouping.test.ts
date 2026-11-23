import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupWithDecisions } from '../src/decision-grouping.ts';
import type { DecisionClient, DecisionRequest } from '../src/decisions.ts';
import type { FeedItem } from '../src/rss.ts';

const item = (id: string): FeedItem => ({
  source: 'outlet',
  sourceName: 'Outlet',
  side: 'center',
  title: id,
  url: `https://example.com/${id}`,
  summary: `ראיה ${id}`,
  published: '',
});
const config = { threshold: 0.9, maxCalls: 30 };
function client(judge: (request: DecisionRequest, key: string) => number): DecisionClient {
  return {
    async decide(request) {
      return {
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key) => [key, judge(request, key)]),
        ),
        diagnostics: { requested_model: 'mock', content_chars: 0 },
      };
    },
  };
}
const titles = (result: Awaited<ReturnType<typeof groupWithDecisions>>) =>
  result.groups.map((group) => group.items.map((item) => item.title));

test('empty and first-singleton grouping need no inference or fabricated assignment', async () => {
  const never = client(() => {
    throw new Error('Must not call');
  });
  assert.equal((await groupWithDecisions([], never, config)).calls, 0);
  const result = await groupWithDecisions([item('a')], never, config);
  assert.equal(result.complete, true);
  assert.deepEqual(titles(result), [['a']]);
});

test('only one complete accepted group merges, equality at threshold is explicit', async () => {
  const result = await groupWithDecisions(
    [item('a'), item('b')],
    client(() => 0.9),
    config,
  );
  assert.deepEqual(titles(result), [['a', 'b']]);
  assert.equal(result.calls, 1);
});

test('A-B and B-C must not transitively merge A-C when A-C is rejected', async () => {
  const result = await groupWithDecisions(
    ['a', 'b', 'c'].map(item),
    client((request, key) => {
      const state = request.state as any;
      return state.article.title === 'c' && state.members[key].title === 'a' ? 0.1 : 0.99;
    }),
    config,
  );
  assert.deepEqual(titles(result), [['a', 'b'], ['c']]);
});

test('two accepted groups remain ambiguous; neither first-match routing nor group fusion is allowed', async () => {
  const result = await groupWithDecisions(
    ['a', 'b', 'c'].map(item),
    client((request) => ((request.state as any).article.title === 'b' ? 0.1 : 0.99)),
    config,
  );
  assert.deepEqual(titles(result), [['a'], ['b'], ['c']]);
});

test('low certainty leaves valid separate stories, missing answer does not masquerade as no-match', async () => {
  const separate = await groupWithDecisions(
    ['a', 'b'].map(item),
    client(() => 0.89),
    config,
  );
  assert.equal(separate.complete, true);
  assert.equal(separate.groups.length, 2);
  const missing = await groupWithDecisions(
    ['a', 'b'].map(item),
    client(() => undefined as any),
    config,
  );
  assert.equal(missing.complete, false);
  assert.equal(missing.unvalidated_articles, 1);
});

test('call cap holds remaining articles back, never falls back to lexical merging', async () => {
  const capped = await groupWithDecisions(
    ['a', 'b', 'c'].map(item),
    client(() => 0.99),
    { ...config, maxCalls: 0 },
  );
  assert.equal(capped.calls, 0);
  assert.equal(capped.unvalidated_articles, 2);
  assert.deepEqual(
    capped.batches.map((batch) => batch.status),
    ['skipped', 'skipped'],
  );
});

test('persistent transport failure holds back only its own article and the stage continues', async () => {
  let calls = 0;
  const brokenForB: DecisionClient = {
    async decide(request) {
      calls++;
      if ((request.state as any).article.title === 'b') throw new Error('HTTP 503');
      return {
        answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, 0.99])),
        diagnostics: { requested_model: 'mock', content_chars: 0 },
      };
    },
  };
  const result = await groupWithDecisions(['a', 'b', 'c'].map(item), brokenForB, config);
  // b exhausted its 3 attempts; c was still processed and merged with a.
  assert.equal(calls, 4);
  assert.deepEqual(titles(result), [['a', 'c'], ['b']]);
  assert.equal(result.complete, false);
  assert.equal(result.unvalidated_articles, 1);
  const failed = result.batches.find((batch) => batch.status === 'unavailable');
  assert.equal(failed?.failure_class, 'provider_unavailable');
  assert.equal(failed?.attempts, 3);
  assert.equal(result.batches.filter((batch) => batch.status === 'skipped').length, 0);
});

test('a transient failure is retried and can recover within the same batch', async () => {
  let calls = 0;
  const flaky: DecisionClient = {
    async decide(request) {
      calls++;
      if (calls === 1) throw new Error('HTTP 429');
      return {
        answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, 0.99])),
        diagnostics: { requested_model: 'mock', content_chars: 0 },
      };
    },
  };
  const result = await groupWithDecisions(['a', 'b'].map(item), flaky, config);
  assert.equal(calls, 2);
  assert.deepEqual(titles(result), [['a', 'b']]);
  assert.equal(result.complete, true);
  assert.equal(result.batches[0].status, 'ok');
  assert.equal(result.batches[0].attempts, 2);
});

test('deterministic contract failures are not retried, and the stage still continues', async () => {
  let calls = 0;
  const contractForB: DecisionClient = {
    async decide(request) {
      calls++;
      if ((request.state as any).article.title === 'b')
        throw new Error('Decision request exceeds conservative byte limit');
      return {
        answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, 0.99])),
        diagnostics: { requested_model: 'mock', content_chars: 0 },
      };
    },
  };
  const result = await groupWithDecisions(['a', 'b', 'c'].map(item), contractForB, config);
  assert.equal(calls, 2);
  const failed = result.batches.find((batch) => batch.status === 'unavailable');
  assert.equal(failed?.failure_class, 'request_too_large');
  assert.equal(failed?.attempts, 1);
  assert.deepEqual(titles(result), [['a', 'c'], ['b']]);
});

test('canonical duplicate articles do not increase decision work or outlet coverage', async () => {
  const result = await groupWithDecisions(
    [item('a'), item('a')],
    client(() => {
      throw new Error('No call');
    }),
    config,
  );
  assert.equal(result.groups[0].items.length, 1);
  assert.equal(result.calls, 0);
});

test('owner-selected 0.8 threshold accepts equality and keeps a lower valid score separate', async () => {
  const accepted = await groupWithDecisions(
    ['a', 'b'].map(item),
    client(() => 0.8),
    { ...config, threshold: 0.8 },
  );
  assert.equal(accepted.groups.length, 1);
  const separate = await groupWithDecisions(
    ['a', 'b'].map(item),
    client(() => 0.799),
    { ...config, threshold: 0.8 },
  );
  assert.equal(separate.groups.length, 2);
  assert.equal(separate.complete, true);
});
