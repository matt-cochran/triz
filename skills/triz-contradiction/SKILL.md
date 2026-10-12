---
name: triz-contradiction
description: "Use when you are about to resolve a specific trade-off or conflicting requirement with TRIZ and need the step-by-step workflow: state the improving and worsening parameters, check the triz catalog, write the request JSON, run triz analyze (live only with authorization, otherwise replay with --offline), inspect the result, and attach the saved result to the deliverable or decision record. Read the triz skill for the method and formats."
---

# Resolve a contradiction with triz

The commands, request format and result fields are in the [triz](../triz/SKILL.md) skill.

1. **State the contradiction.** Write one sentence each for the improving parameter (what
   gets better) and the worsening parameter (what gets worse because of it). For a
   physical contradiction, name the element and its two opposing properties. If you
   cannot do this from evidence, stop: TRIZ does not apply yet.
2. **Gather evidence.** Give each fact a short id (`E1`, `E2`, …): measurements, incident
   notes, review comments. Never invent evidence to get a confident answer.
3. **Check the catalog.** Run `triz catalog` (offline) and note the principles or
   separation routes that look relevant, so you can judge the classifier's suggestions.
4. **Write the request**, for example `.triz/<topic>.request.json`, with `evidence`,
   `desiredImprovement`, and `worseningOutcome` or `element` + `opposingProperties`.
5. **Analyze.**
   - With the user's explicit authorization for a paid call:
     `triz analyze .triz/<topic>.request.json --out .triz/<topic>.result.json`.
   - Otherwise, or to reproduce an earlier run, replay a recorded response:
     `triz analyze .triz/<topic>.request.json --offline <response.json> --out .triz/<topic>.result.json`.
6. **Inspect.** Run `triz inspect .triz/<topic>.result.json`. If it says `uncertain` or
   `insufficient`, improve the evidence or the framing rather than forcing an answer. If
   it says `none`, there is no contradiction to resolve.
7. **Turn principles into options.** For each relevant principle or route, write one
   concrete design option and its expected effect on both parameters. Choose with the
   user; the result does not choose for you.
8. **Record it.** Attach the saved `result.json` (and the request) to the deliverable,
   pull request or decision record, and say which option was chosen and why.
