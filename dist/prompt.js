import { LlmError } from '@deepseek-ai/dsh-llm';
export function buildPrompt(options, config) {
    for (const key of ['temperature', 'maxTokens', 'reasoningEffort']) {
        if (options[key] !== undefined)
            throw new LlmError(`ACP does not expose ${key}. Remove that request option; select an exact model ID for its reasoning tier.`, 'UNSUPPORTED_OPTION');
    }
    if (options.stop?.length)
        throw new LlmError('ACP does not expose stop sequences.', 'UNSUPPORTED_OPTION');
    if (config.toolPolicy === 'reject' &&
        (options.tools?.length || options.toolHistory?.tools.length))
        throw new LlmError('This text ACP provider cannot execute DSH tool calls. Disable tools or explicitly use toolPolicy: text-only.', 'UNSUPPORTED_OPTION');
    const messages = options.messages.map((m) => ({
        role: m.role,
        ...('toolCallId' in m ? { toolCallId: m.toolCallId, isError: m.isError ?? false } : {}),
        content: m.content.map((b) => {
            if (b.type === 'image' || b.type === 'file')
                throw new LlmError('This version accepts text context only. Attachments must be projected by DSH before calling the adapter.', 'UNSUPPORTED_OPTION');
            return b; // Preserve historical text, reasoning, tool calls/results and developer updates.
        }),
    }));
    return [
        'DeepSeek Harness owns this conversation. Produce only the next assistant response using the supplied conversation.',
        'This is a text-only backend. Do not invoke native tools, slash commands, skills, file access, terminals, network tools, or MCP.',
        'DSH tools are unavailable on this route. If an action needs tools, explain that limitation in your answer.',
        'The JSON below is the complete DSH-controlled history, with roles and historical tool results. Answer its final user message. Do not repeat the transcript.',
        JSON.stringify({ system: options.system ?? null, messages }),
    ].join('\n\n');
}
