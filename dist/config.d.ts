import z from '@deepseek-ai/schemastery';
export interface Config {
    provider: string;
    command: string;
    args: string[];
    auth: 'oauth-personal';
    defaultModel: string;
    models: string[];
    toolPolicy: 'text-only' | 'reject';
    timeoutMs: number;
    requestTimeoutMs: number;
    authTimeoutMs: number;
    cancelGraceMs: number;
    disposeGraceMs: number;
    maxSessionsPerProcess: number;
}
export declare const Config: z<Config>;
export declare function resolveConfig(input?: Partial<Config>): Config;
