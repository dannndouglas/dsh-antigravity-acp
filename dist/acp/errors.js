import { LlmError } from '@deepseek-ai/dsh-llm';
import { RequestError } from '@agentclientprotocol/sdk';
/**
 * Raise an ACP failure while remaining constructible on both DSH contracts.
 * 0.2.2-rc.2 types accept only built-in codes; its runtime still accepts any
 * non-empty string. `fromFailure` does not exist on 0.2.2-rc.1.
 */
export function acpError(message, code) {
    return new LlmError(message, code);
}
export function aborted() {
    return acpError('Antigravity generation was interrupted.', 'ABORTED');
}
export function classify(error) {
    if (error instanceof LlmError)
        return error;
    if (error instanceof RequestError) {
        if (error.code === -32000 &&
            /auth|log.?in|sign.?in/i.test(error.message + JSON.stringify(error.data ?? {})))
            return acpError('Antigravity requires Google authorization. Send a message in DSH to open the official browser login.', 'ACP_AUTH_REQUIRED');
        if (error.code === -32602)
            return acpError('The official ACP server rejected the request parameters or model.', 'ACP_INVALID_PARAMS');
        if (error.code === -32601)
            return acpError('The official ACP server does not support the requested method. Check its version.', 'ACP_METHOD_UNSUPPORTED');
        return acpError(`Official ACP server returned JSON-RPC error ${error.code}.`, 'ACP_RPC_ERROR');
    }
    // Raw stderr, remote error messages, RPC data and causes can contain credentials.
    return acpError('Connection to the official ACP server ended. Retry to reconnect.', 'ACP_DISCONNECTED');
}
