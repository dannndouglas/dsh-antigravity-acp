import type { AcpGenerateOptions as GenerateOptions } from './request.js';
import type { Config } from './config.js';
type ConversationMessage = GenerateOptions['messages'][number];
/** Latest person-authored request, ignoring harness notices appended after it. */
export declare function latestHumanText(messages: readonly ConversationMessage[]): string | undefined;
/**
 * Prompt for a new user message on an ACP session that already has the conversation.
 * The session must not be given the tool transcript again.
 */
export declare function followUpPrompt(task: string): string;
export declare function buildPrompt(options: GenerateOptions, config: Config): string;
export {};
