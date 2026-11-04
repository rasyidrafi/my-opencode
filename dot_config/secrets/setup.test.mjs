import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { retiredEnvironmentNames, renderEnvironment, renderEnvironmentFish } from './setup.mjs';

test('retires only previous managed names and keeps reintroduced names', () => {
  assert.deepEqual(retiredEnvironmentNames(['KEEP', 'RETURNED'], ['KEEP', 'OLD'], ['RETURNED']), ['CCS_LOCAL_API_KEY', 'OLD']);
  assert.throws(() => retiredEnvironmentNames([], ['HOME']), /Invalid/);
  assert.throws(() => retiredEnvironmentNames([], ['BAD;COMMAND']), /Invalid/);
});

test('Bash replaces stale values with latest secrets and skips an already-current value', () => {
  const script = renderEnvironment({ ACTIVE: 'latest', EMPTY: 'filled', SAME: 'current', NEW: 'new' }, ['OLD']);
  const result = spawnSync(process.env.BASH_TEST_BINARY || 'bash', ['-c', `set -e\nreadonly SAME\n${script}\nprintf '%s|%s|%s|%s|%s|%s|%s' "\${OLD-unset}" "\${CCS_LOCAL_API_KEY-unset}" "$ACTIVE" "$EMPTY" "$SAME" "$NEW" "$UNRELATED"`], {
    encoding: 'utf8', env: { ...process.env, OLD: 'old', CCS_LOCAL_API_KEY: 'old', ACTIVE: 'stale', EMPTY: '', SAME: 'current', UNRELATED: 'keep' },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'unset|unset|latest|filled|current|new|keep');
});

test('Fish clears retired names without clearing active names', () => {
  const script = renderEnvironmentFish({ ACTIVE: 'managed' }, ['OLD', 'ACTIVE']);
  assert.ok(script.includes('set -e OLD\n'));
  assert.ok(script.includes('set -e CCS_LOCAL_API_KEY\n'));
  assert.ok(!script.includes('set -e ACTIVE\n'));
});
