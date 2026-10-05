import { LlmError } from '@deepseek-ai/dsh-llm';
import { RequestError } from '@agentclientprotocol/sdk';
export function aborted() {
    return new LlmError('Antigravity generation was interrupted.', 'ABORTED');
}
export function classify(error) {
    if (error instanceof LlmError)
        return error;
    if (error instanceof RequestError) {
        if (error.code === -32000 &&
            /auth|log.?in|sign.?in/i.test(error.message + JSON.stringify(error.data ?? {})))
            return new LlmError('Antigravity requires authentication. Run dsh-antigravity-acp login, then retry.', 'ACP_AUTH_REQUIRED');
        if (error.code === -32602)
            return new LlmError('The official ACP server rejected the request parameters or model.', 'ACP_INVALID_PARAMS');
        if (error.code === -32601)
            return new LlmError('The official ACP server does not support the requested method. Check its version.', 'ACP_METHOD_UNSUPPORTED');
        return new LlmError(`Official ACP server returned JSON-RPC error ${error.code}.`, 'ACP_RPC_ERROR');
    }
    // Raw stderr, remote error messages, RPC data and causes can contain credentials.
    return new LlmError('Connection to the official ACP server ended. Retry to reconnect.', 'ACP_DISCONNECTED');
}
