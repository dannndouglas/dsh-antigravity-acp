import { acpError } from './acp/errors.js';
import { mcpToolName } from './mcp/bridge.js';
function sourceKind(message) {
    if (!('source' in message))
        return undefined;
    const source = message.source;
    return typeof source?.kind === 'string' ? source.kind : undefined;
}
/** A person typed this message. Runtime reminders and time samples are not tasks. */
function isHuman(message) {
    if (message.role !== 'user')
        return false;
    const kind = sourceKind(message);
    return kind === undefined || kind === 'user';
}
function visibleText(message) {
    return message.content
        .flatMap((block) => (block.type === 'text' && block.text.trim() ? [block.text] : []))
        .join('\n');
}
/** Latest person-authored request, ignoring harness notices appended after it. */
export function latestHumanText(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message || !isHuman(message))
            continue;
        const text = visibleText(message).trim();
        if (text)
            return text;
    }
    return undefined;
}
function isFollowUp(messages) {
    let humans = 0;
    let assistant = false;
    for (const message of messages) {
        if (isHuman(message) && visibleText(message).trim())
            humans++;
        if (message.role === 'assistant' && visibleText(message).trim())
            assistant = true;
    }
    return humans > 1 || (assistant && humans > 0);
}
function background(messages) {
    const lines = [];
    for (const message of messages) {
        const text = visibleText(message).trim();
        if (!text)
            continue;
        if (isHuman(message))
            lines.push(`User:\n${text}`);
        else if (message.role === 'assistant')
            lines.push(`Assistant:\n${text}`);
    }
    return lines.join('\n\n');
}
/**
 * Prompt for a new user message on an ACP session that already has the conversation.
 * The session must not be given the tool transcript again.
 */
export function followUpPrompt(task) {
    return [
        'The user sent a new message. Do only this task.',
        'Do not repeat earlier investigation, repository setup, or deliver the same result again unless this task explicitly asks.',
        task,
    ].join('\n\n');
}
export function buildPrompt(options, config) {
    // Host reasoning metadata accepts the request field; ACP's exact model ID
    // selects the thinking tier, so reasoningEffort is intentionally not forwarded.
    for (const key of ['temperature', 'maxTokens']) {
        if (options[key] !== undefined)
            throw acpError(`ACP does not expose ${key}. Remove that request option; select an exact model ID for its reasoning tier.`, 'UNSUPPORTED_OPTION');
    }
    if (options.stop?.length)
        throw acpError('ACP does not expose stop sequences.', 'UNSUPPORTED_OPTION');
    if (config.toolPolicy === 'reject' &&
        (options.tools?.length || options.toolHistory?.tools.length))
        throw acpError('toolPolicy: reject refuses tool schemas. Use the default bridge policy to execute DSH tools.', 'UNSUPPORTED_OPTION');
    const task = latestHumanText(options.messages);
    if (isFollowUp(options.messages) && task) {
        return [
            'Current user task. Do only this. Do not repeat earlier investigation, repository setup, or deliver the same result again unless this task explicitly asks.',
            task,
            ...(options.system ? [`System context:\n${options.system}`] : []),
            'Background conversation. This is user requests and assistant replies only; tool transcripts are omitted.',
            background(options.messages),
            'Current user task, again. Do only this:',
            task,
        ].join('\n\n');
    }
    const messages = options.messages.map((m) => ({
        role: m.role,
        ...('toolCallId' in m ? { toolCallId: m.toolCallId, isError: m.isError ?? false } : {}),
        content: m.content.map((b) => {
            if (b.type === 'image' || b.type === 'file')
                throw acpError('This version accepts text context only. Attachments must be projected by DSH before calling the adapter.', 'UNSUPPORTED_OPTION');
            return b; // Preserve historical text, reasoning, tool calls/results and developer updates.
        }),
    }));
    const transcript = [
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
        'The JSON below is the complete DSH-controlled history, with roles and historical tool results. Answer the current user task, not a later runtime reminder. Do not repeat the transcript.',
        JSON.stringify({
            system: options.system ?? null,
            currentUserTask: task,
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
    return task
        ? [
            `Current user task:\n${task}`,
            transcript,
            `Current user task, again. Do only this:\n${task}`,
        ].join('\n\n')
        : transcript;
}
