import type { Context } from '@deepseek-ai/cordis';
import { AntigravityAcpAdapter } from './adapter.js';
import { Config } from './config.js';
export declare const name = "llm-antigravity-acp";
export declare const inject: string[];
export { Config, AntigravityAcpAdapter };
export declare function apply(ctx: Context, config: Config): void;
