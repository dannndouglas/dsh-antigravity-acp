import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { LlmError } from '@deepseek-ai/dsh-llm';
export async function resolveCommand(config, runtime, signal) {
    const explicit = config.command || process.env.AGY_ACP_BIN;
    const names = process.platform === 'win32'
        ? ['agy_acp_server.exe']
        : ['agy_acp_server.par', 'agy_acp_server'];
    const candidates = explicit
        ? [explicit]
        : [
            ...names,
            ...names.map((n) => join(homedir(), '.local', 'bin', n)),
            ...names.map((n) => join(homedir(), '.local', 'share', 'antigravity-acp', n)),
        ];
    for (const command of candidates) {
        signal?.throwIfAborted();
        try {
            return await runtime.resolveExecutable(command, undefined, signal);
        }
        catch {
            signal?.throwIfAborted();
        }
    }
    throw new LlmError('Official Antigravity ACP binary was not found. Set command or AGY_ACP_BIN to the official executable; see the ACP Registry installation instructions.', 'ACP_BINARY_MISSING');
}
export function serverArgs(config, command) {
    // Both Linux architectures in the official Registry require this flag.
    const name = basename(command);
    return process.platform === 'linux' &&
        ['agy_acp_server.par', 'agy_acp_server'].includes(name) &&
        !config.args.some((a) => a.startsWith('--uid='))
        ? ['--uid=', ...config.args]
        : [...config.args];
}
export async function disposeProcess(child, graceMs) {
    child.stdin?.end();
    let exited = false;
    try {
        exited = await child.waitForExit(AbortSignal.timeout(graceMs));
    }
    finally {
        if (!exited) {
            child.terminate();
            await child.waitForExit();
        }
    }
}
