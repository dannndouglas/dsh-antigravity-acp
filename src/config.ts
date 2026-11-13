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
  idleProcessTimeoutMs: number;
  timeoutMs: number;
  requestTimeoutMs: number;
  authTimeoutMs: number;
  cancelGraceMs: number;
  disposeGraceMs: number;
  maxSessionsPerProcess: number;
  maxPromptBytes: number;
  ignoreUnsupportedOptions: boolean;
  contextWindow: number;
  contextWindows: Record<string, number>;
}
export const Config: z<Config> = z.object({
  provider: z.string().default('antigravity-acp'),
  command: z.string().default(''),
  autoInstall: z.boolean().default(true),
  installTimeoutMs: z.natural().default(180000),
  args: z.array(z.string()).default([]),
  auth: z.const('oauth-personal').default('oauth-personal'),
  defaultModel: z.string().default(''),
  models: z.array(z.string()).default([]),
  toolPolicy: z.union(['bridge', 'text-only', 'reject'] as const).default('bridge'),
  toolTimeoutMs: z.natural().default(900000),
  maxActiveToolSessions: z.natural().default(16),
  idleProcessTimeoutMs: z.natural().default(300000),
  timeoutMs: z.natural().default(600000),
  requestTimeoutMs: z.natural().default(30000),
  authTimeoutMs: z.natural().default(600000),
  cancelGraceMs: z.natural().default(1500),
  disposeGraceMs: z.natural().default(3000),
  maxSessionsPerProcess: z.natural().default(100),
  maxPromptBytes: z.natural().default(180000),
  ignoreUnsupportedOptions: z.boolean().default(true),
  contextWindow: z.natural().default(110000),
  contextWindows: z.dict(z.natural()).default({}),
});
export function resolveConfig(input: Partial<Config> = {}): Config {
  const config = Config(input as Config);
  if (!config.provider.trim()) throw new Error('provider must not be empty');
  for (const key of [
    'installTimeoutMs',
    'timeoutMs',
    'requestTimeoutMs',
    'authTimeoutMs',
    'cancelGraceMs',
    'disposeGraceMs',
    'maxSessionsPerProcess',
    'toolTimeoutMs',
    'maxActiveToolSessions',
    'idleProcessTimeoutMs',
    'maxPromptBytes',
    'contextWindow',
  ] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 2147483647)
      throw new Error(`${key} must be a positive integer <= 2147483647`);
  }
  for (const [model, cw] of Object.entries(config.contextWindows)) {
    if (!Number.isSafeInteger(cw) || cw <= 0 || cw > 2147483647)
      throw new Error(`contextWindows.${model} must be a positive integer <= 2147483647`);
  }
  return config;
}
