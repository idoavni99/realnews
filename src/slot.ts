// Edition slots: 09:00 and 21:00 Israel time. GitHub's scheduler can start a
// run hours late (or not at all), so a run may be triggered more than once per
// slot (external clock + backup cron). A slot counts as served once an edition
// was generated at or after the slot's start.
export const SLOT_TIMEZONE = 'Asia/Jerusalem';
export const SLOT_HOURS = [9, 21];

function zoneOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SLOT_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function localWallToUtcMs(y: number, m: number, d: number, hour: number): number {
  const guess = Date.UTC(y, m - 1, d, hour);
  // Two passes handle a DST change between the guess and the real instant.
  let ms = guess - zoneOffsetMs(guess);
  ms = guess - zoneOffsetMs(ms);
  return ms;
}

/** Start (UTC ms) of the most recent slot at or before `nowMs`. */
export function currentSlotStartMs(nowMs: number): number {
  const local = new Date(nowMs + zoneOffsetMs(nowMs));
  const candidates: number[] = [];
  for (let back = 0; back <= 1; back++) {
    const day = new Date(local.getTime() - back * 86400000);
    for (const hour of SLOT_HOURS) {
      candidates.push(
        localWallToUtcMs(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour),
      );
    }
  }
  return Math.max(...candidates.filter((ms) => ms <= nowMs));
}

/** True when an edition generated at `generatedAt` already serves the current slot. */
export function slotServed(generatedAt: unknown, nowMs: number): boolean {
  if (typeof generatedAt !== 'string') return false;
  const generated = Date.parse(generatedAt);
  if (!Number.isFinite(generated)) return false;
  return generated >= currentSlotStartMs(nowMs);
}
