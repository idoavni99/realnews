import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generationFallback, decisionFallback, requestBudget } from '../src/decision-fallback.ts';
import {
  backupRouterModel,
  createLlmClient,
  createOpenRouterClient,
  LlmOutputError,
  type LlmClient,
} from '../src/llm.ts';
import { auditedClient } from '../src/call-audit.ts';

const request = {
  label: 'Synthesis' as const,
  system: '',
  input: {},
  schema: {},
  temperature: 0,
  maxOutputTokens: 1,
};
const failure = (status: number) =>
  new LlmOutputError('HTTP ' + status, {
    requested_model: 'openrouter/free',
    http_status: status,
    content_chars: 0,
  });

function clients(error?: unknown) {
  const order: string[] = [];
  const primary: LlmClient = {
    async generateJson() {
      order.push('free');
      if (error) throw error;
      return { json: { result: 'free' } };
    },
  };
  const fallback: LlmClient = {
    async generateJson() {
      order.push('auto');
      return { json: { result: 'auto' } };
    },
  };
  return { order, primary, fallback };
}

test('generation starts free and does not call auto on success', async () => {
  const state = clients();
  assert.deepEqual(
    (
      await generationFallback([state.primary, state.fallback], requestBudget(60)).generateJson(
        request,
      )
    ).json,
    { result: 'free' },
  );
  assert.deepEqual(state.order, ['free']);
});

test('one auto fallback on explicit unavailable or rate-limit HTTP response', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const state = clients(failure(status));
    assert.deepEqual(
      (
        await generationFallback([state.primary, state.fallback], requestBudget(60)).generateJson(
          request,
        )
      ).json,
      { result: 'auto' },
    );
    assert.deepEqual(state.order, ['free', 'auto']);
  }
});

test('generation does not pay again for auth, credits, malformed output or ambiguous network failure', async () => {
  for (const error of [
    ...[400, 401, 402, 403, 404, 413, 422].map(failure),
    new LlmOutputError('Invalid JSON Synthesis', {
      requested_model: 'openrouter/free',
      content_chars: 10,
    }),
    new LlmOutputError('Truncated Synthesis: output token limit', {
      requested_model: 'openrouter/free',
      content_chars: 10,
    }),
    new TypeError('fetch failed'),
    new DOMException('timeout', 'TimeoutError'),
  ]) {
    const state = clients(error);
    await assert.rejects(() =>
      generationFallback([state.primary, state.fallback], requestBudget(60)).generateJson(request),
    );
    assert.deepEqual(state.order, ['free']);
  }
});

test('shared budget counts free, auto and Decisions separately and stops before over-cap auto call', async () => {
  const consume = requestBudget(3);
  const state = clients(failure(429));
  const llm = generationFallback([state.primary, state.fallback], consume);
  await llm.generateJson(request);
  const decisions = decisionFallback(
    [
      {
        async decide() {
          return {
            answers: { same: 1 },
            diagnostics: { requested_model: 'mock', content_chars: 0 },
          };
        },
      },
    ],
    { Grouping: requestBudget(30), Verification: consume },
  );
  await decisions.decide({
    label: 'Verification',
    state: {},
    questions: { same: { type: 'noul', instructions: 'Same?' } },
  });
  await assert.rejects(() => llm.generateJson(request), /budget exhausted/);
  assert.deepEqual(state.order, ['free', 'auto']);
  const capped = clients(failure(503));
  await assert.rejects(
    () =>
      generationFallback([capped.primary, capped.fallback], requestBudget(1)).generateJson(request),
    /budget exhausted/,
  );
  assert.deepEqual(capped.order, ['free']);
});

test('managed routers back each other up; explicit models get no backup', () => {
  assert.equal(backupRouterModel('openrouter/free'), 'openrouter/auto');
  assert.equal(backupRouterModel('openrouter/auto'), 'openrouter/free');
  assert.equal(backupRouterModel('explicit/model'), undefined);
});

test('free default and explicit model compatibility; workflow pins future regular runs to auto', async () => {
  const original = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = async (_url, init) => {
    models.push(JSON.parse(String(init?.body)).model);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  };
  try {
    await createLlmClient({ OPENROUTER_API_KEY: 'mock' })!.generateJson(request);
    await createLlmClient({
      OPENROUTER_API_KEY: 'mock',
      OPENROUTER_MODEL: 'explicit/model',
    })!.generateJson(request);
    assert.deepEqual(models, ['openrouter/free', 'explicit/model']);
  } finally {
    globalThis.fetch = original;
  }
  const workflow = readFileSync(new URL('../.github/workflows/daily.yml', import.meta.url), 'utf8');
  assert.match(
    workflow,
    /OPENROUTER_MODEL: \$\{\{ inputs\.free_test && 'openrouter\/free' \|\| 'openrouter\/auto' \}\}/,
  );
  assert.match(
    workflow,
    /REALNEWS_GENERATION_AUTO_FALLBACK: \$\{\{ inputs\.free_test && 'false' \|\| 'true' \}\}/,
  );
  assert.ok(!workflow.includes('vars.OPENROUTER_MODEL'));
});

test('transport fallback sends free then auto, while audit and budget count both attempts', async () => {
  const original = globalThis.fetch;
  const models: string[] = [];
  globalThis.fetch = async (_url, init) => {
    models.push(JSON.parse(String(init?.body)).model);
    return models.length === 1
      ? new Response('temporarily unavailable', { status: 503 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
  };
  try {
    const client = generationFallback(
      ['openrouter/free', 'openrouter/auto'].map((model) => createOpenRouterClient('mock', model)),
      requestBudget(2),
    );
    await client.generateJson(request);
    assert.deepEqual(models, ['openrouter/free', 'openrouter/auto']);
    await assert.rejects(() => client.generateJson(request), /budget exhausted/);
    assert.equal(models.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('fallback failures and success are separate audit entries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'generation-fallback-'));
  const path = join(dir, 'calls.json');
  const audit: unknown[] = [];
  const state = clients(failure(429));
  try {
    await generationFallback(
      [state.primary, state.fallback].map((client) => auditedClient(client, path, audit)),
      requestBudget(60),
    ).generateJson(request);
    assert.equal(audit.length, 2);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.calls.length, 2);
    assert.deepEqual(
      saved.calls.map((call: any) => call.status),
      ['failed', 'returned'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
