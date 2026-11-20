import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkers, bindAliases, buildWorkerPrompt, runFusion } from '../dot_config/opencode/plugins/my-opencode/fusion.js';

const knownModels = [
  { providerID: 'rawroute', modelID: 'gpt-peak' },
  { providerID: 'rawroute', modelID: 'base-alpha' },
];

async function fixture(t, config, behavior = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fusion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configURL = pathToFileURL(path.join(directory, 'fusion.json'));
  await writeFile(configURL, JSON.stringify(config));
  const calls = { create: [], prompt: [], wait: [], context: [], interrupt: [] };
  let next = 0;
  const ctx = {
    location: { directory: '/tmp/fusion-project' },
    model: { list: async () => behavior.modelList ?? { location: {}, data: behavior.knownModels ?? knownModels } },
    session: {
      create: async input => {
        calls.create.push(input);
        await behavior.onCreate?.(input);
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

const twoWorkers = { workers: [{ model: 'rawroute/gpt-peak' }, { model: 'rawroute/base-alpha', variant: 'high' }] };

test('loadWorkers accepts objects and string shorthand, normalizing ids, model refs, and variants', async t => {
  const f = await fixture(t, { workers: ['rawroute/gpt-peak', { id: 'cat-worker', model: ' rawroute/base-alpha ', variant: ' high ' }] });
  assert.deepEqual(await loadWorkers(f.configURL), {
    debug: false,
    workers: [
      { id: 'worker-1', providerID: 'rawroute', modelID: 'gpt-peak', variant: undefined, model: 'rawroute/gpt-peak' },
      { id: 'cat-worker', providerID: 'rawroute', modelID: 'base-alpha', variant: 'high', model: 'rawroute/base-alpha' },
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
    { workers: [{ model: 'rawroute/gpt-peak', id: 'ab' }] },
    { workers: [{ model: 'rawroute/gpt-peak', id: 'same' }, { model: 'rawroute/base-alpha', id: 'same' }] },
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
  // Top-level workers: a parentID would make V2 deliver completion notifications
  // to the simulated session and wake it into an endless fusion loop.
  for (const call of f.calls.create) {
    assert.ok(!Object.hasOwn(call, 'parentID'), 'workers must not be children of the calling session');
    assert.deepEqual(call.location, { directory: '/tmp/fusion-project' });
  }
  assert.deepEqual(f.calls.create.map(call => call.title).sort(), ['fusion: Worker A', 'fusion: Worker B']);
  assert.deepEqual(f.calls.create.map(call => call.model).sort((a, b) => a.id.localeCompare(b.id)), [
    { providerID: 'rawroute', id: 'base-alpha', variant: 'high' },
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
  for (const secret of ['rawroute', 'gpt-peak', 'base-alpha', 'worker-1', 'worker-2']) {
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
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'As rawroute/gpt-peak (peak-worker), provider is rawroute, I find a bug.' }] }],
  });
  const result = await f.run();
  assert.ok(result.text.includes('As *** (***), provider is ***, I find a bug.'));
  assert.ok(!result.text.includes('gpt-peak'));
  assert.ok(!result.text.includes('rawroute'));

  const failing = await fixture(t, { workers: [{ model: 'rawroute/gpt-peak' }] }, {
    onPrompt: () => { throw new Error('rawroute/gpt-peak failed at /home/bull/secret/file.ts'); },
  });
  const failed = await failing.run();
  assert.ok(failed.text.includes('## [Worker A] — REVIEW UNAVAILABLE'));
  assert.ok(failed.text.includes('***'));
  assert.ok(failed.text.includes('<path>'));
  assert.ok(!failed.text.includes('gpt-peak'));
  assert.ok(!failed.text.includes('rawroute'));
  assert.ok(!failed.text.includes('/home/bull'));
  assert.ok(!JSON.stringify(failed.metadata).includes('rawroute'));
  assert.equal(failed.metadata.partial, true);
  assert.equal(failed.metadata.workers[0].status, 'failed');
});

test('worker payloads are scrubbed against the whole panel identity set', async t => {
  const f = await fixture(t, twoWorkers, {
    messages: input => [{ type: 'assistant', content: [{ type: 'text', text: `Quoting fusion.json: ${input.sessionID} sees rawroute/base-alpha and gpt-peak in the config.` }] }],
  });
  const result = await f.run();
  assert.ok(!result.text.includes('base-alpha'));
  assert.ok(!result.text.includes('gpt-peak'));
  assert.ok(!result.text.includes('rawroute'));
  assert.ok(result.text.includes('***'));

  const failing = await fixture(t, twoWorkers, {
    onPrompt: input => {
      if (input.sessionID === 'ses_w1') throw new Error('base-alpha quota exceeded');
    },
  });
  const failed = await failing.run();
  assert.ok(!failed.text.includes('base-alpha'));
  assert.ok(!JSON.stringify(failed.metadata).includes('base-alpha'));
});

test('an errored terminal assistant message is a worker failure despite partial text', async t => {
  const f = await fixture(t, twoWorkers, {
    messages: input => input.sessionID === 'ses_w2'
      ? [{ type: 'assistant', content: [{ type: 'text', text: 'partial review prefix' }], error: { type: 'AI_Error', message: 'provider rawroute/base-alpha exploded' } }]
      : [{ type: 'assistant', content: [{ type: 'text', text: 'complete review' }] }],
  });
  const result = await f.run();
  assert.equal((result.text.match(/— REVIEW\n/g) ?? []).length, 1);
  assert.equal((result.text.match(/— REVIEW UNAVAILABLE/g) ?? []).length, 1);
  assert.ok(result.text.includes('complete review'));
  assert.ok(!result.text.includes('partial review prefix'));
  assert.ok(!result.text.includes('base-alpha'));
  assert.ok(!result.text.includes('rawroute'));
  assert.ok(!JSON.stringify(result.metadata).includes('base-alpha'));
  assert.equal(result.metadata.successfulWorkers, 1);
  assert.equal(result.metadata.partial, true);
});

test('short provider and model ids are masked on word boundaries', async t => {
  const f = await fixture(t, { workers: ['ai/gpt'] }, {
    knownModels: [{ providerID: 'ai', modelID: 'gpt' }],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'Provider ai; model gpt. The word said stays intact.' }] }],
  });
  const result = await f.run();
  assert.ok(result.text.includes('Provider ***; model ***.'));
  assert.ok(result.text.includes('The word said stays intact.'));
});

