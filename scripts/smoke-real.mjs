import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, createMessage } from '@deepseek-ai/dsh-llm';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import * as plugin from '../dist/index.js';
const ctx = new Context();
try {
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(plugin, { command: process.env.AGY_ACP_BIN });
  const models = await ctx.llm.listModels('antigravity-acp');
  if (!models.length) throw new Error('No models');
  console.log(
    'PRIMARY_PROVIDER_OK',
    ctx.llm.listProviders().map((p) => p.id),
  );
  const model = models.find((m) => m.id.endsWith('-low'))?.id ?? models[0].id;
  const history = [];
  async function turn(text) {
    history.push(
      createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }),
    );
    let answer = '',
      deltas = 0;
    for await (const c of ctx.llm.stream({
      provider: 'antigravity-acp',
      model,
      messages: history,
    })) {
      if (c.type === 'text-delta') {
        answer += c.text;
        deltas++;
      }
      if (c.type === 'finish' && c.reason.kind !== 'stop')
        throw new Error('Failed finish ' + c.reason.kind);
    }
    history.push(
      createMessage({
        role: 'assistant',
        source: { kind: 'model', provider: 'antigravity-acp', model },
        content: [{ type: 'text', text: answer }],
      }),
    );
    console.log('TURN', JSON.stringify(answer), 'DELTAS', deltas);
    return answer.trim();
  }
  if ((await turn('Remember the word violet. Reply exactly with ACP_OK')) !== 'ACP_OK')
    throw new Error('First turn mismatch');
  if ((await turn('What word did I ask you to remember? Reply with that word only.')) !== 'violet')
    throw new Error('History mismatch');
  const abort = new AbortController();
  let interrupted = false;
  for await (const c of ctx.llm.stream({
    provider: 'antigravity-acp',
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Write a long essay about the history of mathematics. Do not use tools.',
          },
        ],
      },
    ],
    signal: abort.signal,
  })) {
    if (c.type === 'text-delta') abort.abort();
    if (c.type === 'finish') {
      if (c.reason.kind !== 'aborted') throw new Error('Cancellation failed');
      interrupted = true;
    }
  }
  if (!interrupted) throw new Error('No aborted finish');
  console.log('CANCEL_OK');
  if ((await turn('Reply exactly with RECONNECT_OK')) !== 'RECONNECT_OK')
    throw new Error('Reconnect failed');
  console.log('REAL_DSH_SMOKE_OK');
} finally {
  await ctx.fiber.dispose();
}
