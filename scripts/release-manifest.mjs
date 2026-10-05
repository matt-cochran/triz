#!/usr/bin/env node
// Generate release artifacts for a packed tarball using only Node builtins:
//   checksums.sha256       <sha256>  <stable asset name>
//   release-manifest.json  version, tag, commit, digest, node engine, targets
//
// Usage:
//   node scripts/release-manifest.mjs --tarball <path> [--tag vX.Y.Z]
//     [--sha <commit>] [--out-dir <dir>] [--asset-name <name>]

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = String(flags.version ?? pkg.version);

if (typeof flags.tarball !== 'string') {
  console.error('release-manifest requires --tarball <path>');
  process.exit(1);
}

const tarball = resolve(flags.tarball);
const assetName = String(flags['asset-name'] ?? `${pkg.name}-v${version}-node.tgz`);
const tag = String(flags.tag ?? process.env.GITHUB_REF_NAME ?? `v${version}`);
const commit = String(flags.sha ?? process.env.GITHUB_SHA ?? 'unknown');
const outDir = resolve(String(flags['out-dir'] ?? join(root, '.artifacts')));

const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex');

const manifest = {
  schemaVersion: 1,
  name: pkg.name,
  version,
  tag,
  commit,
  asset: { name: assetName, digest: `sha256:${digest}`, source: basename(tarball) },
  node: pkg.engines?.node ?? '>=24',
  runtimeDependencies: Object.keys(pkg.dependencies ?? {}),
  archIndependent: !pkg.os && !pkg.cpu,
  targets: ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64'],
  generatedBy: 'scripts/release-manifest.mjs',
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(outDir, 'checksums.sha256'), `${digest}  ${assetName}\n`);
console.log(JSON.stringify(manifest, null, 2));
