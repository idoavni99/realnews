import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comparisonDetails,
  comparisonDiagnostics,
  summaryDiagnostics,
} from '../src/comparison-diagnostics.ts';
import type { SummaryResult } from '../src/summary-runner.ts';
import type { FeedItem } from '../src/rss.ts';

const items = (sides: FeedItem['side'][]): FeedItem[] =>
  sides.map((side, i) => ({
    source: 'source',
    sourceName: 'source',
    side,
    title: 'PRIVATE TITLE',
    url: 'https://private.invalid/' + i,
    summary: 'PRIVATE EVIDENCE',
    published: '2026-11-17T00:00:00Z',
  }));
const story = { items: items(['center_left', 'center_right']) };
const result = (value: Partial<SummaryResult>): SummaryResult => ({
  fingerprint: 'PRIVATE FINGERPRINT',
  status: 'ready',
  attempts: [],
  ...value,
});

test('comparison outcome counters distinguish verified, absent, cached, failed and ineligible states', () => {
  const stories = Array.from({ length: 5 }, () => story).concat([{ items: items(['center']) }]);
  const results = [
    result({ comparison: { status: 'ready', bullets: [] } }),
    result({ comparison: { status: 'no_difference', bullets: [] } }),
    result({}),
    result({ status: 'unavailable' }),
    result({ attempts: [{ round: 1, comparison_rejected: true }] }),
    result({ comparison: { status: 'no_difference', bullets: [] } }),
  ];
  assert.deepEqual(comparisonDiagnostics(stories, results), {
    eligible: 5,
    ready: 1,
    no_difference: 1,
    summary_not_ready: 1,
    cached_without_comparison: 1,
    missing_after_attempt: 1,
    rejected_attempts: 1,
    invalid_shape_attempts: 0,
    citation_error_attempts: 0,
    number_error_attempts: 0,
    length_error_attempts: 0,
  });
});

test('comparison diagnostics expose fixed reason-class counts only, never raw evidence or errors', () => {
  const errors = [
    'Invalid difference citation',
    'Citation without difference text',
    'Unsupported number in difference',
    'Too many differences',
    'Oversized difference',
    'Invalid differences',
    'PRIVATE SECRET ERROR',
  ];
  const counts = comparisonDiagnostics(
    [story],
    [
      result({
        attempts: errors.map((comparison_error) => ({
          round: 1,
          comparison_error,
          error: 'PRIVATE TRANSPORT ERROR',
          draft: 'PRIVATE MODEL OUTPUT',
        })),
      }),
    ],
  );
  assert.equal(counts.citation_error_attempts, 2);
  assert.equal(counts.number_error_attempts, 1);
  assert.equal(counts.length_error_attempts, 2);
  assert.equal(counts.invalid_shape_attempts, 2);
  assert.ok(!JSON.stringify(counts).includes('PRIVATE'));
  assert.ok(Object.values(counts).every((n) => Number.isSafeInteger(n) && n >= 0));
});

test('detailed lifecycle rows identify stages without exposing private payloads or raw errors', () => {
  const rows = comparisonDetails(
    [story, story, story],
    [
      result({
        attempts: [
          {
            round: 1,
            draft: { comparison: { status: 'ready' }, text: 'PRIVATE OUTPUT' },
            comparison_rejected: true,
          },
        ],
      }),
      result({
        status: 'unavailable',
        attempts: [{ round: 1, error: 'Synthesis HTTP 429 PRIVATE CONTENT' }],
      }),
      result({
        attempts: [
          {
            round: 1,
            draft: 'PRIVATE OUTPUT',
            comparison_error: 'PRIVATE ERROR',
            error: 'Verification rejected summary',
          },
        ],
      }),
    ],
  );
  assert.equal(rows[0].attempts[0].generated_comparison, 'ready');
  assert.equal(rows[0].attempts[0].comparison_outcome, 'verification_rejected');
  assert.equal(rows[1].attempts[0].summary_error_class, 'http_429');
  assert.equal(rows[1].outcome, 'summary_not_ready');
  assert.equal(rows[2].attempts[0].comparison_outcome, 'invalid_shape');
  assert.equal(rows[2].attempts[0].summary_error_class, 'verification_rejected');
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});

test('verdict reasons surface as fixed check names only, unknown shapes collapse', () => {
  const rows = comparisonDetails(
    [story],
    [
      result({
        status: 'unavailable',
        attempts: [
          {
            round: 1,
            error: 'Verification rejected summary',
            verdicts: [
              {
                id: 'summary',
                supported: false,
                reasons: [
                  'decision_check_not_accepted:uncertainty',
                  'decision_check_not_accepted:source_support',
                  'decision_check_not_accepted:not_a_real_check',
                  'PRIVATE FREE-TEXT REASON',
                  42,
                ],
              },
              {
                id: 'comparison',
                supported: false,
                reasons: ['decision_check_not_accepted:same_event'],
              },
            ],
          },
          { round: 2, error: 'Truncated Synthesis: output token limit' },
        ],
      }),
    ],
  );
  assert.deepEqual(rows[0].attempts[0].failed_checks, [
    'uncertainty',
    'source_support',
    'unknown',
    'unknown',
    'unknown',
  ]);
  assert.deepEqual(rows[0].attempts[0].comparison_failed_checks, ['same_event']);
  assert.equal(rows[0].attempts[1].failed_checks, undefined);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});

test('summary diagnostics count every story status and failure class with fixed labels', () => {
  const counts = summaryDiagnostics([
    { fingerprint: 'a', status: 'ready', attempts: [] },
    {
      fingerprint: 'b',
      status: 'ready',
      attempts: [{ round: 1 }],
    },
    { fingerprint: 'c', status: 'single_source', attempts: [] },
    { fingerprint: 'd', status: 'missing_text', attempts: [] },
    {
      fingerprint: 'e',
      status: 'unavailable',
      attempts: [
        { round: 1, error: 'Verification rejected summary' },
        { round: 1, error: 'Truncated Synthesis: output token limit' },
        { round: 2, error: 'Synthesis HTTP 402' },
      ],
    },
    { fingerprint: 'f', status: 'grouping_unvalidated', attempts: [] },
  ]);
  assert.deepEqual(counts, {
    ready: 2,
    cache_hits: 1,
    single_source: 1,
    missing_text: 1,
    grouping_unvalidated: 1,
    not_configured: 0,
    unavailable: 1,
    exhausted: 0,
    failure_classes: {
      verification_rejected: 1,
      output_limit: 1,
      http_402: 1,
    },
  });
});
