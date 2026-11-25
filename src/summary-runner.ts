import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalUrl } from './article-registry.ts';
import type { FeedItem } from './rss.ts';
import type { LlmClient } from './llm.ts';
import { sleep } from './http.ts';
import { groupOf, type Group } from './config.ts';
import {
  comparisonCandidate,
  comparisonToRaw,
  qualifiesForComparison,
  synthesizeStory,
  synthesisInput,
  validateComparison,
  validateSynthesis,
  type StoryComparison,
  type StorySynthesis,
} from './synthesis.ts';
import { verifyCandidates, type VerificationCandidate, type Verdict } from './verification.ts';

export interface SummaryResult {
  fingerprint: string;
  status: string;
  attempts: {
    round: number;
    draft?: unknown;
    verdicts?: unknown;
    error?: string;
    comparison_error?: string;
    comparison_rejected?: boolean;
  }[];
  synthesis?: StorySynthesis;
  comparison?: StoryComparison;
}

export function orderedEvidence(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => canonicalUrl(a.url).localeCompare(canonicalUrl(b.url)));
}

export function summaryFingerprint(items: FeedItem[], verificationIdentity?: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 11,
        ...(verificationIdentity ? { verificationIdentity } : {}),
        comparison: qualifiesForComparison(items),
        urls: items.map((a) => canonicalUrl(a.url)),
        evidence: synthesisInput(items),
      }),
    )
    .digest('hex');
}

export function hasSourceText(items: FeedItem[]): boolean {
  return items.length > 0 && synthesisInput(items).every((a) => a.evidence.trim().length > 0);
}

/** A side earns a paid summary only when it merges several distinct sources; one source shows as published. */
export function summarizedSides(items: FeedItem[]): Group[] {
  const sources: Record<Group, Set<string>> = {
    left: new Set(),
    center: new Set(),
    right: new Set(),
  };
  for (const a of items) {
    const group = groupOf(a.side);
    if (group) sources[group].add(a.sourceName);
  }
  return (['left', 'center', 'right'] as const).filter((side) => sources[side].size >= 2);
}

/** Fixed error labels for public diagnostics and retry policy; raw errors stay private. */
export function summaryErrorClass(error?: string): string {
  if (!error) return 'none';
  if (error === 'Verification rejected summary') return 'verification_rejected';
  if (/budget exhausted/.test(error)) return 'attempt_budget';
  if (/cost cap/.test(error)) return 'cost_cap';
  const http = error.match(/HTTP (\d{3})/);
  if (http) return 'http_' + http[1];
  if (/Truncated/.test(error)) return 'output_limit';
  if (/Invalid JSON|Empty Synthesis/.test(error)) return 'generation_output';
  return 'generation_or_verification_error';
}

/** Only transient generation failures earn a paid re-roll; a rejected or failed call is never re-billed blindly. */
const RETRYABLE_SUMMARY_ERRORS = new Set(['output_limit', 'generation_output']);

export function summaryCache(path: string) {
  let entries: Record<string, { synthesis: StorySynthesis; comparison?: StoryComparison }> = {};
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value && typeof value === 'object' && !Array.isArray(value)) entries = value;
    } catch {
      console.error('Ignoring invalid synthesis cache');
    }
  }
  return {
    get(
      key: string,
      items: FeedItem[],
    ): { synthesis: StorySynthesis; comparison?: StoryComparison } | undefined {
      try {
        const entry = entries[key];
        if (!entry) return undefined;
        const synthesis = validateSynthesis(entry.synthesis, items);
        let comparison: StoryComparison | undefined;
        if (entry.comparison) {
          try {
            comparison = validateComparison(comparisonToRaw(entry.comparison), items);
          } catch {
            comparison = undefined;
          }
        }
        return { synthesis, comparison };
      } catch {
        return undefined;
      }
    },
    save(key: string, value: { synthesis: StorySynthesis; comparison?: StoryComparison }) {
      entries[key] = value;
      mkdirSync(dirname(path), { recursive: true });
      const temporary = path + '.tmp';
      writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
      renameSync(temporary, path);
    },
  };
}

