#!/usr/bin/env node
// Compile triz.ts to dist/triz.js with the project-local TypeScript toolchain,
// then guarantee an executable node shebang on the published CLI.
//
// Runtime code has no npm dependencies; TypeScript is a devDependency only.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

if (!existsSync(tsc)) {
  console.error('TypeScript is not installed. Run `npm install` before building.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

const out = join(root, 'dist', 'triz.js');
if (!existsSync(out)) {
  console.error('Build did not produce dist/triz.js');
  process.exit(1);
}

let source = readFileSync(out, 'utf8');
if (!source.startsWith('#!')) {
  writeFileSync(out, '#!/usr/bin/env node\n' + source);
}
try {
  chmodSync(out, 0o755);
} catch {
  // chmod is a no-op or may be restricted on some platforms (e.g. Windows).
}

console.error('Built dist/triz.js');
