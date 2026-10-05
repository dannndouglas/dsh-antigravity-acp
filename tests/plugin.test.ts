import { expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { fileURLToPath } from 'node:url';
import * as plugin from '../src/index.js';
import { resolveConfig } from '../src/config.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distribution } from '../src/acp/installer.js';
import { zipFixture } from './zip-fixture.js';
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
      name: 'Antigravity (official ACP)',
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
it('works with zero plugin configuration: automatic download, Google authentication and first chat', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-zero-config-'));
  const ctx = new Context();
  const { command } = distribution();
  vi.stubEnv('DSH_HOME', home);
  vi.stubEnv('AGY_ACP_BIN', '');
  const download = vi.fn(
    async () =>
      new Response(
        new Uint8Array(
          zipFixture([{ name: command }, { name: 'helper', text: 'whole distribution' }]),
        ),
      ),
  );
  vi.stubGlobal('fetch', download);
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(LocalSubprocessRuntime);
    const runtime = ctx.subprocess,
      spawn = runtime.spawn.bind(runtime);
    vi.spyOn(runtime, 'resolveExecutable').mockImplementation(async (name) => {
      if (name.startsWith(home) && (await readFile(name, 'utf8')) === 'fixture') return name;
      throw Error('no manually installed binary');
    });
    vi.spyOn(runtime, 'spawn').mockImplementation((options) => {
      expect(options.argv[0]).toContain(home);
      return spawn({
        ...options,
        argv: [
          process.execPath,
          fileURLToPath(new URL('./fake-acp-server.mjs', import.meta.url)),
          'auth',
        ],
      });
    });
    await ctx.plugin(plugin); // No command, environment path, model or login setup.
    const models = await ctx.llm.listModels('antigravity-acp');
    expect(models[0]?.id).toBe('server-default'); // Discovery doesn't launch browser auth.
    const chunks = [];
    for await (const chunk of ctx.llm.stream({
      provider: 'antigravity-acp',
      model: 'server-default',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }))
      chunks.push(chunk);
    expect(
      chunks
        .filter((c) => c.type === 'text-delta')
        .map((c) => c.text)
        .join(''),
    ).toBe('Olá world');
    expect(download).toHaveBeenCalledTimes(1);
    expect((await ctx.llm.listModels('antigravity-acp'))[0]?.id).toBe('fake-model');
  } finally {
    await ctx.fiber.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(home, { recursive: true, force: true });
  }
});
