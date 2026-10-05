import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import type { Config } from '../config.js';
export declare function resolveCommand(config: Config, runtime: SubprocessRuntime, signal?: AbortSignal): Promise<string>;
export declare function serverArgs(config: Config, command: string): string[];
export declare function disposeProcess(child: SubprocessHandle, graceMs: number): Promise<void>;
