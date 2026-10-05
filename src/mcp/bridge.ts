import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { Ajv, type ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { LlmError, ToolCallId, type ToolSchema, type ToolCallBlock } from '@deepseek-ai/dsh-llm';
import type { McpServerHttp } from '@agentclientprotocol/sdk';

const MAX_BODY = 1024 * 1024;
export function mcpToolName(name: string): string {
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 12);
  return `dsh_${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${hash}`;
}
export class DshMcpBridge {
  readonly tools: { mcpName: string; schema: ToolSchema; validate: ValidateFunction }[];
  private token = randomBytes(32).toString('hex');
  private http?: ReturnType<typeof createServer>;
  private protocols = new Set<Server>();
  constructor(
    tools: readonly ToolSchema[],
    private onCall: (call: ToolCallBlock) => Promise<CallToolResult>,
  ) {
    if (tools.length > 256)
      throw new LlmError(
        'The MCP bridge supports at most 256 active tools.',
        'ACP_TOOL_CATALOG_INVALID',
      );
    const names = new Set<string>();
    const ajv = new Ajv({ strict: false, validateFormats: false, logger: false });
    const ajv2020 = new Ajv2020({ strict: false, validateFormats: false, logger: false });
    this.tools = tools.map((tool) => {
      if (!tool.name || names.has(tool.name) || JSON.stringify(tool).length > 131072)
        throw new LlmError(
          'DSH tool names must be unique and schemas bounded to 128 KiB.',
          'ACP_TOOL_CATALOG_INVALID',
        );
      names.add(tool.name);
      const schema = structuredClone(tool);
      // DSH uses object tool arguments. Preserve the schema instead of silently dropping constraints.
      schema.parameters = { type: 'object', ...schema.parameters };
      let validate: ValidateFunction;
      try {
        const validator = String(schema.parameters.$schema ?? '').includes('2020-12')
          ? ajv2020
          : ajv;
        if (schema.parameters.$async) throw new Error('Async schema');
        validate = validator.compile(schema.parameters);
      } catch {
        throw new LlmError(
          `Cannot validate the JSON schema for DSH tool ${tool.name}.`,
          'ACP_TOOL_CATALOG_INVALID',
        );
      }
      const mcpName = mcpToolName(tool.name);
      return { mcpName, schema, validate };
    });
  }
  owns(call: { _meta?: Record<string, unknown> | null; title?: string | null }): boolean {
    const meta = call._meta?.mcp;
    if (!meta || typeof meta !== 'object') return false;
    const { server, tool } = meta as Record<string, unknown>;
    return server === 'dsh-bridge' && this.tools.some((t) => t.mcpName === tool);
  }
  async start(): Promise<McpServerHttp & { type: 'http' }> {
    if (this.http) throw new LlmError('MCP bridge already started.', 'ACP_BRIDGE_STATE');
    this.http = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(400);
        response.end();
      });
    });
    this.http.maxConnections = 32;
    this.http.requestTimeout = 30000;
    this.http.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.http!.once('error', reject);
      this.http!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.http.address();
    if (!address || typeof address === 'string')
      throw new LlmError('Cannot bind MCP bridge.', 'ACP_BRIDGE_STATE');
    return {
      type: 'http',
      name: 'dsh-bridge',
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: [{ name: 'Authorization', value: `Bearer ${this.token}` }],
    };
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const auth = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${this.token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      response.writeHead(401).end();
      return;
    }
    if (request.headers.origin) {
      response.writeHead(403).end();
      return;
    }
    const address = this.http!.address();
    const host = typeof address === 'object' && address ? `127.0.0.1:${address.port}` : '';
    if (request.headers.host !== host) {
      response.writeHead(403).end();
      return;
    }
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    let size = 0;
    const parts: Buffer[] = [];
    for await (const part of request) {
      size += part.length;
      if (size > MAX_BODY) {
        response.writeHead(413).end();
        return;
      }
      parts.push(part);
    }
    const body: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const protocol = new Server(
      { name: 'dsh-bridge', version: '0.3.2' },
      { capabilities: { tools: {} } },
    );
    this.protocols.add(protocol);
    protocol.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.tools.map((t) => ({
        name: t.mcpName,
        description: `DSH tool ${t.schema.name}: ${t.schema.description}`,
        inputSchema: t.schema.parameters as { type: 'object' },
      })),
    }));
    protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.tools.find((t) => t.mcpName === request.params.name);
      const args = request.params.arguments ?? {};
      if (!tool || !tool.validate(args))
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Unknown DSH tool or arguments rejected by its JSON schema.' },
          ],
        };
      // HTTP remains pending until DSH supplies the real result. This bridge executes nothing.
      return this.onCall({
        type: 'tool-call',
        id: ToolCallId(`acp_${randomBytes(16).toString('hex')}`),
        name: tool.schema.name,
        arguments: JSON.stringify(args),
      });
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await protocol.connect(transport);
      await transport.handleRequest(request, response, body);
    } finally {
      this.protocols.delete(protocol);
      await protocol.close();
    }
  }
  async close(): Promise<void> {
    const http = this.http;
    this.http = undefined;
    if (!http) return;
    await Promise.allSettled([...this.protocols].map((p) => p.close()));
    this.protocols.clear();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
}
