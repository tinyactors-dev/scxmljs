/**
 * The documentation media pipeline (run through scripts/media; see its --help).
 *
 *   1. build the stage (stage.html: the elements from source, local fonts, the playground's charts);
 *   2. render every entry of docs/media.json with render.mjs inside the pinned Playwright image;
 *   3. hash each entry: its spec, its encode settings and its frames' pixels → <name>-<hash8>;
 *   4. compare with docs/media.lock.json. A different hash alone doesn't make an entry stale: a
 *      render on another architecture differs in anti-aliasing noise. Unless the spec or encoding
 *      changed, the fresh render is encoded and compared with the published files, pixel by pixel
 *      (compare.ts); only a perceptual difference makes it stale. --check stops here (exit 1 when
 *      anything is stale);
 *   5. encode the stale entries (ffmpeg), push them to the media branch, prune it, point the docs
 *      at the new names, update the lock, commit and push main, and redeploy the website. An
 *      entry that isn't stale keeps its published file and name.
 */
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { $ } from "bun";
import { DOC_GLOBS, MEDIA, MEDIA_BRANCH } from "../../docs/config.ts";
import { markdownFiles } from "../../docs/markdown.ts";
import { compareStills, compareVideos, TOLERANCE, type Verdict } from "./compare.ts";

const root = join(import.meta.dir, "../../..");
const IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble"; // keep in step with @playwright/test (and scripts/visual.sh)
// The image runs natively on the host's architecture (never emulated: Chromium crashes under qemu).
// amd64 and arm64 renders differ only in anti-aliasing noise, which the staleness check tolerates.
const HOST_ARCH = (await $`uname -m`.text()).trim();
const PLATFORM = process.env.SCXML_MEDIA_PLATFORM || (["arm64", "aarch64"].includes(HOST_ARCH) ? "linux/arm64" : "linux/amd64");
const SPEC = "docs/media.json";
const LOCK = "docs/media.lock.json";
const SKIPPED = 3; // exit code: this host can't render (no Docker)
const FPS = 30; // the video's frame rate

/** ffmpeg arguments per output format; part of the hash, so changing them renames the files. */
const ENCODE = {
  video: {
    webm: [
      "-vf",
      `fps=${FPS},format=yuv420p`,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "30",
      "-b:v",
      "0",
      "-row-mt",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "3",
      "-an",
    ],
    webp: [
      "-vf",
      "fps=12,scale=1600:-2:flags=lanczos",
      "-c:v",
      "libwebp_anim",
      "-q:v",
      "75",
      "-compression_level",
      "5",
      "-loop",
      "0",
      "-an",
    ],
    png: ["copy"],
  },
  still: {
    webp: ["-c:v", "libwebp", "-quality", "90", "-compression_level", "6"],
    png: ["copy"],
  },
} as const;

interface Entry {
  name: string;
  about: string;
  scene: string;
  theme: string;
  scheme: string;
  viewport: [number, number];
  scale: number;
  formats: string[];
}
/** hash: of the pixels (and recipe) published; recipe: of the spec and encode settings alone. */
type Lock = Record<string, { hash: string; recipe?: string; files: string[] }>;

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => (flag(f) ? argv[argv.indexOf(f) + 1] : undefined);
const check = flag("--check");
const dryRun = flag("--dry-run");
const twice = flag("--twice");
const noCommit = flag("--no-commit");
const only = opt("--only")?.split(",");
const ci = process.env.GITHUB_ACTIONS === "true";
const log = (s: string) => console.log(s);
const step = (s: string) => console.log(`\n\x1b[1m── ${s}\x1b[0m`);
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const spec: { media: Entry[] } = await Bun.file(join(root, SPEC)).json();
const entries = spec.media.filter((e) => !only || only.includes(e.name));
if (only && entries.length !== only.length) fail(`--only: unknown media (known: ${spec.media.map((e) => e.name).join(", ")})`);
for (const e of spec.media) {
  const kind = e.scene === "explorer-tour" ? "video" : "still";
  // the lossless PNG is what staleness is decided on (compare.ts), so every entry publishes one
  if (!e.formats.includes("png")) fail(`${SPEC}: ${e.name} needs a png (staleness is decided on it)`);
  for (const f of e.formats)
    if (!(f in ENCODE[kind])) fail(`${SPEC}: ${e.name} can't be ${f} (a ${kind} is ${Object.keys(ENCODE[kind]).join(", ")})`);
}
const lockFile = Bun.file(join(root, LOCK));
const { $comment: _comment, ...lock }: Lock & { $comment?: unknown } = (await lockFile.exists()) ? await lockFile.json() : {};

