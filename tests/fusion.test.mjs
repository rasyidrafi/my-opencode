import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkers, bindAliases, buildWorkerPrompt, runFusion } from '../dot_config/opencode/plugins/my-opencode/fusion.js';

const knownModels = [
  { providerID: 'rawroute', modelID: 'gpt-peak' },
  { providerID: 'rawroute', modelID: 'base-cat' },
];

async function fixture(t, config, behavior = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fusion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configURL = pathToFileURL(path.join(directory, 'fusion.json'));
  await writeFile(configURL, JSON.stringify(config));
  const calls = { create: [], prompt: [], wait: [], context: [], interrupt: [] };
  let next = 0;
  const ctx = {
    model: { list: async () => behavior.modelList ?? { location: {}, data: behavior.knownModels ?? knownModels } },
    session: {
      create: async input => {
        calls.create.push(input);
        return { id: `ses_w${++next}` };
      },
      prompt: async input => {
        calls.prompt.push(input);
        await behavior.onPrompt?.(input);
      },
      wait: async input => {
        calls.wait.push(input);
        await behavior.onWait?.(input);
      },
      context: async input => {
        calls.context.push(input);
        return behavior.messages?.(input) ?? [
          { type: 'user', content: [{ type: 'text', text: 'request' }] },
          { type: 'assistant', content: [{ type: 'text', text: `review by ${input.sessionID}` }] },
        ];
      },
      interrupt: async input => {
        calls.interrupt.push(input);
        behavior.onInterrupt?.(input);
        return { interrupted: true };
      },
    },
  };
  const run = (prompt = 'Review the diff.', signal = new AbortController().signal) =>
    runFusion(ctx, { sessionID: 'ses_parent', prompt, signal }, configURL);
  return { ctx, calls, configURL, directory, run };
}

const twoWorkers = { workers: [{ model: 'rawroute/gpt-peak' }, { model: 'rawroute/base-cat', variant: 'high' }] };

test('loadWorkers accepts objects and string shorthand, normalizing ids, model refs, and variants', async t => {
  const f = await fixture(t, { workers: ['rawroute/gpt-peak', { id: 'cat', model: ' rawroute/base-cat ', variant: ' high ' }] });
  assert.deepEqual(await loadWorkers(f.configURL), {
    debug: false,
    workers: [
      { id: 'worker-1', providerID: 'rawroute', modelID: 'gpt-peak', variant: undefined, model: 'rawroute/gpt-peak' },
      { id: 'cat', providerID: 'rawroute', modelID: 'base-cat', variant: 'high', model: 'rawroute/base-cat' },
    ],
  });
});

test('loadWorkers rejects missing files, empty panels, malformed workers, and bad debug/id values', async t => {
  const f = await fixture(t, { workers: [] });
  await assert.rejects(loadWorkers(f.configURL), /non-empty "workers" array/);
  await assert.rejects(loadWorkers(pathToFileURL(path.join(f.directory, 'missing.json'))), /fusion: cannot read worker config/);
  for (const config of [
    { workers: [{ model: 'no-slash' }] },
    { workers: [{ model: 'rawroute/gpt-peak', variant: '  ' }] },
    { workers: [{ model: 'rawroute/gpt-peak', id: 'bad id!' }] },
    { workers: [{ model: 'rawroute/gpt-peak', id: 'same' }, { model: 'rawroute/base-cat', id: 'same' }] },
    { workers: [42] },
    { workers: [{}] },
    { workers: ['rawroute/gpt-peak'], debug: 'yes' },
    { nope: true },
  ]) {
    await writeFile(f.configURL, JSON.stringify(config));
    await assert.rejects(loadWorkers(f.configURL), /fusion:/);
  }
});

test('bindAliases assigns a fresh anonymous permutation per invocation', () => {
  const workers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const seen = new Set();
  for (let run = 0; run < 30; run++) {
    const bound = bindAliases(workers);
    assert.deepEqual(bound.map(worker => worker.alias), ['Worker A', 'Worker B', 'Worker C']);
    assert.deepEqual([...bound].sort((x, y) => x.id.localeCompare(y.id)).map(worker => worker.id), ['a', 'b', 'c']);
    seen.add(bound.map(worker => worker.id).join(','));
  }
  assert.ok(seen.size > 1, 'alias assignment must vary across invocations');
});

