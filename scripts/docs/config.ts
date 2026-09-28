/**
 * Where the documentation lives online. The package README is shown on npm,
 * where relative links don't resolve (the docs aren't in the tarball), so it
 * links to the repository with absolute URLs built from these constants.
 *
 * To move the repository, change REPO here and run `mise run docs:set-repo`:
 * it rewrites every absolute link (and package.json) from the old base to
 * the new one. The link checker (`mise run docs:links`) maps these URLs back
 * to local files, so they are checked offline like relative links.
 */
export const REPO = "https://github.com/tinyactors-dev/scxmljs";
export const BRANCH = "main";

/** Links to files in the repository: `${BLOB}/docs/testing.md`. */
export const BLOB = `${REPO}/blob/${BRANCH}`;
/** Links to directories: `${TREE}/examples`. */
export const TREE = `${REPO}/tree/${BRANCH}`;
/** Images: npm renders raw URLs, not blob URLs. */
export const RAW = `${REPO.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${BRANCH}`;

/** Markdown files that make up the documentation (checked for links; samples tested). */
export const DOC_GLOBS = ["README.md", "SECURITY.md", "CHANGELOG.md", "packages/scxmljs/README.md", "docs/**/*.md", "conformance/*.md"];

/** Files whose code samples must all be tagged for the doc-test (the user-facing docs). */
export const SAMPLE_GLOBS = ["README.md", "SECURITY.md", "packages/scxmljs/README.md", "docs/**/*.md"];

/** Never scanned: generated or vendored. */
export const IGNORE = ["docs/api/**", "**/node_modules/**", "conformance/ecma/**", ".doctest/**"];