// ── can this host render? ──────────────────────────────────────────────────
if ((await $`docker info`.quiet().nothrow()).exitCode !== 0) {
  const msg = "media: can't render here: Docker isn't available. They render wherever Docker runs (and on the media workflow).";
  if (process.env.SCXML_MEDIA_REQUIRED === "1") fail(msg);
  console.log(`media: skipped. ${msg}`);
  process.exit(SKIPPED);
}

// ── build the stage, render the frames ──────────────────────────────────────
const work = join(root, ".media");
await mkdir(work, { recursive: true });
// published/ caches downloads of the published media (their names are content hashes)
for (const d of await readdir(work)) if (d !== "published") await rm(join(work, d), { recursive: true, force: true });
const t0 = performance.now();
step("stage (Bun.build)");
const stage = join(work, "stage");
const built = await Bun.build({ entrypoints: [join(import.meta.dir, "stage.html")], outdir: stage, target: "browser", splitting: true });
if (!built.success) fail(`stage build failed:\n${built.logs.join("\n")}`);
await mkdir(join(stage, "charts"), { recursive: true });
for (const dir of ["examples/playground/charts", "docs/examples"])
  for (const f of await readdir(join(root, dir))) if (f.endsWith(".scxml")) await copyFile(join(root, dir, f), join(stage, "charts", f));

const { hashes, recipes } = await renderAndHash("frames");
if (twice) {
  const again = (await renderAndHash("frames-2")).hashes;
  const differ = entries.filter((e) => again[e.name] !== hashes[e.name]);
  if (differ.length) fail(`not deterministic: ${differ.map((e) => `${e.name} ${hashes[e.name]} ≠ ${again[e.name]}`).join(", ")}`);
  log(`✓ rendered twice, identical: ${entries.map((e) => `${e.name}-${hashes[e.name]}`).join(", ")}`);
}

// ── stale? ──────────────────────────────────────────────────────────────────
const files = new Map<string, string>(); // published name → local path
step(`compare with ${LOCK} and the published media (${MEDIA_BRANCH})`);
/** the hash each entry is published under: the lock's while the published files still show it */
const current: Record<string, string> = {};
const changed: Entry[] = [];
for (const e of entries) {
  const old = lock[e.name];
  const fresh = hashes[e.name]!;
  let why: string | undefined;
  if (!old) why = "new";
  else if (old.hash === fresh) log(`  = ${e.name}: ${fresh}`);
  else if (old.recipe && old.recipe !== recipes[e.name]) why = "its spec or encoding changed";
  else {
    const v = await looksPublished(e, old);
    if (v.same) log(`  ≈ ${e.name}: ${old.hash} (this render is ${fresh}: at most ${v.worst} px differ in ${v.frames} frame(s))`);
    else why = v.reason ?? `${v.worst === Number.POSITIVE_INFINITY ? "it" : `${v.worst} px`} differ`;
  }
  if (why) {
    log(`  ≠ ${e.name}: ${old?.hash ?? "(new)"} → ${fresh} (${why})`);
    changed.push(e);
    current[e.name] = fresh;
  } else current[e.name] = old!.hash;
}
const orphans = Object.keys(lock).filter((n) => !spec.media.some((e) => e.name === n));
if (check) {
  const seconds = ((performance.now() - t0) / 1000).toFixed(0);
  if (changed.length || (!only && orphans.length))
    fail(
      `stale media (${[...changed.map((e) => e.name), ...orphans].join(", ")}): the docs don't show what the code renders. ` +
        "Run scripts/media (or let the media workflow do it on main).",
    );
  log(`✓ media are current (${entries.length} checked in ${seconds} s)`);
  process.exit(0);
}

// ── encode ──────────────────────────────────────────────────────────────────
// the comparison encoded renders that look like what's published: those aren't published again
const publishing = (name: string) => dryRun || changed.some((e) => name.startsWith(`${e.name}-${hashes[e.name]}.`));
for (const name of [...files.keys()]) if (!publishing(name)) files.delete(name);
const toEncode = dryRun ? entries : changed;
if (toEncode.length) step(`encode (ffmpeg): ${toEncode.map((e) => e.name).join(", ")}`);
for (const e of toEncode)
  for (const format of e.formats) {
    const name = await encode(e, format);
    log(`  ${name.padEnd(34)} ${(Bun.file(files.get(name)!).size / 1024).toFixed(0).padStart(6)} KB`);
  }

