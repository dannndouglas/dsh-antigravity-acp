import { describe, expect, it } from 'vitest';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { resolveConfig } from '../src/config.js';
import { clipText, planPrompt, utf8Bytes } from '../src/prompt.js';

type Messages = GenerateOptions['messages'];
const user = (text: string, kind?: string) =>
  ({
    role: 'user',
    content: [{ type: 'text', text }],
    ...(kind ? { source: { kind } } : {}),
  }) as Messages[number];
const assistant = (text: string) =>
  ({ role: 'assistant', content: [{ type: 'text', text }] }) as unknown as Messages[number];
const tool = (text: string) =>
  ({
    role: 'tool',
    toolCallId: 'call-1',
    content: [{ type: 'text', text }],
  }) as unknown as Messages[number];
const request = (messages: Messages, extra: Partial<GenerateOptions> = {}): GenerateOptions => ({
  provider: 'antigravity-acp',
  model: 'm',
  messages,
  ...extra,
});
const transcript = (prompt: string) =>
  JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n{"system"') + 2));

describe('ACP prompt budget', () => {
  it('quotes the current human request first and leaves a placeholder in the history', () => {
    const plan = planPrompt(
      request([user('first task'), assistant('done'), user('second task'), user('notice', 'time')]),
      resolveConfig(),
    );
    const head = plan.prompt.indexOf('CURRENT USER REQUEST');
    expect(head).toBeGreaterThan(0);
    expect(plan.prompt.indexOf('second task')).toBeGreaterThan(head);
    expect(plan.prompt.indexOf('second task')).toBeLessThan(plan.prompt.indexOf('{"system"'));
    const history = transcript(plan.prompt);
    expect(history.messages).toHaveLength(4);
    expect(history.messages[2].content[0].text).toContain('quoted verbatim at the top');
    expect(history.messages[3].content[0].text).toBe('notice'); // Runtime notices remain context.
    expect(plan).toMatchObject({ omittedMessages: 0, clippedBlocks: 0 });
  });

  it('does not duplicate MCP tool schemas that the dsh-bridge server already serves', () => {
    const tools = [{ name: 'read', description: 'x'.repeat(5000), parameters: { type: 'object' } }];
    const plan = planPrompt(request([user('hi')], { tools }), resolveConfig());
    expect(plan.prompt).toContain('dsh-bridge');
    expect(plan.prompt).not.toContain('x'.repeat(100));
    expect(plan.prompt).not.toContain('dshMcpTools');
  });

  it('omits whole oldest rounds before touching the current round', () => {
    const big = 'a'.repeat(40_000);
    const messages: Messages = [];
    for (let round = 0; round < 8; round++)
      messages.push(user(`task ${round}`), tool(big), assistant(`answer ${round}`));
    messages.push(user('latest task'), tool('fresh result'));
    const plan = planPrompt(request(messages, { system: 'SYSTEM' }), resolveConfig());
    expect(plan.bytes).toBeLessThanOrEqual(180_000);
    expect(plan.clippedBlocks).toBe(0);
    expect(plan.omittedMessages % 3).toBe(0); // Rounds are dropped whole.
    const history = transcript(plan.prompt);
    expect(history.system).toBe('SYSTEM');
    expect(history.messages[0].content[0].text).toMatch(/^task \d$/);
    expect(history.messages.at(-1).content[0].text).toBe('fresh result');
    expect(plan.prompt).toContain(`${plan.omittedMessages} oldest history messages were omitted`);
  });

  it('shortens the largest fields when the current round alone exceeds the budget', () => {
    const plan = planPrompt(
      request([user('summarize'), tool('é'.repeat(150_000)), tool('b'.repeat(90_000))]),
      resolveConfig(),
    );
    expect(plan.bytes).toBeLessThanOrEqual(180_000);
    expect(plan.clippedBlocks).toBeGreaterThan(0);
    expect(plan.prompt).toContain('bytes omitted by the DSH Antigravity adapter');
    expect(plan.prompt).not.toContain('�');
    expect(plan.prompt.indexOf('summarize')).toBeLessThan(plan.prompt.indexOf('{"system"'));
  });

  it('honours a configured byte budget, including a huge current request', () => {
    const plan = planPrompt(
      request([user('z'.repeat(100_000))]),
      resolveConfig({ maxPromptBytes: 20_000 }),
    );
    expect(plan.bytes).toBeLessThanOrEqual(20_000);
  });

  it('clips UTF-8 text on character boundaries, keeping head and tail', () => {
    const clipped = clipText('início ' + 'ç'.repeat(5000) + ' fim', 2000);
    expect(utf8Bytes(clipped)).toBeLessThanOrEqual(2000);
    expect(clipped.startsWith('início')).toBe(true);
    expect(clipped.endsWith('fim')).toBe(true);
    expect(clipped).not.toContain('�');
  });

  it('accepts compaction sampling hints unless strict option checks are configured', () => {
    const compaction = request([user('Summarize the conversation.')], {
      maxTokens: 65536,
      temperature: 0,
      stop: ['END'],
    });
    expect(planPrompt(compaction, resolveConfig()).prompt).toContain('Summarize the conversation.');
    expect(() =>
      planPrompt(compaction, resolveConfig({ ignoreUnsupportedOptions: false })),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_OPTION' }));
  });
});
