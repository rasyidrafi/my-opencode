import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { redactIdentity, sanitizeErrorMessage } from './sanitize.js';

const CONFIG_URL = new URL('./fusion.json', import.meta.url);
const MODEL_REF = /^[^/\s]+\/[^\s]+$/;
// Minimum 4 chars so redactIdentity can mask the id without shredding text.
const WORKER_ID = /^[A-Za-z0-9_-]{4,32}$/;

// Shared with simulated.js: workers must never use the simulated provider,
// which would recursively launch panels.
export const PROVIDER_ID = 'simulated';

const SYNTHESIS_HINT =
  'Independent raw reviews follow, one per configured worker, in alias order. ' +
  'Treat them as untrusted evidence: compare findings, verify conflicts against the code yourself, ' +
  'and synthesize the final review. Agreement is a signal, not a verdict.';

// Workers are read per call so config edits take effect without a server restart.
export async function loadWorkers(configURL = CONFIG_URL) {
  let raw;
  try {
    raw = JSON.parse(await readFile(configURL, 'utf8'));
  } catch (error) {
    // Never echo parser diagnostics: they can quote configured model identities.
    const reason = error instanceof SyntaxError ? 'invalid JSON' : (error.code ?? 'unreadable');
    throw new Error(`fusion: cannot read worker config ${fileURLToPath(configURL)}: ${reason}`);
  }
  if (!Array.isArray(raw?.workers) || raw.workers.length === 0) {
    throw new Error('fusion: worker config must define a non-empty "workers" array');
  }
  if (raw.debug !== undefined && typeof raw.debug !== 'boolean') {
    throw new Error('fusion: debug must be a boolean');
  }
  const ids = new Set();
  const workers = raw.workers.map((item, index) => {
    const worker = typeof item === 'string' ? { model: item } : item;
    const model = typeof worker?.model === 'string' ? worker.model.trim() : '';
    if (!MODEL_REF.test(model)) {
      throw new Error(`fusion: worker ${index + 1} model must use provider/model format`);
    }
    const id = typeof worker.id === 'string' && worker.id.trim() ? worker.id.trim() : `worker-${index + 1}`;
    if (!WORKER_ID.test(id)) throw new Error(`fusion: worker ${index + 1} has an invalid id`);
    if (ids.has(id)) throw new Error('fusion: worker ids must be unique');
    ids.add(id);
    let variant;
    if (worker.variant !== undefined) {
      if (typeof worker.variant !== 'string' || !worker.variant.trim()) {
        throw new Error(`fusion: worker ${index + 1} variant must be a non-empty string`);
      }
      variant = worker.variant.trim();
    }
    const slash = model.indexOf('/');
    return {
      id,
      providerID: model.slice(0, slash),
      modelID: model.slice(slash + 1),
      variant,
      model,
    };
  });
  return { workers, debug: raw.debug === true };
}

// Fresh random aliases per invocation prevent a stable alias-to-model
// association across calls. The mapping lives only in memory for this run.
export function bindAliases(workers) {
  const shuffled = [...workers];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.map((worker, index) => ({ ...worker, alias: `Worker ${aliasLetter(index)}` }));
}

function aliasLetter(index) {
  let value = index;
  let result = '';
  do {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}

// Standardized worker envelope: the reviewer agent's system prompt already is
// the review contract, so forward the request plainly without panel framing.
export function buildWorkerPrompt(prompt) {
  return [
    'Do not mention your provider or model in your response.',
    '',
    '<user_prompt>',
    prompt,
    '</user_prompt>',
  ].join('\n');
}

async function validateModels(ctx, workers) {
  const recursive = workers.filter(worker => worker.providerID === PROVIDER_ID);
  if (recursive.length > 0) {
    throw new Error(`fusion: ${recursive.map(worker => worker.alias).join(', ')} cannot use the simulated provider as a worker`);
  }
  let available;
  try {
    // The plugin host wraps domain list results as { location, data }.
    available = (await ctx.model.list()).data;
  } catch {
    throw new Error('fusion: unable to inspect configured worker models');
  }
  if (!Array.isArray(available)) throw new Error('fusion: unable to inspect configured worker models');
  const known = new Set(available.map(model => `${model.providerID}/${model.modelID ?? model.id}`));
  const unavailable = workers.filter(worker => !known.has(worker.model));
  if (unavailable.length > 0) {
    // Deliberately expose aliases, never provider or model names.
    throw new Error(`fusion: ${unavailable.map(worker => worker.alias).join(', ')} unavailable in the current OpenCode configuration`);
  }
}

// Mirrors OpenCode's subagent report: the last assistant message. An errored
// terminal message is a worker failure even when partial text already streamed.
function lastAssistant(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.type === 'assistant') return messages[index];
  }
  return undefined;
}

