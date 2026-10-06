// Atomic behavioral tests for the compiled, packaged TRIZ deliverable.
//
// These exercise public interfaces only: the built CLI (`dist/triz.js`), the
// packed npm tarball, the release manifest helper, and a temporary-prefix
// install. They make no model calls and no network calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const distCli = join(root, 'dist', 'triz.js');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function npmCli(): string {
  return (
    process.env.npm_execpath ||
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  );
}

function runNode(args: string[], cwd = root) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

type Packed = { dir: string; tgz: string; files: string[] };

let cachedPack: Packed | null = null;
function packOnce(): Packed {
  if (cachedPack) return cachedPack;
  const dir = mkdtempSync(join(tmpdir(), 'triz-pack-'));
  const res = spawnSync(process.execPath, [npmCli(), 'pack', '--json', '--pack-destination', dir], {
    cwd: root,
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`npm pack failed:\n${res.stderr || res.stdout}`);
  const parsed = JSON.parse(res.stdout);
  const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  cachedPack = {
    dir,
    tgz: join(dir, info.filename),
    files: (info.files ?? []).map((f: { path: string }) => f.path),
  };
  return cachedPack;
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// --- Compiled CLI -----------------------------------------------------------

test('compiled CLI executes its catalog command through the entrypoint guard', () => {
  const res = runNode([distCli, 'catalog']);
  assert.equal(JSON.parse(res.stdout).canonicalMatrixLookup, false);
});

test('compiled CLI writes an offline analysis to the requested out path', () => {
  const dir = tempDir('triz-cli-');
  const req = join(dir, 'request.json');
  const fixture = join(dir, 'response.json');
  const out = join(dir, 'result.json');
  writeFileSync(
    req,
    JSON.stringify({
      evidence: [{ id: 'E1', text: 'Caching reduced latency.' }],
      desiredImprovement: 'Reduce latency',
      worseningOutcome: 'Data freshness',
    }),
  );
  writeFileSync(
    fixture,
    JSON.stringify({ classification: 'technical', confidence: 0.9, evidenceIds: ['E1'], grounding: true }),
  );
  runNode([distCli, 'analyze', req, '--offline', fixture, '--out', out]);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).classification, 'technical');
  rmSync(dir, { recursive: true, force: true });
});

test('compiled CLI catalog exposes all forty principles', () => {
  const res = runNode([distCli, 'catalog']);
  assert.equal(JSON.parse(res.stdout).technical.length, 40);
});

test('compiled CLI catalog reports the triz-software-2 version', () => {
  const res = runNode([distCli, 'catalog']);
  assert.equal(JSON.parse(res.stdout).version, 'triz-software-2');
});

test('compiled CLI inspect retains the catalog version after an offline analysis', () => {
  const dir = tempDir('triz-cli-');
  const req = join(dir, 'request.json');
  const fixture = join(dir, 'response.json');
  const out = join(dir, 'result.json');
  writeFileSync(
    req,
    JSON.stringify({
      evidence: [{ id: 'E1', text: 'Caching reduced latency.' }],
      desiredImprovement: 'Reduce latency',
      worseningOutcome: 'Data freshness',
    }),
  );
  writeFileSync(
    fixture,
    JSON.stringify({ classification: 'technical', confidence: 0.9, evidenceIds: ['E1'], grounding: true }),
  );
  runNode([distCli, 'analyze', req, '--offline', fixture, '--out', out]);
  const inspected = runNode([distCli, 'inspect', out]);
  assert.equal(JSON.parse(inspected.stdout).catalogVersion, 'triz-software-2');
  rmSync(dir, { recursive: true, force: true });
});

// --- Packed tarball ---------------------------------------------------------

test('packed tarball contents match the published file whitelist', () => {
  assert.deepEqual([...packOnce().files].sort(), [
    'LICENSE',
    'README.md',
    'dist/triz.d.ts',
    'dist/triz.js',
    'package.json',
  ]);
});

// --- Published package metadata --------------------------------------------

test('published package points the triz bin at the compiled CLI', () => {
  assert.equal(pkg.bin.triz, 'dist/triz.js');
});

test('published package declares no runtime dependencies', () => {
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});

test('published package declares no architecture-specific os or cpu restriction', () => {
  assert.equal(Boolean(pkg.os || pkg.cpu), false);
});

// --- Release manifest -------------------------------------------------------

function buildManifest(): Record<string, any> {
  const packed = packOnce();
  const out = tempDir('triz-manifest-');
  const res = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'release-manifest.mjs'), '--tarball', packed.tgz, '--out-dir', out, '--tag', `v${pkg.version}`, '--sha', 'testsha'],
    { cwd: root, encoding: 'utf8' },
  );
  if (res.status !== 0) throw new Error(`manifest failed:\n${res.stderr || res.stdout}`);
  return JSON.parse(readFileSync(join(out, 'release-manifest.json'), 'utf8'));
}

test('release manifest records the sha256 digest of the release asset', () => {
  const digest = createHash('sha256').update(readFileSync(packOnce().tgz)).digest('hex');
  assert.equal(buildManifest().asset.digest, `sha256:${digest}`);
});

test('release manifest records the stable release asset name', () => {
  assert.equal(buildManifest().asset.name, `triz-v${pkg.version}-node.tgz`);
});

test('release manifest lists the six architecture-independent runner targets', () => {
  assert.deepEqual(buildManifest().targets, [
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
    'win32-arm64',
  ]);
});

// --- Installable package ----------------------------------------------------

test('installed CLI catalog exposes all forty principles', () => {
  const packed = packOnce();
  const prefix = tempDir('triz-install-');
  const install = spawnSync(
    process.execPath,
    [npmCli(), 'install', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', packed.tgz],
    { cwd: root, encoding: 'utf8' },
  );
  if (install.status !== 0) throw new Error(`install failed:\n${install.stderr || install.stdout}`);
  const bin =
    process.platform === 'win32'
      ? join(prefix, 'node_modules', '.bin', 'triz.cmd')
      : join(prefix, 'node_modules', '.bin', 'triz');
  const run = spawnSync(bin, ['catalog'], { cwd: prefix, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(JSON.parse(run.stdout).technical.length, 40);
  rmSync(prefix, { recursive: true, force: true });
});

test('packaged CLI runs after installation into a temporary prefix', () => {
  const packed = packOnce();
  const prefix = tempDir('triz-install-');
  const install = spawnSync(
    process.execPath,
    [npmCli(), 'install', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', packed.tgz],
    { cwd: root, encoding: 'utf8' },
  );
  if (install.status !== 0) throw new Error(`install failed:\n${install.stderr || install.stdout}`);
  const bin =
    process.platform === 'win32'
      ? join(prefix, 'node_modules', '.bin', 'triz.cmd')
      : join(prefix, 'node_modules', '.bin', 'triz');
  const run = spawnSync(bin, ['catalog'], { cwd: prefix, encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(JSON.parse(run.stdout).canonicalMatrixLookup, false);
  rmSync(prefix, { recursive: true, force: true });
});
