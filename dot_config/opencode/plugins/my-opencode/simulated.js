import { runFusion, PROVIDER_ID } from './fusion.js';
import { sanitizeErrorMessage } from './sanitize.js';

export { PROVIDER_ID };
export const MODEL_ID = 'multi_reviewer';
const AGENT_ID = 'multi_reviewer';
const KIND_HEADER = 'x-simulated-kind';
const SESSION_HEADER = 'x-simulated-session';

const ZERO_USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function textStream(text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: 'panel' });
        controller.enqueue({ type: 'text-delta', id: 'panel', delta: text });
        controller.enqueue({ type: 'text-end', id: 'panel' });
        controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: ZERO_USAGE });
        controller.close();
      },
    }),
  };
}

function latestUserText(prompt) {
  for (let index = prompt.length - 1; index >= 0; index--) {
    const message = prompt[index];
    if (message?.role !== 'user') continue;
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : (message.content ?? []);
    return content.filter(part => part.type === 'text').map(part => part.text).join('\n\n');
  }
  return '';
}

// The multi_reviewer "model": an in-process LanguageModelV3 whose primary
// requests run the fusion engine instead of calling any real model. Utility
// requests (title, compaction, generate) get canned text so they never fan out.
class SimulatedMultiReviewer {
  specificationVersion = 'v3';
  provider = PROVIDER_ID;
  modelId = MODEL_ID;

  constructor(ctx, configURL) {
    this.ctx = ctx;
    this.configURL = configURL;
  }

  async doGenerate() {
    throw new Error('simulated/multi_reviewer only supports streaming');
  }

  async doStream(options) {
    const headers = options.headers ?? {};
    const kind = headers[KIND_HEADER] ?? 'primary';
    if (kind === 'title') return textStream('multi_reviewer panel');
    if (kind !== 'primary') return textStream('Simulated multi_reviewer session: the review panel is the last assistant text.');
    const sessionID = headers[SESSION_HEADER];
    const prompt = latestUserText(options.prompt ?? []);

    // OpenCode 2.3.2 passes no abortSignal and interrupts by cancelling the
    // ReadableStream; own the abort lifecycle and stop writing once cancelled.
    const abort = new AbortController();
    const onOuterAbort = () => abort.abort();
    options.abortSignal?.addEventListener('abort', onOuterAbort, { once: true });
    // An already-aborted signal never replays its event.
    if (options.abortSignal?.aborted) abort.abort();
    let closed = false;
    let controller;
    const stream = new ReadableStream({
      start(value) { controller = value; },
      cancel() { closed = true; abort.abort(); },
    });
    const enqueue = part => {
      if (closed) return;
      try { controller.enqueue(part); } catch { closed = true; }
    };
    enqueue({ type: 'stream-start', warnings: [] });
    let counter = 0;
    const activity = text => {
      const id = `fusion-activity-${counter++}`;
      enqueue({ type: 'reasoning-start', id });
      enqueue({ type: 'reasoning-delta', id, delta: text });
      enqueue({ type: 'reasoning-end', id });
    };
    void (async () => {
      try {
        if (!sessionID) throw new Error('simulated/multi_reviewer request is missing the session header');
        if (!prompt.trim()) throw new Error('simulated/multi_reviewer received an empty prompt');
        const result = await runFusion(this.ctx, {
          sessionID,
          prompt,
          signal: abort.signal,
          onProgress: event => {
            if (event.type === 'panel-start') activity(`Fusion panel: ${event.workerCount} reviewer workers.`);
            else if (event.type === 'worker-start') activity(`Invoking ${event.alias}…`);
            else if (event.type === 'worker-end') activity(event.ok ? `${event.alias} finished.` : `${event.alias} failed: ${event.error}`);
          },
        }, this.configURL);
        enqueue({ type: 'text-start', id: 'panel' });
        enqueue({ type: 'text-delta', id: 'panel', delta: result.text });
        enqueue({ type: 'text-end', id: 'panel' });
        enqueue({
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: ZERO_USAGE,
          providerMetadata: { [PROVIDER_ID]: result.metadata },
        });
      } catch (error) {
        enqueue({ type: 'error', error: new Error(sanitizeErrorMessage(error)) });
        enqueue({ type: 'finish', finishReason: { unified: 'error', raw: 'error' }, usage: ZERO_USAGE });
      } finally {
        options.abortSignal?.removeEventListener('abort', onOuterAbort);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* consumer already cancelled */ }
        }
      }
    })();
    return { stream };
  }
}

export async function registerSimulated(ctx, configURL) {
  await ctx.provider.transform(editor => {
    editor.add({
      info: {
        id: PROVIDER_ID,
        name: 'Simulated',
        activation: 'enabled',
        package: `aisdk:${PROVIDER_ID}`,
        // Placeholder credential: the plugin supplies the model in-process and
        // never sends this key anywhere (same pattern as opencode-muse).
        settings: { apiKey: 'simulated' },
      },
      models: [{
        id: MODEL_ID,
        modelID: MODEL_ID,
        providerID: PROVIDER_ID,
        name: 'Multi Reviewer (simulated)',
        capabilities: { tools: false, input: ['text'], output: ['text'] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: 'active',
        enabled: true,
        limit: { context: 1_000_000, output: 131_072 },
      }],
    });
  });

  await ctx.aisdk.hook('sdk', event => {
    event.sdk = { languageModel: () => new SimulatedMultiReviewer(ctx, configURL) };
  }, { providerID: PROVIDER_ID });

  await ctx.session.hook('model.request', event => {
    if (event.model.providerID !== PROVIDER_ID) return;
    event.headers[KIND_HEADER] = event.kind;
    event.headers[SESSION_HEADER] = event.sessionID;
  }, { providerID: PROVIDER_ID });

  // Retrying a failed panel would duplicate every worker run; report the failure instead.
  await ctx.session.hook('retry', event => {
    event.decision = { retry: false };
  }, { providerID: PROVIDER_ID });

  // Untitled top-level multi_reviewer sessions schedule automatic title
  // generation with the configured title agent model (a real provider). The
  // hook is unscoped and keys off the owning session's agent so the canned
  // title intercepts that request before any model call.
  await ctx.session.hook('title', async event => {
    try {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (session?.agent === AGENT_ID) event.result = 'multi_reviewer panel';
    } catch { /* missing session: leave title generation alone */ }
  });

  // Compaction validates summary headings and may select the compaction
  // agent's real model; the session-level result hook is consumed upstream
  // before any model call, so multi_reviewer never reaches a provider.
  await ctx.session.hook('compaction', async event => {
    try {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (session?.agent === AGENT_ID) {
        event.result = { summary: 'Simulated multi_reviewer session: the review panel is the last assistant text.' };
      }
    } catch { /* missing session: leave compaction alone */ }
  });
}