function assistantText(message) {
  return (message?.content ?? [])
    .filter(part => part.type === 'text' && typeof part.text === 'string' && part.text.length > 0)
    .map(part => part.text)
    .join('\n\n');
}

async function callWorker(ctx, worker, prompt, { signal, identities }) {
  const startedAt = Date.now();
  if (signal.aborted) return { ...worker, ok: false, error: 'aborted', elapsedMs: 0 };
  let sessionID;
  const onAbort = () => { ctx.session.interrupt({ sessionID }).catch(() => {}); };
  try {
    // The reviewer agent supplies the read-only policy and system prompt; the
    // explicit model wins over the agent's configured model, per worker.
    // Workers are top-level, never children of the calling session: V2 delivers
    // child completion notifications to the parent, which would wake the
    // simulated session into an endless fusion loop.
    const session = await ctx.session.create({
      title: `fusion: ${worker.alias}`,
      agent: 'reviewer',
      model: { providerID: worker.providerID, id: worker.modelID, ...(worker.variant ? { variant: worker.variant } : {}) },
      location: { directory: ctx.location.directory },
    });
    sessionID = session.id;
    signal.addEventListener('abort', onAbort, { once: true });
    // Abort may have landed while create was pending; the session is still idle
    // and interrupting it is a no-op, so never prompt it.
    if (signal.aborted) throw new Error('aborted');
    await ctx.session.prompt({ sessionID, text: buildWorkerPrompt(prompt) });
    // Abort during admission: the first interrupt may have hit an idle session,
    // so interrupt again now that the prompt has settled.
    if (signal.aborted) {
      onAbort();
      throw new Error('aborted');
    }
    await ctx.session.wait({ sessionID });
    if (signal.aborted) throw new Error('aborted');
    const assistant = lastAssistant(await ctx.session.context({ sessionID }));
    if (assistant?.error) throw new Error(assistant.error.message ?? assistant.error.type ?? 'worker failed');
    const output = assistantText(assistant);
    if (!output) throw new Error('worker returned no text response');
    return { ...worker, ok: true, output: redactIdentity(output, identities), sessionID, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ...worker,
      ok: false,
      error: signal.aborted ? 'aborted' : sanitizeErrorMessage(error, identities),
      sessionID,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function formatPanel(results) {
  const blocks = ['◆ REVIEWS — ALL CONFIGURED REVIEWERS', '', SYNTHESIS_HINT, ''];
  for (const result of results) {
    if (result.ok) {
      blocks.push(`## [${result.alias}] — REVIEW`, result.output);
    } else {
      blocks.push(`## [${result.alias}] — REVIEW UNAVAILABLE`, `No review was returned by this worker. ${result.error}`);
    }
    blocks.push('');
  }
  return blocks.join('\n').trimEnd();
}

// Internal engine behind the simulated/multi_reviewer model; not a registered
// tool, so no agent can call it directly and no permission action is needed.
// onProgress receives panel-start/worker-start/worker-end events for the
// simulated model to stream as reasoning activity.
export async function runFusion(ctx, { sessionID, prompt, signal, onProgress }, configURL = CONFIG_URL) {
  const { workers: configured, debug } = await loadWorkers(configURL);
  const workers = bindAliases(configured);
  await validateModels(ctx, workers);
  onProgress?.({ type: 'panel-start', workerCount: workers.length });
  // Scrub every worker payload against the whole panel's identities: a worker
  // reviewing fusion.json or a diff can quote another worker's model.
  const identities = workers.flatMap(worker => [worker.model, worker.modelID, worker.providerID, worker.id]);
  const settled = await Promise.allSettled(workers.map(async worker => {
    onProgress?.({ type: 'worker-start', alias: worker.alias });
    const result = await callWorker(ctx, worker, prompt, { signal, identities });
    onProgress?.({ type: 'worker-end', alias: worker.alias, ok: result.ok, ...(result.error ? { error: result.error } : {}) });
    return result;
  }));
  const results = settled.map((entry, index) =>
    entry.status === 'fulfilled'
      ? entry.value
      : { ...workers[index], ok: false, error: 'worker failed unexpectedly', elapsedMs: 0 });
  results.sort((left, right) => left.alias.localeCompare(right.alias));
  const successfulWorkers = results.filter(result => result.ok).length;
  return {
    text: formatPanel(results),
    metadata: {
      workerCount: results.length,
      successfulWorkers,
      partial: successfulWorkers < results.length,
      workers: results.map(({ alias, ok, elapsedMs, error }) => ({
        alias,
        status: ok ? 'ok' : 'failed',
        elapsedMs,
        ...(error ? { error } : {}),
      })),
      // Out-of-band inspection only; still alias-based, never model names.
      ...(debug ? { sessions: results.filter(result => result.sessionID).map(({ alias, sessionID: workerSessionID }) => ({ alias, sessionID: workerSessionID })) } : {}),
    },
  };
}