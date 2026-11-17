import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalUrl } from './article-registry.ts';
import type { FeedItem } from './rss.ts';
import type { LlmClient } from './llm.ts';
import { sleep } from './http.ts';
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
      else {
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
      if (!options.llm || unavailable || calls + 2 > options.maxCalls) continue;
      const attempt: SummaryResult['attempts'][number] = { round };
      result.attempts.push(attempt);
      let accepted: StorySynthesis | undefined;
      let acceptedComparison: StoryComparison | undefined;
      try {
        calls++;
        const draft = await synthesizeStory(stories[i].items, options.llm);
        attempt.draft = draft;
        if (draft.comparison_error) attempt.comparison_error = draft.comparison_error;
        calls++;
        const candidates: VerificationCandidate[] = [{ id: 'summary', summary: draft.synthesis }];
        const asCandidate = draft.comparison ? comparisonCandidate(draft.comparison) : undefined;
        if (asCandidate)
          candidates.push({ id: 'comparison', summary: asCandidate, citation_kind: 'claim_level' });
        const verdicts = options.verify
          ? await options.verify(stories[i].items, candidates)
          : await verifyCandidates(stories[i].items, candidates, options.llm);
        attempt.verdicts = verdicts;
        if (!verdicts.find((v) => v.id === 'summary')?.supported)
          throw new Error('Verification rejected summary');
        accepted = draft.synthesis;
        if (draft.comparison) {
          if (asCandidate && !verdicts.find((v) => v.id === 'comparison')?.supported) {
            // A rejected comparison never takes down a verified summary; bullets are simply dropped.
            attempt.comparison_rejected = true;
          } else {
            acceptedComparison = draft.comparison;
          }
        }
      } catch (e) {
        attempt.error = (e as Error).message.slice(0, 250);
        if (/HTTP (402|429|503|403)/.test((e as Error).message)) unavailable = true;
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
