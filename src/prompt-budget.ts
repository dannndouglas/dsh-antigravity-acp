import type { RequestMessage } from '@deepseek-ai/dsh-llm';

export const DEFAULT_MAX_PROMPT_BYTES = 180000;
const TRIM_MARK = '\n...[trimmed by the DSH Antigravity adapter]';

export function promptBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function clipText(text: string, maxBytes: number): string {
  if (typeof text !== 'string' || promptBytes(text) <= maxBytes) return text;
  let out = text.slice(0, Math.max(0, maxBytes - promptBytes(TRIM_MARK) - 8));
  while (out.length && promptBytes(out) > maxBytes - promptBytes(TRIM_MARK)) {
    out = out.slice(0, Math.floor(out.length * 0.95));
  }
  return out + TRIM_MARK;
}

export function clipMessage(message: RequestMessage, maxBytes: number): RequestMessage {
  const content = [];
  let used = 0;
  for (const block of message.content ?? []) {
    const cost = promptBytes(JSON.stringify(block)) + 1;
    if (used + cost <= maxBytes) {
      content.push(block);
      used += cost;
      continue;
    }
    const room = maxBytes - used;
    if (room > 512) {
      if (block && block.type === 'text' && typeof (block as any).text === 'string') {
        content.push({ ...block, text: clipText((block as any).text, room - 2) });
      } else if (block && typeof (block as any).arguments === 'string') {
        content.push({ ...block, arguments: clipText((block as any).arguments, room - 2) });
      }
    }
    break;
  }
  return { ...message, content } as RequestMessage;
}

export function newestRoundStart(messages: readonly RequestMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return 0;
}

/**
 * Fit the serialized history under `limit` bytes. `assemble(messages)` returns
 * the final request text. Returns the prompt plus bookkeeping for callers/tests.
 */
export function withPromptBudget(
  messages: readonly RequestMessage[],
  assemble: (messages: RequestMessage[]) => string,
  limit: number = DEFAULT_MAX_PROMPT_BYTES,
): { prompt: string; messages: RequestMessage[]; dropped: number } {
  let visible = messages.slice();
  let prompt = assemble(visible);
  let dropped = 0;

  // Drop the oldest non-system messages; never touch the newest round.
  while (promptBytes(prompt) > limit) {
    const keepFrom = newestRoundStart(visible);
    let victim = -1;
    for (let i = 0; i < keepFrom; i++) {
      if (visible[i]?.role !== 'system') {
        victim = i;
        break;
      }
    }
    if (victim < 0) break;
    visible.splice(victim, 1);
    dropped += 1;
    prompt = assemble(visible);
  }

  // Last resort: the newest round alone is over budget (e.g. one huge tool result).
  // Clip text/arguments blocks until it fits.
  for (const cap of [32768, 8192, 2048]) {
    if (promptBytes(prompt) <= limit) break;
    visible = visible.map((message) => clipMessage(message, cap));
    prompt = assemble(visible);
  }

  return { prompt, messages: visible, dropped };
}