test('punctuation-edged short identifiers are masked without shredding words', async t => {
  const f = await fixture(t, { workers: ['+ai/m-'] }, {
    knownModels: [{ providerID: '+ai', modelID: 'm-' }],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'Provider: +ai. Model: m-. The word said stays intact.' }] }],
  });
  const result = await f.run();
  assert.ok(result.text.includes('Provider: ***. Model: ***.'));
  assert.ok(result.text.includes('The word said stays intact.'));
});

test('the replacement marker never reintroduces a configured identity', async t => {
  const f = await fixture(t, { workers: ['acme/redacted'] }, {
    knownModels: [{ providerID: 'acme', modelID: 'redacted' }],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'Model: acme/redacted is configured.' }] }],
  });
  const result = await f.run();
  assert.ok(!result.text.includes('redacted'), 'marker collision leaked the model id');
  assert.ok(result.text.includes('***'));

  const failing = await fixture(t, { workers: ['acme/redacted'] }, {
    knownModels: [{ providerID: 'acme', modelID: 'redacted' }],
    onPrompt: () => { throw new Error('acme/redacted quota exceeded'); },
  });
  const failed = await failing.run();
  assert.ok(!failed.text.includes('redacted'));
  assert.ok(!JSON.stringify(failed.metadata).includes('redacted'));
});

test('every occurrence of a short identity is masked in output and errors', async t => {
  const repeated = 'Provider ai; provider ai. Model gpt; model gpt.';
  const f = await fixture(t, { workers: ['ai/gpt'] }, {
    knownModels: [{ providerID: 'ai', modelID: 'gpt' }],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: repeated }] }],
  });
  const result = await f.run();
  assert.ok(!/(?<![A-Za-z0-9_])ai(?![A-Za-z0-9_])/.test(result.text));
  assert.ok(!/(?<![A-Za-z0-9_])gpt(?![A-Za-z0-9_])/.test(result.text));
  assert.equal((result.text.match(/\*\*\*/g) ?? []).length, 4);

  const failing = await fixture(t, { workers: ['ai/gpt'] }, {
    knownModels: [{ providerID: 'ai', modelID: 'gpt' }],
    onPrompt: () => { throw new Error(repeated); },
  });
  const failed = await failing.run();
  assert.ok(!/(?<![A-Za-z0-9_])ai(?![A-Za-z0-9_])/.test(failed.text));
  assert.ok(!/(?<![A-Za-z0-9_])gpt(?![A-Za-z0-9_])/.test(failed.text));
  assert.ok(!/(?<![A-Za-z0-9_])gpt(?![A-Za-z0-9_])/.test(JSON.stringify(failed.metadata)));
});

