import { type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { Config } from '../config.js';
/** A separate managed ACP process for each in-flight tool turn avoids subagent deadlocks.
 * The only retained state is an unfinished MCP exchange. DSH history starts every new turn.
 */
export declare class ToolSessions {
    private config;
    private runtime;
    private notify;
    private bindings;
    private closing;
    private disposed;
    processStarts: number;
    authentications: number;
    generations: number;
    constructor(config: Config, runtime: SubprocessRuntime, notify: (message: string) => void);
    get active(): number;
    private find;
    has(o: GenerateOptions): boolean;
    private deadline;
    private fail;
    private watch;
    private queueTool;
    private create;
    private matches;
    private resume;
    stream(o: GenerateOptions): AsyncIterable<StreamChunk>;
    private close;
    dispose(): Promise<void>;
}
