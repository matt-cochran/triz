// Atomic behavioral tests for the compiled, packaged TRIZ deliverable.
//
// These exercise public interfaces only: the built CLI (`dist/triz.js`), the
// packed npm tarball, the release manifest helper, and a temporary-prefix
// install. They make no model calls and no network calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const distCli = join(root, 'dist', 'triz.js');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const skillFiles = readdirSync(join(root, 'skills'))
  .filter((name) => existsSync(join(root, 'skills', name, 'SKILL.md')))
  .map((name) => `skills/${name}/SKILL.md`)
  .sort();

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

/** Install the packed tarball into a temporary prefix; returns its triz bin. */
function installPacked(prefix: string): string {
  const install = spawnSync(
    process.execPath,
    [npmCli(), 'install', '--prefix', prefix, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', packOnce().tgz],
    { cwd: root, encoding: 'utf8' },
  );
  if (install.status !== 0) throw new Error(`install failed:\n${install.stderr || install.stdout}`);
  return process.platform === 'win32'
    ? join(prefix, 'node_modules', '.bin', 'triz.cmd')
    : join(prefix, 'node_modules', '.bin', 'triz');
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
    ...skillFiles,
  ].sort());
});

test('packed tarball contains each shipped SKILL.md', () => {
  assert.deepEqual(skillFiles.filter((f) => !packOnce().files.includes(f)), []);
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

const releaseTag = `v${pkg.version}`;
const releaseCommit = '0123456789abcdef0123456789abcdef01234567';

function runScript(script: string, args: string[]) {
  return spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
}

/** Generate the release assets for the packed tarball into a new directory. */
function buildReleaseAssets(tag = releaseTag, sha = releaseCommit): string {
  const out = tempDir('triz-manifest-');
  const res = runScript('release-manifest.mjs', ['--tarball', packOnce().tgz, '--out-dir', out, '--tag', tag, '--sha', sha]);
  if (res.status !== 0) throw new Error(`manifest failed:\n${res.stderr || res.stdout}`);
  return out;
}

function buildManifest(): Record<string, any> {
  return JSON.parse(readFileSync(join(buildReleaseAssets(), 'release-manifest.json'), 'utf8'));
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

test('release manifest records the version, tag, and full source commit', () => {
  const { version, tag, commit } = buildManifest();
  assert.deepEqual({ version, tag, commit }, { version: pkg.version, tag: releaseTag, commit: releaseCommit });
});

test('release manifest refuses a tag that does not match the package version', () => {
  const out = tempDir('triz-manifest-');
  const res = runScript('release-manifest.mjs', ['--tarball', packOnce().tgz, '--out-dir', out, '--tag', 'v0.0.0-mismatch', '--sha', releaseCommit]);
  assert.notEqual(res.status, 0);
});

test('release manifest refuses an abbreviated commit', () => {
  const out = tempDir('triz-manifest-');
  const res = runScript('release-manifest.mjs', ['--tarball', packOnce().tgz, '--out-dir', out, '--tag', releaseTag, '--sha', 'abc1234']);
  assert.notEqual(res.status, 0);
});

test('release checksums cover the tarball and the manifest', () => {
  const sums = readFileSync(join(buildReleaseAssets(), 'checksums.sha256'), 'utf8');
  assert.deepEqual(
    sums.trim().split('\n').map((line) => line.split('  ')[1]),
    [`triz-v${pkg.version}-node.tgz`, 'release-manifest.json'],
  );
});

test('release asset verification accepts the generated assets', () => {
  const dir = buildReleaseAssets();
  assert.equal(runScript('verify-release-assets.mjs', ['--dir', dir, '--tag', releaseTag, '--commit', releaseCommit]).status, 0);
});

test('release asset verification rejects a tampered tarball', () => {
  const dir = buildReleaseAssets();
  writeFileSync(join(dir, `triz-v${pkg.version}-node.tgz`), 'tampered');
  assert.notEqual(runScript('verify-release-assets.mjs', ['--dir', dir, '--tag', releaseTag]).status, 0);
});

test('release asset verification rejects a manifest from another commit', () => {
  const dir = buildReleaseAssets();
  const other = 'f'.repeat(40);
  assert.notEqual(runScript('verify-release-assets.mjs', ['--dir', dir, '--tag', releaseTag, '--commit', other]).status, 0);
});

test('release asset verification rejects an extra asset', () => {
  const dir = buildReleaseAssets();
  writeFileSync(join(dir, 'notes.txt'), 'extra');
  assert.notEqual(runScript('verify-release-assets.mjs', ['--dir', dir, '--tag', releaseTag]).status, 0);
});

test('release tag check rejects a tag that does not match the package version', () => {
  assert.notEqual(runScript('verify-tag-version.mjs', ['--tag', 'v0.0.0-mismatch']).status, 0);
});

test('release tag check accepts the tag for the package version', () => {
  assert.equal(runScript('verify-tag-version.mjs', ['--tag', releaseTag]).status, 0);
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

test('compiled CLI --version prints the package version', () => {
  assert.equal(runNode([distCli, '--version']).stdout, `triz ${pkg.version}\n`);
});

test('installed CLI installs its shipped skills into a project', () => {
  const prefix = tempDir('triz-install-');
  const bin = installPacked(join(prefix, 'pkg'));
  const project = tempDir('triz-project-');
  spawnSync(bin, ['skills', 'install', '--target', 'claude', '--project', project], {
    cwd: prefix,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, HOME: prefix, USERPROFILE: prefix },
  });
  assert.equal(
    readFileSync(join(project, '.claude', 'skills', 'triz', 'SKILL.md'), 'utf8'),
    readFileSync(join(root, 'skills', 'triz', 'SKILL.md'), 'utf8'),
  );
  rmSync(prefix, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});
