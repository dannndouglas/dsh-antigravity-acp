import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { buildPrompt } from '../src/prompt.js';
import { clipMessage, clipText, promptBytes, withPromptBudget } from '../src/prompt-budget.js';
import { createMessage, type RequestMessage } from '@deepseek-ai/dsh-llm';

describe('prompt-budget and prompt assembly', () => {
  it('measures UTF-8 byte length accurately', () => {
    expect(promptBytes('abc')).toBe(3);
    expect(promptBytes('你好')).toBe(6);
  });

  it('clips text to maxBytes and appends trim mark', () => {
    const text = 'a'.repeat(100);
    const clipped = clipText(text, 50);
    expect(promptBytes(clipped)).toBeLessThanOrEqual(50);
    expect(clipped).toContain('...[trimmed by the DSH Antigravity adapter]');
  });

  it('clips message content blocks within budget', () => {
    const msg = createMessage({
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'x'.repeat(1000) }],
    });
    const clipped = clipMessage(msg, 200);
    expect(promptBytes(JSON.stringify(clipped))).toBeLessThanOrEqual(250);
  });

  it('drops oldest non-system messages when exceeding limit while keeping newest round', () => {
    const messages: RequestMessage[] = [
      createMessage({
        role: 'system',
        source: { kind: 'system-prompt' },
        content: [{ type: 'text', text: 'SYSTEM_PROMPT' }],
      }),
      createMessage({
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'OLD_USER_1' }],
      }),
      createMessage({
        role: 'assistant',
        source: { kind: 'model', provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'OLD_ASSISTANT_1' }],
      }),
      createMessage({
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'NEW_USER' }],
      }),
    ];

    const assemble = (msgs: RequestMessage[]) => JSON.stringify(msgs);
    // Limit small enough to require dropping old messages, but large enough for system + new user
    const full = assemble(messages);
    const fullBytes = promptBytes(full);
    const result = withPromptBudget(messages, assemble, fullBytes - 20);

    expect(result.dropped).toBeGreaterThan(0);
    expect(result.prompt).toContain('SYSTEM_PROMPT');
    expect(result.prompt).toContain('NEW_USER');
    expect(result.prompt).not.toContain('OLD_USER_1');
  });

  it('prepends CURRENT USER REQUEST before transcript JSON', () => {
    const config = resolveConfig();
    const prompt = buildPrompt(
      {
        provider: 'antigravity-acp',
        model: 'test-model',
        messages: [
          createMessage({
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'First question' }],
          }),
          createMessage({
            role: 'assistant',
            source: { kind: 'model', provider: 'test', model: 'test' },
            content: [{ type: 'text', text: 'First answer' }],
          }),
          createMessage({
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'Latest question' }],
          }),
        ],
      },
      config,
    );

    const previewIndex = prompt.indexOf('CURRENT USER REQUEST (verbatim; newest last)');
    const jsonIndex = prompt.indexOf('The JSON below is the complete DSH-controlled history');
    expect(previewIndex).toBeGreaterThan(-1);
    expect(jsonIndex).toBeGreaterThan(previewIndex);
    expect(prompt.slice(previewIndex, jsonIndex)).toContain('Latest question');
  });

  it('does not duplicate tool schemas as dshMcpTools in prompt JSON', () => {
    const config = resolveConfig({ toolPolicy: 'bridge' });
    const prompt = buildPrompt(
      {
        provider: 'antigravity-acp',
        model: 'test-model',
        tools: [
          {
            name: 'bash',
            description: 'Execute bash command',
            parameters: { type: 'object', properties: { command: { type: 'string' } } },
          },
        ],
        messages: [
          createMessage({
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'Run command' }],
          }),
        ],
      },
      config,
    );

    expect(prompt).not.toContain('dshMcpTools');
    expect(prompt).toContain('dsh-bridge MCP server');
  });

  it('safely ignores maxTokens, temperature and stop with default config', () => {
    const config = resolveConfig();
    expect(config.ignoreUnsupportedOptions).toBe(true);

    const prompt = buildPrompt(
      {
        provider: 'antigravity-acp',
        model: 'test-model',
        maxTokens: 4096,
        temperature: 0.7,
        stop: ['END'],
        messages: [
          createMessage({
            role: 'user',
            source: { kind: 'user' },
            content: [{ type: 'text', text: 'Hello' }],
          }),
        ],
      },
      config,
    );
    expect(prompt).toContain('Hello');
  });

  it('throws UNSUPPORTED_OPTION when ignoreUnsupportedOptions is false', () => {
    const config = resolveConfig({ ignoreUnsupportedOptions: false });
    expect(() =>
      buildPrompt(
        {
          provider: 'antigravity-acp',
          model: 'test-model',
          maxTokens: 4096,
          messages: [
            createMessage({
              role: 'user',
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Hello' }],
            }),
          ],
        },
        config,
      ),
    ).toThrowError(/maxTokens/);

    expect(() =>
      buildPrompt(
        {
          provider: 'antigravity-acp',
          model: 'test-model',
          temperature: 0.5,
          messages: [
            createMessage({
              role: 'user',
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Hello' }],
            }),
          ],
        },
        config,
      ),
    ).toThrowError(/temperature/);

    expect(() =>
      buildPrompt(
        {
          provider: 'antigravity-acp',
          model: 'test-model',
          stop: ['STOP'],
          messages: [
            createMessage({
              role: 'user',
              source: { kind: 'user' },
              content: [{ type: 'text', text: 'Hello' }],
            }),
          ],
        },
        config,
      ),
    ).toThrowError(/stop sequences/);
  });
});
