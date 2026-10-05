import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmError } from '@deepseek-ai/dsh-llm';
import { methods, } from '@agentclientprotocol/sdk';
import { connectTransport } from './transport.js';
import { disposeProcess, resolveCommand, serverArgs } from './process.js';
import { aborted, classify } from './errors.js';
import { modelOption, selectValues } from '../models.js';
/** One process per adapter, serialized by the adapter. No credentials or history are persisted here. */
export class AcpClient {
    config;
    runtime;
    notify;
    connection;
    child;
    cwd;
    stopping;
    sessionCount = 0;
    disposed = false;
    initializeResult;
    processStarts = 0;
    authentications = 0;
    onUpdate;
    onPermission;
    constructor(config, runtime, notify = () => { }) {
        this.config = config;
        this.runtime = runtime;
        this.notify = notify;
    }
    get connected() {
        return !!this.connection && !this.connection.signal.aborted;
    }
    async bounded(operation, timeoutMs, signal) {
        let timer;
        let onAbort;
        const interruption = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new LlmError('Official ACP operation timed out. The process will be reset; retry to reconnect.', 'ACP_TIMEOUT')), timeoutMs);
            onAbort = () => reject(aborted());
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted)
                onAbort();
        });
        try {
            return await Promise.race([operation, interruption]);
        }
        catch (error) {
            throw classify(error);
        }
        finally {
            clearTimeout(timer);
            if (onAbort)
                signal?.removeEventListener('abort', onAbort);
        }
    }
    async start(signal) {
        if (this.disposed)
            throw new LlmError('ACP client has been disposed.', 'ACP_DISPOSED');
        if (signal?.aborted)
            throw aborted();
        if (this.stopping)
            await this.stopping;
        if (this.connected)
            return;
        if (this.child)
            await this.reset();
        try {
            const command = await resolveCommand(this.config, this.runtime, signal, this.notify);
            const cwd = this.cwd ?? (await mkdtemp(join(tmpdir(), 'dsh-antigravity-acp-')));
            if (this.disposed || signal?.aborted) {
                if (!this.cwd)
                    await rm(cwd, { recursive: true, force: true });
                throw aborted();
            }
            this.cwd = cwd;
            this.child = this.runtime.spawn({
                argv: [command, ...serverArgs(this.config, command)],
                cwd: this.cwd,
                stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
                graceMs: this.config.disposeGraceMs,
                env: { PYTHONUNBUFFERED: '1' },
            });
            this.processStarts++;
            const child = this.child;
            if (!child.stdin || !child.stdout)
                throw new LlmError('ACP subprocess did not expose stdio pipes.', 'ACP_DISCONNECTED');
            // Drain without logging or retaining server diagnostics (may contain account/auth data).
            child.stderr?.resume();
            const connection = connectTransport(child.stdout, child.stdin, (event) => this.onUpdate?.(event), () => this.onPermission?.());
            this.connection = connection;
            void child.done.then(() => connection.close(), () => connection.close());
            const init = await this.bounded(connection.agent.request(methods.agent.initialize, {
                protocolVersion: 1,
                clientInfo: { name: 'dsh-antigravity-acp', version: '0.2.0' },
                clientCapabilities: {
                    fs: { readTextFile: false, writeTextFile: false },
                    terminal: false,
                },
            }), this.config.requestTimeoutMs, signal);
            if (init.protocolVersion !== 1)
                throw new LlmError('The official server did not negotiate ACP v1.', 'ACP_VERSION_MISMATCH');
            this.initializeResult = init;
        }
        catch (error) {
            await this.reset();
            throw signal?.aborted ? aborted() : classify(error);
        }
    }
    async login(signal) {
        await this.start(signal);
        const method = this.initializeResult?.authMethods?.find((m) => m.id === this.config.auth);
        if (!method || ('type' in method && method.type === 'terminal'))
            throw new LlmError('This server does not advertise protocol-driven oauth-personal authentication.', 'ACP_AUTH_UNSUPPORTED');
        this.notify('Authorize your Google account in the browser opened by the official Antigravity server. DSH will continue automatically.');
        await this.bounded(this.connection.agent.request(methods.agent.authenticate, { methodId: method.id }), this.config.authTimeoutMs, signal);
        this.authentications++;
    }
    async newSession(signal, authenticate = true) {
        // ACP has no universal session disposal; periodically recycle between turns.
        if (this.sessionCount >= this.config.maxSessionsPerProcess)
            await this.reset();
        await this.start(signal);
        const create = () => this.bounded(this.connection.agent.request(methods.agent.session.new, {
            cwd: this.cwd,
            mcpServers: [],
        }), this.config.requestTimeoutMs, signal);
        let session;
        try {
            session = await create();
        }
        catch (error) {
            if (!authenticate || !(error instanceof LlmError) || error.code !== 'ACP_AUTH_REQUIRED')
                throw error;
            await this.login(signal);
            session = await create();
        }
        this.sessionCount++;
        return session;
    }
    async selectModel(session, model, signal) {
        const option = modelOption(session);
        const wanted = model === 'server-default' ? this.config.defaultModel : model || this.config.defaultModel;
        if (!wanted)
            return;
        if (!option || !selectValues(option).some((c) => c.value === wanted))
            throw new LlmError('Selected model is not announced in the official ACP model selector. Run doctor and use an exact server model ID.', 'ACP_INVALID_MODEL');
        if (option.currentValue === wanted)
            return;
        await this.bounded(this.connection.agent.request(methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: option.id,
            value: wanted,
        }), this.config.requestTimeoutMs, signal);
    }
    prompt(sessionId, text, signal) {
        return this.bounded(this.connection.agent.request(methods.agent.session.prompt, {
            sessionId,
            prompt: [{ type: 'text', text }],
        }), this.config.timeoutMs, signal);
    }
    async logout(signal) {
        await this.start(signal);
        if (!this.initializeResult?.agentCapabilities?.auth?.logout)
            throw new LlmError('The official server does not advertise logout.', 'ACP_METHOD_UNSUPPORTED');
        await this.bounded(this.connection.agent.request('logout', {}), this.config.requestTimeoutMs, signal);
        await this.reset();
    }
    async cancelAndReset(sessionId) {
        if (this.stopping)
            return this.stopping;
        if (sessionId && this.connected) {
            // ACP cancel is a notification, not a JSON-RPC request.
            try {
                await this.bounded(this.connection.agent.notify(methods.agent.session.cancel, { sessionId }), this.config.cancelGraceMs);
            }
            catch {
                /* reset owns cleanup */
            }
        }
        await this.reset();
    }
    async reset() {
        if (this.stopping)
            return this.stopping;
        const child = this.child, connection = this.connection;
        this.child = undefined;
        this.connection = undefined;
        this.initializeResult = undefined;
        this.sessionCount = 0;
        this.stopping = (async () => {
            connection?.close();
            if (child)
                await disposeProcess(child, this.config.disposeGraceMs);
        })();
        try {
            await this.stopping;
        }
        catch {
            throw new LlmError('Official ACP subprocess cleanup failed. Restart this DSH profile before retrying.', 'ACP_TEARDOWN_FAILED');
        }
        finally {
            this.stopping = undefined;
        }
    }
    async dispose() {
        this.disposed = true;
        await this.reset();
        if (this.cwd) {
            await rm(this.cwd, { recursive: true, force: true });
            this.cwd = undefined;
        }
    }
}
