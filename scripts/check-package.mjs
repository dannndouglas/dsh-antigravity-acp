import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out.push(...(entry.isDirectory() ? await walk(path) : [path]));
  }
  return out;
}
for (const path of [...(await walk(join(root, 'src'))), ...(await walk(join(root, 'dist')))]) {
  const source = await readFile(path, 'utf8');
  assert(
    !/v1internal|cloudcode|refresh_token|client_secret/i.test(source),
    `Forbidden private transport/auth reference in ${path}`,
  );
  assert(
    !/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(source),
    `TLS override in ${path}`,
  );
  assert(!/\.(exe|par|zip)$/.test(path), `Proprietary binary in package: ${path}`);
}
const plugin = await import('../dist/index.js');
assert.equal(plugin.name, 'llm-antigravity-acp');
assert.deepEqual(plugin.inject, ['llm', 'subprocess']);
assert.equal(typeof plugin.apply, 'function');
assert.equal(plugin.default, undefined);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.main, 'dist/index.js');
console.log('Published entry, source security scan and package metadata passed.');
