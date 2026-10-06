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

Bump package.json and package-lock.json together and push a matching version tag only when authorized to release. The workflow gates on platform tests and creates a draft with checksum and provenance manifest assets. A maintainer reviews the draft before publication. GitHub tarball releases do not imply npm registry publication or ownership of the unscoped triz name.
