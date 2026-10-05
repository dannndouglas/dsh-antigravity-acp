export class EventMapper {
    blocks = new Map();
    get hasText() {
        return !!this.blocks.get('text')?.text;
    }
    update(update) {
        if (update.sessionUpdate !== 'agent_message_chunk' &&
            update.sessionUpdate !== 'agent_thought_chunk')
            return [];
        if (update.content.type !== 'text' || !update.content.text)
            return [];
        const type = update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'text';
        const chunks = [];
        let block = this.blocks.get(type);
        if (!block) {
            block = { index: this.blocks.size, text: '' };
            this.blocks.set(type, block);
            chunks.push({ type: 'block-start', index: block.index, blockType: type });
        }
        block.text += update.content.text;
        chunks.push(type === 'text'
            ? { type: 'text-delta', index: block.index, text: update.content.text }
            : { type: 'reasoning-delta', index: block.index, text: update.content.text });
        return chunks;
    }
    end() {
        return [...this.blocks].map(([type, b]) => ({
            type: 'block-end',
            index: b.index,
            block: { type, text: b.text },
        }));
    }
}
export function finishReason(reason) {
    switch (reason) {
        case 'end_turn':
            return { kind: 'stop' };
        case 'max_tokens':
            return { kind: 'max-tokens' };
        case 'cancelled':
            return {
                kind: 'aborted',
                failure: { code: 'ABORTED', message: 'Official ACP generation was cancelled.' },
            };
        case 'refusal':
            return {
                kind: 'error',
                failure: { code: 'ACP_REFUSAL', message: 'Official ACP server refused the prompt.' },
            };
        case 'max_turn_requests':
            return {
                kind: 'error',
                failure: {
                    code: 'ACP_TURN_LIMIT',
                    message: 'Official ACP agent reached its turn request limit.',
                },
            };
        default:
            return {
                kind: 'error',
                failure: {
                    code: 'ACP_UNKNOWN_STOP',
                    message: 'Official ACP server returned an unrecognized stop reason.',
                },
            };
    }
}
