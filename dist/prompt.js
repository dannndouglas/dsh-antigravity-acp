import { acpError } from './acp/errors.js';
/**
 * Antigravity silently cuts one ACP user request after ~192,000 UTF-8 bytes,
 * from the tail, whether the prompt is one text block, several blocks or
 * embedded resources. Prompts are therefore budgeted below that cap.
 */
export const DEFAULT_MAX_PROMPT_BYTES = 180_000;
const MIN_CLIP_BYTES = 1024;
const CURRENT_PLACEHOLDER = '[Current user request: quoted verbatim at the top of this prompt.]';
export const utf8Bytes = (text) => Buffer.byteLength(text, 'utf8');
function sourceKind(message) {
    const source = message.source;
    return typeof source?.kind === 'string' ? source.kind : undefined;
}
/**
 * Whether a person (or a host-internal request such as compaction) authored this
 * user message. Runtime notices are user-role messages carrying their producer's
 * source kind; they are context, not the task to answer.
 */
function isHuman(message) {
    if (message.role !== 'user')
        return false;
    const kind = sourceKind(message);
    return kind === undefined || kind === 'user';
}
function textOf(message) {
    return message.content
        .flatMap((b) => (b.type === 'text' && b.text.trim() ? [b.text] : []))
        .join('\n\n');
}
/** Index of the latest person-authored user message with text, if any. */
export function latestHumanIndex(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (isHuman(message) && textOf(message))
            return i;
    }
    return -1;
}
/** Keep the head and tail of oversized text, marking the omitted middle. */
export function clipText(text, maxBytes) {
    const size = utf8Bytes(text);
    if (size <= maxBytes)
        return text;
    const marker = `\n\n[... ${size - maxBytes} bytes omitted by the DSH Antigravity adapter to fit the ACP request size limit ...]\n\n`;
    const room = Math.max(0, maxBytes - utf8Bytes(marker));
    const bytes = Buffer.from(text, 'utf8');
    const decode = (part) => part.toString('utf8').replace(/^�+|�+$/g, '');
    const head = Math.floor(room * 0.7);
    return (decode(bytes.subarray(0, head)) + marker + decode(bytes.subarray(bytes.length - (room - head))));
}
function project(message, current) {
    return {
        role: message.role,
        ...('toolCallId' in message
            ? { toolCallId: String(message.toolCallId), isError: message.isError ?? false }
            : {}),
        content: message.content.flatMap((b, index) => {
            if (b.type === 'image' || b.type === 'file')
                throw acpError('This version accepts text context only. Attachments must be projected by DSH before calling the adapter.', 'UNSUPPORTED_OPTION');
            // The current request is quoted once, before the transcript.
            if (current)
                return index ? [] : [{ type: 'text', text: CURRENT_PLACEHOLDER }];
            // Preserve historical text, reasoning, tool calls/results and developer updates.
            return [{ ...b }];
        }),
    };
}
function validate(options, config) {
    // ACP exposes no sampling controls. Host-internal requests (compaction and
    // titles) carry these as hints, so they are dropped by default rather than
    // failing the whole request. reasoningEffort is accepted for host metadata;
    // the exact model ID selects the thinking tier.
    if (!config.ignoreUnsupportedOptions) {
        for (const key of ['temperature', 'maxTokens']) {
            if (options[key] !== undefined)
                throw acpError(`ACP does not expose ${key}. Remove that request option or enable ignoreUnsupportedOptions.`, 'UNSUPPORTED_OPTION');
        }
        if (options.stop?.length)
            throw acpError('ACP does not expose stop sequences.', 'UNSUPPORTED_OPTION');
    }
    if (config.toolPolicy === 'reject' &&
        (options.tools?.length || options.toolHistory?.tools.length))
        throw acpError('toolPolicy: reject refuses tool schemas. Use the default bridge policy to execute DSH tools.', 'UNSUPPORTED_OPTION');
}
/**
 * Serialize DSH-owned history into one ACP prompt within `config.maxPromptBytes`.
 *
 * The current request is quoted first, so even an unexpected server-side tail
 * cut cannot remove it. When the budget is exceeded, whole oldest rounds are
 * omitted first (DSH compaction should normally prevent this), then the largest
 * remaining text fields are shortened head-and-tail.
 */
