import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, tailnet, account } from './setup.mjs';

const target = { BackendState: 'Running', CurrentTailnet: { MagicDNSSuffix: tailnet } };
const other = { BackendState: 'Running', CurrentTailnet: { MagicDNSSuffix: 'other.ts.net' } };
const loggedOut = { BackendState: 'NeedsLogin' };
const saved = { id: 'abcd', account, tailnet: account };

function harness(states, profiles = []) {
  const changes = [];
  const messages = [];
  let reads = 0;
  let terminalChecks = 0;
  return {
    changes, messages,
    get terminalChecks() { return terminalChecks; },
    status: () => states[Math.min(reads++, states.length - 1)],
    profiles: () => profiles,
    change: args => changes.push(args),
    requireTerminal: () => { terminalChecks++; },
    log: message => messages.push(message),
    wait: async () => {},
  };
}

test('already connected is a no-op, even without a terminal', async () => {
  const io = harness([target]);
  await setup(io);
  assert.deepEqual(io.changes, []);
  assert.equal(io.terminalChecks, 0);
  assert.match(io.messages.at(-1), /^Done:/);
});

test('reconnects the target without creating another account', async () => {
  const io = harness([{ ...target, BackendState: 'Stopped' }, target]);
  await setup(io);
  assert.deepEqual(io.changes, [['up']]);
});

test('switches a saved account without logging out the old account', async () => {
  const io = harness([other, target, target, target], [saved]);
  await setup(io);
  assert.deepEqual(io.changes, [['switch', 'abcd']]);
});

test('reconnects a stopped saved account after switching', async () => {
  const io = harness([other, { ...target, BackendState: 'Stopped' }, target, target], [saved]);
  await setup(io);
  assert.deepEqual(io.changes, [['switch', 'abcd'], ['up']]);
});

for (const [name, initial] of [['another account', other], ['no account', loggedOut]]) {
  test(`logs in with ${name} and no matching saved profile`, async () => {
    const io = harness([initial, target]);
    await setup(io);
    assert.deepEqual(io.changes, [['login']]);
  });
}

test('does not treat account name alone as proof of the target tailnet', async () => {
  const io = harness([other, other, other, target], [saved]);
  await setup(io);
  assert.deepEqual(io.changes, [['switch', 'abcd'], ['login']]);
});

test('wrong browser identity fails instead of reporting success', async () => {
  const io = harness([loggedOut, other]);
  await assert.rejects(setup(io), /different tailnet/);
  assert.ok(!io.messages.some(message => message.startsWith('Done:')));
});

test('pending connection times out without reporting success', async () => {
  const io = harness([loggedOut]);
  await assert.rejects(setup(io), /Not connected.*NeedsLogin/);
  assert.deepEqual(io.changes, [['login']]);
});

test('cancelled elevation stops the flow', async () => {
  const io = harness([other]);
  io.change = () => { throw new Error('elevation cancelled'); };
  await assert.rejects(setup(io), /elevation cancelled/);
  assert.ok(!io.messages.some(message => message.startsWith('Done:')));
});

test('service failure does not attempt login', async () => {
  const io = harness([]);
  io.status = () => { throw new Error('service unavailable'); };
  await assert.rejects(setup(io), /service unavailable/);
  assert.deepEqual(io.changes, []);
});
