import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { retiredEnvironmentNames, renderEnvironment, renderEnvironmentFish } from './setup.mjs';

test('retires only previous managed names and keeps reintroduced names', () => {
  assert.deepEqual(retiredEnvironmentNames(['KEEP', 'RETURNED'], ['KEEP', 'OLD'], ['RETURNED']), ['CCS_LOCAL_API_KEY', 'OLD']);
  assert.throws(() => retiredEnvironmentNames([], ['HOME']), /Invalid/);
  assert.throws(() => retiredEnvironmentNames([], ['BAD;COMMAND']), /Invalid/);
});

test('Bash clears retired inherited values while preserving active caller overrides', () => {
  const script = renderEnvironment({ ACTIVE: 'managed', NEW: 'new' }, ['OLD']);
  const result = spawnSync('bash', ['-c', `${script}\nprintf '%s|%s|%s|%s|%s' "\${OLD-unset}" "\${CCS_LOCAL_API_KEY-unset}" "$ACTIVE" "$NEW" "$UNRELATED"`], {
    encoding: 'utf8', env: { ...process.env, OLD: 'old', CCS_LOCAL_API_KEY: 'old', ACTIVE: 'caller', UNRELATED: 'keep' },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'unset|unset|caller|new|keep');
});

test('Fish clears retired names without clearing active names', () => {
  const script = renderEnvironmentFish({ ACTIVE: 'managed' }, ['OLD', 'ACTIVE']);
  assert.ok(script.includes('set -e OLD\n'));
  assert.ok(script.includes('set -e CCS_LOCAL_API_KEY\n'));
  assert.ok(!script.includes('set -e ACTIVE\n'));
});
