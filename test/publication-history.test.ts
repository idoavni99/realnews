import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'realnews-history-publication-'));
  const remote = join(root, 'remote.git'),
    runner = join(root, 'runner');
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return r.stdout.trim();
  };
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(runner, path)), { recursive: true });
    writeFileSync(join(runner, path), text);
  };
  git(root, 'init', '--bare', remote);
  git(root, 'clone', remote, runner);
  git(runner, 'checkout', '-b', 'main');
  git(runner, 'config', 'user.name', 'Test');
  git(runner, 'config', 'user.email', 'test@example.invalid');
  for (const name of ['publish-digest.sh', 'push-with-retry.sh']) {
    mkdirSync(join(runner, 'scripts'), { recursive: true });
    copyFileSync(new URL('../scripts/' + name, import.meta.url), join(runner, 'scripts', name));
  }
  put('site/data.json', '{"edition":"old"}\n');
  git(runner, 'add', '.');
  git(runner, 'commit', '-m', 'base');
  git(runner, 'push', '-u', 'origin', 'main');
  const publish = () =>
    spawnSync('bash', ['scripts/publish-digest.sh'], {
      cwd: runner,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        RETRY_DELAYS: '0 0',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
  const remoteFile = (path: string) => git(root, '--git-dir=' + remote, 'show', 'main:' + path);
  const remoteFiles = (dir: string) =>
    git(root, '--git-dir=' + remote, 'ls-tree', '-r', '--name-only', 'main', dir);
  return {
    root,
    runner,
    git,
    put,
    publish,
    remoteFile,
    remoteFiles,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('digest publication commits archived editions and pruned history deletions', () => {
  const f = fixture();
  try {
    f.put('site/data.json', '{"edition":"new"}\n');
    f.put('site/history/2026-11-13T06-00-00Z.json', '{"edition":"old"}\n');
    f.put(
      'site/history/index.json',
      '{"editions":[{"id":"2026-11-13T06-00-00Z","generated_at":"2026-11-13T06:00:00Z","stories":1}]}\n',
    );
    const first = f.publish();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.equal(f.remoteFile('site/data.json'), '{"edition":"new"}');
    assert.equal(f.remoteFile('site/history/2026-11-13T06-00-00Z.json'), '{"edition":"old"}');
    f.put('site/data.json', '{"edition":"newer"}\n');
    f.put('site/history/2026-11-14T06-00-00Z.json', '{"edition":"new"}\n');
    f.put(
      'site/history/index.json',
      '{"editions":[{"id":"2026-11-14T06-00-00Z","generated_at":"2026-11-14T06:00:00Z","stories":1}]}\n',
    );
    rmSync(join(f.runner, 'site', 'history', '2026-11-13T06-00-00Z.json'));
    const second = f.publish();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.deepEqual(f.remoteFiles('site/history').split('\n').sort(), [
      'site/history/2026-11-14T06-00-00Z.json',
      'site/history/index.json',
    ]);
  } finally {
    f.cleanup();
  }
});

test('digest publication still blocks a change outside the generated files', () => {
  const f = fixture();
  try {
    f.put('site/data.json', '{"edition":"new"}\n');
    f.put('site/history/2026-11-13T06-00-00Z.json', '{"edition":"old"}\n');
    f.put('scripts/push-with-retry.sh', 'tampered\n');
    const r = f.publish();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Publication blocked:/);
  } finally {
    f.cleanup();
  }
});

test('digest publication without a history directory still works', () => {
  const f = fixture();
  try {
    f.put('site/data.json', '{"edition":"new"}\n');
    const r = f.publish();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.remoteFile('site/data.json'), '{"edition":"new"}');
  } finally {
    f.cleanup();
  }
});
