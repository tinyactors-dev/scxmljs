/**
 * Release DRY RUN for @tinyactors/scxmljs. It never publishes: it checks that the
 * tree is releasable, builds the exact tarball that would be published, verifies
 * it, runs `npm stage publish --dry-run` on it, and prints the command the maintainer
 * runs later. It exits non-zero while anything blocks a release.
 *
 *   scripts/release            everything, including the full scripts/ci
 *   scripts/release --skip-ci  skip scripts/ci (still builds); a warning, not a release check
 */
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { $ } from "bun";
import { REPO } from "./docs/config.ts";

const root = new URL("..", import.meta.url).pathname;
const pkgDir = join(root, "packages/scxmljs");
const pkg = await Bun.file(join(pkgDir, "package.json")).json();
const skipCi = process.argv.includes("--skip-ci");

const blockers: string[] = [];
const warnings: string[] = [];
const ok: string[] = [];
const section = (title: string) => console.log(`\n\x1b[1m── ${title}\x1b[0m`);
const pass = (msg: string) => (ok.push(msg), console.log(`  ✓ ${msg}`));
const warn = (msg: string) => (warnings.push(msg), console.log(`  ! ${msg}`));
const block = (msg: string) => (blockers.push(msg), console.log(`  ✗ ${msg}`));

const name: string = pkg.name;
const version: string = pkg.version;
const tag = `v${version}`;
// dist-tag: prereleases go to their first identifier (0.2.0-dev.3 → "dev", 1.0.0-rc.1 → "rc"), the rest to "latest"
const prerelease = version.includes("-");
const distTag = prerelease
  ? version
      .split("-")[1]!
      .split(".")[0]!
      .replace(/[^a-z0-9-]/gi, "") || "next"
  : "latest";
console.log(`\x1b[1mRelease dry run: ${name}@${version}\x1b[0m → dist-tag "${distTag}" (nothing is published)`);

// ── changelog ──────────────────────────────────────────────────────────────
section("changelog");
const changelog = await Bun.file(join(root, "CHANGELOG.md")).text();
const heading = changelog.split("\n").find((l) => l.startsWith(`## [${version}]`));
if (prerelease && !heading) pass(`prerelease: no CHANGELOG entry needed (it goes to the "${distTag}" dist-tag)`);
else if (!heading) block(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" entry`);
else if (!/^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}$/.test(heading)) block(`CHANGELOG.md: set the release date in "${heading}" (YYYY-MM-DD)`);
else pass(`CHANGELOG.md: ${heading.slice(3)}`);
if (!prerelease && !changelog.includes(`[${version}]: ${REPO}/releases/tag/${tag}`)) warn(`CHANGELOG.md has no link line for [${version}]`);

