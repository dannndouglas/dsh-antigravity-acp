import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type ValidateFunction } from 'ajv';
import { type ToolSchema, type ToolCallBlock } from '@deepseek-ai/dsh-llm';
import type { McpServerHttp } from '@agentclientprotocol/sdk';
export declare function mcpToolName(name: string): string;
export declare class DshMcpBridge {
    private onCall;
    readonly tools: {
        mcpName: string;
        schema: ToolSchema;
        validate: ValidateFunction;
    }[];
    private token;
    private http?;
    private protocols;
    constructor(tools: readonly ToolSchema[], onCall: (call: ToolCallBlock) => Promise<CallToolResult>);
    owns(call: {
        _meta?: Record<string, unknown> | null;
        title?: string | null;
    }): boolean;
    start(): Promise<McpServerHttp & {
        type: 'http';
    }>;
    private handle;
    close(): Promise<void>;
}