export async function summarizeStories(
  stories: { items: FeedItem[]; heldBack?: boolean }[],
  options: {
    enabled: boolean;
    llm?: LlmClient;
    maxCalls: number;
    cache: ReturnType<typeof summaryCache>;
    verify?: (items: FeedItem[], candidates: VerificationCandidate[]) => Promise<Verdict[]>;
    verificationIdentity?: string;
    pause?: () => Promise<void>;
  },
): Promise<SummaryResult[]> {
  const results = stories.map(({ items, heldBack }) => {
    const fingerprint = summaryFingerprint(items, options.verificationIdentity);
    const result: SummaryResult = { fingerprint, status: 'not_configured', attempts: [] };
    if (heldBack) result.status = 'grouping_unvalidated';
    else if (options.enabled) {
      if (!hasSourceText(items)) result.status = 'missing_text';
      else if (!summarizedSides(items).length && !qualifiesForComparison(items)) {
        // Every side has a single source: the excerpt shows as published, no paid rewrite.
        result.status = 'single_source';
      } else {
        const cached = options.cache.get(fingerprint, items);
        result.synthesis = cached?.synthesis;
        result.comparison = cached?.comparison;
        result.status = result.synthesis ? 'ready' : 'pending';
      }
    }
    return result;
  });
  let calls = 0,
    unavailable = false;
  for (let round = 1; round <= 3; round++) {
    for (let i = 0; i < stories.length; i++) {
      const result = results[i];
      if (result.status !== 'pending') continue;
      const qualifying = qualifiesForComparison(stories[i].items);
      // Reserve the attempt's worst case: synthesis + summary verification (+ comparison verification).
      if (!options.llm || unavailable || calls + (qualifying ? 3 : 2) > options.maxCalls) continue;
      const attempt: SummaryResult['attempts'][number] = { round };
      result.attempts.push(attempt);
      let accepted: StorySynthesis | undefined;
      let acceptedComparison: StoryComparison | undefined;
      try {
        calls++;
        const draft = await synthesizeStory(stories[i].items, options.llm, {
          summarizeSides: summarizedSides(stories[i].items),
        });
        attempt.draft = draft;
        if (draft.comparison_error) attempt.comparison_error = draft.comparison_error;
        const asCandidate = draft.comparison ? comparisonCandidate(draft.comparison) : undefined;
        const verify = options.verify
          ? options.verify
          : (items: FeedItem[], candidates: VerificationCandidate[]) =>
              verifyCandidates(items, candidates, options.llm);
        // The summary is verified alone, in the same single-candidate shape as every
        // non-qualifying story; the comparison's extra question set is checked only
        // afterwards, so it can never change how the summary itself is judged.
        // A story whose sides all show as-published excerpts has no generated prose to verify.
        const hasSummaryProse = Object.values(draft.synthesis.sides).some(
          (side) => side.summary.length,
        );
        let summaryVerdicts: Verdict[] = [];
        if (hasSummaryProse) {
          calls++;
          summaryVerdicts = await verify(stories[i].items, [
            { id: 'summary', summary: draft.synthesis },
          ]);
          attempt.verdicts = summaryVerdicts;
          if (!summaryVerdicts.find((v) => v.id === 'summary')?.supported)
            throw new Error('Verification rejected summary');
        }
        accepted = draft.synthesis;
        if (draft.comparison && asCandidate) {
          calls++;
          const comparisonVerdicts = await verify(stories[i].items, [
            { id: 'comparison', summary: asCandidate, citation_kind: 'claim_level' },
          ]);
          attempt.verdicts = [...summaryVerdicts, ...comparisonVerdicts];
          if (!comparisonVerdicts.find((v) => v.id === 'comparison')?.supported) {
            // A rejected comparison never takes down a verified summary; bullets are simply dropped.
            attempt.comparison_rejected = true;
          } else {
            acceptedComparison = draft.comparison;
          }
        } else if (draft.comparison) {
          // no_difference: nothing to verify.
          acceptedComparison = draft.comparison;
        }
      } catch (e) {
        const message = (e as Error).message.slice(0, 250);
        attempt.error = message;
        if (/HTTP (402|429|503|403)/.test(message)) unavailable = true;
        // Deterministic failures (verification rejects, budget, HTTP errors) stop this story:
        // re-billing the same prompt does not fix them. Only transient classes retry next round.
        if (!RETRYABLE_SUMMARY_ERRORS.has(summaryErrorClass(message)))
          result.status = 'unavailable';
      }
      if (accepted) {
        options.cache.save(result.fingerprint, {
          synthesis: accepted,
          comparison: acceptedComparison,
        });
        result.synthesis = accepted;
        result.comparison = acceptedComparison;
        result.status = 'ready';
      }
      await (options.pause ?? (() => sleep(2000)))();
    }
  }
  for (const result of results) {
    if (result.status === 'pending')
      result.status = result.attempts.length === 3 ? 'exhausted' : 'unavailable';
  }
  return results;
}
