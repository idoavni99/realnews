import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  orderedEvidence,
  summarizedSides,
  summaryCache,
  summaryFingerprint,
  summarizeStories,
} from '../src/summary-runner.ts';
import { attachSummaryMembership } from '../src/synthesis.ts';
import { publicationGate } from '../scripts/publication-gate.ts';
import type { FeedItem } from '../src/rss.ts';
import type { LlmClient } from '../src/llm.ts';

const item = (id: string): FeedItem => ({
  source: id,
  sourceName: id,
  side: 'center',
  title: 'כותרת',
  url: 'https://example.com/' + id,
  summary: 'טקסט מקור',
  published: '2026-11-08T12:00:00Z',
});
const stories = ['a', 'b', 'c'].map((id) => ({ items: [item(id)] }));
const sideItem = (id: string, side: string): FeedItem => ({ ...item(id), side });
// Two same-side sources: a merged side that earns a paid summary under the per-side rule.
const pair = (a: string, b: string) => ({ items: [item(a), item(b)] });
const pairStories = ['a', 'b', 'c'].map((id) => pair(id + '1', id + '2'));
const draft = { sides: { left: '', center: 'טקסט מקור', right: '' } };
const pause = async () => {};
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'realnews-summary-'));
  const path = join(dir, 'synthesis.json');
  return {
    path,
    cache: summaryCache(path),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('three rounds only retry transient failures; successful stories never repeat', async () => {
  const state = setup();
  const order: string[] = [];
  const attempts: Record<string, number> = {};
  const llm: LlmClient = {
    async generateJson(req) {
      if (req.label === 'Synthesis') {
        const id = (req.input as any)[0].source;
        order.push(id);
        attempts[id] = (attempts[id] ?? 0) + 1;
        if (id === 'c1' || (id === 'b1' && attempts[id] === 1))
          throw new Error('Truncated Synthesis: output token limit');
        return { json: draft };
      }
      return { json: { verdicts: [{ id: 'summary', supported: true, reasons: [] }] } };
    },
  };
  try {
    const result = await summarizeStories(pairStories, {
      enabled: true,
      llm,
      maxCalls: 60,
      cache: state.cache,
      pause,
    });
    assert.deepEqual(order, ['a1', 'b1', 'c1', 'b1', 'c1', 'c1']);
    assert.deepEqual(
      result.map((r) => r.status),
      ['ready', 'ready', 'exhausted'],
    );
    assert.deepEqual(
      result.map((r) => r.attempts.length),
      [1, 2, 3],
    );
    assert.equal(result[2].synthesis, undefined);
    assert.equal(Object.keys(JSON.parse(readFileSync(state.path, 'utf8'))).length, 2);
  } finally {
    state.cleanup();
  }
});

test('rejected verification is never re-billed: one paid attempt, then the story stops', async () => {
  const state = setup();
  let synthesis = 0;
  try {
    const result = await summarizeStories(pairStories.slice(0, 1), {
      enabled: true,
      maxCalls: 6,
      cache: state.cache,
      pause,
      llm: {
        async generateJson(req) {
          if (req.label === 'Synthesis') {
            synthesis++;
            return { json: draft };
          }
          return {
            json: { verdicts: [{ id: 'summary', supported: false, reasons: ['Check'] }] },
          };
        },
      },
    });
    assert.equal(result[0].status, 'unavailable');
    assert.equal(result[0].attempts.length, 1);
    assert.equal(synthesis, 1);
    assert.equal(
      existsSync(state.path) ? Object.keys(JSON.parse(readFileSync(state.path, 'utf8'))).length : 0,
      0,
    );
  } finally {
    state.cleanup();
  }
});

test('single-source stories never get a paid rewrite, even with a cached summary', async () => {
  const state = setup();
  let calls = 0;
  try {
    state.cache.save(summaryFingerprint(stories[0].items), {
      synthesis: attachSummaryMembership(draft, stories[0].items),
    });
    const result = await summarizeStories(stories.slice(0, 1), {
      enabled: true,
      maxCalls: 10,
      cache: summaryCache(state.path),
      pause,
      llm: {
        async generateJson() {
          calls++;
          throw new Error('must not call');
        },
      },
    });
    assert.equal(result[0].status, 'single_source');
    assert.equal(result[0].synthesis, undefined);
    assert.equal(calls, 0);
  } finally {
    state.cleanup();
  }
});

test('a side merges paid prose only when it has several sources', () => {
  assert.deepEqual(summarizedSides([item('a')]), []);
  assert.deepEqual(summarizedSides([item('a'), item('b')]), ['center']);
  assert.deepEqual(summarizedSides([sideItem('l', 'left'), sideItem('r', 'right')]), []);
  assert.deepEqual(
    summarizedSides([
      sideItem('l1', 'left'),
      sideItem('l2', 'center_left'),
      sideItem('r', 'right'),
    ]),
    ['left'],
  );
});

test('eligible story with single-source sides keeps differences without paid side prose', async () => {
  const state = setup();
  const verified: string[] = [];
  const eligible = { items: [sideItem('l1', 'left'), sideItem('r1', 'right')] };
  try {
    const result = await summarizeStories([eligible], {
      enabled: true,
      maxCalls: 10,
      cache: state.cache,
      pause,
      llm: {
        async generateJson(req) {
          if (req.label === 'Synthesis') {
            assert.match(req.system as string, /Summarize ONLY these sides: none/);
            return {
              json: {
                sides: { left: '', center: '', right: '' },
                differences: [
                  {
                    right: 'ימין מדווח אחרת',
                    left: 'שמאל מדווח אחרת',
                    right_article_ids: [1],
                    left_article_ids: [0],
                  },
                ],
              },
            };
          }
          verified.push((req.input as any).candidates?.[0]?.id ?? (req.input as any)[0]?.id ?? '?');
          return { json: { verdicts: [{ id: 'comparison', supported: true, reasons: [] }] } };
        },
      },
    });
    assert.equal(result[0].status, 'ready');
    assert.equal(result[0].comparison?.status, 'ready');
    assert.deepEqual(verified, ['comparison']);
    assert.ok(Object.values(result[0].synthesis!.sides).every((s) => s.summary.length === 0));
  } finally {
    state.cleanup();
  }
});

test('stray prose on a single-source side is dropped, merged sides keep theirs', async () => {
  const state = setup();
  const mixed = {
    items: [item('c1'), item('c2'), sideItem('l1', 'left')],
  };
  try {
    const result = await summarizeStories([mixed], {
      enabled: true,
      maxCalls: 10,
      cache: state.cache,
      pause,
      llm: {
        async generateJson(req) {
          if (req.label === 'Synthesis') {
            assert.match(req.system as string, /Summarize ONLY these sides: center/);
            return { json: { sides: { left: 'תקציר שמאל', center: 'טקסט מקור', right: '' } } };
          }
          return { json: { verdicts: [{ id: 'summary', supported: true, reasons: [] }] } };
        },
      },
    });
    assert.equal(result[0].status, 'ready');
    assert.equal(result[0].synthesis!.sides.left.summary.length, 0);
    assert.equal(result[0].synthesis!.sides.center.summary.length, 1);
  } finally {
    state.cleanup();
  }
});

test('success survives a fresh cache instance, other absent stories, disabled runs and provider change', async () => {
  const state = setup();
  let calls = 0;
  const llm: LlmClient = {
    async generateJson(req) {
      calls++;
      return {
        json:
          req.label === 'Synthesis'
            ? draft
            : { verdicts: [{ id: 'summary', supported: true, reasons: [] }] },
      };
    },
  };
  try {
    await summarizeStories(pairStories.slice(0, 1), {
      enabled: true,
      llm,
      maxCalls: 2,
      cache: state.cache,
      pause,
    });
    await summarizeStories(pairStories.slice(1), {
      enabled: false,
      maxCalls: 0,
      cache: summaryCache(state.path),
      pause,
    });
    const result = await summarizeStories(pairStories.slice(0, 1), {
      enabled: true,
      llm,
      maxCalls: 0,
      cache: summaryCache(state.path),
      pause,
    });
    assert.equal(result[0].status, 'ready');
    assert.equal(calls, 2);
    assert.equal(result[0].attempts.length, 0);
  } finally {
    state.cleanup();
  }
});

test('missing body and lead skip all attempts; RSS lead is still valid source text', async () => {
  const state = setup();
  let calls = 0;
  try {
    const result = await summarizeStories(
      [
        { items: [{ ...item('a'), summary: ' ', fulltext: '\n' }] },
        { items: [item('b'), { ...item('c'), summary: '' }] },
      ],
      {
        enabled: true,
        maxCalls: 20,
        cache: state.cache,
        pause,
        llm: {
          async generateJson() {
            calls++;
            throw new Error('must not call');
          },
        },
      },
    );
    assert.deepEqual(
      result.map((r) => r.status),
      ['missing_text', 'missing_text'],
    );
    assert.equal(calls, 0);
    assert.ok(result.every((r) => r.attempts.length === 0));
  } finally {
    state.cleanup();
  }
});

test('rate-limit stops later paid requests; call cap bounds all rounds', async () => {
  for (const error of ['HTTP 402', 'HTTP 429', 'HTTP 503', 'HTTP 403', 'Transient']) {
    const state = setup();
    let calls = 0;
    try {
      const result = await summarizeStories(pairStories, {
        enabled: true,
        maxCalls: 2,
        cache: state.cache,
        pause,
        llm: {
          async generateJson() {
            calls++;
            throw new Error(error);
          },
        },
      });
      assert.equal(calls, 1);
      assert.ok(result.every((r) => !r.synthesis));
    } finally {
      state.cleanup();
    }
  }
});

test('stable source order keeps cache key and citation membership deterministic', () => {
  const a = orderedEvidence([item('b'), item('a')]);
  const b = orderedEvidence([item('a'), item('b')]);
  assert.equal(summaryFingerprint(a), summaryFingerprint(b));
  assert.notEqual(
    summaryFingerprint(a),
    summaryFingerprint([{ ...a[0], summary: 'changed' }, a[1]]),
  );
});

test('failed summary is isolated while verified stories and source articles survive publication', () => {
  const synthesis = attachSummaryMembership(draft, [item('a')]);
  const good = { articles: [item('a')], synthesis_status: 'ready', synthesis };
  const failed = { articles: [item('b')], synthesis_status: 'exhausted', synthesis };
  const data = {
    stories: [good, failed, { articles: [item('c')], synthesis_status: 'missing_text' }],
  };
  const out = publicationGate(data);
  assert.deepEqual(out.stories[0], good);
  assert.equal(out.stories[1].synthesis, undefined);
  assert.deepEqual(out.stories[1].articles, failed.articles);
  assert.equal(out.stories.length, 3);
  assert.equal(data.stories[1].synthesis, synthesis);
});

test('malformed ready prose is omitted locally without manual approval or relaxed citation checks', () => {
  const synthesis = attachSummaryMembership(draft, [item('a')]);
  for (const invalid of [
    {},
    { sides: {} },
    { ...synthesis, headline: 'invented' },
    { sides: { ...synthesis.sides, center: { summary: [{ text: 'text', article_ids: [99] }] } } },
    { sides: { ...synthesis.sides, right: synthesis.sides.center } },
    {
      sides: {
        ...synthesis.sides,
        center: {
          summary: [{ text: 'text', article_ids: [0, 0], evidence_kind: 'side_membership' }],
        },
      },
    },
  ]) {
    const out = publicationGate(
      {
        grouping: { complete: true },
        stories: [
          { articles: [item('a')], synthesis_status: 'ready', synthesis: invalid },
          { articles: [item('b')], synthesis_status: 'ready', synthesis },
        ],
      },
      true,
    );
    assert.equal(out.stories[0].synthesis, undefined);
    assert.equal(out.stories[0].synthesis_status, 'invalid_summary');
    assert.deepEqual(out.stories[1].synthesis, synthesis);
  }
  const absent = publicationGate({ stories: [{ synthesis_status: 'ready' }] });
  assert.equal(absent.stories[0].synthesis_status, 'invalid_summary');
});

test('unvalidated grouping never calls summary or reuses cached prose', async () => {
  const state = setup();
  try {
    state.cache.save(
      summaryFingerprint(stories[0].items),
      attachSummaryMembership(draft, stories[0].items),
    );
    const result = await summarizeStories([{ ...stories[0], heldBack: true }], {
      enabled: true,
      maxCalls: 60,
      cache: state.cache,
      pause,
      llm: {
        async generateJson() {
          throw new Error('must not call');
        },
      },
    });
    assert.equal(result[0].status, 'grouping_unvalidated');
    assert.equal(result[0].synthesis, undefined);
  } finally {
    state.cleanup();
  }
});
