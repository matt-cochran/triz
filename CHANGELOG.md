# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-10-23

### Fixed

- Describe how 0.4.0 ranks principles in the `triz` skill reference: a confident
  result returns at most 8 catalog heuristics with Jev relevance >= 0.5 in
  descending relevance, or the top 3 flagged `belowThreshold: true` when fewer
  than three clear the floor, instead of the outdated "unranked candidate
  heuristics" ([#17](https://github.com/matt-cochran/triz/issues/17)).
- Point the README library example at the published scoped package name
  `@matthew-cochran/triz` rather than the unscoped `triz` ([#17](https://github.com/matt-cochran/triz/issues/17)).
- Add this changelog, covering 0.1.0 to 0.4.0 ([#17](https://github.com/matt-cochran/triz/issues/17)).

## [0.4.0] - 2026-10-22

### Added

- Ranked principles for a confident `technical` or `physical` result: a bounded
  relevance question per catalog entry, with principles at relevance 0.5 or
  higher returned in descending order (at most 8), each carrying a `rank`,
  `relevance`, and a deterministic `reason`.
- `belowThreshold: true` on the top 3 principles when fewer than three clear the
  0.5 relevance floor.
- A deterministic rationale built from the request and grounded evidence ids, so
  it is never empty for a confident result.
- A `needs` list on uncertain and insufficient results.
- A `mixed_framing` refusal: a request carrying both a technical and a physical
  framing is rejected with `TrizRequestError` code `mixed_framing` before any
  provider call, and the CLI prints `error[code]`.

### Changed

- Without relevance data (an offline fixture without it, or a failed relevance
  call) the full catalog is returned unranked as before, and `notes` records
  that ranking was skipped.
- `triz skills install` and `uninstall` serialize concurrent runs with an
  exclusive per-root `.triz-skills.lock`, recovered when stale or owned by a
  dead same-host process; `--dry-run` and `list` take no lock.

## [0.3.0] - 2026-10-12

### Added

- Agent Skills shipped in the npm package: `triz` (method reference) and
  `triz-contradiction` (workflow), installed with `triz skills
  install|uninstall|list` for the claude, codex, cursor, copilot, gemini,
  agents-md and all targets at project or user scope.
- Per-root `.triz-skills.json` manifest of sha256 hashes with edit and
  foreign-file protection unless `--force`, shared-root reference counting, an
  AGENTS.md managed block, `--dry-run`, and atomic writes.
- `--version` and `-V` flags that print `triz <version>` from the package's own
  `package.json`.
- Safe command help and strict CLI argument handling.
- Labelled Pi cost and cached token usage in results.

### Changed

- New TRIZ requests reject ignored fields.
- Normalize the npm executable path.
- Publish GitHub releases alongside npm releases: one `publish.yml` workflow
  bound to npm Trusted Publishing validates the tag against `package.json`,
  runs the platform tests, packs one tarball, publishes it with provenance, and
  creates a non-draft GitHub release with checksum and manifest assets.
- Adopt the feature -> dev -> main branch flow, enforced by CI.

### Fixed

- Correct the release backfill docs and stop `upload-artifact` from skipping the
  dot-directory release assets.

## [0.2.1] - 2026-10-06

### Added

- Prepare the scoped `@matthew-cochran/triz` npm distribution and trusted
  publishing.
- TRIZ licensing (MIT) and contributor guidance for open-source release.

## [0.2.0] - 2026-10-05

### Added

- Complete software-adapted TRIZ contradiction catalog: the 40 Inventive
  Principles for technical contradictions and the six MATRIZ separation routes
  for physical ones.
- Catalog platform checks run once per pull request.

## [0.1.0] - 2026-10-05

### Added

- Initial release: an architecture-independent TRIZ contradiction
  classification CLI and library, compiled to JavaScript.
- Verified release packages for the x64 and ARM64 platforms.

[Unreleased]: https://github.com/matt-cochran/triz/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/matt-cochran/triz/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/matt-cochran/triz/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/matt-cochran/triz/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/matt-cochran/triz/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/matt-cochran/triz/releases/tag/v0.1.0
