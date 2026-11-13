import type { RequestMessage } from '@deepseek-ai/dsh-llm';
export declare const DEFAULT_MAX_PROMPT_BYTES = 180000;
export declare function promptBytes(value: string): number;
export declare function clipText(text: string, maxBytes: number): string;
export declare function clipMessage(message: RequestMessage, maxBytes: number): RequestMessage;
export declare function newestRoundStart(messages: readonly RequestMessage[]): number;
/**
 * Fit the serialized history under `limit` bytes. `assemble(messages)` returns
 * the final request text. Returns the prompt plus bookkeeping for callers/tests.
 */
export declare function withPromptBudget(messages: readonly RequestMessage[], assemble: (messages: RequestMessage[]) => string, limit?: number): {
    prompt: string;
    messages: RequestMessage[];
    dropped: number;
};
