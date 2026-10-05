import { LlmAdapter, LlmError, } from '@deepseek-ai/dsh-llm';
import { AcpClient } from './acp/client.js';
import { EventMapper, finishReason } from './acp/events.js';
import { aborted, classify } from './acp/errors.js';
import { modelCatalog } from './models.js';
import { buildPrompt } from './prompt.js';
export class AntigravityAcpAdapter extends LlmAdapter {
    config;
    warn;
    client;
    tail = Promise.resolve();
    disposed = false;
    lifetime = new AbortController();
    generations = 0;
    warnedTools = false;
    catalog = [];
    constructor(config, runtime, warn = () => { }) {
        super();
        this.config = config;
        this.warn = warn;
        this.client = new AcpClient(config, runtime);
    }
    providerInfo(provider) {
        return { id: provider, name: 'Antigravity (official ACP · text only)' };
    }
    async acquire(signal) {
        if (this.disposed)
            throw new LlmError('Antigravity adapter has been disposed.', 'ACP_DISPOSED');
        if (signal?.aborted)
            throw aborted();
        const previous = this.tail;
        let release;
        this.tail = new Promise((resolve) => {
            release = resolve;
        });
        let onAbort;
        try {
            const abort = new Promise((_, reject) => {
                onAbort = () => reject(aborted());
                signal?.addEventListener('abort', onAbort, { once: true });
                if (signal?.aborted)
                    onAbort();
            });
            await Promise.race([previous, abort]);
            if (this.disposed)
                throw new LlmError('Antigravity adapter has been disposed.', 'ACP_DISPOSED');
            return release;
        }
        catch (error) {
            void previous.then(release);
            throw error;
        }
        finally {
            if (onAbort)
                signal?.removeEventListener('abort', onAbort);
        }
    }
    async listModels(provider) {
        const release = await this.acquire(this.lifetime.signal);
        try {
            if (!this.catalog.length) {
                try {
                    this.catalog = modelCatalog(await this.client.newSession(this.lifetime.signal, false));
                }
                catch (error) {
                    await this.client.reset();
                    this.warn(classify(error).message);
                }
            }
            const entries = new Map([...this.catalog, ...this.config.models.map((id) => ({ id, name: id }))].map((m) => [
                m.id,
                m,
            ]));
            if (!entries.size)
                entries.set('server-default', {
                    id: 'server-default',
                    name: 'Server default (login / discovery pending)',
                });
            return [...entries.values()].map((m) => ({
                ...m,
                provider,
                inputModalities: ['text'],
                description: 'Official ACP text backend; DSH tool execution unavailable',
            }));
        }
        finally {
            release();
        }
    }
    async resolveModel(provider, model, signal) {
        if (signal?.aborted)
            throw aborted();
        return {
            provider,
            id: model,
            name: this.catalog.find((m) => m.id === model)?.name ?? model,
            inputModalities: ['text'],
        };
    }
    diagnostics() {
        return {
            connected: this.client.connected,
            processStarts: this.client.processStarts,
            authentications: this.client.authentications,
            generations: this.generations,
        };
    }
    async *stream(options) {
        options = {
            ...options,
            signal: options.signal
                ? AbortSignal.any([options.signal, this.lifetime.signal])
                : this.lifetime.signal,
        };
        const prompt = buildPrompt(options, this.config); // Validate before spawning or authenticating.
        const release = await this.acquire(options.signal);
        const mapper = new EventMapper();
        let sessionId, completed = false, promptStarted = false;
        const queue = [];
        let wake;
        let error;
        let done = false;
        try {
            if (options.tools?.length && !this.warnedTools) {
                this.warnedTools = true;
                this.warn('Antigravity ACP is a text-only route: DSH tool schemas are omitted and tool execution is unavailable (toolPolicy: text-only).');
            }
            const session = await this.client.newSession(options.signal);
            sessionId = session.sessionId;
            this.catalog = modelCatalog(session);
            await this.client.selectModel(session, options.model, options.signal);
            this.generations++;
            const nativeTools = () => {
                error = new LlmError('Antigravity attempted native agent tool activity. This provider supports text only; tools remain unavailable on this route.', 'ACP_NATIVE_TOOLS_UNSUPPORTED');
                done = true;
                wake?.();
            };
            this.client.onPermission = nativeTools;
            this.client.onUpdate = (event) => {
                if (event.sessionId !== sessionId || done)
                    return;
                if (event.update.sessionUpdate === 'tool_call' ||
                    event.update.sessionUpdate === 'tool_call_update') {
                    nativeTools();
                    return;
                }
                queue.push(...mapper.update(event.update));
                wake?.();
            };
            let stop = '';
            promptStarted = true;
            const pending = this.client.prompt(sessionId, prompt, options.signal).then((result) => {
                stop = result.stopReason;
                done = true;
                wake?.();
            }, (failure) => {
                error = failure;
                done = true;
                wake?.();
            });
            while (!done || queue.length) {
                while (queue.length) {
                    if (options.signal?.aborted)
                        throw aborted();
                    yield queue.shift();
                }
                if (!done)
                    await new Promise((resolve) => {
                        wake = resolve;
                    });
            }
            if (error)
                throw error;
            await pending;
            if (options.signal?.aborted)
                throw aborted();
            if (!mapper.hasText && stop === 'end_turn')
                throw new LlmError('Official ACP server ended the turn without assistant text.', 'EMPTY_RESPONSE');
            yield* mapper.end();
            // ACP usage_update reports current context occupancy, not per-call token billing.
            completed = true;
            yield { type: 'finish', reason: finishReason(stop) };
        }
        catch (failure) {
            throw options.signal?.aborted ? aborted() : classify(failure);
        }
        finally {
            this.client.onUpdate = undefined;
            this.client.onPermission = undefined;
            try {
                if (!completed)
                    await this.client.cancelAndReset(promptStarted ? sessionId : undefined);
            }
            finally {
                release();
            }
        }
    }
    async dispose() {
        this.disposed = true;
        this.lifetime.abort();
        await this.client.dispose();
    }
}
