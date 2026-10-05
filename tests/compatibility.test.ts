import { readFileSync } from 'node:fs';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('DSH installation compatibility', () => {
  it.each(['0.2.0-rc.2', '0.2.1-alpha.1'])(
    'passes the official installer preflight on DSH %s without an exemption',
    (runtimeVersion) => {
      expect(evaluatePluginCompatibility(manifest, {}, runtimeVersion)).toBeUndefined();
    },
  );

  it.each(['0.1.7-rc.2', '0.3.0'])(
    'refuses unverified DSH %s instead of disabling version checks',
    (runtimeVersion) => {
      const issue = evaluatePluginCompatibility(manifest, {}, runtimeVersion);
      expect(issue?.exempted).toBe(false);
      expect(Object.keys(issue?.peers ?? {})).toContain('@deepseek-ai/dsh-llm');
    },
  );
});
