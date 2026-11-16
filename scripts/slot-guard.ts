// Decides whether a guarded run should proceed. Prints the decision and, in
// GitHub Actions, writes `run=true|false` to $GITHUB_OUTPUT. It never fails a
// run: any problem reading the published edition means "run".
import { appendFileSync, readFileSync } from 'node:fs';
import { currentSlotStartMs, slotServed } from '../src/slot.ts';

const now = Date.now();
let generatedAt: unknown;
try {
  generatedAt = JSON.parse(readFileSync('site/data.json', 'utf8')).generated_at;
} catch {
  generatedAt = undefined;
}
const run = !slotServed(generatedAt, now);
console.log(
  `slot start ${new Date(currentSlotStartMs(now)).toISOString()}, latest edition ${String(generatedAt)}: ` +
    (run ? 'running' : 'slot already served, skipping (no model calls)'),
);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
