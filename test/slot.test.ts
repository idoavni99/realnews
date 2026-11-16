import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentSlotStartMs, slotServed } from '../src/slot.ts';
const daily = readFileSync(new URL('../.github/workflows/daily.yml', import.meta.url), 'utf8');
const iso = (ms: number) => new Date(ms).toISOString();
// Israel is UTC+2 in November, UTC+3 in summer.
test('slot start is the latest 09:00 or 21:00 Israel time', () => {
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2026-11-16T07:00:00Z'))),
    '2026-11-16T07:00:00.000Z',
  );
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2026-11-16T14:28:00Z'))),
    '2026-11-16T07:00:00.000Z',
  );
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2026-11-16T19:00:00Z'))),
    '2026-11-16T19:00:00.000Z',
  );
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2026-11-16T23:18:00Z'))),
    '2026-11-16T19:00:00.000Z',
  );
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2026-11-16T05:00:00Z'))),
    '2026-11-15T19:00:00.000Z',
  );
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2026-07-16T06:00:00Z'))),
    '2026-07-16T06:00:00.000Z',
  );
});
test('slot start is correct across the DST changes', () => {
  // 2027-03-26 Israel switches to UTC+3 at 02:00; the 09:00 slot is 06:00Z.
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2027-03-26T10:00:00Z'))),
    '2027-03-26T06:00:00.000Z',
  );
  assert.equal(
    iso(currentSlotStartMs(Date.parse('2027-03-25T10:00:00Z'))),
    '2027-03-25T07:00:00.000Z',
  );
});
test('slot is served only by an edition generated at or after its start', () => {
  const now = Date.parse('2026-11-16T07:00:05Z');
  assert.equal(slotServed('2026-11-16T06:59:59Z', now), false); // previous slot's edition
  assert.equal(slotServed('2026-11-16T07:00:00Z', now), true);
  assert.equal(slotServed('2026-11-16T01:18:00Z', Date.parse('2026-11-16T14:28:00Z')), false);
  assert.equal(slotServed('2026-11-15T23:26:56Z', Date.parse('2026-11-16T03:00:00Z')), true); // late 21:00 slot run
});
test('missing or invalid edition never blocks a run', () => {
  assert.equal(slotServed(undefined, Date.now()), false);
  assert.equal(slotServed('not a date', Date.now()), false);
});
test('daily workflow gates build on the slot guard for schedule and slot_guard runs only', () => {
  assert.match(daily, /slot_guard:/);
  assert.match(daily, /build:\n {4}needs: check\n {4}if: needs.check.outputs.run == 'true'/);
  assert.match(daily, /if: github.event_name == 'schedule' \|\| inputs.slot_guard/);
  assert.match(daily, /run: \$\{\{ steps.guard.outputs.run \|\| 'true' \}\}/);
  assert.ok(!/check:[\s\S]*OPENROUTER/.test(daily.slice(0, daily.indexOf('  build:'))));
});
