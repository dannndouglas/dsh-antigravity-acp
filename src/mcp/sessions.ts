import { randomUUID } from 'node:crypto';
import {
  LlmError,
  type GenerateOptions,
  type StreamChunk,
  type ToolCallBlock,
  type RequestMessage,
} from '@deepseek-ai/dsh-llm';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AcpClient } from '../acp/client.js';
import { EventMapper, finishReason } from '../acp/events.js';
import { aborted, classify } from '../acp/errors.js';
import { buildPrompt } from '../prompt.js';
import type { Config } from '../config.js';
import { DshMcpBridge } from './bridge.js';

interface Pending {
  call: ToolCallBlock;
  exposed: boolean;
  resolve: (result: CallToolResult) => void;
}
interface Writer {
  mapper: EventMapper;
  queue: StreamChunk[];
  toolReady: boolean;
  wake?: () => void;
  batch?: ReturnType<typeof setTimeout>;
}
interface Binding {
  key: string;
  client: AcpClient;
  bridge: DshMcpBridge;
  controller: AbortController;
  sessionId?: string;
  history: string[];
  signature: string;
  pending: Map<string, Pending>;
  trustedAcpIds: Set<string>;
  writer?: Writer;
  done: boolean;
  stop: string;
  error?: unknown;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: Promise<void>;
  listeners: (() => void)[];
}
function history(messages: readonly RequestMessage[]): string[] {
  return messages.map((m) =>
    JSON.stringify({
      role: m.role,
      content: m.content,
      ...(m.role === 'tool' ? { toolCallId: m.toolCallId, isError: m.isError ?? false } : {}),
    }),
  );
}
function signature(o: GenerateOptions): string {
  return JSON.stringify({
    provider: o.provider,
    model: o.model,
    system: o.system ?? null,
    tools: o.tools ?? [],
  });
}
const unavailable = (): CallToolResult => ({
  isError: true,
  content: [
    { type: 'text', text: 'The DSH tool round trip was cancelled. No result is available.' },
  ],
});

/** Active turns own separate ACP processes, avoiding subagent deadlocks.
 * Completed processes can stay ready; every independent turn gets a fresh ACP session.
 */