if (dryRun) {
  const dest = opt("--out") ?? "media-out";
  await mkdir(dest, { recursive: true });
  for (const [name, path] of files) await copyFile(path, join(dest, name));
  step(`dry run: wrote ${files.size} files to ${dest}/; nothing published or committed`);
  process.exit(0);
}
if (!changed.length && !orphans.length) {
  log("\n✓ the docs already show what the code renders: nothing to publish");
  process.exit(0);
}

// ── publish: the media branch, then main ────────────────────────────────────
const identity = ci
  ? ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]
  : [];
const git = (...args: string[]) => $`git ${identity} ${args}`.cwd(root).quiet();
if ((await git("status", "--porcelain", "--untracked-files=no").text()).trim()) fail("uncommitted changes: publish from a clean tree");
const branch = ci ? process.env.GITHUB_REF_NAME! : (await git("branch", "--show-current").text()).trim();
if (branch !== "main") fail(`publish from main (this is ${branch || "a detached HEAD"}); use --dry-run or --check elsewhere`);

const newLock: Lock = {};
for (const e of spec.media) {
  const hash = current[e.name] ?? lock[e.name]?.hash;
  const recipe = recipes[e.name] ?? lock[e.name]?.recipe;
  if (hash) newLock[e.name] = { hash, recipe, files: e.formats.map((f) => `${e.name}-${hash}.${f}`) };
}
step(`media branch (${MEDIA_BRANCH})`);
await publishBranch(newLock);
// raw.githubusercontent.com may take a moment to see the new branch head
for (const name of files.keys()) {
  for (let i = 0; i < 40 && !(await fetch(`${MEDIA}/${name}`, { method: "HEAD" })).ok; i++) await Bun.sleep(3000);
}

step("docs on main");
if (noCommit) {
  const touched = await pointDocsAt(newLock);
  log(`--no-commit: updated ${[LOCK, ...touched].join(", ")}; not committed`);
  process.exit(0);
}
// rebase-and-retry: on a race, start again from the new main and rewrite the names there
for (let attempt = 1; ; attempt++) {
  const touched = await pointDocsAt(newLock);
  await git("add", LOCK, ...touched);
  await git("commit", "--quiet", "-m", `docs: refresh media (${changed.map((e) => e.name).join(", ") || "prune"})`);
  const pushed = await $`git push --quiet origin HEAD:refs/heads/main`.cwd(root).nothrow();
  if (pushed.exitCode === 0) {
    log(`✓ pushed ${(await git("rev-parse", "--short", "HEAD").text()).trim()} to main (${[LOCK, ...touched].join(", ")})`);
    break;
  }
  if (attempt === 5) fail("couldn't push to main after 5 attempts");
  log(`  main moved: rebasing (attempt ${attempt + 1})`);
  await git("fetch", "--quiet", "origin", "main");
  await git("reset", "--quiet", "--hard", "origin/main");
}

step("website");
const site = await $`gh workflow run site.yml --ref main`.cwd(root).nothrow();
if (site.exitCode === 0) log("✓ started the site workflow (site.yml on main)");
else fail(`couldn't start site.yml: ${site.stderr.toString().trim()}`);

// ── helpers ─────────────────────────────────────────────────────────────────

