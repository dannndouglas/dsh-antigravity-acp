import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureOfficialServer, distribution } from '../src/acp/installer.js';
import { zipFixture } from './zip-fixture.js';
import { resolveCommand } from '../src/acp/process.js';
import { resolveConfig } from '../src/config.js';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
const roots: string[] = [];
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'dsh-install-test-'));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const archive = () =>
  zipFixture([
    { name: 'agy_acp_server.exe' },
    { name: 'localharness_external.exe', text: 'sibling' },
  ]);
const fetcher = (bytes = archive()) => vi.fn(async () => new Response(new Uint8Array(bytes)));
it('downloads the complete official distribution once and reuses the cache offline', async () => {
  const cacheRoot = await root(),
    fetch = fetcher();
  const options = { cacheRoot, platform: 'win32', arch: 'x64', fetch };
  const command = await ensureOfficialServer(options);
  expect(fetch.mock.calls).toHaveLength(1);
  expect(await readFile(join(command, '..', 'localharness_external.exe'), 'utf8')).toBe('sibling');
  expect(
    await ensureOfficialServer({
      ...options,
      fetch: vi.fn(() => {
        throw Error('offline');
      }),
    }),
  ).toBe(command);
});
it.each(['../escape.exe', '/absolute.exe', 'C:drive.exe', 'bad\\file', 'CON', 'a/../../escape'])(
  'rejects unsafe ZIP path %s without publishing a cache',
  async (name) => {
    const cacheRoot = await root();
    await expect(
      ensureOfficialServer({
        cacheRoot,
        platform: 'win32',
        arch: 'x64',
        fetch: fetcher(zipFixture([{ name }])),
      }),
    ).rejects.toMatchObject({ code: 'ACP_INSTALL_FAILED' });
    expect(await readdir(cacheRoot)).toEqual([]);
  },
);
it('rejects symlinks and incomplete distributions', async () => {
  for (const bytes of [
    zipFixture([{ name: 'agy_acp_server.exe', mode: 0o120777 }]),
    zipFixture([{ name: 'other.exe' }]),
  ]) {
    const cacheRoot = await root();
    await expect(
      ensureOfficialServer({ cacheRoot, platform: 'win32', arch: 'x64', fetch: fetcher(bytes) }),
    ).rejects.toMatchObject({ code: 'ACP_INSTALL_FAILED' });
    expect(await readdir(cacheRoot)).toEqual([]);
  }
});
it('does not follow download redirects and sanitizes network errors', async () => {
  const cacheRoot = await root();
  for (const fetch of [
    vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }),
    ),
    vi.fn(async () => {
      throw Error('private-secret');
    }),
  ]) {
    await expect(
      ensureOfficialServer({ cacheRoot, platform: 'win32', arch: 'x64', fetch }),
    ).rejects.toMatchObject({ code: 'ACP_INSTALL_FAILED' });
    expect(await readdir(cacheRoot)).toEqual([]);
  }
});
it('cancels an interrupted download and retries from a clean staging directory', async () => {
  const cacheRoot = await root(),
    controller = new AbortController();
  const fetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Error('aborted')), { once: true });
        controller.abort();
      }),
  );
  await expect(
    ensureOfficialServer({
      cacheRoot,
      platform: 'win32',
      arch: 'x64',
      fetch,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: 'ABORTED' });
  expect(await readdir(cacheRoot)).toEqual([]);
  await expect(
    ensureOfficialServer({ cacheRoot, platform: 'win32', arch: 'x64', fetch: fetcher() }),
  ).resolves.toContain('agy_acp_server.exe');
});
it('publishes a valid distribution atomically for concurrent installers', async () => {
  const cacheRoot = await root(),
    options = { cacheRoot, platform: 'win32', arch: 'x64', fetch: fetcher() };
  const commands = await Promise.all([
    ensureOfficialServer(options),
    ensureOfficialServer(options),
  ]);
  expect(commands[0]).toBe(commands[1]);
  expect(await readdir(cacheRoot)).toHaveLength(1);
});
it('repairs a damaged sibling without requiring manual cache deletion', async () => {
  const cacheRoot = await root(),
    fetch = fetcher();
  const options = { cacheRoot, platform: 'win32', arch: 'x64', fetch };
  const command = await ensureOfficialServer(options);
  await writeFile(join(command, '..', 'localharness_external.exe'), 'broken file');
  expect(await ensureOfficialServer(options)).toBe(command);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await readFile(join(command, '..', 'localharness_external.exe'), 'utf8')).toBe('sibling');
  expect(await readdir(cacheRoot)).toHaveLength(1);
});
it('preserves an explicit executable override instead of hiding a broken path with automatic downloads', async () => {
  const runtime = {
    resolveExecutable: vi.fn(async () => {
      throw Error('missing');
    }),
  } as unknown as SubprocessRuntime;
  await expect(
    resolveCommand(resolveConfig({ command: '/missing/custom-server' }), runtime),
  ).rejects.toMatchObject({ code: 'ACP_BINARY_MISSING' });
  expect(runtime.resolveExecutable).toHaveBeenCalledExactlyOnceWith(
    '/missing/custom-server',
    undefined,
    undefined,
  );
});
it('selects the six official Registry platforms and rejects unsupported hosts before downloading', async () => {
  for (const platform of ['win32', 'linux', 'darwin'])
    for (const arch of ['x64', 'arm64']) {
      expect(distribution(platform, arch).url).toMatch(
        /^https:\/\/dl.google.com\/agy-extensions\/releases\//,
      );
    }
  expect(() => distribution('linux', 'ia32')).toThrowError(/unsupported/i);
});