// ── git ────────────────────────────────────────────────────────────────────
section("git");
const hasCommits = (await $`git rev-parse --verify HEAD`.cwd(root).quiet().nothrow()).exitCode === 0;
if (!hasCommits) warn("the repository has no commits yet: make the first commit before releasing");
else {
  const dirty = (await $`git status --porcelain`.cwd(root).quiet().text()).trim();
  if (dirty) block(`uncommitted changes (${dirty.split("\n").length} paths): release from a clean tree`);
  else pass("working tree is clean");
  const tagRef = await $`git rev-parse --verify refs/tags/${tag}^{commit}`.cwd(root).quiet().nothrow();
  if (tagRef.exitCode !== 0) pass(`tag ${tag} is free`);
  else {
    // on a tag build (scripts/publish) the tag exists by definition: it must point at what's being released
    const head = (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim();
    if (tagRef.stdout.toString().trim() === head) pass(`tag ${tag} points at HEAD`);
    else block(`tag ${tag} already exists and points at another commit`);
  }
}

// ── registry (read-only) ───────────────────────────────────────────────────
section("registry (read-only)");
const view = await $`npm view ${`${name}@${version}`} version --json`.cwd(root).quiet().nothrow();
const viewOut = `${view.stdout}${view.stderr}`;
if (view.exitCode === 0 && viewOut.includes(version)) block(`${name}@${version} is already on npm: bump the version`);
else if (/E404|404 Not Found|is not in this registry/.test(viewOut)) pass(`${name}@${version} is not on npm yet`);
else warn(`couldn't ask the registry (offline?): ${viewOut.trim().split("\n")[0] ?? "no output"}`);

// ── metadata ───────────────────────────────────────────────────────────────
section("package.json");
for (const field of [
  "name",
  "version",
  "description",
  "license",
  "author",
  "repository",
  "homepage",
  "bugs",
  "exports",
  "types",
  "engines",
  "publishConfig",
])
  if (pkg[field] === undefined) block(`package.json has no "${field}"`);
if (pkg.publishConfig?.access !== "public") block('publishConfig.access must be "public" for a scoped package');
if (pkg.private) block("package.json is private");
if (!String(pkg.repository?.url ?? "").includes(REPO.replace("https://", "")))
  block(`repository.url doesn't match scripts/docs/config.ts (${REPO})`);
if (blockers.every((b) => !b.startsWith("package.json") && !b.startsWith("publishConfig") && !b.startsWith("repository")))
  pass("required fields present");

// ── docs media ─────────────────────────────────────────────────────────────
// every screenshot and video must show what this code renders (scripts/media; arm64 + Docker only)
section("docs media");
const media = Bun.spawnSync([join(root, "scripts/media"), "--check"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (media.exitCode === 0) pass("docs media are current");
else if (media.exitCode === 3) warn("docs media weren't checked: this host can't render them (needs Docker on arm64)");
else block("docs media are stale or didn't render: run scripts/media (the media workflow does it on main)");

// ── checks ─────────────────────────────────────────────────────────────────
section(skipCi ? "scripts/ci (skipped)" : "scripts/ci");
if (skipCi) {
  warn("--skip-ci: scripts/ci was not run, so this is not a release check");
  await $`mise run build`.cwd(root).quiet();
  pass("built dist/");
} else {
  const ci = Bun.spawnSync([join(root, "scripts/ci"), "--full"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, SCXML_MEDIA_CHECKED: "1" }, // checked above
  });
  if (ci.exitCode === 0) pass("scripts/ci passed");
  else block("scripts/ci failed");
}

// ── the tarball ────────────────────────────────────────────────────────────
section("tarball");
const tmp = await mkdtemp(join(tmpdir(), "scxmljs-release-"));
let tarball = "";
try {
  // the prepack build prints before npm's JSON: parse from the first "["
  const packOut = await $`npm pack --json --pack-destination ${tmp}`.cwd(pkgDir).quiet().text();
  const packed = JSON.parse(packOut.slice(packOut.indexOf("\n[") + 1 || packOut.indexOf("["))) as {
    filename: string;
    size: number;
    unpackedSize: number;
    files: { path: string }[];
    integrity: string;
  }[];
  const info = packed[0]!;
  tarball = join(tmp, info.filename);
  await $`tar -xzf ${tarball} -C ${tmp}`.quiet();
  const unpacked = join(tmp, "package");
  const files = (await walk(unpacked)).map((f) => relative(unpacked, f)).sort();

  const allowed = [
    /^package\.json$/,
    /^README\.md$/,
    /^LICENSE$/,
    /^THIRD_PARTY_NOTICES$/,
    /^dist\/[\w/-]+\.(js|js\.map|d\.ts)$/,
    /^dist\/themes\/[\w-]+\.css$/,
  ];
  const unexpected = files.filter((f) => !allowed.some((re) => re.test(f)));
  if (unexpected.length) block(`unexpected files in the tarball: ${unexpected.join(", ")}`);
  else pass(`${files.length} files, all expected`);
  for (const f of ["README.md", "LICENSE", "THIRD_PARTY_NOTICES"]) if (!files.includes(f)) block(`${f} is missing from the tarball`);

  // every export target (and its types) must be in the tarball
  const shipped = await Bun.file(join(unpacked, "package.json")).json();
  for (const [sub, target] of Object.entries(shipped.exports as Record<string, string | Record<string, string>>)) {
    const targets = typeof target === "string" ? { default: target } : target;
    for (const [cond, path] of Object.entries(targets))
      if (!files.includes(path.replace(/^\.\//, ""))) block(`exports["${sub}"].${cond} → ${path} is not in the tarball`);
    if (typeof target !== "string" && !target.types && !sub.endsWith(".css") && sub !== "./package.json")
      block(`exports["${sub}"] has no types`);
  }
  if (shipped.version !== version) block(`the tarball says version ${shipped.version}`);
  if (JSON.stringify(shipped.exports).includes("/src/")) block("exports point into src/ (not shipped)");
  if (!blockers.some((b) => b.includes("tarball") || b.startsWith("exports")))
    pass("every export and its types resolve inside the tarball");

  const dts = files.filter((f) => f.endsWith(".d.ts"));
  const leaks = [];
  for (const f of dts) if (/from "\.{1,2}\/[^"]+\.ts"/.test(await Bun.file(join(unpacked, f)).text())) leaks.push(f);
  if (leaks.length) block(`declarations import .ts files: ${leaks.join(", ")}`);
  else pass(`${dts.length} declaration files, no .ts imports`);

  console.log(`  packed ${(info.size / 1024).toFixed(1)} KB, unpacked ${(info.unpackedSize / 1024).toFixed(1)} KB`);
  console.log(`  ${info.integrity}`);

  // ── npm stage publish --dry-run (CI stages; a maintainer approves) ────────
  section("npm stage publish --dry-run");
  const dryRun = ["npm", "stage", "publish", tarball, "--dry-run", "--access", "public", "--tag", distTag];
  // this script must never publish: the only publish invocation is a dry run
  if (!dryRun.includes("--dry-run")) throw new Error("refusing to run npm publish without --dry-run");
  const result = Bun.spawnSync(dryRun, { cwd: tmp, stdout: "pipe", stderr: "pipe" });
  const out = `${result.stdout}${result.stderr}`;
  const notable = out
    .split("\n")
    .filter((l) => /Publishing to|name:|version:|package size|unpacked size|total files|tag|access|dry-run/i.test(l));
  for (const l of notable) console.log(`  ${l.replace(/^npm notice\s*/, "")}`);
  if (result.exitCode === 0) pass("npm stage publish --dry-run accepted the tarball");
  else block(`npm stage publish --dry-run failed: ${out.trim().split("\n").slice(-3).join(" / ")}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

// ── summary ────────────────────────────────────────────────────────────────
section("summary");
console.log(`  ${ok.length} checks passed, ${warnings.length} warnings, ${blockers.length} blockers`);
for (const w of warnings) console.log(`  ! ${w}`);
for (const b of blockers) console.log(`  ✗ ${b}`);
console.log(`
  To publish ${name}@${version} (this script never does):

    git tag ${tag} && git push origin main ${tag}

  The tag starts .github/workflows/release.yml, which runs scripts/publish: this same check
  on GitHub, then \`npm stage publish\` through npm trusted publishing (OIDC, provenance).
  Then approve it with 2FA: npmjs.com → the package → Staged Packages → Approve
  (or \`npm stage list ${name}\` and \`npm stage approve <stage-id>\`).
`);
if (blockers.length) {
  console.log("\x1b[1;31m✗ not releasable yet\x1b[0m");
  process.exit(1);
}
console.log("\x1b[1;32m✓ releasable (dry run)\x1b[0m");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir)) {
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