test('runFusion fans out reviewer sessions and dumps masked reviews under anonymous aliases', async t => {
  const f = await fixture(t, twoWorkers);
  const result = await f.run('Review the diff.');
  assert.deepEqual(f.calls.create.map(call => call.agent), ['reviewer', 'reviewer']);
  assert.deepEqual(f.calls.create.map(call => call.parentID), ['ses_parent', 'ses_parent']);
  assert.deepEqual(f.calls.create.map(call => call.title).sort(), ['fusion: Worker A', 'fusion: Worker B']);
  assert.deepEqual(f.calls.create.map(call => call.model).sort((a, b) => a.id.localeCompare(b.id)), [
    { providerID: 'rawroute', id: 'base-cat', variant: 'high' },
    { providerID: 'rawroute', id: 'gpt-peak' },
  ]);
  for (const call of f.calls.prompt) assert.equal(call.text, buildWorkerPrompt('Review the diff.'));
  assert.ok(buildWorkerPrompt('Review the diff.').includes('<user_prompt>\nReview the diff.\n</user_prompt>'));
  assert.ok(!buildWorkerPrompt('x').includes('panel'));

  assert.ok(result.text.startsWith('◆ REVIEWS — ALL CONFIGURED REVIEWERS'));
  const sections = [...result.text.matchAll(/## \[(Worker [A-Z]+)\] — REVIEW/g)].map(match => match[1]);
  assert.deepEqual(sections, ['Worker A', 'Worker B']);
  assert.ok(result.text.includes('review by ses_w1'));
  assert.ok(result.text.includes('review by ses_w2'));
  assert.ok(result.text.includes('synthesize the final review'));
  for (const secret of ['rawroute', 'gpt-peak', 'base-cat', 'worker-1', 'worker-2']) {
    assert.ok(!result.text.includes(secret), `panel text must not reveal ${secret}`);
  }
  assert.equal(result.metadata.workerCount, 2);
  assert.equal(result.metadata.successfulWorkers, 2);
  assert.equal(result.metadata.partial, false);
  assert.deepEqual(result.metadata.workers.map(({ alias, status }) => ({ alias, status })), [
    { alias: 'Worker A', status: 'ok' },
    { alias: 'Worker B', status: 'ok' },
  ]);
  for (const worker of result.metadata.workers) {
    assert.ok(Number.isInteger(worker.elapsedMs));
    assert.ok(!Object.hasOwn(worker, 'model'));
    assert.ok(!Object.hasOwn(worker, 'sessionID'));
  }
  assert.ok(!Object.hasOwn(result.metadata, 'sessions'));
});

test('worker output and errors are scrubbed of configured identities and runtime details', async t => {
  const f = await fixture(t, { workers: [{ id: 'peak-worker', model: 'rawroute/gpt-peak' }] }, {
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'As rawroute/gpt-peak (peak-worker), I find a bug.' }] }],
  });
  const result = await f.run();
  assert.ok(result.text.includes('As <redacted> (<redacted>), I find a bug.'));
  assert.ok(!result.text.includes('gpt-peak'));

  const failing = await fixture(t, { workers: [{ model: 'rawroute/gpt-peak' }] }, {
    onPrompt: () => { throw new Error('rawroute/gpt-peak failed at /home/bull/secret/file.ts'); },
  });
  const failed = await failing.run();
  assert.ok(failed.text.includes('## [Worker A] — REVIEW UNAVAILABLE'));
  assert.ok(failed.text.includes('<redacted>'));
  assert.ok(failed.text.includes('<path>'));
  assert.ok(!failed.text.includes('gpt-peak'));
  assert.ok(!failed.text.includes('/home/bull'));
  assert.equal(failed.metadata.partial, true);
  assert.equal(failed.metadata.workers[0].status, 'failed');
});

test('unavailable worker models fail fast with aliases only, before any session is created', async t => {
  const f = await fixture(t, twoWorkers, { knownModels: [{ providerID: 'rawroute', modelID: 'gpt-peak' }] });
  await assert.rejects(f.run(), error => {
    assert.match(error.message, /fusion: Worker [A-Z]+ unavailable in the current OpenCode configuration/);
    assert.ok(!error.message.includes('base-cat'));
    assert.ok(!error.message.includes('rawroute'));
    return true;
  });
  assert.equal(f.calls.create.length, 0);
});

test('a malformed model catalog response fails cleanly without creating sessions', async t => {
  const f = await fixture(t, twoWorkers, { modelList: { location: {}, data: null } });
  await assert.rejects(f.run(), /fusion: unable to inspect configured worker models/);
  assert.equal(f.calls.create.length, 0);
});

test('workers without assistant text are reported as failures', async t => {
  const f = await fixture(t, { workers: ['rawroute/gpt-peak'] }, {
    messages: () => [{ type: 'user', content: [{ type: 'text', text: 'request' }] }],
  });
  const result = await f.run();
  assert.ok(result.text.includes('REVIEW UNAVAILABLE'));
  assert.ok(result.text.includes('worker returned no text response'));
  assert.equal(result.metadata.partial, true);
});

test('abort interrupts every live worker session and marks the panel aborted', async t => {
  const waiting = new Map();
  const f = await fixture(t, twoWorkers, {
    onWait: input => new Promise(resolve => waiting.set(input.sessionID, resolve)),
    onInterrupt: input => waiting.get(input.sessionID)?.(),
  });
  const controller = new AbortController();
  const pending = f.run('Review the diff.', controller.signal);
  while (f.calls.wait.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  const result = await pending;
  assert.deepEqual(f.calls.interrupt.map(call => call.sessionID).sort(), ['ses_w1', 'ses_w2']);
  assert.ok(result.text.includes('REVIEW UNAVAILABLE'));
  assert.ok(result.text.includes('aborted'));
  assert.equal(result.metadata.successfulWorkers, 0);
});

test('debug adds an alias-to-session mapping without model names; config errors propagate', async t => {
  const f = await fixture(t, { workers: ['rawroute/gpt-peak'], debug: true });
  const result = await f.run();
  assert.deepEqual(result.metadata.sessions, [{ alias: 'Worker A', sessionID: 'ses_w1' }]);
  assert.ok(!JSON.stringify(result.metadata).includes('gpt-peak'));

  const broken = await fixture(t, { workers: [] });
  await assert.rejects(broken.run(), /fusion: worker config must define a non-empty "workers" array/);
});