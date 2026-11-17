import { LlmError } from '@deepseek-ai/dsh-llm';
/**
 * Raise an adapter-specific ACP failure on every supported DSH contract.
 * DSH 0.2.2-rc.2 narrowed the constructor's type to built-in codes, while its
 * runtime (like every earlier release) still accepts any non-empty code.
 * `LlmError.fromFailure` is not used because 0.2.2-rc.1 and older lack it.
 */
export declare function acpError(message: string, code: string): LlmError;
export declare function aborted(): LlmError;
export declare function classify(error: unknown): LlmError;
