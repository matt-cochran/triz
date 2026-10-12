#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Release gate: the git tag must exactly match the package.json version.
//
// Tag pushes (`vX.Y.Z`), manual dispatch (INPUT_TAG=vX.Y.Z), and an explicit
// `--tag vX.Y.Z` all funnel through this check, so a mismatched or unpinned
// release can never publish. `--package-dir <dir>` checks another checkout.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const packageDir = resolve(flag('package-dir') ?? root);
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const refType = process.env.GITHUB_REF_TYPE;
const refName = process.env.GITHUB_REF_NAME ?? '';
const inputTag = process.env.INPUT_TAG ?? '';
const tag = flag('tag') ?? (refType === 'tag' ? refName : inputTag);

if (!tag) {
  console.error('No release tag: push a vX.Y.Z tag or set INPUT_TAG for a manual run.');
  process.exit(1);
}
const expected = `v${pkg.version}`;
if (tag !== expected) {
  console.error(`Release tag ${tag} does not match package version ${pkg.version} (expected ${expected}).`);
  process.exit(1);
}
console.log(`Release tag ${tag} matches package version ${pkg.version}.`);
