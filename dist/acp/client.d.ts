import { type InitializeResponse, type NewSessionResponse, type SessionNotification, type PromptResponse } from '@agentclientprotocol/sdk';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { Config } from '../config.js';
/** One process per adapter, serialized by the adapter. No credentials or history are persisted here. */
export declare class AcpClient {
    readonly config: Config;
    readonly runtime: SubprocessRuntime;
    private connection?;
    private child?;
    private cwd?;
    private stopping?;
    private sessionCount;
    private disposed;
    initializeResult?: InitializeResponse;
    processStarts: number;
    authentications: number;
    onUpdate?: (event: SessionNotification) => void;
    onPermission?: () => void;
    constructor(config: Config, runtime: SubprocessRuntime);
    get connected(): boolean;
    private bounded;
    start(signal?: AbortSignal): Promise<void>;
    login(signal?: AbortSignal): Promise<void>;
    newSession(signal?: AbortSignal, authenticate?: boolean): Promise<NewSessionResponse>;
    selectModel(session: NewSessionResponse, model: string, signal?: AbortSignal): Promise<void>;
    prompt(sessionId: string, text: string, signal?: AbortSignal): Promise<PromptResponse>;
    logout(signal?: AbortSignal): Promise<void>;
    cancelAndReset(sessionId?: string): Promise<void>;
    reset(): Promise<void>;
    dispose(): Promise<void>;
}
