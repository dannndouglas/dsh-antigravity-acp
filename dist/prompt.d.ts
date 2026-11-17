import type { AcpGenerateOptions as GenerateOptions } from './request.js';
import type { Config } from './config.js';
type Message = GenerateOptions['messages'][number];
/**
 * Antigravity silently cuts one ACP user request after ~192,000 UTF-8 bytes,
 * from the tail, whether the prompt is one text block, several blocks or
 * embedded resources. Prompts are therefore budgeted below that cap.
 */
export declare const DEFAULT_MAX_PROMPT_BYTES = 180000;
export declare const utf8Bytes: (text: string) => number;
/** Index of the latest person-authored user message with text, if any. */
export declare function latestHumanIndex(messages: readonly Message[]): number;
/** Keep the head and tail of oversized text, marking the omitted middle. */
export declare function clipText(text: string, maxBytes: number): string;
export interface PromptPlan {
    prompt: string;
    bytes: number;
    /** Oldest history messages left out to fit the byte budget. */
    omittedMessages: number;
    /** Text fields shortened to fit the byte budget. */
    clippedBlocks: number;
}
/**
 * Serialize DSH-owned history into one ACP prompt within `config.maxPromptBytes`.
 *
 * The current request is quoted first, so even an unexpected server-side tail
 * cut cannot remove it. When the budget is exceeded, whole oldest rounds are
 * omitted first (DSH compaction should normally prevent this), then the largest
 * remaining text fields are shortened head-and-tail.
 */
export declare function planPrompt(options: GenerateOptions, config: Config): PromptPlan;
export declare function buildPrompt(options: GenerateOptions, config: Config): string;
export {};
