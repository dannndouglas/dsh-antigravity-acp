import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { createMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { fileURLToPath } from 'node:url';
import { AntigravityAcpAdapter } from '../src/adapter.js';
import { resolveConfig } from '../src/config.js';
const live: AntigravityAcpAdapter[] = [];
const contexts: Context[] = [];
function adapter(variant = 'normal', extra = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  const runtime = new LocalSubprocessRuntime(ctx);
  const a = new AntigravityAcpAdapter(
    resolveConfig({
      command: process.execPath,
      args: [fileURLToPath(new URL('./fake-acp-server.mjs', import.meta.url)), variant],
      requestTimeoutMs: 1000,
      timeoutMs: 3000,
      cancelGraceMs: 100,
      disposeGraceMs: 100,
      ...extra,
    }),
    runtime,
  );
  live.push(a);
  return a;
}
const options = (): GenerateOptions => ({
  provider: 'antigravity-acp',
  model: 'fake-model',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
});
const collect = async (a: AntigravityAcpAdapter, o = options()) => {
  const chunks: StreamChunk[] = [];
  for await (const c of a.stream(o)) chunks.push(c);
  return chunks;
};
afterEach(async () => {
  await Promise.all(live.splice(0).map((a) => a.dispose()));
  await Promise.all(contexts.splice(0).map((c) => c.fiber.dispose()));
});
describe('official ACP provider contract (fake server)', () => {
  it('discovers server model IDs and registers text-only metadata', async () => {
    const a = adapter();
    expect(await a.listModels('antigravity-acp')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fake-model', inputModalities: ['text'] }),
      ]),
    );
  });
  it('streams split NDJSON and UTF-8, maps reasoning and block indexes, and finishes last', async () => {
    const chunks = await collect(adapter());
    expect(
      chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    ).toBe('Olá world');
    expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'Thinking' });
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } });
    expect(chunks.some((c) => c.type === 'usage')).toBe(false); // usage_update is context size, not billable tokens.
    expect(chunks.filter((c) => c.type === 'block-end')).toHaveLength(2);
  });
  it('delivers first delta before prompt RPC finishes', async () => {
    const stream = adapter().stream(options())[Symbol.asyncIterator]();
    let first = await stream.next();
    while (first.value?.type !== 'text-delta') first = await stream.next();
    expect(first.value).toMatchObject({ type: 'text-delta', text: 'Olá ' });
    await stream.return?.();
  });
  it('sends all DSH history once in a fresh session per generation', async () => {
    const a = adapter('echo');
    const o = options();
    o.system = 'System instructions';
    o.messages = [
      createMessage({
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'OLD_USER' }],
      }),
      createMessage({
        role: 'assistant',
        source: { kind: 'model', provider: o.provider, model: o.model },
        content: [{ type: 'text', text: 'OLD_ASSISTANT' }],
      }),
      ...o.messages,
    ];
    const texts = (await collect(a, o))
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.text)
      .join('');
    expect(texts.match(/OLD_USER/g)).toHaveLength(1);
    expect(texts).toContain('OLD_ASSISTANT');
    expect(texts).toContain('System instructions');
    await collect(a, options());
    expect(a.diagnostics().generations).toBe(2);
    expect(a.diagnostics().processStarts).toBe(1);
  });
  it('correlates and serializes concurrent generations without cross-session text', async () => {
    const a = adapter();
    const results = await Promise.all([collect(a), collect(a), collect(a)]);
    expect(
      results.every(
        (cs) =>
          cs
            .filter((c) => c.type === 'text-delta')
            .map((c) => c.text)
            .join('') === 'Olá world',
      ),
    ).toBe(true);
    expect(a.diagnostics().processStarts).toBe(1);
  });
  it('reports JSON-RPC error safely', async () => {
    await expect(collect(adapter('error'))).rejects.toMatchObject({ code: 'ACP_INVALID_PARAMS' });
  });
  it('reports disconnect and reconnects on the next request', async () => {
    const a = adapter('disconnect');
    await expect(collect(a)).rejects.toMatchObject({ code: 'ACP_DISCONNECTED' });
    await expect(collect(a)).rejects.toMatchObject({ code: 'ACP_DISCONNECTED' });
    expect(a.diagnostics().processStarts).toBe(2);
  });
  it('bounds prompt timeout and initialization timeout', async () => {
    await expect(collect(adapter('hang', { timeoutMs: 80 }))).rejects.toMatchObject({
      code: 'ACP_TIMEOUT',
    });
    await expect(collect(adapter('init-hang', { requestTimeoutMs: 80 }))).rejects.toMatchObject({
      code: 'ACP_TIMEOUT',
    });
  });
  it('cancels, reaps an uncooperative process, and supports another turn', async () => {
    const a = adapter('ignore-cancel');
    const control = new AbortController();
    const o = { ...options(), signal: control.signal };
    const pending = (async () => {
      for await (const chunk of a.stream(o)) {
        if (chunk.type === 'text-delta') control.abort();
      }
    })();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(a.diagnostics().connected).toBe(false);
    await collect(a, {
      ...options(),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'RECOVER' }] }],
    });
    expect(a.diagnostics().processStarts).toBe(2);
  });
  it('rejects native ACP tool activity instead of fabricating DSH calls', async () => {
    await expect(collect(adapter('tools'))).rejects.toMatchObject({
      code: 'ACP_NATIVE_TOOLS_UNSUPPORTED',
    });
  });
  it('denies permission requests and explains text-only limitation', async () => {
    await expect(collect(adapter('permission'))).rejects.toMatchObject({
      code: 'ACP_NATIVE_TOOLS_UNSUPPORTED',
    });
  });
  it('refuses unsupported sampling options, images, strict tools and protocol versions', async () => {
    const a = adapter();
    await expect(collect(a, { ...options(), maxTokens: 10 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
    });
    await expect(collect(a, { ...options(), stop: ['stop'] })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
    });
    await expect(
      collect(adapter('normal', { toolPolicy: 'reject' }), {
        ...options(),
        tools: [{ name: 'test', description: 'Test', parameters: {} }],
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' });
    await expect(collect(adapter('v2'))).rejects.toMatchObject({ code: 'ACP_VERSION_MISMATCH' });
  });
  it('reuses server-owned auth; performs oauth-personal only on auth_required', async () => {
    const a = adapter('auth');
    await collect(a);
    expect(a.diagnostics().authentications).toBe(1);
    await collect(a);
    expect(a.diagnostics().authentications).toBe(1);
  });
  it('maps refusal to an error finish', async () => {
    expect((await collect(adapter('refusal'))).at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'ACP_REFUSAL' } },
    });
  });
  it('aborts a queued call without cancelling the running session', async () => {
    const a = adapter();
    const running = collect(a);
    const signal = new AbortController();
    const queued = collect(a, { ...options(), signal: signal.signal });
    signal.abort();
    await expect(queued).rejects.toMatchObject({ code: 'ABORTED' });
    expect((await running).at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } });
    expect(a.diagnostics().processStarts).toBe(1);
  });
  it('recycles retained sessions only between generations', async () => {
    const a = adapter('normal', { maxSessionsPerProcess: 1 });
    await collect(a);
    await collect(a);
    expect(a.diagnostics().processStarts).toBe(2);
  });
  it('rejects unavailable models before prompting', async () => {
    await expect(
      collect(adapter(), { ...options(), model: 'missing-model' }),
    ).rejects.toMatchObject({ code: 'ACP_INVALID_MODEL' });
  });
  it('checks images and unsupported sampling before starting a process', async () => {
    const a = adapter();
    await expect(collect(a, { ...options(), temperature: 0.5 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
    });
    expect(a.diagnostics().processStarts).toBe(0);
  });
  it('never includes remote JSON-RPC error message text in public errors', async () => {
    const a = adapter('error');
    try {
      await collect(a);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(String(error)).not.toContain('secret test credential');
    }
  });
});
