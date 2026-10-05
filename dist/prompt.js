import { LlmError } from '@deepseek-ai/dsh-llm';
import { mcpToolName } from './mcp/bridge.js';
export function buildPrompt(options, config) {
    for (const key of ['temperature', 'maxTokens', 'reasoningEffort']) {
        if (options[key] !== undefined)
            throw new LlmError(`ACP does not expose ${key}. Remove that request option; select an exact model ID for its reasoning tier.`, 'UNSUPPORTED_OPTION');
    }
    if (options.stop?.length)
        throw new LlmError('ACP does not expose stop sequences.', 'UNSUPPORTED_OPTION');
    if (config.toolPolicy === 'reject' &&
        (options.tools?.length || options.toolHistory?.tools.length))
        throw new LlmError('toolPolicy: reject refuses tool schemas. Use the default bridge policy to execute DSH tools.', 'UNSUPPORTED_OPTION');
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
        ...(config.toolPolicy === 'bridge' && options.tools?.length
            ? [
                'Use only tools supplied by the dsh-bridge MCP server. These are the real DeepSeek Harness tools, including file and terminal tools. Call them using their MCP names and schemas.',
                'Never use built-in Antigravity tools, slash commands, skills, file access, terminals, or network tools outside dsh-bridge. Do not use a native tool to find MCP tools; the MCP catalog is already supplied.',
                'Each MCP call is executed by DSH with its current permissions. A denied or failed tool result is authoritative; do not bypass it or repeat the action through another tool.',
            ]
            : [
                'This is a text-only backend. Do not invoke native tools, slash commands, skills, file access, terminals, network tools, or MCP.',
                'DSH tools are unavailable on this request. If an action needs tools, explain that limitation in your answer.',
            ]),
        'The JSON below is the complete DSH-controlled history, with roles and historical tool results. Answer its final user message. Do not repeat the transcript.',
        JSON.stringify({
            system: options.system ?? null,
            messages,
            ...(config.toolPolicy === 'bridge' && options.tools?.length
                ? {
                    dshMcpTools: options.tools.map((tool) => ({
                        mcpServer: 'dsh-bridge',
                        mcpName: mcpToolName(tool.name),
                        dshName: tool.name,
                        description: tool.description,
                        parameters: tool.parameters,
                    })),
                }
                : {}),
        }),
    ].join('\n\n');
}
