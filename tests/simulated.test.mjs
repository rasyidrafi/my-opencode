import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerSimulated, PROVIDER_ID, MODEL_ID } from '../dot_config/opencode/plugins/my-opencode/simulated.js';
import { buildWorkerPrompt } from '../dot_config/opencode/plugins/my-opencode/fusion.js';

async function collect(stream) {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

async function fixture(t, config = { workers: ['rawroute/gpt-peak', 'rawroute/base-cat'] }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'simulated-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configURL = pathToFileURL(path.join(directory, 'fusion.json'));
  await writeFile(configURL, JSON.stringify(config));

  const registered = { providers: [], aisdk: [], sessionHooks: [] };
  const sessionCalls = { create: [], prompt: [], interrupt: [] };
  let next = 0;
  const ctx = {
    model: {
      list: async () => [
        { providerID: 'rawroute', modelID: 'gpt-peak' },
        { providerID: 'rawroute', modelID: 'base-cat' },
      ],
    },
    provider: {
      transform: async callback => {
        callback({ add: definition => registered.providers.push(definition) });
      },
    },
    aisdk: {
      hook: async (name, callback, options) => {
        registered.aisdk.push({ name, callback, options });
      },
    },
    session: {
      hook: async (name, callback, options) => {
        registered.sessionHooks.push({ name, callback, options });
      },
      create: async input => {
        sessionCalls.create.push(input);
        return { id: `ses_w${++next}` };
      },
      prompt: async input => { sessionCalls.prompt.push(input); },
      wait: async () => {},
      context: async input => [{ type: 'assistant', content: [{ type: 'text', text: `review by ${input.sessionID}` }] }],
      interrupt: async input => {
        sessionCalls.interrupt.push(input);
        return { interrupted: true };
      },
    },
  };
  await registerSimulated(ctx, configURL);
  const model = () => {
    const event = { model: { providerID: PROVIDER_ID }, options: {} };
    registered.aisdk[0].callback(event);
    return event.sdk.languageModel(MODEL_ID);
  };
  const hook = name => registered.sessionHooks.find(entry => entry.name === name);
  return { ctx, registered, sessionCalls, configURL, model, hook };
}

const primaryOptions = (text, extra = {}) => ({
  headers: { 'x-simulated-kind': 'primary', 'x-simulated-session': 'ses_parent' },
  prompt: [{ role: 'user', content: [{ type: 'text', text }] }],
  ...extra,
});

test('registers the simulated provider and one chat model without tool capability', async t => {
  const f = await fixture(t);
  assert.equal(f.registered.providers.length, 1);
  const { info, models } = f.registered.providers[0];
  assert.equal(info.id, 'simulated');
  assert.equal(info.package, 'aisdk:simulated');
  assert.equal(info.activation, 'enabled');
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'multi_reviewer');
  assert.equal(models[0].modelID, 'multi_reviewer');
  assert.equal(models[0].providerID, 'simulated');
  assert.equal(models[0].capabilities.tools, false);
  assert.deepEqual(models[0].capabilities.input, ['text']);
  assert.equal(models[0].enabled, true);
});

test('hooks are scoped to the simulated provider; requests carry kind and session headers', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.registered.aisdk.map(entry => [entry.name, entry.options]), [['sdk', { providerID: 'simulated' }]]);
  assert.deepEqual(f.registered.sessionHooks.map(entry => entry.name).sort(), ['model.request', 'retry']);
  for (const entry of f.registered.sessionHooks) assert.deepEqual(entry.options, { providerID: 'simulated' });

  const event = { model: { providerID: 'simulated' }, kind: 'primary', sessionID: 'ses_parent', headers: {} };
  await f.hook('model.request').callback(event);
  assert.equal(event.headers['x-simulated-kind'], 'primary');
  assert.equal(event.headers['x-simulated-session'], 'ses_parent');

  const other = { model: { providerID: 'rawroute' }, kind: 'primary', sessionID: 'ses_other', headers: {} };
  await f.hook('model.request').callback(other);
  assert.deepEqual(other.headers, {});

  const retry = { decision: { retry: true, delay: 1000 } };
  await f.hook('retry').callback(retry);
  assert.deepEqual(retry.decision, { retry: false });
});

test('primary requests run the fusion engine and stream the masked panel as assistant text', async t => {
  const f = await fixture(t);
  const parts = await collect((await f.model().doStream(primaryOptions('Review the diff.'))).stream);
  assert.deepEqual(parts.map(part => part.type), ['stream-start', 'text-start', 'text-delta', 'text-end', 'finish']);
  const text = parts.find(part => part.type === 'text-delta').delta;
  assert.ok(text.startsWith('◆ REVIEWS — ALL CONFIGURED REVIEWERS'));
  assert.ok(text.includes('## [Worker A] — REVIEW'));
  assert.ok(text.includes('## [Worker B] — REVIEW'));
  assert.ok(text.includes('review by ses_w1'));
  assert.ok(text.includes('review by ses_w2'));
  for (const secret of ['rawroute', 'gpt-peak', 'base-cat']) {
    assert.ok(!text.includes(secret), `simulated response must not reveal ${secret}`);
  }
  assert.deepEqual(parts.at(-1).finishReason, { unified: 'stop', raw: 'stop' });
  assert.deepEqual(parts.at(-1).usage.outputTokens, { total: 0, text: 0, reasoning: 0 });
  assert.deepEqual(f.sessionCalls.create.map(call => call.agent), ['reviewer', 'reviewer']);
  assert.deepEqual(f.sessionCalls.prompt.map(call => call.text), [buildWorkerPrompt('Review the diff.'), buildWorkerPrompt('Review the diff.')]);
});

test('utility requests get canned text and never fan out workers', async t => {
  const f = await fixture(t);
  for (const kind of ['title', 'compaction', 'generate']) {
    const parts = await collect((await f.model().doStream({
      headers: { 'x-simulated-kind': kind, 'x-simulated-session': 'ses_parent' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Review the diff.' }] }],
    })).stream);
    assert.ok(parts.some(part => part.type === 'text-delta' && part.delta.length > 0));
    assert.equal(parts.at(-1).finishReason.unified, 'stop');
  }
  assert.equal(f.sessionCalls.create.length, 0);
});

test('missing session header, empty prompt, and broken config surface as stream errors', async t => {
  const f = await fixture(t);
  const noSession = await collect((await f.model().doStream({
    headers: { 'x-simulated-kind': 'primary' },
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Review.' }] }],
  })).stream);
  assert.ok(noSession.some(part => part.type === 'error' && /session header/.test(part.error.message)));

  const empty = await collect((await f.model().doStream(primaryOptions('   '))).stream);
  assert.ok(empty.some(part => part.type === 'error' && /empty prompt/.test(part.error.message)));

  await writeFile(f.configURL, JSON.stringify({ workers: [] }));
  const broken = await collect((await f.model().doStream(primaryOptions('Review.'))).stream);
  assert.ok(broken.some(part => part.type === 'error' && /fusion:/.test(part.error.message)));
  assert.equal(broken.at(-1).finishReason.unified, 'error');
  assert.equal(f.sessionCalls.create.length, 0);
});

test('the simulated model only supports streaming', async t => {
  const f = await fixture(t);
  const model = f.model();
  assert.equal(model.specificationVersion, 'v3');
  assert.equal(model.provider, 'simulated');
  assert.equal(model.modelId, 'multi_reviewer');
  await assert.rejects(model.doGenerate({}), /only supports streaming/);
});