/** Renders the entries into .media/<dir> (inside Docker) and returns each entry's hash and recipe. */
async function renderAndHash(dir: string) {
  step(`render (${IMAGE}, ${PLATFORM})`);
  const uid = (await $`id -u`.text()).trim();
  const gid = (await $`id -g`.text()).trim();
  const out = join(work, dir);
  const res = Bun.spawnSync(
    [
      "docker",
      "run",
      "--rm",
      "--platform",
      PLATFORM,
      "--ipc=host",
      "--init",
      "--user",
      `${uid}:${gid}`,
      "-e",
      "HOME=/tmp",
      "-v",
      `${root}:/work`,
      "-w",
      "/work",
      IMAGE,
      "node",
      "scripts/lib/media/render.mjs",
      "--stage",
      relative(root, stage),
      "--spec",
      SPEC,
      "--out",
      relative(root, out),
      ...(only ? ["--only", only.join(",")] : []),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (res.exitCode !== 0) fail("rendering failed");
  const hashes: Record<string, string> = {};
  const recipes: Record<string, string> = {};
  for (const e of entries) {
    const d = join(out, e.name);
    const kind = e.scene === "explorer-tour" ? "video" : "still";
    const frames: { file: string; ms: number }[] = await Bun.file(join(d, "frames.json")).json();
    const h = new Bun.CryptoHasher("sha256");
    const { about: _, ...what } = e;
    const recipe = JSON.stringify({
      what,
      encode: Object.fromEntries(e.formats.map((f) => [f, (ENCODE[kind] as Record<string, unknown>)[f]])),
    });
    recipes[e.name] = sha256(new TextEncoder().encode(recipe)).slice(0, 8);
    h.update(recipe);
    for (const f of frames) h.update(`${f.ms}:${sha256(await Bun.file(join(d, f.file)).bytes())}\n`);
    h.update(`still:${sha256(await Bun.file(join(d, "still.png")).bytes())}`);
    hashes[e.name] = h.digest("hex").slice(0, 8);
  }
  return { hashes, recipes };
}

/** Encodes one format of a rendered entry into .media/out; returns its published name. */
async function encode(e: Entry, format: string): Promise<string> {
  const name = `${e.name}-${hashes[e.name]}.${format}`;
  if (files.has(name)) return name;
  const dir = join(work, "frames", e.name);
  const kind = e.scene === "explorer-tour" ? "video" : "still";
  const dest = join(work, "out", name);
  await mkdir(join(work, "out"), { recursive: true });
  const args = (ENCODE[kind] as Record<string, readonly string[]>)[format]!;
  if (args[0] === "copy") await copyFile(join(dir, "still.png"), dest);
  else if (kind === "video") {
    await Bun.write(join(dir, "frames.ffconcat"), await concat(dir));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", join(dir, "frames.ffconcat"), ...args, dest]);
  } else await ffmpeg(["-i", join(dir, "still.png"), ...args, dest]);
  files.set(name, dest);
  return name;
}

/**
 * Does this render look like the published files? The PNG (lossless: every entry has one) is
 * compared with the published PNG, and a video's webm, encoded like the published one, with it
 * (lossy against lossy): at the middle of every rendered frame, after its size and duration. The
 * webp files are made from the same pixels (and ffmpeg can't decode an animated one), so they
 * follow.
 */
async function looksPublished(e: Entry, old: Lock[string]): Promise<Verdict> {
  const compared = ["png", "webm"].filter((f) => e.formats.includes(f)); // the quick one first
  let verdict: Verdict = { same: false, worst: Number.POSITIVE_INFINITY, frames: 0, reason: "nothing to compare" };
  for (const format of compared) {
    const published = old.files.find((f) => f.endsWith(`.${format}`));
    if (!published) return { same: false, worst: Number.POSITIVE_INFINITY, frames: 0, reason: `${format} isn't published` };
    const theirs = await download(published);
    const ours = files.get(await encode(e, format))!;
    const tolerance = format === "webm" ? TOLERANCE.video : TOLERANCE.lossless;
    const v =
      format === "webm"
        ? await compareVideos(ours, theirs, await midFrames(e), FPS, tolerance)
        : await compareStills(ours, theirs, tolerance);
    if (!v.same) return { ...v, reason: `${format}: ${v.reason ?? `${v.worst} px differ in a frame (> ${tolerance.maxDiffPixels})`}` };
    verdict = { same: true, worst: Math.max(v.worst, verdict.same ? verdict.worst : 0), frames: verdict.frames + v.frames };
  }
  return verdict;
}

/** The video frame at the middle of each rendered frame's display time. */
async function midFrames(e: Entry): Promise<number[]> {
  const frames: { ms: number }[] = await Bun.file(join(work, "frames", e.name, "frames.json")).json();
  let t = 0;
  return frames.map((f) => {
    const n = Math.floor(((t + f.ms / 2) / 1000) * FPS);
    t += f.ms;
    return n;
  });
}

/** A published media file, from the cache in .media/published or the media branch. */
async function download(name: string): Promise<string> {
  const path = join(work, "published", name);
  if (await Bun.file(path).exists()) return path;
  const res = await fetch(`${MEDIA}/${name}`);
  if (!res.ok) fail(`couldn't download ${MEDIA}/${name}: ${res.status} (is it on ${MEDIA_BRANCH}?)`);
  await Bun.write(`${path}.part`, await res.arrayBuffer());
  await $`mv ${`${path}.part`} ${path}`.quiet();
  return path;
}

function sha256(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** The frames with their display times, for ffmpeg's concat demuxer. */
async function concat(dir: string) {
  const frames: { file: string; ms: number }[] = await Bun.file(join(dir, "frames.json")).json();
  let text = "ffconcat version 1.0\n";
  for (const f of frames) text += `file ${f.file}\nduration ${(f.ms / 1000).toFixed(4)}\n`;
  return `${text}file ${frames.at(-1)!.file}\n`; // concat ignores the last duration unless the file repeats
}

async function ffmpeg(args: string[]) {
  const res = Bun.spawnSync(["mise", "exec", "--", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stderr: "inherit" });
  if (res.exitCode !== 0) fail(`ffmpeg failed: ${args.join(" ")}`);
}

/** Media names linked from markdown text: `<name>-<hash8>.<ext>` under MEDIA. */
function linkedMedia(text: string): string[] {
  const esc = MEDIA.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return [...text.matchAll(new RegExp(`${esc}/([\\w.-]+-[0-9a-f]{8}\\.[a-z0-9]+)`, "g"))].map((m) => m[1]!);
}

/**
 * The media branch holds one squashed commit. It keeps every file the new lock names, everything
 * main's docs link right now (the previous set, for READMEs cached elsewhere), and everything any
 * v* tag's docs link (npm shows each published version's README forever).
 */
async function publishBranch(next: Lock) {
  const keep = new Set(Object.values(next).flatMap((l) => l.files));
  await git("fetch", "--quiet", "--tags", "origin", "main", MEDIA_BRANCH);
  const refs = ["origin/main", ...(await git("tag", "--list", "v*").text()).split("\n").filter(Boolean)];
  for (const ref of refs) {
    const docs = (await git("ls-tree", "-r", "--name-only", ref).text()).split("\n").filter((f) => f.endsWith(".md"));
    for (const f of docs) for (const name of linkedMedia(await git("show", `${ref}:${f}`).text())) keep.add(name);
  }
  const tree = await mkdtemp(join(tmpdir(), "media-branch-"));
  try {
    await git("worktree", "add", "--quiet", "--detach", tree, `origin/${MEDIA_BRANCH}`);
    const present = (await readdir(tree)).filter((f) => f !== ".git" && f !== "README.md" && f !== "sets.json" && f !== "index.json");
    const missing = [...keep].filter((f) => !present.includes(f) && !files.has(f));
    if (missing.length) fail(`${MEDIA_BRANCH} lacks files that docs link: ${missing.join(", ")}`);
    const pruned = present.filter((f) => !keep.has(f));
    for (const f of pruned) await rm(join(tree, f));
    await rm(join(tree, "sets.json"), { force: true });
    for (const [name, path] of files) await copyFile(path, join(tree, name));
    const index = [...keep].sort();
    await Bun.write(join(tree, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
    await Bun.write(
      join(tree, "README.md"),
      `# Documentation media\n\nWritten by \`scripts/media\` from \`docs/media.json\` on \`main\`; don't edit this branch by hand.\n` +
        "It's force-pushed as a single commit holding the media main's docs link now, the ones they linked before\n" +
        "the last refresh, and every file a `v*` tag's docs link (see `index.json`).\n",
    );
    const head = `media-publish-${process.pid}`;
    await $`git checkout --quiet --orphan ${head}`.cwd(tree).quiet();
    await $`git add -A`.cwd(tree).quiet();
    await $`git ${identity} commit --quiet -m ${`media: ${[...files.keys()].join(", ") || "prune"}`}`.cwd(tree).quiet();
    await $`git push --quiet --force origin HEAD:refs/heads/${MEDIA_BRANCH}`.cwd(tree);
    log(`✓ pushed ${files.size} file(s); pruned ${pruned.length ? pruned.join(", ") : "nothing"}; ${index.length} kept`);
    await git("branch", "-D", head).nothrow();
  } finally {
    await git("worktree", "remove", "--force", tree).nothrow();
  }
}

/** Rewrites every docs link to a media entry whose hash changed, and writes the lock. */
async function pointDocsAt(next: Lock): Promise<string[]> {
  const touched: string[] = [];
  const esc = MEDIA.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  for (const file of await markdownFiles(DOC_GLOBS)) {
    const path = join(root, file);
    const text = await Bun.file(path).text();
    let updated = text;
    for (const [name, { hash }] of Object.entries(next))
      updated = updated.replace(new RegExp(`(${esc}/${name})-[0-9a-f]{8}\\.`, "g"), `$1-${hash}.`);
    if (updated !== text) {
      await Bun.write(path, updated);
      touched.push(file);
    }
  }
  await Bun.write(
    join(root, LOCK),
    `${JSON.stringify({ $comment: "Generated by scripts/media from docs/media.json: the published hash of every media entry (and of its spec and encoding: recipe). Don't edit.", ...next }, null, 2)}\n`,
  );
  return touched;
}
