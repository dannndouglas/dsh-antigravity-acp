import { type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import { AcpClient } from '../acp/client.js';
import type { Config } from '../config.js';
import type { AcpGenerateOptions as GenerateOptions } from '../request.js';
/** Active turns own separate ACP processes, avoiding subagent deadlocks.
 * A completed turn keeps its ACP session briefly so the next user message is a follow-up.
 * A new session, when one is required, receives the current task rather than the tool transcript.
 */
export declare class ToolSessions {
    private config;
    private runtime;
    private notify;
    private bindings;
    private retained;
    private closing;
    private idleClients;
    private borrowedClients;
    private counts;
    private disposed;
    processStarts: number;
    authentications: number;
    generations: number;
    constructor(config: Config, runtime: SubprocessRuntime, notify: (message: string) => void);
    get active(): number;
    get idle(): number;
    get connected(): boolean;
    private account;
    private track;
    borrowReadyClient(): AcpClient | undefined;
    private takeClient;
    private keepClient;
    acceptReadyClient(client: AcpClient): Promise<void>;
    discardReadyClient(client: AcpClient): Promise<void>;
    private find;
    has(o: GenerateOptions): boolean;
    private deadline;
    private fail;
    private watch;
    private queueTool;
    private create;
    private canFollowUp;
    private claimFollowUp;
    private relinquish;
    private donateProcess;
    private retain;
    private matches;
    private resume;
    stream(o: GenerateOptions): AsyncIterable<StreamChunk>;
    private close;
    dispose(): Promise<void>;
}
