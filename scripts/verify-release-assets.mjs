#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Release gate: check the assets a GitHub release will carry, using only Node
// builtins. Downstream checksum-verifying installers depend on exactly these
// names and fields, so the release fails unless the directory holds exactly
//
//   triz-vX.Y.Z-node.tgz   the npm-packed tarball, with package/dist/triz.js
//                          and a package/package.json of "type": "module"
//                          at version X.Y.Z
//   checksums.sha256       sha256sum lines covering every other asset
//   release-manifest.json  { version: X.Y.Z, tag: vX.Y.Z, commit: <40-char SHA> }
//
// Usage:
//   node scripts/verify-release-assets.mjs --dir <dir> --tag vX.Y.Z [--commit <sha>]
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

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

/** The regular files in a gzipped tar archive, as path -> contents. */
function readTarball(path) {
  const data = gunzipSync(readFileSync(path));
  const files = new Map();
  let pending = null;
  for (let offset = 0; offset + 512 <= data.length; ) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      // A pax extended header may carry the entry's full path.
      pending = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1] ?? null;
      continue;
    }
    const name = pending ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    pending = null;
    if (type === '0') files.set(name, body);
  }
  return files;
}

const flags = parseArgs(process.argv.slice(2));
const dir = resolve(String(flags.dir ?? '.artifacts'));
const tag = String(flags.tag ?? '');
const errors = [];

const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!match) {
  console.error(`--tag must be vX.Y.Z, got ${JSON.stringify(tag)}`);
  process.exit(1);
}
const version = match[1];
const assetName = `triz-v${version}-node.tgz`;
const expected = [assetName, 'checksums.sha256', 'release-manifest.json'].sort();

const present = readdirSync(dir).sort();
if (JSON.stringify(present) !== JSON.stringify(expected)) {
  errors.push(`${dir} must hold exactly ${expected.join(', ')}; found ${present.join(', ') || 'nothing'}`);
} else {
  const sums = new Map();
  for (const line of readFileSync(join(dir, 'checksums.sha256'), 'utf8').split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) errors.push(`checksums.sha256 has a malformed line: ${JSON.stringify(line)}`);
    else sums.set(m[2], m[1]);
  }
  for (const name of expected.filter((n) => n !== 'checksums.sha256')) {
    const digest = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
    if (!sums.has(name)) errors.push(`checksums.sha256 does not cover ${name}`);
    else if (sums.get(name) !== digest) errors.push(`checksums.sha256 does not match ${name}`);
  }
  for (const name of sums.keys()) {
    if (!expected.includes(name) || name === 'checksums.sha256') errors.push(`checksums.sha256 lists an unknown asset ${name}`);
  }

  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
  } catch (e) {
    errors.push(`release-manifest.json is not valid JSON: ${e.message}`);
  }
  if (manifest.version !== version) errors.push(`release-manifest.json version ${manifest.version} is not ${version}`);
  if (manifest.tag !== tag) errors.push(`release-manifest.json tag ${manifest.tag} is not ${tag}`);
  if (!/^[0-9a-f]{40}$/.test(String(manifest.commit))) {
    errors.push(`release-manifest.json commit ${JSON.stringify(manifest.commit)} is not a full 40-character SHA`);
  } else if (typeof flags.commit === 'string' && manifest.commit !== flags.commit) {
    errors.push(`release-manifest.json commit ${manifest.commit} is not the source commit ${flags.commit}`);
  }

  let files = new Map();
  try {
    files = readTarball(join(dir, assetName));
  } catch (e) {
    errors.push(`${assetName} is not a readable gzipped tarball: ${e.message}`);
  }
  if (!files.has('package/dist/triz.js')) errors.push(`${assetName} does not contain package/dist/triz.js`);
  const packed = files.get('package/package.json');
  if (!packed) {
    errors.push(`${assetName} does not contain package/package.json`);
  } else {
    const pkg = JSON.parse(packed.toString('utf8'));
    if (pkg.type !== 'module') errors.push(`${assetName} package/package.json type is ${pkg.type}, not module`);
    if (pkg.version !== version) errors.push(`${assetName} package/package.json version ${pkg.version} is not ${version}`);
  }
}

if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log(`Release assets for ${tag} verified: ${expected.join(', ')}`);
