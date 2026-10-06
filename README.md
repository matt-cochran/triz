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
curl -LO https://github.com/matt-cochran/triz/releases/download/v0.2.1/triz-v0.2.1-node.tgz
curl -LO https://github.com/matt-cochran/triz/releases/download/v0.2.1/checksums.sha256
curl -LO https://github.com/matt-cochran/triz/releases/download/v0.2.1/release-manifest.json

# 2. Verify the download (Linux: sha256sum, macOS: shasum -a 256 -c).
sha256sum -c checksums.sha256

# 3. Install the tarball without compiling anything.
npm install -g ./triz-v0.2.1-node.tgz

# 4. Run it.
triz catalog
```

`npm install <tarball>` also works in a project or a temporary prefix. The
manifest records the version, tag, commit SHA, asset digest, the Node engine,
and the architecture-independent targets.

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
```

Options: `--offline <response.json>`, `--out <result.json>`,
`--provider <provider>`, `--model <model>`, `--timeout-ms <n>`.

Every command also accepts `-h`/`--help`, which prints usage to stdout and
exits `0` without reading input files, writing output, or contacting a
provider. Arguments are validated before any file or provider action: unknown
options (including short flags), missing option values, a non-numeric or
non-positive `--timeout-ms`, and excess positional arguments all fail with a
non-zero exit code.

The same CLI can be run directly from the compiled file with `node
dist/triz.js <command>`. npm bin shims and symlinks are recognized on all
platforms, including Windows `.cmd`/`.ps1` shims.

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
needed for a confident `physical` result.

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
  `principles`
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
catalog. Requests and SDK startup are bounded by a 45s timeout and an
`AbortSignal`. Credentials are never printed.

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
`false`. Recommendations are unranked candidate heuristics, not a deterministic
selection or a canonical matrix ranking.

## Library use (Junior integration)

The compiled package exports the pure pieces so another tool can integrate
without the CLI: `validateRequest`, `interpretVerdict`, `buildQuestions`,
`adaptClassifierResponse`, `buildResult`, `hashInput`, `inspectResult`,
`writeResultAtomic`, `validateCatalog`, `CATALOG`, `CATALOG_VERSION`,
`PRINCIPLE_IDS`, `PHYSICAL_ROUTE_IDS`, `SCHEMA_VERSION`, `analyze`, and
`createTrizClassifier`. Use `analyze(request,
{ classify })` with an injected classifier for offline or custom transports.

```js
import { analyze, CATALOG } from 'triz';
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
atomic packaged-CLI behavior: the compiled entrypoint, tarball
contents, package metadata, the release manifest/checksums, and installation
into a temporary prefix.

CI runs on Node 24 and 26 across the supported OS/architecture matrix. Live
output is kept in ignored local artifacts. Billed cost remains unknown.

## Open-source project

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [SUPPORT.md](SUPPORT.md). Live analysis sends supplied evidence to the configured provider; offline classification fixtures require no provider access. Results are reviewable candidate strategies, not automatic implementation decisions. GitHub release tarballs do not imply npm registry availability.

## Publishing

Maintainers publish the first version with `npm login` followed by
`npm publish --access public`. Configure npm Trusted Publishing for this
package using GitHub owner `matt-cochran`, repository `triz`, and workflow
`publish.yml` (environment blank). Subsequent matching `vX.Y.Z` tags publish
through GitHub Actions with provenance after the package tests pass. No
long-lived npm token is needed in GitHub. The separate GitHub release workflow
continues producing reviewed tarballs and checksums.