export function planPrompt(options, config) {
    validate(options, config);
    const limit = config.maxPromptBytes;
    const bridged = config.toolPolicy === 'bridge' && !!options.tools?.length;
    const currentIndex = latestHumanIndex(options.messages);
    let task = currentIndex >= 0 ? textOf(options.messages[currentIndex]) : undefined;
    let system = options.system ?? null;
    let messages = options.messages.map((m, i) => project(m, i === currentIndex));
    let omittedMessages = 0;
    let clippedBlocks = 0;
    const assemble = () => [
        'DeepSeek Harness owns this conversation. Produce only the next assistant response using the supplied conversation.',
        ...(bridged
            ? [
                'Use only tools supplied by the dsh-bridge MCP server. These are the real DeepSeek Harness tools, including file and terminal tools. Call them using their MCP names and schemas.',
                'Never use built-in Antigravity tools, slash commands, skills, file access, terminals, or network tools outside dsh-bridge. Do not use a native tool to find MCP tools; the MCP catalog is already supplied.',
                'Each MCP call is executed by DSH with its current permissions. A denied or failed tool result is authoritative; do not bypass it or repeat the action through another tool.',
            ]
            : [
                'This is a text-only backend. Do not invoke native tools, slash commands, skills, file access, terminals, network tools, or MCP.',
                'DSH tools are unavailable on this request. If an action needs tools, explain that limitation in your answer.',
            ]),
        ...(task === undefined
            ? []
            : ['CURRENT USER REQUEST (verbatim). This is the request you must answer now:', task]),
        [
            'The JSON below is the DSH-controlled history, with roles and historical tool results.',
            task === undefined
                ? 'Answer its final user message.'
                : 'The current user request appears in it as a placeholder at its original position; answer that request, not an earlier one or a later runtime notice.',
            omittedMessages
                ? `The ${omittedMessages} oldest history messages were omitted to fit the request size limit.`
                : '',
            'Do not repeat the transcript.',
        ]
            .filter(Boolean)
            .join(' '),
        JSON.stringify({ system, messages }),
    ].join('\n\n');
    let prompt = assemble();
    // 1. Omit whole oldest rounds (a round starts at a person-authored message).
    //    The round holding the current request and system-role messages stay.
    if (utf8Bytes(prompt) > limit && currentIndex > 0) {
        const starts = options.messages.flatMap((m, i) => (i > 0 && isHuman(m) ? [i] : []));
        const keepFrom = currentIndex;
        let cut = 0;
        for (const start of starts.filter((s) => s <= keepFrom)) {
            if (utf8Bytes(prompt) <= limit)
                break;
            cut = start;
            const kept = options.messages
                .map((m, i) => ({ m, p: project(m, i === currentIndex), i }))
                .filter(({ m, i }) => i >= cut || m.role === 'system');
            omittedMessages = options.messages.length - kept.length;
            messages = kept.map(({ p }) => p);
            prompt = assemble();
        }
    }
    const fields = [];
    for (const message of messages)
        for (const block of message.content)
            for (const key of ['text', 'arguments', 'content'])
                if (typeof block[key] === 'string')
                    fields.push({ get: () => block[key], set: (v) => (block[key] = v) });
    // The current request and system prompt are shortened last.
    const lastResort = [];
    if (task !== undefined)
        lastResort.push({ get: () => task, set: (v) => (task = v) });
    if (system !== null)
        lastResort.push({ get: () => system, set: (v) => (system = v) });
    for (const pool of [fields, lastResort]) {
        let excess = utf8Bytes(prompt) - limit;
        while (excess > 0) {
            let largest;
            let size = 0;
            for (const field of pool) {
                const bytes = utf8Bytes(field.get());
                if (bytes > size)
                    [largest, size] = [field, bytes];
            }
            if (!largest || size <= MIN_CLIP_BYTES)
                break;
            // JSON escaping can make a field cost more than its UTF-8 length.
            const target = Math.max(MIN_CLIP_BYTES, size - excess - 256);
            largest.set(clipText(largest.get(), target));
            clippedBlocks++;
            prompt = assemble();
            excess = utf8Bytes(prompt) - limit;
        }
    }
    return { prompt, bytes: utf8Bytes(prompt), omittedMessages, clippedBlocks };
}
export function buildPrompt(options, config) {
    return planPrompt(options, config).prompt;
}
