import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { StreamChunk, FinishReason } from '@deepseek-ai/dsh-llm';
export declare class EventMapper {
    private blocks;
    get hasText(): boolean;
    update(update: SessionUpdate): StreamChunk[];
    end(): StreamChunk[];
}
export declare function finishReason(reason: string): FinishReason;
