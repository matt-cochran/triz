# Contributing to TRIZ

Keep contributions focused on one documented capability. Discuss significant taxonomy, catalog, schema, or transport changes in an issue first.

## Development

Use Node 24+, run npm ci, then npm test. The suite compiles TypeScript and exercises offline behavior and the installable package. No credentials or paid classifier calls are needed. Run npm run pack to inspect the release artifact. Generated output and analysis artifacts remain ignored.

Tests use atomic scenarios, declarative names, and one behavioral assertion against a public outcome. Cover evidence validation, uncertainty, persistence, and public CLI/library behavior rather than private implementation details. Live calls must remain explicitly opt-in.

## Catalog contributions

Cite primary sources and identify software adaptations clearly. Do not copy substantial third-party prose or datasets without compatible licensing and provenance. The catalog is an adapted set of principles and routes, not a complete classical contradiction matrix. Preserve that distinction in output and documentation. Probabilistic classification must not be described as deterministic inference.

## Pull requests

Describe the problem, final behavior, evidence, and tests. Update documentation for public schema or CLI changes. Never include credentials, private evidence, or provider transcripts. AI-assisted contributions are welcome; contributors review the full changes themselves. Contributions use the project's MIT license. Be respectful and discuss technical disagreements with evidence.

## Releases

One version tag produces both the npm publication and the GitHub release, through a single workflow, `.github/workflows/publish.yml` (keep that file name: npm Trusted Publishing is bound to it). Release only when authorized to.

1. On a branch, bump the version in package.json and package-lock.json together (`npm version X.Y.Z --no-git-tag-version`), run `npm test` and `npm pack --dry-run`, and merge the pull request.
2. Tag the merged commit on main and push only the tag: `git tag vX.Y.Z <commit>` then `git push origin vX.Y.Z`. The tag must be exactly `v` plus the package.json version.
3. The workflow then:
   - fails unless the tag matches the package.json version (`scripts/verify-tag-version.mjs`);
   - runs `npm test` on the six platform runners;
   - packs one tarball and writes `triz-vX.Y.Z-node.tgz`, `checksums.sha256` (sha256sum lines for the tarball and the manifest) and `release-manifest.json` (`version`, `tag`, and the full 40-character source `commit`), and fails unless `scripts/verify-release-assets.mjs` accepts exactly those three assets;
   - publishes that tarball to npm with provenance, unless the version is already on npm;
   - creates (or updates and un-drafts) the GitHub release for the tag with the three assets, then downloads them again and checks the checksums.
4. Check that `npm view @matthew-cochran/triz version` and the release page show the new version.

Re-running the workflow for a tag is safe: a version already on npm is not republished, and its registry tarball becomes the release asset so the GitHub release carries the bytes npm serves. To backfill a GitHub release for a version that is already on npm, tag the commit npm recorded (`npm view @matthew-cochran/triz@X.Y.Z gitHead`) and push the tag, then run the workflow from main with the tag as input: `gh workflow run publish.yml --ref main -f tag=vX.Y.Z` (or Actions, Release, Run workflow). The tag push alone is not enough, because GitHub runs the workflow files of the tagged commit, which for an older version are the old ones. The workflow refuses a tag that does not point at the commit npm recorded.

Junior's checksum-verifying installer depends on exactly these asset names and manifest fields; change them only together with it.
