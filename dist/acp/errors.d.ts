import { LlmError } from '@deepseek-ai/dsh-llm';
/**
 * Raise an ACP failure while remaining constructible on both DSH contracts.
 * 0.2.2-rc.2 types accept only built-in codes; its runtime still accepts any
 * non-empty string. `fromFailure` does not exist on 0.2.2-rc.1.
 */
export declare function acpError(message: string, code: string): LlmError;
export declare function aborted(): LlmError;
export declare function classify(error: unknown): LlmError;
