#!/usr/bin/env node
// Generate release artifacts for a packed tarball using only Node builtins:
//   release-manifest.json  version, tag, commit, digest, node engine, targets
//   checksums.sha256       sha256sum lines for the tarball and the manifest
//
// The tag must be v<package version> and the commit a full 40-character SHA,
// so a release can never describe a different version or an unpinned source.
//
// Usage:
//   node scripts/release-manifest.mjs --tarball <path> --tag vX.Y.Z --sha <commit>
//     [--out-dir <dir>] [--asset-name <name>] [--package-dir <dir>]

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const flags = parseArgs(process.argv.slice(2));
const packageDir = resolve(String(flags['package-dir'] ?? root));
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const version = String(pkg.version);

if (typeof flags.tarball !== 'string') fail('release-manifest requires --tarball <path>');

const tarball = resolve(flags.tarball);
const assetName = String(flags['asset-name'] ?? `triz-v${version}-node.tgz`);
const tag = String(flags.tag ?? process.env.GITHUB_REF_NAME ?? `v${version}`);
const commit = String(flags.sha ?? process.env.GITHUB_SHA ?? '');
const outDir = resolve(String(flags['out-dir'] ?? join(root, '.artifacts')));

if (tag !== `v${version}`) fail(`Release tag ${tag} does not match package version ${version} (expected v${version}).`);
if (!/^[0-9a-f]{40}$/.test(commit)) fail(`Release commit must be a full 40-character SHA, got ${JSON.stringify(commit)}.`);

const digest = sha256(tarball);

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
const assetPath = join(outDir, assetName);
if (resolve(assetPath) !== tarball) copyFileSync(tarball, assetPath);
const manifestPath = join(outDir, 'release-manifest.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
// checksums.sha256 covers every other release asset, in sha256sum format.
writeFileSync(
  join(outDir, 'checksums.sha256'),
  `${digest}  ${assetName}\n${sha256(manifestPath)}  release-manifest.json\n`,
);
console.log(JSON.stringify(manifest, null, 2));