test('marker selection terminates when every fixed candidate collides', async t => {
  const { redactIdentity } = await import('../dot_config/opencode/plugins/my-opencode/sanitize.js');
  const identities = ['redacted', 'masked', 'removed', 'hidden'];
  const result = redactIdentity('redacted masked removed hidden', identities);
  for (const identity of identities) assert.ok(!result.includes(identity));
  assert.equal(result, '*** *** *** ***');

  const f = await fixture(t, { workers: ['aa/redacted', 'bb/masked', 'cc/removed', 'dd/hidden'] }, {
    knownModels: [
      { providerID: 'aa', modelID: 'redacted' }, { providerID: 'bb', modelID: 'masked' },
      { providerID: 'cc', modelID: 'removed' }, { providerID: 'dd', modelID: 'hidden' },
    ],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'redacted masked removed hidden' }] }],
  });
  const panel = await f.run();
  for (const identity of identities) {
    assert.ok(!panel.text.includes(identity));
    assert.ok(!JSON.stringify(panel.metadata).includes(identity));
  }
  assert.equal(panel.metadata.successfulWorkers, 4);
});

test('replacements cannot recreate an identity across the marker boundary', async t => {
  const { redactIdentity } = await import('../dot_config/opencode/plugins/my-opencode/sanitize.js');
  const identities = ['acme/other', 'other', 'acme', 'acme/redacted>foo', 'redacted>foo', 'worker-1', 'worker-2'];
  const direct = redactIdentity('otherfoo', identities);
  assert.ok(!direct.includes('redacted>foo'));
  assert.ok(!direct.includes('other'));

  const f = await fixture(t, { workers: ['acme/other', 'acme/redacted>foo'] }, {
    knownModels: [{ providerID: 'acme', modelID: 'other' }, { providerID: 'acme', modelID: 'redacted>foo' }],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'otherfoo' }] }],
  });
  const result = await f.run();
  assert.ok(!result.text.includes('redacted>foo'));
  assert.ok(!result.text.includes('other'));
  assert.ok(!JSON.stringify(result.metadata).includes('redacted>foo'));
});

test('masking rechecks boundaries until stable and leaves embedded words intact', async t => {
  const { redactIdentity, sanitizeErrorMessage } = await import('../dot_config/opencode/plugins/my-opencode/sanitize.js');
  const identities = ['acme/ai-', 'ai-', 'acme', 'acme/b', 'b', 'worker-1', 'worker-2'];
  assert.equal(redactIdentity('ai-b', identities), '******');
  assert.equal(sanitizeErrorMessage(new Error('ai-b'), identities), '******');
  assert.equal(redactIdentity('said', ['acme/ai', 'ai', 'acme', 'worker-1']), 'said');

  const f = await fixture(t, { workers: ['acme/ai-', 'acme/b'] }, {
    knownModels: [{ providerID: 'acme', modelID: 'ai-' }, { providerID: 'acme', modelID: 'b' }],
    messages: () => [{ type: 'assistant', content: [{ type: 'text', text: 'ai-b and said stay.' }] }],
  });
  const result = await f.run();
  assert.ok(result.text.includes('****** and said stay.'));
  assert.ok(!result.text.includes('ai-'));
});

test('error truncation cannot expose an identity at the cut boundary', async t => {
  const { sanitizeErrorMessage } = await import('../dot_config/opencode/plugins/my-opencode/sanitize.js');
  const identities = ['acme/ai', 'acme', 'ai', 'worker-1'];
  const out = sanitizeErrorMessage(new Error('x'.repeat(237) + ' aiX'), identities);
  assert.ok(!/(?<![A-Za-z0-9_])ai(?![A-Za-z0-9_])/.test(out), 'truncation exposed the short identity');
  assert.ok(out.includes('***'));
});

