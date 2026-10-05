# triz.ts

A minimal, dependency-free TypeScript CLI and library for classifying software
contradictions using a typed classifier (TypeSafe's Jev via the installed Pi
SDK). It is a separate tool: it does not run nested workers and makes no
classifier calls unless the live `analyze` path is explicitly used.

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

## Install and run

No dependencies and no install step. Node 26 (or any Node with native
TypeScript type stripping) runs the file directly.

```sh
# Deterministic offline run from a fixture (no model call):
node triz.ts analyze request.json --offline response.json --out result.json

# Live classifier run (the only path that calls Jev):
node triz.ts analyze request.json --out result.json

# Inspect a persisted handoff:
node triz.ts inspect result.json

# Print the curated catalog:
node triz.ts catalog
```

Options: `--offline <response.json>`, `--out <result.json>`,
`--provider <provider>`, `--model <model>`, `--timeout-ms <n>`.

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

## Result handoff (schemaVersion 1)

`result.json` is written atomically (same-directory temp file, then rename) to
the explicit `--out` path and contains:

- `schemaVersion`, `inputHash` (stable sha256 over the request),
  `catalogVersion`
- `requested` and `reported` provider/model. `reported` is the model the
  classifier actually returned, or `unavailable` when it did not return one.
- `classification`, `confidence`, `groundedEvidenceIds`, `rationale`,
  `principles`
- `usage` (classifier token usage when reported) and `billedCostUsd`, which is
  always `null`: actual billing is never observed. A usage cost, when present,
  is a catalog estimate, not a bill.
- `catalog` metadata and `notes`.

## Classifier model and bounds

The default model is `openrouter` / `~typesafe/jev-latest`. Override with
`--provider`/`--model` or by passing a different model definition to
`createTrizClassifier`. The live path uses the installed Pi SDK
`ModelRuntime` + `ModelRegistry.classify` with normal local auth, creating a
fresh registry per call so the latest alias resolves against the current
catalog. Requests and SDK startup are bounded by a 45s timeout and an
`AbortSignal`. Credentials are never printed.

## Catalog limits

The catalog (`triz-software-1`) is a small, software-adapted heuristic set:

- `technical` suggests `segmentation` (1), `preliminary action` (10),
  `feedback` (23), and `intermediary` (24) only as broad heuristics.
- `physical` suggests separation in time, space, and condition.

It cites <https://triz.org/contradictions/> and
<https://triz.org/principles/>. It is **not** the complete classical TRIZ
39x39 contradiction matrix, and a software heuristic is not a canonical matrix
lookup (`canonicalMatrixLookup: false`).

## Library use (Junior integration)

`triz.ts` exports the pure pieces so another tool can integrate without the
CLI: `validateRequest`, `interpretVerdict`, `buildQuestions`,
`adaptClassifierResponse`, `buildResult`, `hashInput`, `inspectResult`,
`writeResultAtomic`, `validateCatalog`, `CATALOG`, `CATALOG_VERSION`,
`SCHEMA_VERSION`, `analyze`, and `createTrizClassifier`. Use `analyze(request,
{ classify })` with an injected classifier for offline or custom transports.

## Tests

```sh
node --test triz.test.ts
```

The suite makes no paid model calls. It covers each taxonomy outcome, malformed
and low-confidence responses, wrong evidence IDs, catalog validation, atomic
persistence, and a CLI analyze-then-inspect restart check.

Run `npm test` for the offline behavior suite. CI runs on Node 24 and 26. The latest-alias live smoke test returned a technical contradiction at confidence 0.97 (752 tokens); the provider reported the alias rather than a resolved underlying version. Live output is kept in ignored local artifacts. Billed cost remains unknown.
