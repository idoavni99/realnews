import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decisionFallback,
  requestBudget,
  budgetedLlm,
  costBudget,
  costCapLlm,
  canFailOver,
  generationFallback,
} from '../src/decision-fallback.ts';
import { LlmOutputError, type LlmClient } from '../src/llm.ts';
import type { DecisionClient } from '../src/decisions.ts';

const request = {
  label: 'Grouping' as const,
  state: {},
  questions: { same: { type: 'noul' as const, instructions: 'Same?' } },
};
const fail = (status: number): DecisionClient => ({
  async decide() {
    throw new LlmOutputError('HTTP ' + status, {
      requested_model: 'mock',
      http_status: status,
      content_chars: 0,
    });
  },
});
const answer = (value: number): DecisionClient => ({
  async decide() {
    return { answers: { same: value }, diagnostics: { requested_model: 'mock', content_chars: 0 } };
  },
});
const budgets = () => ({ Grouping: requestBudget(30), Verification: requestBudget(60) });

test('confirmed primary-Liquid-Jev order advances on unavailable/rate-limited HTTP only', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const order: string[] = [];
    const wrap = (name: string, client: DecisionClient): DecisionClient => ({
      decide(request) {
        order.push(name);
        return client.decide(request);
      },
    });
    const client = decisionFallback(
      [wrap('Perplexity', fail(status)), wrap('Liquid', fail(503)), wrap('Jev', answer(0.99))],
      budgets(),
    );
    assert.equal((await client.decide(request)).answers.same, 0.99);
    assert.deepEqual(order, ['Perplexity', 'Liquid', 'Jev']);
  }
});

test('valid no and uncertainty are terminal, never shopping for a better opinion', async () => {
  for (const value of [0, 0.1, 0.5, 0.89]) {
    let later = 0;
    const client = decisionFallback(
      [
        answer(value),
        {
          async decide() {
            later++;
            throw new Error('must not call');
          },
        },
      ],
      budgets(),
    );
    assert.equal((await client.decide(request)).answers.same, value);
    assert.equal(later, 0);
  }
});

test('invalid requests, authentication, credits, content filtering and malformed answers do not fail over', async () => {
  for (const status of [400, 401, 402, 403, 404, 413, 422]) {
    let later = 0;
    const client = decisionFallback(
      [
        fail(status),
        {
          async decide() {
            later++;
            return answer(1).decide(request);
          },
        },
      ],
      budgets(),
    );
    await assert.rejects(() => client.decide(request));
    assert.equal(later, 0);
  }
  for (const error of [
    new Error('Invalid decision probability'),
    new Error('Size exceeded'),
    new TypeError('fetch failed'),
    new DOMException('timeout', 'TimeoutError'),
  ]) {
    let later = 0;
    const client = decisionFallback(
      [
        {
          async decide() {
            throw error;
          },
        },
        {
          async decide() {
            later++;
            return answer(1).decide(request);
          },
        },
      ],
      budgets(),
    );
    await assert.rejects(() => client.decide(request));
    assert.equal(later, 0);
  }
});

test('every fallback attempt consumes budget, cap stops before next provider and remains exhausted across articles', async () => {
  let calls = 0;
  const counter: DecisionClient = {
    async decide() {
      calls++;
      return fail(429).decide(request);
    },
  };
  const client = decisionFallback([counter, counter, counter], {
    Grouping: requestBudget(2),
    Verification: requestBudget(60),
  });
  await assert.rejects(() => client.decide(request), /budget exhausted/);
  assert.equal(calls, 2);
  await assert.rejects(() => client.decide(request), /budget exhausted/);
  assert.equal(calls, 2);
});

test('synthesis and verification share physical attempt cap including failed fallback attempts', async () => {
  const consume = requestBudget(3);
  let synthesis = 0;
  const llm = budgetedLlm(
    {
      async generateJson() {
        synthesis++;
        return { json: {} };
      },
    },
    consume,
  );
  const client = decisionFallback([fail(429), answer(0.99)], {
    Grouping: requestBudget(30),
    Verification: consume,
  });
  const synthesisRequest = {
    label: 'Synthesis' as const,
    system: '',
    input: {},
    schema: {},
    temperature: 0,
    maxOutputTokens: 1,
  };
  await llm.generateJson(synthesisRequest);
  await client.decide({ ...request, label: 'Verification' });
  await assert.rejects(() => llm.generateJson(synthesisRequest), /budget exhausted/);
  assert.equal(synthesis, 1);
});

const llmRequest = {
  label: 'Synthesis' as const,
  system: '',
  input: {},
  schema: {},
  temperature: 0,
  maxOutputTokens: 1,
};

test('cost budget validates its limit and accumulates only reported cost', () => {
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => costBudget(bad), /Invalid/);
  const budget = costBudget(0.5);
  budget.record(undefined);
  budget.record({});
  assert.equal(budget.spent(), 0);
  budget.record({ cost: 0.2 });
  assert.equal(budget.spent(), 0.2);
  assert.equal(budget.exhausted(), false);
  budget.record({ cost: 0.3 });
  assert.equal(budget.exhausted(), true);
});

test('cost cap blocks the paid route at the budget and fails over to the free route', async () => {
  const budget = costBudget(0.5);
  let paidCalls = 0;
  const paid: LlmClient = {
    async generateJson() {
      paidCalls++;
      return { json: { route: 'paid' }, usage: { cost: 0.3 } };
    },
  };
  const free: LlmClient = {
    async generateJson() {
      return { json: { route: 'free' }, usage: { cost: 0 } };
    },
  };
  const client = generationFallback([costCapLlm(paid, budget), free], () => {});
  assert.deepEqual((await client.generateJson(llmRequest)).json, { route: 'paid' });
  // The cap blocks the next call once the limit is reached, so overshoot is at most one call.
  assert.deepEqual((await client.generateJson(llmRequest)).json, { route: 'paid' });
  assert.equal(paidCalls, 2);
  assert.deepEqual((await client.generateJson(llmRequest)).json, { route: 'free' });
  assert.equal(paidCalls, 2);
  assert.equal(budget.spent(), 0.6);
});

test('cost-cap errors are fail-overable and failed paid calls still record cost', async () => {
  const budget = costBudget(0.5);
  const paid: LlmClient = {
    async generateJson() {
      throw new LlmOutputError('Synthesis HTTP 503', {
        requested_model: 'mock',
        content_chars: 0,
        http_status: 503,
        usage: { cost: 0.6 },
      });
    },
  };
  const capped = costCapLlm(paid, budget);
  await assert.rejects(() => capped.generateJson(llmRequest), /HTTP 503/);
  assert.equal(budget.spent(), 0.6);
  const blocked = await capped.generateJson(llmRequest).catch((e) => e);
  assert.ok(blocked instanceof LlmOutputError);
  assert.match(blocked.message, /cost cap/);
  assert.equal(blocked.diagnostics?.cost_cap, true);
  assert.equal(canFailOver(blocked), true);
});
