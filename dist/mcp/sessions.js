import { randomUUID } from 'node:crypto';
import { LlmError, } from '@deepseek-ai/dsh-llm';
import { AcpClient } from '../acp/client.js';
import { EventMapper, finishReason } from '../acp/events.js';
import { aborted, classify } from '../acp/errors.js';
import { buildPrompt } from '../prompt.js';
import { DshMcpBridge } from './bridge.js';
function history(messages) {
    return messages.map((m) => JSON.stringify({
        role: m.role,
        content: m.content,
        ...(m.role === 'tool' ? { toolCallId: m.toolCallId, isError: m.isError ?? false } : {}),
    }));
}
function signature(o) {
    return JSON.stringify({
        provider: o.provider,
        model: o.model,
        system: o.system ?? null,
        tools: o.tools ?? [],
    });
}
const unavailable = () => ({
    isError: true,
    content: [
        { type: 'text', text: 'The DSH tool round trip was cancelled. No result is available.' },
    ],
});
/** A separate managed ACP process for each in-flight tool turn avoids subagent deadlocks.
 * The only retained state is an unfinished MCP exchange. DSH history starts every new turn.
 */
export class ToolSessions {
    config;
    runtime;
    notify;
    bindings = new Map();
    closing = new Set();
    disposed = false;
    processStarts = 0;
    authentications = 0;
    generations = 0;
    constructor(config, runtime, notify) {
        this.config = config;
        this.runtime = runtime;
        this.notify = notify;
    }
    get active() {
        return this.bindings.size;
    }
    find(o) {
        if (o.purpose)
            return undefined;
        if (o.sessionId)
            return this.bindings.get(o.sessionId);
        const ids = new Set(o.messages.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : [])));
        return [...this.bindings.values()].find((b) => [...b.pending.values()].some((p) => p.exposed && ids.has(p.call.id)));
    }
    has(o) {
        return !!this.find(o);
    }
    deadline(b, ms, code) {
        clearTimeout(b.timer);
        b.timer = setTimeout(() => {
            this.fail(b, new LlmError(code === 'ACP_TOOL_TIMEOUT'
                ? 'DSH did not return the tool result before the bridge deadline. Retry from the saved DSH conversation.'
                : 'Official ACP generation timed out.', code));
            void this.close(b).catch(() => { });
        }, ms);
        b.timer.unref();
    }
    fail(b, error) {
        b.error ??= error;
        b.done = true;
        b.writer?.wake?.();
    }
    watch(b, signal) {
        if (!signal)
            return;
        const onAbort = () => {
            this.fail(b, aborted());
            void this.close(b).catch(() => { });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        b.listeners.push(() => signal.removeEventListener('abort', onAbort));
        if (signal.aborted)
            onAbort();
    }
    queueTool(b, call) {
        if (b.done || b.controller.signal.aborted)
            return Promise.resolve(unavailable());
        if (b.pending.size >= 64)
            return Promise.resolve({
                isError: true,
                content: [{ type: 'text', text: 'Too many concurrent DSH tool calls.' }],
            });
        clearTimeout(b.timer);
        this.deadline(b, this.config.toolTimeoutMs, 'ACP_TOOL_TIMEOUT');
        const result = new Promise((resolve) => b.pending.set(call.id, { call, resolve, exposed: false }));
        const w = b.writer;
        if (w && !w.batch)
            w.batch = setTimeout(() => {
                w.batch = undefined;
                w.toolReady = true;
                w.wake?.();
            }, 10);
        return result;
    }
    async create(o) {
        if (this.bindings.size >= this.config.maxActiveToolSessions)
            throw new LlmError('Too many active ACP tool sessions. Finish or cancel an existing turn.', 'ACP_SESSION_LIMIT');
        const key = o.sessionId && !o.purpose ? o.sessionId : randomUUID();
        const client = new AcpClient(this.config, this.runtime, this.notify);
        const b = {
            key,
            client,
            bridge: undefined,
            controller: new AbortController(),
            history: history(o.messages),
            signature: signature(o),
            pending: new Map(),
            trustedAcpIds: new Set(),
            done: false,
            stop: '',
            listeners: [],
        };
        b.bridge = new DshMcpBridge(o.tools ?? [], (call) => this.queueTool(b, call));
        this.bindings.set(key, b);
        this.watch(b, o.signal);
        try {
            await client.start(b.controller.signal);
            if (!client.initializeResult?.agentCapabilities?.mcpCapabilities?.http)
                throw new LlmError('Official ACP server does not advertise HTTP MCP support.', 'ACP_MCP_UNSUPPORTED');
            const descriptor = await b.bridge.start();
            const session = await client.newSession(b.controller.signal, true, [descriptor]);
            b.sessionId = session.sessionId;
            await client.selectModel(session, o.model, b.controller.signal);
            client.onUpdate = (event) => {
                if (event.sessionId !== b.sessionId || b.done)
                    return;
                const u = event.update;
                if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
                    if (b.bridge.owns(u))
                        b.trustedAcpIds.add(u.toolCallId);
                    else if (!b.trustedAcpIds.has(u.toolCallId))
                        this.fail(b, new LlmError('Antigravity attempted a native tool outside the DSH MCP bridge. The request was cancelled.', 'ACP_NATIVE_TOOLS_UNSUPPORTED'));
                    return; // Agent-owned ACP updates are never fabricated into DSH tool calls.
                }
                const w = b.writer;
                if (w) {
                    w.queue.push(...w.mapper.update(u));
                    w.wake?.();
                }
            };
            client.onPermission = (request) => {
                if (request.sessionId === b.sessionId && b.bridge.owns(request.toolCall)) {
                    const allow = request.options.find((option) => option.kind === 'allow_once');
                    if (allow)
                        return { outcome: { outcome: 'selected', optionId: allow.optionId } };
                }
                this.fail(b, new LlmError('Antigravity requested permission for a tool outside the DSH bridge.', 'ACP_NATIVE_TOOLS_UNSUPPORTED'));
                return { outcome: { outcome: 'cancelled' } };
            };
            return b;
        }
        catch (error) {
            await this.close(b);
            throw error;
        }
    }
    matches(b, o) {
        const current = history(o.messages);
        return (signature(o) === b.signature &&
            current.length >= b.history.length &&
            b.history.every((m, i) => m === current[i]) &&
            !o.messages.slice(b.history.length).some((m) => m.role === 'user'));
    }
    resume(b, o) {
        const tail = o.messages.slice(b.history.length);
        const exposed = [...b.pending.values()].filter((p) => p.exposed);
        const results = exposed.map((p) => {
            const matching = tail.filter((m) => m.role === 'tool' && m.toolCallId === p.call.id);
            const hasCall = tail.some((m) => m.role === 'assistant' &&
                m.content.some((c) => c.type === 'tool-call' &&
                    c.id === p.call.id &&
                    c.name === p.call.name &&
                    c.arguments === p.call.arguments));
            if (matching.length !== 1 || !hasCall)
                throw new LlmError('A pending DSH tool call requires exactly one matching assistant call and tool result.', 'ACP_TOOL_RESULTS_MISSING');
            const message = matching[0];
            if (message.role !== 'tool')
                throw new Error('Unreachable');
            return {
                pending: p,
                result: {
                    isError: message.isError ?? false,
                    content: message.content.map((c) => ({
                        type: 'text',
                        text: c.type === 'text' || c.type === 'reasoning' ? c.text : JSON.stringify(c),
                    })),
                },
            };
        });
        if (!exposed.length)
            throw new LlmError('The ACP session has no exposed calls to resume.', 'ACP_SESSION_BUSY');
        b.history = history(o.messages);
        for (const { pending, result } of results) {
            b.pending.delete(pending.call.id);
            pending.resolve(result);
        }
        if (!b.pending.size)
            this.deadline(b, this.config.timeoutMs, 'ACP_TIMEOUT');
    }
    async *stream(o) {
        if (this.disposed)
            throw new LlmError('ACP adapter disposed.', 'ACP_DISPOSED');
        if (o.signal?.aborted)
            throw aborted();
        let b = this.find(o), fresh = !b, parked = false;
        if (b && (!b.sessionId || b.writer))
            throw new LlmError('This DSH session already has an active generation.', 'ACP_SESSION_BUSY');
        let prompt;
        try {
            prompt = buildPrompt(o, this.config);
        }
        catch (error) {
            if (b)
                await this.close(b);
            throw error;
        }
        if (b && !this.matches(b, o)) {
            await this.close(b);
            b = undefined;
            fresh = true;
        }
        b ??= await this.create(o);
        const w = {
            mapper: new EventMapper(),
            queue: [],
            toolReady: [...b.pending.values()].some((p) => !p.exposed),
        };
        b.writer = w;
        try {
            if (fresh) {
                this.generations++;
                this.deadline(b, this.config.timeoutMs, 'ACP_TIMEOUT');
                // Per-segment generation and tool deadlines above own the budget while MCP is parked.
                void b.client.prompt(b.sessionId, prompt, b.controller.signal, 2147483647).then((result) => {
                    b.stop = result.stopReason;
                    b.done = true;
                    b.writer?.wake?.();
                }, (error) => this.fail(b, error));
            }
            else {
                this.watch(b, o.signal);
                this.resume(b, o);
            }
            while (true) {
                while (w.queue.length) {
                    if (o.signal?.aborted)
                        throw aborted();
                    yield w.queue.shift();
                }
                if (b.error)
                    throw b.error;
                if (w.toolReady) {
                    yield* w.mapper.end();
                    let index = w.mapper.blockCount;
                    for (const pending of b.pending.values()) {
                        if (pending.exposed)
                            continue;
                        pending.exposed = true;
                        const call = pending.call;
                        yield { type: 'block-start', index, blockType: 'tool-call' };
                        yield {
                            type: 'tool-call-delta',
                            index,
                            id: call.id,
                            name: call.name,
                            argumentsDelta: call.arguments,
                        };
                        yield { type: 'block-end', index, block: call };
                        index++;
                    }
                    parked = true;
                    this.deadline(b, this.config.toolTimeoutMs, 'ACP_TOOL_TIMEOUT');
                    yield { type: 'finish', reason: { kind: 'tool-calls' } };
                    return;
                }
                if (b.done)
                    break;
                await new Promise((resolve) => {
                    w.wake = resolve;
                });
            }
            if (!w.mapper.hasText && b.stop === 'end_turn')
                throw new LlmError('Official ACP server ended without assistant text.', 'EMPTY_RESPONSE');
            yield* w.mapper.end();
            yield { type: 'finish', reason: finishReason(b.stop) };
        }
        catch (error) {
            throw o.signal?.aborted ? aborted() : classify(error);
        }
        finally {
            clearTimeout(w.batch);
            if (b.writer === w)
                b.writer = undefined;
            if (!parked)
                await this.close(b);
        }
    }
    async close(b) {
        if (b.cleanup)
            return b.cleanup;
        if (this.bindings.get(b.key) === b)
            this.bindings.delete(b.key);
        clearTimeout(b.timer);
        clearTimeout(b.writer?.batch);
        b.listeners.splice(0).forEach((remove) => remove());
        b.controller.abort();
        b.writer?.wake?.();
        const cleanup = (async () => {
            try {
                await b.client.cancelAndReset(b.sessionId);
            }
            finally {
                for (const pending of b.pending.values())
                    pending.resolve(unavailable());
                b.pending.clear();
                await b.bridge.close();
                await b.client.dispose();
                this.processStarts += b.client.processStarts;
                this.authentications += b.client.authentications;
            }
        })();
        b.cleanup = cleanup;
        this.closing.add(cleanup);
        void cleanup.then(() => this.closing.delete(cleanup), () => this.closing.delete(cleanup));
        return cleanup;
    }
    async dispose() {
        this.disposed = true;
        await Promise.all([...this.closing, ...[...this.bindings.values()].map((b) => this.close(b))]);
    }
}
