import { Context } from '@deepseek-ai/cordis';
import {
  LlmRuntime,
  createUserMessage,
  createAssistantMessage,
  createToolResultMessage,
} from '@deepseek-ai/dsh-llm';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import * as plugin from '../dist/index.js';
const ctx = new Context();
try {
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(LocalSubprocessRuntime);
  await ctx.plugin(plugin, { command: process.env.AGY_ACP_BIN });
  const models = await ctx.llm.listModels('antigravity-acp');
  const model = models.find((m) => m.id.endsWith('-low'))?.id ?? models[0].id;
  const messages = [
    createUserMessage({
      source: { kind: 'user' },
      content: [
        {
          type: 'text',
          text: 'Use the DSH probe tool to obtain the marker. Then call the DSH denied tool exactly once. Report the marker and whether the second tool was denied. Never use other tools or guess the marker.',
        },
      ],
    }),
  ];
  const tools = [
    {
      name: 'probe_marker',
      description: 'Obtain the marker. Call this tool; its value is unavailable otherwise.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'denied_action',
      description:
        'Attempt a test action. DSH permission will deny it. Do not repeat a denied action.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  let count = 0,
    denied = 0,
    answer = '';
  for (let step = 0; step < 8; step++) {
    const blocks = [];
    let finish;
    for await (const chunk of ctx.llm.stream({
      provider: 'antigravity-acp',
      model,
      sessionId: 'real-tool-smoke',
      messages,
      tools,
    })) {
      if (chunk.type === 'block-end') blocks.push(chunk.block);
      if (chunk.type === 'finish') finish = chunk.reason;
    }
    messages.push(
      createAssistantMessage({ source: { provider: 'antigravity-acp', model }, content: blocks }),
    );
    for (const call of blocks.filter((b) => b.type === 'tool-call')) {
      const isError = call.name === 'denied_action';
      if (isError) denied++;
      else if (call.name === 'probe_marker') count++;
      else throw Error('Unknown harness call');
      messages.push(
        createToolResultMessage({
          callId: call.id,
          isError,
          content: [
            { type: 'text', text: isError ? 'DSH_PERMISSION_DENIED' : 'REAL_TOOL_MARKER_5c72d8' },
          ],
        }),
      );
      console.log('DSH_TOOL_CALL', call.name, isError ? 'DENIED' : 'RETURNED');
    }
    if (finish?.kind === 'stop') {
      answer = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      break;
    }
    if (finish?.kind !== 'tool-calls') throw Error('Unexpected finish ' + JSON.stringify(finish));
  }
  console.log('ANSWER', answer);
  if (
    count !== 1 ||
    denied !== 1 ||
    !answer.includes('REAL_TOOL_MARKER_5c72d8') ||
    !/denied|negad/i.test(answer)
  )
    throw Error('Real tool smoke failed');
  console.log('REAL_DSH_LLM_TOOL_SMOKE_OK');
} finally {
  await ctx.fiber.dispose();
}
