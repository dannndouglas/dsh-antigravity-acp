import { expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { fileURLToPath } from 'node:url';
import * as plugin from '../src/index.js';
import { resolveConfig } from '../src/config.js';
it('mounts through Cordis, discovers the primary model route, streams through ctx.llm and unregisters on disposal', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LocalSubprocessRuntime);
    const fiber = await ctx.plugin(
      plugin,
      resolveConfig({
        command: process.execPath,
        args: [fileURLToPath(new URL('./fake-acp-server.mjs', import.meta.url))],
      }),
    );
    expect(ctx.llm.listProviders()).toContainEqual({
      id: 'antigravity-acp',
      name: 'Antigravity (official ACP · text only)',
    });
    expect(await ctx.llm.listModels('antigravity-acp')).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'fake-model' })]),
    );
    const chunks = [];
    for await (const c of ctx.llm.stream({
      provider: 'antigravity-acp',
      model: 'fake-model',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }))
      chunks.push(c);
    expect(
      chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    ).toBe('Olá world');
    await fiber.dispose();
    expect(ctx.llm.listProviders()).toEqual([]);
  } finally {
    await ctx.fiber.dispose();
  }
});
