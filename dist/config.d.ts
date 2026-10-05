import z from '@deepseek-ai/schemastery';
export interface Config {
    provider: string;
    command: string;
    autoInstall: boolean;
    installTimeoutMs: number;
    args: string[];
    auth: 'oauth-personal';
    defaultModel: string;
    models: string[];
    toolPolicy: 'bridge' | 'text-only' | 'reject';
    toolTimeoutMs: number;
    maxActiveToolSessions: number;
    timeoutMs: number;
    requestTimeoutMs: number;
    authTimeoutMs: number;
    cancelGraceMs: number;
    disposeGraceMs: number;
    maxSessionsPerProcess: number;
}
export declare const Config: z<Config>;
export declare function resolveConfig(input?: Partial<Config>): Config;