export class ToolSessions {
  private bindings = new Map<string, Binding>();
  private closing = new Set<Promise<void>>();
  private idleClients = new Map<AcpClient, ReturnType<typeof setTimeout>>();
  private counts = new WeakMap<AcpClient, { starts: number; auth: number }>();
  private disposed = false;
  processStarts = 0;
  authentications = 0;
  generations = 0;
  constructor(
    private config: Config,
    private runtime: SubprocessRuntime,
    private notify: (message: string) => void,
  ) {}
  get active(): number {
    return this.bindings.size;
  }
  get idle(): number {
    return this.idleClients.size;
  }
  get connected(): boolean {
    return [...this.idleClients.keys(), ...[...this.bindings.values()].map((b) => b.client)].some(
      (client) => client.connected,
    );
  }
  private account(client: AcpClient): void {
    const previous = this.counts.get(client) ?? { starts: 0, auth: 0 };
    this.processStarts += client.processStarts - previous.starts;
    this.authentications += client.authentications - previous.auth;
    this.counts.set(client, { starts: client.processStarts, auth: client.authentications });
  }
  private track(cleanup: Promise<void>): Promise<void> {
    this.closing.add(cleanup);
    void cleanup.then(
      () => this.closing.delete(cleanup),
      () => this.closing.delete(cleanup),
    );
    return cleanup;
  }
  private takeClient(): AcpClient {
    for (const [client, timer] of this.idleClients) {
      this.idleClients.delete(client);
      clearTimeout(timer);
      if (client.connected) return client;
      void this.track(client.dispose()).catch(() => {});
    }
    return new AcpClient(this.config, this.runtime, this.notify);
  }
  private async keepClient(client: AcpClient): Promise<void> {
    client.onUpdate = undefined;
    client.onPermission = undefined;
    if (this.disposed || !client.connected || this.idleClients.size >= 2) {
      await client.dispose();
      return;
    }
    const timer = setTimeout(() => {
      this.idleClients.delete(client);
      void this.track(client.dispose()).catch(() => {});
    }, this.config.idleProcessTimeoutMs);
    timer.unref();
    this.idleClients.set(client, timer);
  }
  async acceptReadyClient(client: AcpClient): Promise<void> {
    try {
      await this.keepClient(client);
    } finally {
      this.account(client);
    }
  }
  private find(o: GenerateOptions): Binding | undefined {
    if (o.purpose) return undefined;
    if (o.sessionId) return this.bindings.get(o.sessionId);
    const ids = new Set(o.messages.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : [])));
    return [...this.bindings.values()].find((b) =>
      [...b.pending.values()].some((p) => p.exposed && ids.has(p.call.id)),
    );
  }
  has(o: GenerateOptions): boolean {
    return !!this.find(o);
  }
  private deadline(b: Binding, ms: number, code: string): void {
    clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      this.fail(
        b,
        new LlmError(
          code === 'ACP_TOOL_TIMEOUT'
            ? 'DSH did not return the tool result before the bridge deadline. Retry from the saved DSH conversation.'
            : 'Official ACP generation timed out.',
          code,
        ),
      );
      void this.close(b).catch(() => {});
    }, ms);
    b.timer.unref();
  }
  private fail(b: Binding, error: unknown): void {
    b.error ??= error;
    b.done = true;
    b.writer?.wake?.();
  }
  private watch(b: Binding, signal?: AbortSignal): void {
    if (!signal) return;
    const onAbort = () => {
      this.fail(b, aborted());
      void this.close(b).catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    b.listeners.push(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  }
  private queueTool(b: Binding, call: ToolCallBlock): Promise<CallToolResult> {
    if (b.done || b.controller.signal.aborted) return Promise.resolve(unavailable());
    if (b.pending.size >= 64)
      return Promise.resolve({
        isError: true,
        content: [{ type: 'text', text: 'Too many concurrent DSH tool calls.' }],
      });
    clearTimeout(b.timer);
    this.deadline(b, this.config.toolTimeoutMs, 'ACP_TOOL_TIMEOUT');
    const result = new Promise<CallToolResult>((resolve) =>
      b.pending.set(call.id, { call, resolve, exposed: false }),
    );
    const w = b.writer;
    if (w && !w.batch)
      w.batch = setTimeout(() => {
        w.batch = undefined;
        w.toolReady = true;
        w.wake?.();
      }, 10);
    return result;
  }
  private async create(o: GenerateOptions): Promise<Binding> {
    if (this.bindings.size >= this.config.maxActiveToolSessions)
      throw new LlmError(
        'Too many active ACP tool sessions. Finish or cancel an existing turn.',
        'ACP_SESSION_LIMIT',
      );
    const key = o.sessionId && !o.purpose ? o.sessionId : randomUUID();
    const client = this.takeClient();
    if (this.disposed || o.signal?.aborted) {
      await client.dispose();
      throw aborted();
    }
    const b: Binding = {
      key,
      client,
      bridge: undefined!,
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
        throw new LlmError(
          'Official ACP server does not advertise HTTP MCP support.',
          'ACP_MCP_UNSUPPORTED',
        );
      const descriptor = await b.bridge.start();
      const session = await client.newSession(b.controller.signal, true, [descriptor]);
      b.sessionId = session.sessionId;
      await client.selectModel(session, o.model, b.controller.signal);
      client.onUpdate = (event) => {
        if (event.sessionId !== b.sessionId || b.done) return;
        const u = event.update;
        if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
          if (b.bridge.owns(u)) b.trustedAcpIds.add(u.toolCallId);
          else if (!b.trustedAcpIds.has(u.toolCallId))
            this.fail(
              b,
              new LlmError(
                'Antigravity attempted a native tool outside the DSH MCP bridge. The request was cancelled.',
                'ACP_NATIVE_TOOLS_UNSUPPORTED',
              ),
            );
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
          if (allow) return { outcome: { outcome: 'selected', optionId: allow.optionId } };
        }
        this.fail(
          b,
          new LlmError(
            'Antigravity requested permission for a tool outside the DSH bridge.',
            'ACP_NATIVE_TOOLS_UNSUPPORTED',
          ),
        );
        return { outcome: { outcome: 'cancelled' } };
      };
      return b;
    } catch (error) {
      await this.close(b);
      throw error;
    }
  }
  private matches(b: Binding, o: GenerateOptions): boolean {
    const current = history(o.messages);
    return (
      signature(o) === b.signature &&
      current.length >= b.history.length &&
      b.history.every((m, i) => m === current[i]) &&
      !o.messages.slice(b.history.length).some((m) => m.role === 'user')
    );
  }
  private resume(b: Binding, o: GenerateOptions): void {
    const tail = o.messages.slice(b.history.length);
    const exposed = [...b.pending.values()].filter((p) => p.exposed);
    const results = exposed.map((p) => {
      const matching = tail.filter((m) => m.role === 'tool' && m.toolCallId === p.call.id);
      const hasCall = tail.some(
        (m) =>
          m.role === 'assistant' &&
          m.content.some(
            (c) =>
              c.type === 'tool-call' &&
              c.id === p.call.id &&
              c.name === p.call.name &&
              c.arguments === p.call.arguments,
          ),
      );
      if (matching.length !== 1 || !hasCall)
        throw new LlmError(
          'A pending DSH tool call requires exactly one matching assistant call and tool result.',
          'ACP_TOOL_RESULTS_MISSING',
        );
      const message = matching[0]!;
      if (message.role !== 'tool') throw new Error('Unreachable');
      return {
        pending: p,
        result: {
          isError: message.isError ?? false,
          content: message.content.map((c) => ({
            type: 'text' as const,
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
    if (!b.pending.size) this.deadline(b, this.config.timeoutMs, 'ACP_TIMEOUT');
  }
  async *stream(o: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.disposed) throw new LlmError('ACP adapter disposed.', 'ACP_DISPOSED');
    if (o.signal?.aborted) throw aborted();
    let b = this.find(o),
      fresh = !b,
      parked = false,
      completed = false;
    if (b && (!b.sessionId || b.writer))
      throw new LlmError('This DSH session already has an active generation.', 'ACP_SESSION_BUSY');
    let prompt: string;
    try {
      prompt = buildPrompt(o, this.config);
    } catch (error) {
      if (b) await this.close(b);
      throw error;
    }
    if (b && !this.matches(b, o)) {
      await this.close(b);
      b = undefined;
      fresh = true;
    }
    b ??= await this.create(o);
    const w: Writer = {
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
        void b.client.prompt(b.sessionId!, prompt, b.controller.signal, 2147483647).then(
          (result) => {
            b!.stop = result.stopReason;
            b!.done = true;
            b!.writer?.wake?.();
          },
          (error) => this.fail(b!, error),
        );
      } else {
        this.watch(b, o.signal);
        this.resume(b, o);
      }
      while (true) {
        while (w.queue.length) {
          if (o.signal?.aborted) throw aborted();
          yield w.queue.shift()!;
        }
        if (b.error) throw b.error;
        if (w.toolReady) {
          yield* w.mapper.end();
          let index = w.mapper.blockCount;
          for (const pending of b.pending.values()) {
            if (pending.exposed) continue;
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
        if (b.done) break;
        await new Promise<void>((resolve) => {
          w.wake = resolve;
        });
      }
      if (!w.mapper.hasText && b.stop === 'end_turn')
        throw new LlmError('Official ACP server ended without assistant text.', 'EMPTY_RESPONSE');
      yield* w.mapper.end();
      completed = b.stop === 'end_turn';
      yield { type: 'finish', reason: finishReason(b.stop) };
    } catch (error) {
      throw o.signal?.aborted ? aborted() : classify(error);
    } finally {
      clearTimeout(w.batch);
      if (b.writer === w) b.writer = undefined;
      if (!parked) await this.close(b, completed && !o.signal?.aborted && !b.error);
    }
  }
  private async close(b: Binding, reusable = false): Promise<void> {
    if (b.cleanup) return b.cleanup;
    if (this.bindings.get(b.key) === b) this.bindings.delete(b.key);
    clearTimeout(b.timer);
    clearTimeout(b.writer?.batch);
    b.listeners.splice(0).forEach((remove) => remove());
    b.controller.abort();
    b.writer?.wake?.();
    const cleanup = (async () => {
      try {
        if (!reusable) await b.client.cancelAndReset(b.sessionId);
      } finally {
        for (const pending of b.pending.values()) pending.resolve(unavailable());
        b.pending.clear();
        let bridgeClosed = false;
        try {
          await b.bridge.close();
          bridgeClosed = true;
        } finally {
          try {
            if (reusable && bridgeClosed) await this.keepClient(b.client);
            else await b.client.dispose();
          } finally {
            this.account(b.client);
          }
        }
      }
    })();
    b.cleanup = cleanup;
    return this.track(cleanup);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    const idle = [...this.idleClients].map(([client, timer]) => {
      clearTimeout(timer);
      return client.dispose();
    });
    this.idleClients.clear();
    await Promise.all([
      ...idle,
      ...this.closing,
      ...[...this.bindings.values()].map((b) => this.close(b)),
    ]);
  }
}