test('config parse failures never echo configured identities', async t => {
  const f = await fixture(t, { workers: [] });
  await writeFile(f.configURL, '{ "workers": [{ "model": "rawroute/gpt-peak" },] }');
  await assert.rejects(loadWorkers(f.configURL), error => {
    assert.match(error.message, /fusion: cannot read worker config .*: invalid JSON/);
    assert.ok(!error.message.includes('rawroute'));
    assert.ok(!error.message.includes('gpt-peak'));
    return true;
  });
});

test('the simulated provider is rejected as a worker before any session exists', async t => {
  const f = await fixture(t, { workers: ['simulated/multi_reviewer', 'rawroute/gpt-peak'] }, {
    knownModels: [...knownModels, { providerID: 'simulated', modelID: 'multi_reviewer' }],
  });
  await assert.rejects(f.run(), error => {
    assert.match(error.message, /fusion: Worker [A-Z]+ cannot use the simulated provider as a worker/);
    assert.ok(!error.message.includes('simulated/multi_reviewer'));
    return true;
  });
  assert.equal(f.calls.create.length, 0);
});

test('unavailable worker models fail fast with aliases only, before any session is created', async t => {
  const f = await fixture(t, twoWorkers, { knownModels: [{ providerID: 'rawroute', modelID: 'gpt-peak' }] });
  await assert.rejects(f.run(), error => {
    assert.match(error.message, /fusion: Worker [A-Z]+ unavailable in the current OpenCode configuration/);
    assert.ok(!error.message.includes('base-alpha'));
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

test('abort during session creation never prompts the idle worker', async t => {
  let releaseCreate;
  const f = await fixture(t, { workers: ['rawroute/gpt-peak'] }, {
    onCreate: () => new Promise(resolve => { releaseCreate = resolve; }),
  });
  const controller = new AbortController();
  const pending = f.run('Review.', controller.signal);
  while (f.calls.create.length < 1) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  releaseCreate();
  const result = await pending;
  assert.equal(f.calls.prompt.length, 0, 'aborted worker must not be prompted');
  assert.ok(result.text.includes('aborted'));
});

test('abort during prompt admission interrupts the worker once it settles', async t => {
  let releasePrompt;
  const f = await fixture(t, { workers: ['rawroute/gpt-peak'] }, {
    onPrompt: () => new Promise(resolve => { releasePrompt = resolve; }),
  });
  const controller = new AbortController();
  const pending = f.run('Review.', controller.signal);
  while (f.calls.prompt.length < 1) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort();
  releasePrompt();
  const result = await pending;
  assert.ok(f.calls.interrupt.length >= 1, 'worker must be interrupted after admission');
  assert.equal(f.calls.wait.length, 0, 'aborted worker must not be waited on');
  assert.ok(result.text.includes('aborted'));
});

test('runFusion emits panel and worker progress events for reasoning streaming', async t => {
  const f = await fixture(t, twoWorkers);
  const events = [];
  await runFusion(f.ctx, { sessionID: 'ses_parent', prompt: 'Review.', signal: new AbortController().signal, onProgress: event => events.push(event) }, f.configURL);
  assert.deepEqual(events[0], { type: 'panel-start', workerCount: 2 });
  assert.deepEqual(events.filter(event => event.type === 'worker-start').map(event => event.alias).sort(), ['Worker A', 'Worker B']);
  const ends = events.filter(event => event.type === 'worker-end');
  assert.equal(ends.length, 2);
  assert.ok(ends.every(event => event.ok === true));

  const failing = await fixture(t, { workers: ['rawroute/gpt-peak'] }, {
    onPrompt: () => { throw new Error('provider down'); },
  });
  const failEvents = [];
  await runFusion(failing.ctx, { sessionID: 'ses_parent', prompt: 'Review.', signal: new AbortController().signal, onProgress: event => failEvents.push(event) }, failing.configURL);
  const end = failEvents.find(event => event.type === 'worker-end');
  assert.equal(end.ok, false);
  assert.equal(end.error, 'provider down');
});

test('debug adds an alias-to-session mapping without model names; config errors propagate', async t => {
  const f = await fixture(t, { workers: ['rawroute/gpt-peak'], debug: true });
  const result = await f.run();
  assert.deepEqual(result.metadata.sessions, [{ alias: 'Worker A', sessionID: 'ses_w1' }]);
  assert.ok(!JSON.stringify(result.metadata).includes('gpt-peak'));

  const broken = await fixture(t, { workers: [] });
  await assert.rejects(broken.run(), /fusion: worker config must define a non-empty "workers" array/);
});