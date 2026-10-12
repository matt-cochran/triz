#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Double-publish guard: report whether the current package version already
// exists on the registry. The publish workflow skips the publish step when it
// does, so a re-run of a tag can never fail (or duplicate) a release.
// ---------------------------------------------------------------------------

import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirFlag = process.argv.indexOf('--package-dir');
const packageDir = resolve(dirFlag === -1 ? root : process.argv[dirFlag + 1]);
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const spec = `${pkg.name}@${pkg.version}`;

let published = false;
try {
  const out = execFileSync('npm', ['view', spec, 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  }).trim();
  published = out === pkg.version;
} catch {
  published = false;
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`);
}
console.log(published ? `${spec} is already published; skipping publish.` : `${spec} is not published yet.`);
