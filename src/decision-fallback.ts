import { LlmOutputError, type LlmClient } from './llm.ts';
import type { DecisionClient } from './decisions.ts';

const UNAVAILABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function canFailOver(error: unknown): boolean {
  return (
    error instanceof LlmOutputError &&
    UNAVAILABLE_HTTP_STATUSES.has(error.diagnostics?.http_status ?? 0)
  );
}

export function requestBudget(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid provider-attempt budget');
  let attempts = 0;
  return () => {
    if (attempts >= limit) throw new Error('Provider-attempt budget exhausted');
    attempts++;
  };
}

export function budgetedLlm(client: LlmClient, consume: () => void): LlmClient {
  return {
    async generateJson(request) {
      consume();
      return client.generateJson(request);
    },
  };
}

/** Each physical generation attempt is separately audited by its wrapped client and consumes the shared cap. */
export function generationFallback(clients: LlmClient[], consume: () => void): LlmClient {
  if (!clients.length) throw new Error('No generation providers configured');
  return {
    async generateJson(request) {
      for (const [index, client] of clients.entries()) {
        consume();
        try {
          return await client.generateJson(request);
        } catch (error) {
          if (index === clients.length - 1 || !canFailOver(error)) throw error;
        }
      }
      throw new Error('No generation result');
    },
  };
}

export function decisionFallback(
  clients: DecisionClient[],
  budgets: Record<'Grouping' | 'Verification', () => void>,
): DecisionClient {
  if (!clients.length) throw new Error('No decision providers configured');
  return {
    async decide(request) {
      for (const [index, client] of clients.entries()) {
        budgets[request.label]();
        try {
          return await client.decide(request);
        } catch (error) {
          if (index === clients.length - 1 || !canFailOver(error)) throw error;
        }
      }
      throw new Error('No decision result');
    },
  };
}
