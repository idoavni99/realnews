import { qualifiesForComparison } from './synthesis.ts';
import type { FeedItem } from './rss.ts';
import type { SummaryResult } from './summary-runner.ts';

function comparisonErrorClass(error: string) {
  if (['Invalid difference citation', 'Citation without difference text'].includes(error))
    return 'citation';
  if (error === 'Unsupported number in difference') return 'unsupported_number';
  if (['Too many differences', 'Oversized difference'].includes(error)) return 'length';
  return 'shape';
}

function summaryErrorClass(error?: string) {
  if (!error) return 'none';
  if (error === 'Verification rejected summary') return 'verification_rejected';
  if (/budget exhausted/.test(error)) return 'attempt_budget';
  const http = error.match(/HTTP (\d{3})/);
  if (http) return 'http_' + http[1];
  if (/Truncated/.test(error)) return 'output_limit';
  if (/Invalid JSON|Empty Synthesis/.test(error)) return 'generation_output';
  return 'generation_or_verification_error';
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
