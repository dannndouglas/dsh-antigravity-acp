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
export const Config: z<Config> = z.object({
  provider: z.string().default('antigravity-acp'),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  auth: z.const('oauth-personal').default('oauth-personal'),
  defaultModel: z.string().default(''),
  models: z.array(z.string()).default([]),
  toolPolicy: z.union(['text-only', 'reject'] as const).default('text-only'),
  timeoutMs: z.natural().default(600000),
  requestTimeoutMs: z.natural().default(30000),
  authTimeoutMs: z.natural().default(600000),
  cancelGraceMs: z.natural().default(1500),
  disposeGraceMs: z.natural().default(3000),
  maxSessionsPerProcess: z.natural().default(100),
});
export function resolveConfig(input: Partial<Config> = {}): Config {
  const config = Config(input as Config);
  if (!config.provider.trim()) throw new Error('provider must not be empty');
  for (const key of [
    'timeoutMs',
    'requestTimeoutMs',
    'authTimeoutMs',
    'cancelGraceMs',
    'disposeGraceMs',
    'maxSessionsPerProcess',
  ] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 2147483647)
      throw new Error(`${key} must be a positive integer <= 2147483647`);
  }
  return config;
}
