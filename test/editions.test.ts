import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveCurrentEdition,
  editionId,
  readEditionIndex,
  MAX_PAST_EDITIONS,
} from '../src/editions.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'realnews-editions-'));
  mkdirSync(join(root, 'site'), { recursive: true });
  const putDigest = (generatedAt: string, stories: number, text = '{}') =>
    writeFileSync(
      join(root, 'site', 'data.json'),
      JSON.stringify({
        generated_at: generatedAt,
        stories: Array.from({ length: stories }, () => JSON.parse(text)),
      }),
    );
  const historyFiles = () =>
    readdirSync(join(root, 'site', 'history'))
      .filter((f) => f !== 'index.json')
      .sort();
  return {
    root,
    putDigest,
    historyFiles,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('editionId is second-precision and URL safe', () => {
  assert.equal(editionId('2026-11-14T00:16:37.183Z'), '2026-11-14T00-16-37Z');
  assert.throws(() => editionId('not-a-date'));
});

test('archive returns null without a previous digest or with a malformed one', () => {
  const f = fixture();
  try {
    assert.equal(archiveCurrentEdition(f.root), null);
    writeFileSync(join(f.root, 'site', 'data.json'), 'not json');
    assert.equal(archiveCurrentEdition(f.root), null);
    writeFileSync(join(f.root, 'site', 'data.json'), JSON.stringify({ stories: [] }));
    assert.equal(archiveCurrentEdition(f.root), null);
    assert.equal(existsSync(join(f.root, 'site', 'history')), false);
  } finally {
    f.cleanup();
  }
});

test('archive copies the digest byte-identically and indexes it newest first', () => {
  const f = fixture();
  try {
    f.putDigest('2026-11-13T06:00:00.000Z', 2);
    const before = readFileSync(join(f.root, 'site', 'data.json'), 'utf8');
    const first = archiveCurrentEdition(f.root);
    assert.equal(first?.id, '2026-11-13T06-00-00Z');
    assert.equal(first?.stories, 2);
    assert.equal(
      readFileSync(join(f.root, 'site', 'history', first!.id + '.json'), 'utf8'),
      before,
    );
    f.putDigest('2026-11-13T18:00:00.000Z', 5);
    archiveCurrentEdition(f.root);
    const index = readEditionIndex(join(f.root, 'site'));
    assert.deepEqual(
      index.map((e) => e.id),
      ['2026-11-13T18-00-00Z', '2026-11-13T06-00-00Z'],
    );
  } finally {
    f.cleanup();
  }
});

test('archive keeps at most MAX_PAST_EDITIONS and prunes older files', () => {
  const f = fixture();
  try {
    const stamps = [
      '2026-11-11T06:00:00Z',
      '2026-11-12T06:00:00Z',
      '2026-11-13T06:00:00Z',
      '2026-11-14T06:00:00Z',
      '2026-11-15T06:00:00Z',
    ];
    for (const stamp of stamps) {
      f.putDigest(stamp, 1);
      archiveCurrentEdition(f.root);
    }
    const index = readEditionIndex(join(f.root, 'site'));
    assert.equal(index.length, MAX_PAST_EDITIONS);
    assert.deepEqual(
      index.map((e) => e.id),
      stamps
        .slice(-3)
        .reverse()
        .map((s) => editionId(s)),
    );
    assert.deepEqual(
      f.historyFiles(),
      stamps
        .slice(-3)
        .map((s) => editionId(s) + '.json')
        .sort(),
    );
  } finally {
    f.cleanup();
  }
});

test('re-archiving the same digest is idempotent and missing files drop out of the index', () => {
  const f = fixture();
  try {
    f.putDigest('2026-11-13T06:00:00Z', 1);
    archiveCurrentEdition(f.root);
    archiveCurrentEdition(f.root);
    assert.equal(readEditionIndex(join(f.root, 'site')).length, 1);
    f.putDigest('2026-11-14T06:00:00Z', 1);
    archiveCurrentEdition(f.root);
    rmSync(join(f.root, 'site', 'history', '2026-11-13T06-00-00Z.json'));
    f.putDigest('2026-11-15T06:00:00Z', 1);
    archiveCurrentEdition(f.root);
    assert.deepEqual(
      readEditionIndex(join(f.root, 'site')).map((e) => e.id),
      ['2026-11-15T06-00-00Z', '2026-11-14T06-00-00Z'],
    );
  } finally {
    f.cleanup();
  }
});
