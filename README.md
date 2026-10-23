# triz

A minimal, architecture-independent TRIZ contradiction classification CLI and
library. The release package is compiled JavaScript with **no runtime npm
dependencies**. It classifies software contradictions with a typed classifier
(TypeSafe's Jev, optionally via the installed Pi SDK) and maps the result onto
a complete software-adapted contradiction-resolution catalog.

It is a separate tool: it does not run nested workers and makes no classifier
calls unless the live `analyze` path is explicitly used.

## What it does

Given a request describing evidence, a desired improvement, and (where
relevant) a worsening outcome or an element with opposing properties, the
classifier returns one of a fixed taxonomy:

| Classification | Meaning |
| --- | --- |
| `technical` | Improving one outcome worsens another (a trade-off). |
| `physical` | The same element must have two opposing properties at once. |
| `none` | No contradiction is present in the evidence. |
| `insufficient` | The evidence cannot support a classification. |
| `uncertain` | Derived by this tool for low-confidence, malformed, or ungrounded classifier output. |

Confident output must cite input evidence IDs that actually exist in the
request. Unknown IDs, missing evidence, malformed types, confidence outside
`0..1`, or confidence below `0.6` are downgraded to `uncertain`. A confident
`technical` answer without a worsening outcome, or a confident `physical`
answer without an element and two opposing properties, is downgraded to
`insufficient`. The tool never fabricates evidence.

The classifier output is probabilistic. Only the catalog mapping is
deterministic; the result always records `inferenceDeterministic: false`.

For a confident `technical` or `physical` result the tool returns a ranked
shortlist instead of the whole catalog: at most eight principles (or separation
routes), ordered by relevance descending, each carrying a `rank`, `relevance`,
and a deterministic non-empty `reason`. Principles below the `0.5` relevance
floor are excluded, except that when fewer than three qualify the top three by
relevance are returned flagged `belowThreshold: true`. When no relevance data is
available (an offline fixture without it, or a failed relevance call) the full
catalog is returned unranked, as before, and `notes` records that ranking was
unavailable. A request that mixes both framings (a `worseningOutcome` together
with `element`/`opposingProperties`) is refused before any classifier call with
the code `mixed_framing`. `uncertain` and `insufficient` results carry a `needs`
array naming the request fields or evidence to add.

## Requirements

- **Node.js 24 or newer.** The shipped JavaScript uses modern ESM and Node
  builtins only.
- **No Rust and no native addons.** There is nothing to compile for users. The
  published package is plain `.js` and runs unchanged on x64 and ARM64 across
  Linux, macOS, and Windows. It works wherever Node's supported architecture
  runs; there is no separate native binary and no architecture-specific build.
- **Optional, for live classification only:** an installed Pi SDK
  (`@earendil-works/pi-coding-agent`) plus normal local auth. Offline runs need
  neither.

## Install from npm

Requires Node.js 24 or newer. No Rust or local compilation is required.

```sh
npm install -g @matthew-cochran/triz
triz catalog
```

For a project-local install, use `npm install @matthew-cochran/triz` and
`npx triz catalog`. Live analysis additionally requires the provider setup
below; catalog inspection is offline.

## Install from a GitHub release

Releases publish a single Node tarball named `triz-v<version>-node.tgz`
together with `checksums.sha256` and `release-manifest.json`.

```sh
# 1. Download the release asset, checksum file, and manifest.
curl -LO https://github.com/matt-cochran/triz/releases/download/v0.4.1/triz-v0.4.1-node.tgz
curl -LO https://github.com/matt-cochran/triz/releases/download/v0.4.1/checksums.sha256
curl -LO https://github.com/matt-cochran/triz/releases/download/v0.4.1/release-manifest.json

# 2. Verify the download (Linux: sha256sum, macOS: shasum -a 256 -c).
sha256sum -c checksums.sha256

# 3. Install the tarball without compiling anything.
npm install -g ./triz-v0.4.1-node.tgz

# 4. Run it.
triz catalog
```

`npm install <tarball>` also works in a project or a temporary prefix. The
manifest records the version, tag, full commit SHA, asset digest, the Node
engine, and the architecture-independent targets. `checksums.sha256` covers
both the tarball and the manifest. A release made by the publish workflow carries
the same tarball that npm serves for that version.

## Run

```sh
# Deterministic offline run from a fixture (no model call):
triz analyze request.json --offline response.json --out result.json

# Live classifier run (the only path that calls Jev):
triz analyze request.json --out result.json

# Inspect a persisted handoff:
triz inspect result.json

# Print the curated catalog:
triz catalog

# Show help (global or per command):
triz --help
triz analyze --help

# Print the installed version (`triz <version>`):
triz --version

# Install the agent skills for Claude Code in this repository:
triz skills install --target claude --project .
```

Options: `--offline <response.json>`, `--out <result.json>`,
`--provider <provider>`, `--model <model>`, `--timeout-ms <n>`.

`triz --version` (or `-V`) prints exactly one line, `triz <version>`, read from
the package's own `package.json`, and exits `0`.

Every command also accepts `-h`/`--help`, which prints usage to stdout and
exits `0` without reading input files, writing output, or contacting a
provider. Arguments are validated before any file or provider action: unknown
options (including short flags), missing option values, a non-numeric or
non-positive `--timeout-ms`, and excess positional arguments all fail with a
non-zero exit code.

The same CLI can be run directly from the compiled file with `node
dist/triz.js <command>`. npm bin shims and symlinks are recognized on all
platforms, including Windows `.cmd`/`.ps1` shims.

## Agent skills

The package ships two [Agent Skills](https://agentskills.io) under `skills/`:

- `triz`: the method reference. When TRIZ applies, the offline and paid
  commands, and the request and result formats.
- `triz-contradiction`: the step-by-step workflow, from naming the improving
  and worsening parameters to attaching the saved result to the decision record.

Install them for your agent tool with:

```sh
triz skills install --target <claude|codex|cursor|copilot|gemini|agents-md|all> (--project <dir> | --user) [--dry-run] [--force]
triz skills uninstall --target <target> (--project <dir> | --user) [--dry-run]
triz skills list [--project <dir> | --user]
```

| Target | Project scope | User scope |
| --- | --- | --- |
| `claude` | `.claude/skills/` | `~/.claude/skills/` |
| `codex` | `.agents/skills/` | `~/.agents/skills/` |
| `cursor` | `.cursor/skills/` | `~/.cursor/skills/` |
| `copilot` | `.github/skills/` | `~/.copilot/skills/` |
| `gemini` | `.agents/skills/` + `.gemini/commands/triz-*.toml` | same under `~` |
| `agents-md` | a `<!-- triz:begin -->` … `<!-- triz:end -->` block in `AGENTS.md` + `.agents/skills/` | not available |
| `all` | `.claude/skills/` + `.agents/skills/` | same under `~` |

Each skills directory gets a `.triz-skills.json` manifest
(`{ "schema": 1, "triz_version", "targets", "files": { "<path>": "<sha256>" } }`).
A reinstall replaces only files whose current hash still matches the manifest.
Files you edited, and files triz did not write, are reported as skipped and
left alone unless you pass `--force`. Uninstall removes only files the manifest
owns and still match, and keeps a directory shared by another target (for
example `.agents/skills/` used by both `codex` and `gemini`) until the last
target is uninstalled. Every change is planned before the first write, and each
file is written atomically. `--dry-run` reports the plan and writes nothing.
The installer never writes MCP configuration. `list` reports installs under
the user home and the current directory, or only under the scope you give.
Concurrent runs on the same skills directory are serialized by a
`.triz-skills.lock` file, and a stale lock left by a dead process is recovered.
`TRIZ_SKILLS_LOCK_WAIT_MS` sets how long a run waits for a busy lock (default
5000 ms).

## Request format

```json
{
  "evidence": [
    { "id": "E1", "text": "Caching reduced latency." },
    { "id": "E2", "text": "Users now see stale data." }
  ],
  "desiredImprovement": "Reduce dashboard latency",
  "worseningOutcome": "Data freshness",
  "element": "response cache",
  "opposingProperties": ["large for hit rate", "small for memory"]
}
```

`evidence` and `desiredImprovement` are required. `worseningOutcome` is needed
for a confident `technical` result; `element` and `opposingProperties` are
needed for a confident `physical` result. A request must use one framing:
setting a `worseningOutcome` together with `element` or `opposingProperties` is
refused with `error[mixed_framing]` (the library throws a `TrizRequestError`
with code `mixed_framing`), because it is ambiguous whether the contradiction is
technical or physical. Split such a request into separate one-framing requests.

The request contract is strict: unknown top-level keys and unknown evidence-item
keys are rejected with an error naming the offending key, so a misspelled
optional field (for example `desiredImprovment`) fails validation before any
classifier or output action instead of being silently ignored. Persisted results
remain tolerant: `inspect` and `inspectResult` accept historical metadata from
saved `schemaVersion` 1 results.

## Result handoff (schemaVersion 1)

`result.json` is written atomically (same-directory temp file, then rename) to
the explicit `--out` path and contains:

- `schemaVersion`, `inputHash` (stable sha256 over the request),
  `catalogVersion`
- `requested` and `reported` provider/model. `reported` is the model the
  classifier actually returned, or `unavailable` when it did not return one.
- `classification`, `confidence`, `groundedEvidenceIds`, `rationale`,
  `principles`. A confident `technical` or `physical` result populates
  `principles` with a ranked shortlist (`rank`, `relevance`, `reason`, and
  optionally `belowThreshold`); an unranked catalog has the principle fields
  only. The deterministic `rationale` names the desired improvement and
  worsening outcome (technical) or the element and opposing properties
  (physical) and the grounded evidence ids.
- `needs`, a possibly empty array naming the request fields or evidence to add.
  For an `uncertain` result it begins with `more evidence that states the
  trade-off directly` and includes the classifier's note; an `insufficient`
  technical result names `worseningOutcome` and an `insufficient` physical
  result names `element` and `opposingProperties`.
- `usage`, or `null` when the classifier reported none. A reported usage
  carries `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, and an
  `available` flag. Token counts are not presented as authoritative zeros when
  data is missing: `available` is the signal that the Pi SDK reported usage,
  while a reported count of `0` is a real zero.
- `usage.costUsd` is the legacy flat Pi-reported total in USD; `usage.piReported`
  is the labelled form (`{ amountUsd, available, source: "pi_reported" }`). A
  missing cost is `null` with `available: false`; a reported zero is `0` with
  `available: true`, so unknown and free are never conflated.
- `billedCostUsd`, which is always `null`: actual billing is never observed. A
  Pi-reported cost is an estimate, not a bill, and an absent cost is unknown
  rather than free. The offline/fixture path performs no live classification and
  incurs no bill; only the explicit live `analyze` path can spend money, and
  even then the tool does not claim to know the charge.
- `catalog` metadata and `notes`.

## Classifier model and bounds

The default model is `openrouter` / `~typesafe/jev-latest`. Override with
`--provider`/`--model` or by passing a different model definition to
`createTrizClassifier`. The live path uses the installed Pi SDK
`ModelRuntime` + `ModelRegistry.classify` with normal local auth, creating a
fresh registry per call so the latest alias resolves against the current
catalog. A confident `technical` or `physical` result makes a **second**
classifier call for relevance, so the result's `usage` sums both calls; an
`uncertain`, `insufficient`, or `none` result makes exactly one call. Requests
and SDK startup are bounded by a 45s timeout and an `AbortSignal`. Credentials
are never printed.

## Catalog scope

The catalog (`triz-software-2`) is a **complete software-adapted TRIZ
contradiction-resolution heuristic catalog**:

- `technical` lists all **40 main Inventive Principles**, numbered 1–40, with
  normalized English names and software-adapted heuristic wording.
- `physical` lists the **six modern MATRIZ physical-contradiction resolution
  routes** in flow order: separation in space, separation in time, separation
  in relation (condition/context, retaining the existing `condition-separation`
  id), separation in system level, satisfying contradictory demands, and
  bypassing contradictory demands.

The wording is an interpretation layer for software, not modified canonical
TRIZ taxonomy. The catalog deliberately excludes the historical supplemental
principles 41–50, the classical 39x39 matrix cells, and the wider TRIZ body of
knowledge (ARIZ, Substance-Field analysis, Standard Inventive Solutions,
trends of engineering-system evolution, scientific effects, function analysis).

It cites seven sources:

- <https://triz.org/contradictions/> and <https://triz.org/principles/> for the
  principles and contradiction concepts.
- <https://matriz.org/methodology/>, the MATRIZ contradictions wiki, the MATRIZ
  contradiction-matrix wiki page, and the MATRIZ Level 1 physical-contradiction
  training material for the current methodology and route flow.
- <https://doi.org/10.1016/j.proeng.2015.12.413> for adapting TRIZ to
  information technology.

Having every principle is **not** a complete contradiction matrix: the object
stores no 39x39 matrix cells. A software heuristic is not a canonical matrix
lookup, so `canonicalMatrixLookup` and `completeClassicalMatrix` both remain
`false`. A confident result's shortlist is a relevance ranking of those
heuristics produced by the classifier's boolean relevance answers, not a
deterministic selection from the classical matrix; the ranking never invents
principles and only orders the existing catalog.

## Library use (Junior integration)

The compiled package exports the pure pieces so another tool can integrate
without the CLI: `validateRequest`, `interpretVerdict`, `buildQuestions`,
`buildRelevanceQuestions`, `adaptClassifierResponse`,
`adaptRelevanceResponse`, `rankPrinciples`, `buildResult`, `hashInput`,
`inspectResult`, `writeResultAtomic`, `validateCatalog`, `TrizRequestError`,
`CATALOG`, `CATALOG_VERSION`, `PRINCIPLE_IDS`, `PHYSICAL_ROUTE_IDS`,
`RELEVANCE_FLOOR`, `MAX_RANKED_PRINCIPLES`, `SCHEMA_VERSION`, `TRIZ_VERSION`,
`analyze`, and `createTrizClassifier`. Use `analyze(request,
{ classify })` with an injected classifier for offline or custom transports.

```js
import { analyze, CATALOG } from '@matthew-cochran/triz';
```

## Build from source

Building is only needed to produce the published artifact. TypeScript and
`@types/node` are project-local devDependencies pinned by `package-lock.json`;
runtime has none.

```sh
npm ci          # install the pinned dev toolchain
npm run build   # compile triz.ts -> dist/triz.js (node shebang)
npm test        # compile, then run the offline behavior/package suite
npm run pack    # produce the installable tarball
```

`dist/`, `node_modules/`, `*.tgz`, and `.artifacts/` are generated and
gitignored; no compiled JavaScript is authored or committed. CI (GitHub
Actions) builds and tests the compiled CLI and package on six mainstream
OS/architecture runners — Ubuntu 22.04 x64/arm64, macOS 15 Intel/Apple
silicon, and Windows x64/arm64 — on Node 24 and 26.

## Tests

```sh
npm test
```

The suite makes no paid model calls and needs no network. It covers each
taxonomy outcome, malformed and low-confidence responses, wrong evidence IDs,
catalog validation, usage availability with missing, zero, cached, and finite
Pi costs, atomic persistence, a CLI analyze-then-inspect restart check, and
the skills installer (manifest, idempotent re-runs, edit protection, `--force`,
uninstall ownership, `--dry-run`, every target, and the `AGENTS.md` block, all
in temporary project and home directories), and atomic packaged-CLI behavior:
the compiled entrypoint, `--version`, tarball contents including each
`SKILL.md`, package metadata, the release manifest/checksums, and installation
into a temporary prefix.

CI runs on Node 24 and 26 across the supported OS/architecture matrix. Live
output is kept in ignored local artifacts. Billed cost remains unknown.

## Open-source project

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [SUPPORT.md](SUPPORT.md). Live analysis sends supplied evidence to the configured provider; offline classification fixtures require no provider access. Results are reviewable candidate strategies, not automatic implementation decisions.

## Publishing

A single `vX.Y.Z` tag publishes to npm (with provenance, through npm Trusted
Publishing bound to the `publish.yml` workflow; no long-lived npm token is
stored in GitHub) and creates the matching GitHub release with the tarball,
checksums, and manifest. The workflow fails when the tag and the package.json
version disagree. The step-by-step procedure, including backfilling a release
for a version already on npm, is in [CONTRIBUTING.md](CONTRIBUTING.md#releases).
