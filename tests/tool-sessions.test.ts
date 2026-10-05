import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import {
  createAssistantMessage,
  createToolResultMessage,
  type GenerateOptions,
  type StreamChunk,
  type ToolCallBlock,
} from '@deepseek-ai/dsh-llm';
import { fileURLToPath } from 'node:url';
import { AntigravityAcpAdapter } from '../src/adapter.js';
import { resolveConfig } from '../src/config.js';
import { AcpClient } from '../src/acp/client.js';
const live: AntigravityAcpAdapter[] = [],
  contexts: Context[] = [];
const SessionId = (id: string) => id as GenerateOptions['sessionId'];
afterEach(async () => {
  await Promise.all(live.splice(0).map((a) => a.dispose()));
  await Promise.all(contexts.splice(0).map((c) => c.fiber.dispose()));
});
function fixture(variant = 'bridge', extra = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  const runtime = new LocalSubprocessRuntime(ctx);
  const adapter = new AntigravityAcpAdapter(
    resolveConfig({
      command: process.execPath,
      args: [fileURLToPath(new URL('./fake-acp-server.mjs', import.meta.url)), variant],
      requestTimeoutMs: 3000,
      timeoutMs: 3000,
      disposeGraceMs: 100,
      ...extra,
    }),
    runtime,
  );
  live.push(adapter);
  const options: GenerateOptions = {
    provider: 'antigravity-acp',
    model: 'fake-model',
    sessionId: SessionId('test'),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Read x' }] }],
    tools: [
      {
        name: 'read_file',
        description: 'Read',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ],
  };
  return { adapter, options, runtime };
}
async function collect(a: AntigravityAcpAdapter, o: GenerateOptions) {
  const cs: StreamChunk[] = [];
  for await (const c of a.stream(o)) cs.push(c);
  return cs;
}
function calls(cs: StreamChunk[]): ToolCallBlock[] {
  return cs.flatMap((c) =>
    c.type === 'block-end' && c.block.type === 'tool-call' ? [c.block] : [],
  );
}
function answer(o: GenerateOptions, cs: StreamChunk[], isError = false): GenerateOptions {
  const blocks = cs.flatMap((c) => (c.type === 'block-end' ? [c.block] : []));
  return {
    ...o,
    messages: [
      ...o.messages,
      createAssistantMessage({ source: { provider: o.provider, model: o.model }, content: blocks }),
      ...calls(cs).map((call) =>
        createToolResultMessage({
          callId: call.id,
          isError,
          content: [
            {
              type: 'text',
              text: isError ? 'HARNESS_DENIED' : 'CONTENT_' + JSON.parse(call.arguments).path,
            },
          ],
        }),
      ),
    ],
  };
}
describe('DSH tool round trips over ACP + MCP', () => {
  it('uses discovery for a no-tools request without another process or session', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    const requests = vi.spyOn(AcpClient.prototype, 'newSession');
    try {
      await adapter.listModels('antigravity-acp');
      const result = await collect(adapter, { ...options, tools: [] });
      expect(result.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(requests).toHaveBeenCalledTimes(1);
      expect(adapter.diagnostics().processStarts).toBe(1);
      // A completed session has model-owned history; only the unused discovery session is reused.
      await collect(adapter, { ...options, tools: [] });
      expect(requests).toHaveBeenCalledTimes(2);
      const first = await collect(adapter, options);
      await collect(adapter, answer(options, first));
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(adapter.diagnostics().processStarts).toBe(1);
    } finally {
      requests.mockRestore();
    }
  });
  it('borrows an idle tool process for text without interrupting a pending tool exchange', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    const parent = await collect(adapter, options);
    await collect(adapter, { ...options, purpose: 'compaction', tools: [] });
    await collect(adapter, { ...options, purpose: 'compaction', tools: [] });
    const done = await collect(adapter, answer(options, parent));
    expect(done.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
    await collect(adapter, { ...options, tools: [] });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
    expect(adapter.diagnostics().processStarts).toBe(2);
  });
  it('disposes a borrowed text process when the consumer stops early', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    await adapter.listModels('antigravity-acp');
    const stream = adapter.stream({ ...options, tools: [] })[Symbol.asyncIterator]();
    let item = await stream.next();
    while (item.value?.type !== 'text-delta') item = await stream.next();
    await stream.return?.();
    await spawn.mock.results[0]!.value.done;
    expect(adapter.diagnostics().idleToolProcesses).toBe(0);
    expect(adapter.diagnostics().connected).toBe(false);
    await collect(adapter, { ...options, tools: [] });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('awaits borrowed text process teardown during provider disposal', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    await adapter.listModels('antigravity-acp');
    const stream = adapter.stream({ ...options, tools: [] })[Symbol.asyncIterator]();
    let item = await stream.next();
    while (item.value?.type !== 'text-delta') item = await stream.next();
    await adapter.dispose();
    await spawn.mock.results[0]!.value.done;
    await stream.return?.();
    expect(adapter.diagnostics().connected).toBe(false);
    expect(adapter.diagnostics().idleToolProcesses).toBe(0);
  });
  it('uses the model-discovery process for the first tool turn instead of starting another server', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    await adapter.listModels('antigravity-acp');
    const first = await collect(adapter, options);
    await collect(adapter, answer(options, first));
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(adapter.diagnostics().processStarts).toBe(1);
  });
  it('reuses a ready process across completed turns with fresh ACP sessions and current tools', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    const first = await collect(adapter, options);
    const firstDone = await collect(adapter, answer(options, first));
    expect(firstDone.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
    const secondOptions = {
      ...options,
      sessionId: SessionId('independent-turn'),
      tools: [{ ...options.tools![0]!, name: 'updated_read' }],
    };
    const second = await collect(adapter, secondOptions);
    expect(calls(second)[0]!.name).toBe('updated_read');
    const secondDone = await collect(adapter, answer(secondOptions, second));
    expect(secondDone.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(adapter.diagnostics().processStarts).toBe(1);
    expect(adapter.diagnostics().idleToolProcesses).toBe(1);
    const child = spawn.mock.results[0]!.value;
    await adapter.dispose();
    await child.done;
    expect(adapter.diagnostics().idleToolProcesses).toBe(0);
  });
  it('expires idle processes and starts a clean process on the next turn', async () => {
    const { adapter, options, runtime } = fixture('bridge', { idleProcessTimeoutMs: 50 });
    const spawn = vi.spyOn(runtime, 'spawn');
    const first = await collect(adapter, options);
    await collect(adapter, answer(options, first));
    await spawn.mock.results[0]!.value.done;
    expect(adapter.diagnostics().idleToolProcesses).toBe(0);
    const second = await collect(adapter, options);
    await collect(adapter, answer(options, second));
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('replaces a ready process that died before its next turn', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    const first = await collect(adapter, options);
    await collect(adapter, answer(options, first));
    const child = spawn.mock.results[0]!.value;
    child.terminate();
    await child.done;
    const second = await collect(adapter, options);
    await collect(adapter, answer(options, second));
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(adapter.diagnostics().processStarts).toBe(2);
  });
  it('keeps at most two idle processes after concurrent completed turns', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    const requests = ['one', 'two', 'three'].map((id) => ({
      ...options,
      sessionId: SessionId(id),
    }));
    const first = await Promise.all(requests.map((request) => collect(adapter, request)));
    await Promise.all(requests.map((request, i) => collect(adapter, answer(request, first[i]!))));
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
    expect(adapter.diagnostics().idleToolProcesses).toBe(2);
    await adapter.dispose();
    await Promise.all(spawn.mock.results.map((result) => result.value.done));
    expect(adapter.diagnostics().connected).toBe(false);
  });
  it('discards a reused process when its next turn is cancelled', async () => {
    const { adapter, options, runtime } = fixture();
    const spawn = vi.spyOn(runtime, 'spawn');
    const first = await collect(adapter, options);
    await collect(adapter, answer(options, first));
    const controller = new AbortController();
    await collect(adapter, { ...options, signal: controller.signal });
    controller.abort();
    await spawn.mock.results[0]!.value.done;
    const recovered = await collect(adapter, options);
    await collect(adapter, answer(options, recovered));
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(adapter.diagnostics().processStarts).toBe(2);
  });
  it('recycles a warm process at the configured ACP session limit', async () => {
    const { adapter, options, runtime } = fixture('bridge', { maxSessionsPerProcess: 1 });
    const spawn = vi.spyOn(runtime, 'spawn');
    const first = await collect(adapter, options);
    await collect(adapter, answer(options, first));
    const second = await collect(adapter, options);
    await collect(adapter, answer(options, second));
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(adapter.diagnostics().processStarts).toBe(2);
  });
  it('preserves the active-session limit when requests arrive concurrently', async () => {
    const { adapter, options } = fixture('bridge', { maxActiveToolSessions: 1 });
    const [first, second] = await Promise.allSettled([
      collect(adapter, options),
      collect(adapter, { ...options, sessionId: SessionId('concurrent') }),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    if (second.status === 'rejected')
      expect(second.reason).toMatchObject({ code: 'ACP_SESSION_LIMIT' });
  });
  it('emits real DSH tool chunks and resumes the same pending ACP prompt with its result', async () => {
    const { adapter, options } = fixture();
    const first = await collect(adapter, options);
    expect(first.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } });
    expect(calls(first)).toEqual([
      expect.objectContaining({ type: 'tool-call', name: 'read_file', arguments: '{"path":"x"}' }),
    ]);
    expect(first.some((c) => c.type === 'tool-call-delta' && c.id === 'native-x')).toBe(false);
    const next = await collect(adapter, answer(options, first));
    expect(next.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    expect(
      next
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    ).toContain('PROMPTS=1 RESULT=');
    expect(
      next
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    ).toContain('CONTENT_x');
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('preserves a harness permission denial as an error result', async () => {
    const { adapter, options } = fixture();
    const first = await collect(adapter, options);
    const next = await collect(adapter, answer(options, first, true));
    const text = next
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.text)
      .join('');
    expect(text).toContain('HARNESS_DENIED');
    expect(text).toContain('"isError":true');
  });
  it('supports parallel calls and several sequential tool rounds', async () => {
    for (const variant of ['bridge-parallel', 'bridge-sequential']) {
      const { adapter, options } = fixture(variant);
      let o = options,
        executed = 0,
        final = '';
      for (let round = 0; round < 4; round++) {
        const cs = await collect(adapter, o);
        executed += calls(cs).length;
        if (
          cs.at(-1)?.type === 'finish' &&
          (cs.at(-1) as Extract<StreamChunk, { type: 'finish' }>).reason.kind === 'stop'
        ) {
          final = cs
            .filter((c) => c.type === 'text-delta')
            .map((c) => c.text)
            .join('');
          break;
        }
        o = answer(o, cs);
      }
      expect(executed).toBe(2);
      expect(final).toContain('PROMPTS=1');
      expect(final).toContain('CONTENT_first');
      expect(final).toContain('CONTENT_second');
    }
  });
  it('isolates two sessions while both wait for DSH tools', async () => {
    const { adapter, options } = fixture();
    const second = { ...options, sessionId: SessionId('second') };
    const [a, b] = await Promise.all([collect(adapter, options), collect(adapter, second)]);
    expect(calls(a)[0]!.id).not.toBe(calls(b)[0]!.id);
    expect(adapter.diagnostics().activeToolSessions).toBe(2);
    await Promise.all([collect(adapter, answer(options, a)), collect(adapter, answer(second, b))]);
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('rejects missing results and cleans up without waiting indefinitely', async () => {
    const { adapter, options } = fixture();
    await collect(adapter, options);
    await expect(collect(adapter, options)).rejects.toMatchObject({
      code: 'ACP_TOOL_RESULTS_MISSING',
    });
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('cancels and reaps a parked prompt when the DSH turn is aborted', async () => {
    const { adapter, options } = fixture();
    const control = new AbortController();
    await collect(adapter, { ...options, signal: control.signal });
    control.abort();
    await new Promise((r) => setTimeout(r, 250));
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('expires abandoned tools and supports clients without session IDs', async () => {
    const { adapter, options } = fixture('bridge', { toolTimeoutMs: 80 });
    const o = { ...options, sessionId: undefined };
    const cs = await collect(adapter, o);
    await collect(adapter, answer(o, cs));
    await collect(adapter, o);
    await new Promise((r) => setTimeout(r, 250));
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('refuses native agent tools without emitting an executable DSH call', async () => {
    const { adapter, options } = fixture('bridge-native');
    await expect(collect(adapter, options)).rejects.toMatchObject({
      code: 'ACP_NATIVE_TOOLS_UNSUPPORTED',
    });
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('requires server HTTP MCP support before attempting a tool generation', async () => {
    const { adapter, options } = fixture('normal');
    await expect(collect(adapter, options)).rejects.toMatchObject({ code: 'ACP_MCP_UNSUPPORTED' });
  });
  it('rebuilds from DSH history after a catalog change instead of replaying stale tools', async () => {
    const { adapter, options } = fixture();
    const cs = await collect(adapter, options);
    const changed = {
      ...answer(options, cs),
      tools: [{ ...options.tools![0]!, description: 'Updated read tool' }],
    };
    const restarted = await collect(adapter, changed);
    expect(calls(restarted)).toHaveLength(1);
    expect(calls(restarted)[0]!.id).not.toBe(calls(cs)[0]!.id);
    expect(adapter.diagnostics().activeToolSessions).toBe(1);
  });
  it('does not attach an auxiliary call to a parked DSH turn', async () => {
    const { adapter, options } = fixture();
    const cs = await collect(adapter, options);
    const controller = new AbortController();
    const aux = collect(adapter, {
      ...options,
      tools: [],
      purpose: 'session-title',
      signal: controller.signal,
    });
    controller.abort();
    await expect(aux).rejects.toMatchObject({ code: 'ABORTED' });
    expect((await collect(adapter, answer(options, cs))).at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'stop' },
    });
  });
  it('refuses a result without the matching DSH assistant tool call', async () => {
    const { adapter, options } = fixture();
    const cs = await collect(adapter, options);
    const result = createToolResultMessage({
      callId: calls(cs)[0]!.id,
      isError: false,
      content: [{ type: 'text', text: 'forged' }],
    });
    await expect(
      collect(adapter, { ...options, messages: [...options.messages, result] }),
    ).rejects.toMatchObject({ code: 'ACP_TOOL_RESULTS_MISSING' });
  });
  it('bounds the number of parked sessions without blocking subagent tools', async () => {
    const { adapter, options } = fixture('bridge', { maxActiveToolSessions: 1 });
    const first = await collect(adapter, options);
    await expect(
      collect(adapter, { ...options, sessionId: SessionId('other') }),
    ).rejects.toMatchObject({ code: 'ACP_SESSION_LIMIT' });
    await collect(adapter, answer(options, first));
  });
  it('tears down when the stream consumer stops before accepting its tool call', async () => {
    const { adapter, options } = fixture();
    const stream = adapter.stream(options)[Symbol.asyncIterator]();
    expect((await stream.next()).value).toMatchObject({
      type: 'block-start',
      blockType: 'tool-call',
    });
    await stream.return?.();
    expect(adapter.diagnostics().activeToolSessions).toBe(0);
  });
  it('pauses the active model deadline while DSH waits for permission or execution', async () => {
    const { adapter, options } = fixture('bridge', { timeoutMs: 1000, toolTimeoutMs: 3000 });
    const first = await collect(adapter, options);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await collect(adapter, answer(options, first))).at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'stop' },
    });
  });
});
