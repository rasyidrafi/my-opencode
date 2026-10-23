import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restart } from './restart.mjs';

const running = 'LoadState=loaded\nActiveState=active\nSubState=running\n';
function fixture({ state = running, after = running, status = 0, uid = 1000, platform = 'linux', args = [] } = {}) {
  const calls = [];
  let inspections = 0;
  const execute = () => restart({ uid, platform, args, run: (command, argv, options) => {
    calls.push({ command, argv, options });
    if (argv[0] === 'show') return { status: 0, stdout: inspections++ ? after : state };
    return { status };
  } });
  return { calls, execute };
}

test('running service uses interactive sudo and verifies state afterward', () => {
  const { calls, execute } = fixture();
  execute();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], {
    command: 'sudo', argv: ['--', 'systemctl', 'try-restart', '--job-mode=fail', 'cloudflared.service'], options: { stdio: 'inherit' },
  });
});
test('root does not require sudo', () => {
  const { calls, execute } = fixture({ uid: 0 });
  execute();
  assert.equal(calls[1].command, 'systemctl');
  assert.equal(calls[1].argv[0], 'try-restart');
});
for (const state of [
  'LoadState=not-found\nActiveState=inactive\nSubState=dead',
  'LoadState=loaded\nActiveState=inactive\nSubState=dead',
  'LoadState=loaded\nActiveState=failed\nSubState=failed',
  'LoadState=loaded\nActiveState=active\nSubState=exited',
]) {
  test(`reject non-running service: ${state.replaceAll('\n', ', ')}`, () => {
    const { calls, execute } = fixture({ state });
    assert.throws(execute, /already be installed and running/);
    assert.equal(calls.length, 1);
  });
}
test('sudo/restart failure is propagated without claiming success', () => {
  const { calls, execute } = fixture({ status: 1 });
  assert.throws(execute, /restart failed/);
  assert.equal(calls.length, 2);
});
test('service not running after restart fails verification', () => {
  assert.throws(fixture({ after: 'LoadState=loaded\nActiveState=inactive\nSubState=dead' }).execute, /already be installed and running/);
});
test('unsupported host and arguments fail before executing commands', () => {
  for (const options of [{ platform: 'darwin' }, { args: ['--anything'] }]) {
    const { calls, execute } = fixture(options);
    assert.throws(execute);
    assert.equal(calls.length, 0);
  }
});
test('inspection errors fail closed before sudo', () => {
  for (const result of [{ status: 1 }, { error: new Error('not found') }, { status: 0, stdout: '' }]) {
    let calls = 0;
    assert.throws(() => restart({ platform: 'linux', uid: 1000, args: [], run: () => { calls++; return result; } }));
    assert.equal(calls, 1);
  }
});
