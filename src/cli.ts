#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Context } from '@deepseek-ai/cordis';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { AntigravityAcpAdapter } from './adapter.js';
import { resolveConfig } from './config.js';
import { modelCatalog } from './models.js';
import { classify } from './acp/errors.js';

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    command: { type: 'string' },
    arg: { type: 'string', multiple: true },
    model: { type: 'string' },
    help: { type: 'boolean' },
  },
});
const action = parsed.positionals[0] ?? 'doctor';
if (parsed.values.help) {
  console.log(
    'dsh-antigravity-acp <login|status|doctor|logout|probe> [--command /path/to/agy_acp_server] [--arg value] [--model exact-id]',
  );
} else {
  if (!['login', 'status', 'doctor', 'logout', 'probe'].includes(action))
    throw new Error('Unknown command. Use --help.');
  const major = Number(process.versions.node.split('.')[0]),
    minor = Number(process.versions.node.split('.')[1]);
  if (major < 22 || (major === 22 && minor < 19))
    throw new Error('Node.js >=22.19 is required by the DSH subprocess runtime.');
  const ctx = new Context();
  await ctx.plugin(LocalSubprocessRuntime);
  const adapter = new AntigravityAcpAdapter(
    resolveConfig({
      command: parsed.values.command ?? '',
      args: parsed.values.arg ?? [],
      defaultModel: parsed.values.model ?? '',
    }),
    ctx.subprocess,
    (message) => console.error(message),
  );
  const control = new AbortController();
  const interrupt = () => control.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const client = adapter.client;
    if (action === 'login') {
      console.log(
        'Starting oauth-personal in the official Google ACP server. Complete the browser flow if it opens.',
      );
      await client.login(control.signal);
      console.log('Authenticated. Credentials are managed by the official server.');
    } else if (action === 'logout') {
      await client.logout(control.signal);
      console.log('Official server logout completed.');
    } else if (action === 'probe') {
      const chunks = [];
      for await (const chunk of adapter.stream({
        provider: 'antigravity-acp',
        model: parsed.values.model || 'server-default',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Reply exactly with ACP_OK' }] },
        ],
        signal: control.signal,
      })) {
        if (chunk.type === 'text-delta') process.stdout.write(chunk.text);
        chunks.push(chunk);
      }
      process.stdout.write('\n');
      if (
        chunks
          .filter((c) => c.type === 'text-delta')
          .map((c) => c.text)
          .join('')
          .trim() !== 'ACP_OK'
      )
        throw new Error('Probe response did not match ACP_OK.');
      console.log('ACP probe passed (real streaming).');
    } else {
      await client.start(control.signal);
      const init = client.initializeResult!;
      console.log(
        JSON.stringify(
          {
            protocolVersion: init.protocolVersion,
            agent: init.agentInfo?.name,
            version: init.agentInfo?.version,
            authMethods: init.authMethods?.map((m) => m.id),
            textOnly: true,
          },
          null,
          2,
        ),
      );
      // Status never launches OAuth. Authenticated session creation is the test.
      const session = await client.newSession(control.signal, false);
      console.log(JSON.stringify({ authenticated: true, models: modelCatalog(session) }, null, 2));
    }
  } catch (error) {
    console.error(classify(error).message);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    await adapter.dispose();
    await ctx.fiber.dispose();
  }
}
