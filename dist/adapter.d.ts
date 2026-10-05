import { LlmAdapter, type GenerateOptions, type StreamChunk, type LlmModelInfo, type LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import { AcpClient } from './acp/client.js';
import type { Config } from './config.js';
export declare class AntigravityAcpAdapter extends LlmAdapter {
    readonly config: Config;
    private runtime;
    private warn;
    private controlClient;
    private tools;
    private tail;
    private disposed;
    private lifetime;
    private generations;
    private warnedTools;
    private catalog;
    constructor(config: Config, runtime: SubprocessRuntime, warn?: (message: string) => void);
    get client(): AcpClient;
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    private acquire;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    diagnostics(): {
        connected: boolean;
        processStarts: number;
        authentications: number;
        generations: number;
        activeToolSessions: number;
        idleToolProcesses: number;
    };
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    dispose(): Promise<void>;
}
