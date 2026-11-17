import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  comparisonCandidate,
  qualifiesForComparison,
  synthesizeStory,
  validateComparison,
  validateSynthesis,
} from '../src/synthesis.ts';
import { summarizeStories, summaryCache, summaryFingerprint } from '../src/summary-runner.ts';
import { decisionVerifier } from '../src/decision-verification.ts';
import type { DecisionClient } from '../src/decisions.ts';
import type { FeedItem } from '../src/rss.ts';
import type { LlmClient } from '../src/llm.ts';

const item = (id: string, side: FeedItem['side'], text = 'טקסט מקור'): FeedItem => ({
  source: id,
  sourceName: id,
  side,
  title: 'כותרת ' + id,
  url: 'https://example.com/' + id,
  summary: text,
  published: '2026-11-17T08:00:00Z',
});
const bothSides = [item('r1', 'right'), item('r2', 'right'), item('l1', 'left')];
const pause = async () => {};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'realnews-comparison-'));
  const path = join(dir, 'synthesis.json');
  return {
    path,
    cache: summaryCache(path),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('qualification requires at least one article in each side group', () => {
  assert.equal(qualifiesForComparison(bothSides), true);
  assert.equal(
    qualifiesForComparison([item('r1', 'center_right'), item('l1', 'center_left')]),
    true,
  );
  assert.equal(qualifiesForComparison([item('r1', 'right'), item('c1', 'center')]), false);
  assert.equal(qualifiesForComparison([item('l1', 'left'), item('c1', 'center')]), false);
  assert.equal(qualifiesForComparison([item('c1', 'center')]), false);
});

test('valid differences: paired bullet, one-side bullet, empty array means no_difference', () => {
  const paired = validateComparison(
    [
      {
        right: 'הליכוד דורש רוטציה',
        left: 'איזנקוט מציע ממשלה ללא רוטציה',
        right_article_ids: [0, 1],
        left_article_ids: [2],
      },
      { right: 'ועדה לביטול חוקי הרפורמה', left: '', right_article_ids: [1], left_article_ids: [] },
    ],
    bothSides,
  );
  assert.equal(paired.status, 'ready');
  assert.equal(paired.bullets.length, 2);
  assert.deepEqual(paired.bullets[1], {
    right: { text: 'ועדה לביטול חוקי הרפורמה', article_ids: [1] },
  });
  const none = validateComparison([], bothSides);
  assert.deepEqual(none, { status: 'no_difference', bullets: [] });
});

test('invalid differences throw: bullets, citations, fields, sides, numbers, sizes', () => {
  const good = {
    right: 'פרט',
    left: '',
    right_article_ids: [0],
    left_article_ids: [],
  };
  const bad = [
    'not-array',
    [good, good, good, good], // too many
    [{ ...good, topic: 'x' }], // unexpected field
    [{ ...good, right_article_ids: [2] }], // cross-side citation
    [{ ...good, right_article_ids: [99] }], // unknown id
    [{ ...good, right: '', right_article_ids: [0] }], // citation without text
    [{ ...good, right: 'x'.repeat(251) }], // oversized
    [{ right: '', left: '', right_article_ids: [], left_article_ids: [] }], // empty bullet
    [{ right: 'פרט 987654', left: '', right_article_ids: [0], left_article_ids: [] }], // unsupported number
    [{ ...good, right_article_ids: [0, 1, 0, 0, 0], left_article_ids: [] }].map((b) => b), // >4 ids
  ];
  for (const value of bad) assert.throws(() => validateComparison(value, bothSides), Error);
  // Supported number passes when the cited article contains it.
  const numbered = [item('r1', 'right', 'נפצעו 3 אנשים'), item('l1', 'left')];
  assert.equal(
    validateComparison(
      [{ right: 'דווח על 3 נפצעים', left: '', right_article_ids: [0], left_article_ids: [] }],
      numbered,
    ).status,
    'ready',
  );
});

test('comparison candidate fits the existing per-side verifier shape', () => {
  const comparison = validateComparison(
    [
      {
        right: 'הליכוד דורש רוטציה',
        left: 'איזנקוט מציע ממשלה',
        right_article_ids: [0],
        left_article_ids: [2],
      },
    ],
    bothSides,
  );
  const candidate = comparisonCandidate(comparison);
  assert.ok(candidate);
  assert.equal(candidate.sides.right.summary.length, 1);
  assert.equal(candidate.sides.left.summary.length, 1);
  assert.equal(candidate.sides.center.summary.length, 0);
  // Must pass the same deterministic validator the verifier applies to candidates.
  assert.doesNotThrow(() => validateSynthesis(candidate, bothSides));
  assert.equal(comparisonCandidate({ status: 'no_difference', bullets: [] }), undefined);
});

test('synthesizeStory: extended contract only for qualifying stories, invalid differences dropped not retried', async () => {
  const requests: any[] = [];
  const llm: LlmClient = {
    async generateJson(req) {
      requests.push(req);
      const qualifying = JSON.stringify(req.schema).includes('differences');
      return {
        json: qualifying
          ? {
              sides: { left: 'טקסט מקור', center: '', right: 'טקסט מקור' },
              differences: [
                {
                  right: 'פרט',
                  left: '',
                  right_article_ids: [2], // cross-side on purpose: l1 is index 2
                  left_article_ids: [],
                },
              ],
            }
          : { sides: { left: '', center: 'טקסט מקור', right: '' } },
      };
    },
  };
  const centerOnly = [item('a', 'center'), item('b', 'center')];
  const plain = await synthesizeStory(centerOnly, llm);
  assert.ok(!JSON.stringify(requests[0].schema).includes('differences'));
  assert.ok(!requests[0].system.includes('differences'));
  assert.equal(plain.comparison, undefined);
  assert.equal(plain.comparison_error, undefined);

  const qualifying = await synthesizeStory(bothSides, llm);
  assert.ok(JSON.stringify(requests[1].schema).includes('differences'));
  assert.ok(qualifying.synthesis.sides.left.summary.length > 0);
  assert.equal(qualifying.comparison, undefined);
  assert.match(qualifying.comparison_error || '', /citation/i);

  const clean = await synthesizeStory(bothSides, {
    async generateJson() {
      return {
        json: {
          sides: { left: 'טקסט מקור', center: '', right: 'טקסט מקור' },
          differences: [],
        },
      };
    },
  });
  assert.deepEqual(clean.comparison, { status: 'no_difference', bullets: [] });
});

test('runner: rejected comparison is dropped, verified summary still publishes and caches', async () => {
  const state = setup();
  const response = {
    sides: { left: 'טקסט מקור', center: '', right: 'טקסט מקור' },
    differences: [
      {
        right: 'הליכוד דורש רוטציה',
        left: 'איזנקוט מציע ממשלה',
        right_article_ids: [0],
        left_article_ids: [2],
      },
    ],
  };
  let synthesisCalls = 0;
  const llm: LlmClient = {
    async generateJson(req) {
      if (req.label === 'Synthesis') {
        synthesisCalls++;
        return { json: response };
      }
      throw new Error('chat verification not used here');
    },
  };
  const verify = async (_items: FeedItem[], candidates: any[]) => {
    assert.deepEqual(
      candidates.map((c: any) => c.id),
      ['summary', 'comparison'],
    );
    assert.equal(candidates[1].citation_kind, 'claim_level');
    return [
      { id: 'summary', supported: true, reasons: [] },
      {
        id: 'comparison',
        supported: false,
        reasons: ['decision_check_not_accepted:source_support'],
      },
    ];
  };
  try {
    const stories = [{ items: bothSides }];
    const result = await summarizeStories(stories, {
      enabled: true,
      llm,
      maxCalls: 10,
      cache: state.cache,
      verify,
      pause,
    });
    assert.equal(result[0].status, 'ready');
    assert.ok(result[0].synthesis);
    assert.equal(result[0].comparison, undefined);
    assert.equal(result[0].attempts[0].comparison_rejected, true);

    // Cached summary must come back without another paid call and without the dropped comparison.
    const again = await summarizeStories(stories, {
      enabled: true,
      llm: {
        async generateJson() {
          throw new Error('must not call');
        },
      },
      maxCalls: 10,
      cache: summaryCache(state.path),
      verify,
      pause,
    });
    assert.equal(again[0].status, 'ready');
    assert.equal(again[0].comparison, undefined);
    assert.equal(synthesisCalls, 1);
  } finally {
    state.cleanup();
  }
});

test('runner: verified comparison publishes, survives cache reload, and no_difference publishes', async () => {
  const state = setup();
  const response = {
    sides: { left: 'טקסט מקור', center: '', right: 'טקסט מקור' },
    differences: [
      {
        right: 'הליכוד דורש רוטציה',
        left: 'איזנקוט מציע ממשלה',
        right_article_ids: [0],
        left_article_ids: [2],
      },
    ],
  };
  const llm: LlmClient = {
    async generateJson() {
      return { json: response };
    },
  };
  const verify = async (_items: FeedItem[], candidates: any[]) =>
    candidates.map((c: any) => ({ id: c.id, supported: true, reasons: [] }));
  try {
    const stories = [{ items: bothSides }];
    const result = await summarizeStories(stories, {
      enabled: true,
      llm,
      maxCalls: 10,
      cache: state.cache,
      verify,
      pause,
    });
    assert.equal(result[0].comparison?.status, 'ready');
    assert.equal(result[0].comparison?.bullets.length, 1);
    const cached = JSON.parse(readFileSync(state.path, 'utf8'));
    const entry = Object.values(cached)[0] as any;
    assert.equal(entry.comparison.status, 'ready');
    const again = await summarizeStories(stories, {
      enabled: true,
      llm: {
        async generateJson() {
          throw new Error('must not call');
        },
      },
      maxCalls: 10,
      cache: summaryCache(state.path),
      verify,
      pause,
    });
    assert.equal(again[0].comparison?.status, 'ready');
    assert.deepEqual(again[0].comparison?.bullets[0].left?.article_ids, [2]);
  } finally {
    state.cleanup();
  }
});

test('summary rejection still fails the whole attempt, comparison included', async () => {
  const state = setup();
  let calls = 0;
  const llm: LlmClient = {
    async generateJson() {
      calls++;
      return {
        json: {
          sides: { left: 'טקסט מקור', center: '', right: 'טקסט מקור' },
          differences: [{ right: 'פרט', left: '', right_article_ids: [0], left_article_ids: [] }],
        },
      };
    },
  };
  const verify = async (_items: FeedItem[], candidates: any[]) =>
    candidates.map((c: any) => ({ id: c.id, supported: false, reasons: ['x'] }));
  try {
    const result = await summarizeStories([{ items: bothSides }], {
      enabled: true,
      llm,
      maxCalls: 10,
      cache: state.cache,
      verify,
      pause,
    });
    assert.equal(result[0].status, 'exhausted');
    assert.equal(result[0].synthesis, undefined);
    assert.equal(result[0].comparison, undefined);
    assert.equal(calls, 3); // three rounds of one paid synthesis call each
  } finally {
    state.cleanup();
  }
});

test('fingerprint separates qualifying stories and earlier cache versions', () => {
  const centerOnly = [item('a', 'center')];
  assert.notEqual(summaryFingerprint(bothSides), summaryFingerprint(centerOnly));
  assert.notEqual(summaryFingerprint(bothSides, 'decisions-v2:x'), summaryFingerprint(bothSides));
});

test('decision verifier adds one checked candidate set for comparison with claim-level note', async () => {
  let seen: any;
  const client: DecisionClient = {
    async decide(request) {
      seen = request;
      return {
        answers: Object.fromEntries(Object.keys(request.questions).map((k) => [k, 0.99])),
        diagnostics: { requested_model: 'mock', content_chars: 0 },
      };
    },
  };
  const comparison = validateComparison(
    [{ right: 'פרט', left: '', right_article_ids: [0], left_article_ids: [] }],
    bothSides,
  );
  const summary = validateSynthesis(
    {
      sides: {
        left: {
          summary: [{ text: 'טקסט מקור', article_ids: [2], evidence_kind: 'side_membership' }],
        },
        center: { summary: [] },
        right: {
          summary: [{ text: 'טקסט מקור', article_ids: [0, 1], evidence_kind: 'side_membership' }],
        },
      },
    },
    bothSides,
  );
  // side_membership rows require exact membership lists; build via raw instead
  const verdicts = await decisionVerifier(client, 0.8)(bothSides, [
    { id: 'summary', summary },
    { id: 'comparison', summary: comparisonCandidate(comparison)!, citation_kind: 'claim_level' },
  ]);
  assert.deepEqual(
    verdicts.map((v) => v.id),
    ['summary', 'comparison'],
  );
  assert.equal(Object.keys(seen.questions).length, 14); // 7 checks x 2 candidates
  const comparisonQuestions = Object.values(seen.questions).filter((q: any) =>
    q.instructions.includes('candidates[1]'),
  );
  assert.equal(comparisonQuestions.length, 7);
  assert.ok(comparisonQuestions.every((q: any) => q.instructions.includes('claim citations')));
  const summaryQuestions = Object.values(seen.questions).filter((q: any) =>
    q.instructions.includes('candidates[0]'),
  );
  assert.ok(summaryQuestions.every((q: any) => !q.instructions.includes('claim citations')));
});

test('publication gate strips an invalid comparison but keeps the story and summary', async () => {
  const { publicationGate } = await import('../scripts/publication-gate.ts');
  const story = {
    headline: 'כותרת',
    summary: 'תקציר',
    counts: { right: 2, left: 1 },
    total: 3,
    grouping_status: 'schema_assigned',
    synthesis_status: 'not_configured',
    articles: [
      {
        article_id: 'a1',
        source: 'ימין א',
        side: 'right',
        title: 't',
        url: 'https://r1.example.com',
        extraction: 'full',
        summary: 's',
      },
      {
        article_id: 'a2',
        source: 'שמאל א',
        side: 'left',
        title: 't',
        url: 'https://l1.example.com',
        extraction: 'full',
        summary: 's',
      },
    ],
  };
  const data = { stories: [story] };
  const valid = {
    status: 'ready',
    bullets: [{ right: { text: 'פרט', article_ids: [0] } }],
  };
  const kept = publicationGate({ stories: [{ ...story, comparison: valid }] });
  assert.equal(kept.stories[0].comparison.status, 'ready');
  for (const bad of [
    { status: 'ready', bullets: [{ right: { text: 'פרט', article_ids: [1] } }] }, // cross-side
    { status: 'ready', bullets: [] }, // ready with no bullets
    { status: 'no_difference', bullets: [{ left: { text: 'x', article_ids: [1] } }] },
    { status: 'ready', bullets: [{ right: { text: 'x'.repeat(251), article_ids: [0] } }] },
    { status: 'sometimes', bullets: [] },
    { bullets: [] },
  ]) {
    const out = publicationGate({ stories: [{ ...story, comparison: bad }] });
    assert.equal(out.stories[0].comparison, undefined);
    assert.equal(out.stories[0].headline, 'כותרת');
  }
  assert.deepEqual(publicationGate(data).stories[0].comparison, undefined);
});
