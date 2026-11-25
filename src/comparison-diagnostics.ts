import { qualifiesForComparison } from './synthesis.ts';
import { VERIFICATION_CHECK_NAMES } from './decision-verification.ts';
import type { FeedItem } from './rss.ts';
import { summaryErrorClass, type SummaryResult } from './summary-runner.ts';

function comparisonErrorClass(error: string) {
  if (['Invalid difference citation', 'Citation without difference text'].includes(error))
    return 'citation';
  if (error === 'Unsupported number in difference') return 'unsupported_number';
  if (['Too many differences', 'Oversized difference'].includes(error)) return 'length';
  return 'shape';
}

/** Fixed check names from verdict reasons, never free-text reasons: unknown shapes collapse to 'unknown'. */
function failedChecks(verdicts: unknown, id: string): string[] | undefined {
  if (!Array.isArray(verdicts)) return undefined;
  const verdict = verdicts.find(
    (v) => v && typeof v === 'object' && (v as { id?: unknown }).id === id,
  ) as { reasons?: unknown } | undefined;
  if (!verdict || !Array.isArray(verdict.reasons)) return undefined;
  return verdict.reasons.map((reason: unknown) => {
    const match =
      typeof reason === 'string' ? reason.match(/^decision_check_not_accepted:(.+)$/) : null;
    return match && VERIFICATION_CHECK_NAMES.includes(match[1]) ? match[1] : 'unknown';
  });
}

/** Public diagnostics use fixed labels and counters, never raw errors, text, prompts, URLs or fingerprints. */
export function comparisonDetails(stories: { items: FeedItem[] }[], results: SummaryResult[]) {
  const allowedStatuses = new Set([
    'ready',
    'unavailable',
    'exhausted',
    'missing_text',
    'not_configured',
    'grouping_unvalidated',
    'single_source',
    'pending',
  ]);
  return stories.flatMap((story, index) => {
    if (!qualifiesForComparison(story.items)) return [];
    const result = results[index];
    const outcome =
      !result || result.status !== 'ready'
        ? 'summary_not_ready'
        : result.comparison?.status === 'ready'
          ? 'ready'
          : result.comparison?.status === 'no_difference'
            ? 'no_difference'
            : !result.attempts.length
              ? 'cached_without_comparison'
              : 'missing_after_attempt';
    return [
      {
        story_index: index,
        article_count: story.items.length,
        outcome,
        summary_status: result && allowedStatuses.has(result.status) ? result.status : 'unknown',
        cache_hit: result?.status === 'ready' && !result.attempts.length,
        bullet_count: result?.comparison?.bullets.length ?? 0,
        attempts: (result?.attempts ?? []).map((attempt) => ({
          round: attempt.round,
          generated_comparison: !attempt.draft
            ? 'not_available'
            : (attempt.draft as { comparison?: { status?: string } }).comparison?.status === 'ready'
              ? 'ready'
              : (attempt.draft as { comparison?: { status?: string } }).comparison?.status ===
                  'no_difference'
                ? 'no_difference'
                : 'absent_or_invalid',
          summary_error_class: summaryErrorClass(attempt.error),
          comparison_outcome: attempt.comparison_rejected
            ? 'verification_rejected'
            : attempt.comparison_error
              ? 'invalid_' + comparisonErrorClass(attempt.comparison_error)
              : attempt.error
                ? 'summary_attempt_failed'
                : 'no_recorded_comparison_error',
          failed_checks: failedChecks(attempt.verdicts, 'summary'),
          comparison_failed_checks: failedChecks(attempt.verdicts, 'comparison'),
        })),
      },
    ];
  });
}

/** Aggregate counters only. Never return source text, model output, URLs, IDs or raw errors. */
export function comparisonDiagnostics(stories: { items: FeedItem[] }[], results: SummaryResult[]) {
  const counts = {
    eligible: 0,
    ready: 0,
    no_difference: 0,
    summary_not_ready: 0,
    cached_without_comparison: 0,
    missing_after_attempt: 0,
    rejected_attempts: 0,
    invalid_shape_attempts: 0,
    citation_error_attempts: 0,
    number_error_attempts: 0,
    length_error_attempts: 0,
  };
  for (const [index, story] of stories.entries()) {
    if (!qualifiesForComparison(story.items)) continue;
    counts.eligible++;
    const result = results[index];
    if (!result || result.status !== 'ready') counts.summary_not_ready++;
    else if (result.comparison?.status === 'ready') counts.ready++;
    else if (result.comparison?.status === 'no_difference') counts.no_difference++;
    else if (!result.attempts.length) counts.cached_without_comparison++;
    else counts.missing_after_attempt++;
    for (const attempt of result?.attempts ?? []) {
      if (attempt.comparison_rejected) counts.rejected_attempts++;
      if (!attempt.comparison_error) continue;
      const reason = comparisonErrorClass(attempt.comparison_error);
      if (reason === 'citation') counts.citation_error_attempts++;
      else if (reason === 'unsupported_number') counts.number_error_attempts++;
      else if (reason === 'length') counts.length_error_attempts++;
      else counts.invalid_shape_attempts++;
    }
  }
  return counts;
}

/** Per-status summary counters and fixed-label failure classes for every story, not only eligible ones. */
export function summaryDiagnostics(results: SummaryResult[]) {
  const counts: Record<string, number> = {
    ready: 0,
    cache_hits: 0,
    single_source: 0,
    missing_text: 0,
    grouping_unvalidated: 0,
    not_configured: 0,
    unavailable: 0,
    exhausted: 0,
  };
  const failure_classes: Record<string, number> = {};
  for (const result of results) {
    counts[result.status in counts ? result.status : 'unavailable']++;
    if (result.status === 'ready' && !result.attempts.length) counts.cache_hits++;
    for (const attempt of result.attempts) {
      if (!attempt.error) continue;
      const label = summaryErrorClass(attempt.error);
      failure_classes[label] = (failure_classes[label] ?? 0) + 1;
    }
  }
  return { ...counts, failure_classes };
}
