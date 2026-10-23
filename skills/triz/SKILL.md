---
name: triz
description: "Use when a design, architecture or engineering decision has a real technical contradiction (improving one outcome worsens another) or physical contradiction (one element needs two opposing properties), and you want TRIZ inventive principles or separation routes for it. Covers when TRIZ applies and when it does not (plain brainstorming, missing evidence), the offline `triz catalog`, the paid `triz analyze` call (TypeSafe Jev through OpenRouter, which needs explicit authorization) and its `--offline` replay, `triz inspect`, and the request and result formats. Use triz-contradiction for the step-by-step workflow."
---

# TRIZ with the triz CLI

TRIZ resolves contradictions instead of trading them off. The `triz` CLI classifies the
evidence you give it as `technical`, `physical`, `none` or `insufficient` (`uncertain` when
the classifier's answer is weak or ungrounded) and maps the result onto a software-adapted
catalog: the 40 Inventive Principles for technical contradictions and the six MATRIZ
separation routes for physical ones. The step-by-step workflow is
[triz-contradiction](../triz-contradiction/SKILL.md).

## When to use it

- **Use** when you can name, from real evidence, an outcome to improve and an outcome
  that gets worse because of it ("caching cut latency, users now see stale data"), or one
  element that must be two opposite things ("the cache must be large for hit rate and
  small for memory").
- **Do not use** for general ideation, for ranking options, or when you cannot point to
  evidence. A request without a worsening outcome or opposing properties will come back
  `none` or `insufficient`, and that is the correct answer.

## Commands

| Command | Cost | What it does |
| --- | --- | --- |
| `triz catalog` | offline | Prints the catalog (principles, routes, sources) as JSON. |
| `triz analyze <request.json> --out <result.json>` | **paid** | Classifies the request with Jev through OpenRouter and writes the result atomically. |
| `triz analyze <request.json> --offline <response.json> --out <result.json>` | offline | Replays a recorded classifier response; no provider call. |
| `triz inspect <result.json>` | offline | Validates and prints a saved result. |
| `triz --version` | offline | Prints `triz <version>`. |

**A live `analyze` sends the evidence to an external model provider and spends money.**
Run it only when the user has authorized that call for this request. Otherwise prepare the
request, run `triz catalog`, and ask. Live runs need an installed Pi SDK
(`@earendil-works/pi-coding-agent`) with local OpenRouter auth. `--provider`, `--model` and
`--timeout-ms <n>` override the defaults (`openrouter`, `~typesafe/jev-latest`, 45000 ms).

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

- `evidence` (a non-empty `id` and `text` per item) and `desiredImprovement` are required.
- A confident `technical` result needs `worseningOutcome`. A confident `physical` result
  needs `element` and at least two `opposingProperties`. Leave out the fields you cannot
  support from the evidence.
- Unknown keys are rejected, so a misspelt field fails before any call.

## Reading the result

- `classification` and `confidence`. Confidence below 0.6, or citations of evidence ids
  that are not in the request, become `uncertain`.
- `groundedEvidenceIds`: the evidence the classification rests on.
- `principles`: for a confident result, at most 8 candidate heuristics from the catalog
  with Jev relevance >= 0.5, in descending relevance. When fewer than three clear 0.5, the
  top 3 by relevance are returned flagged `belowThreshold: true`. Treat them as prompts for
  design options, not as decisions. Classification is probabilistic
  (`inferenceDeterministic: false`), and the catalog is not the classical 39x39 matrix.
- `billedCostUsd` is always `null`. `usage.piReported` is an estimate, not a bill.
