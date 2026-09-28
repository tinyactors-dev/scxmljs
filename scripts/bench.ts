/**
 * Benchmarks for @tinyactors/scxmljs: reproducible numbers the docs can cite.
 *
 *   bun scripts/bench.ts                # full run: Bun + Node + browser → bench/results/*.json, docs/measurements.md
 *   bun scripts/bench.ts --quick        # a few seconds; checks the harness still works (numbers are rough)
 *   bun scripts/bench.ts --no-node --no-browser
 *
 * Runtime measurements run against the BUILT package (dist/) in subprocesses
 * (bench/runtime.mjs), so Bun and Node measure the same code and cold starts
 * really are cold. Browser measurements need the playground (`mise run up`)
 * and agent-browser; they're skipped (and reported as skipped) otherwise.
 *
 * scripts/ci runs only `--quick` (≈6 s, Bun + Node, no thresholds): it keeps the
 * harness working against the current API. Benchmarks aren't pass/fail and CI
 * machines are noisy; the memory regression that matters is a unit test
 * (packages/scxmljs/test/leak.test.ts). Quick results go to bench/.fixtures/ (ignored).
 */

import { cpus, hostname, platform, release, totalmem } from "node:os";
import { $ } from "bun";
import { generatedChart } from "../bench/charts.mjs";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const withNode = !args.includes("--no-node");
const withBrowser = !args.includes("--no-browser") && !quick;
const fixtures = `${root}bench/.fixtures`;

const C = quick
  ? { coldSamples: 3, compileRuns: { small: 3, large: 2 }, sessions: 50, systems: 3, events: 2_000, microsteps: 2_000, leakCycles: 200 }
  : {
      coldSamples: 15,
      compileRuns: { small: 30, large: 5 },
      sessions: 500,
      systems: 20,
      events: 20_000,
      microsteps: 20_000,
      leakCycles: 1_000,
    };

// ───────────────────────────── setup ─────────────────────────────

console.log("building dist/ …");
await $`bun run build`.cwd(`${root}packages/scxmljs`).quiet();

const { supportDeskChart } = await import(`${root}examples/playground/src/explorer/support-desk-generator.ts`);
const charts: Record<string, string> = {
  gatekeeper: await Bun.file(`${root}examples/playground/charts/github-issues.scxml`).text(),
  fulfillment: await Bun.file(`${root}examples/playground/charts/fulfillment.scxml`).text(),
  "support-desk": supportDeskChart(),
  "generated-1000": generatedChart(1000),
  "generated-5000": generatedChart(5000),
};
for (const [id, text] of Object.entries(charts)) await Bun.write(`${fixtures}/${id}.scxml`, text);

const nodeVersion = withNode ? (await $`node --version`.nothrow().quiet().text()).trim() : "";
const runtimes: Record<string, string[]> = { bun: ["bun"] };
if (withNode) {
  const [major = 0, minor = 0] = nodeVersion.replace(/^v/, "").split(".").map(Number);
  if (major > 22 || (major === 22 && minor >= 3)) runtimes.node = ["node", "--expose-gc"];
  else console.log(`skipping Node: ${nodeVersion || "not installed"} (needs ≥ 22.3)`);
}

async function measure(runtime: string, ...cmd: (string | number)[]): Promise<any> {
  const proc = Bun.spawn([...runtimes[runtime]!, `${root}bench/runtime.mjs`, ...cmd.map(String)], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${runtime} ${cmd.join(" ")} failed:\n${err}`);
  return JSON.parse(out.trim().split("\n").pop()!);
}

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!;

// ─────────────────────────── measurements ───────────────────────────

const results: any = { date: new Date().toISOString(), quick, config: C, env: {}, runtimes: {}, browser: undefined };
results.env = {
  host: hostname(),
  os: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model ?? "unknown",
  cores: cpus().length,
  memoryGB: Math.round(totalmem() / 2 ** 30),
  bun: Bun.version,
  node: runtimes.node ? nodeVersion : undefined,
};

for (const runtime of Object.keys(runtimes)) {
  console.log(`\n== ${runtime}`);
  const r: any = {};
  results.runtimes[runtime] = r;

  process.stdout.write("cold start … ");
  r.coldStart = {};
  for (const model of ["sandboxed", "trusted"]) {
    const samples: Record<string, number>[] = [];
    for (let i = 0; i < C.coldSamples; i++) samples.push(await measure(runtime, "load", model));
    const pick = (k: string) => samples.map((s) => s[k] ?? Number.NaN);
    r.coldStart[model] = {
      totalMs: { median: med(pick("totalMs")), p95: p95(pick("totalMs")) },
      importMs: { median: med(pick("importMs")) },
      engineMs: { median: med(pick("engineMs")) },
    };
  }
  console.log("done");

  process.stdout.write("compile … ");
  r.compile = {};
  for (const id of Object.keys(charts)) {
    const runs = id.startsWith("generated-5000") || id === "support-desk" ? C.compileRuns.large : C.compileRuns.small;
    r.compile[id] = await measure(runtime, "compile", `${fixtures}/${id}.scxml`, runs);
  }
  console.log("done");

  process.stdout.write("sessions … ");
  r.sessions = {};
  for (const model of ["sandboxed", "trusted"]) {
    r.sessions[model] = {
      gatekeeper: await measure(runtime, "sessions", model, `${fixtures}/gatekeeper.scxml`, C.sessions),
      "support-desk": await measure(runtime, "sessions", model, `${fixtures}/support-desk.scxml`, C.systems),
    };
  }
  console.log("done");

  process.stdout.write("throughput … ");
  r.throughput = {};
  for (const model of ["sandboxed", "trusted"]) r.throughput[model] = await measure(runtime, "throughput", model, C.events, C.microsteps);
  console.log("done");

  process.stdout.write("leak check … ");
  r.leak = {};
  for (const model of ["sandboxed", "trusted"]) r.leak[model] = await measure(runtime, "leak", model, C.leakCycles);
  console.log("done");
}

// ───────────────────────────── browser ─────────────────────────────

if (withBrowser) {
  const reachable = (await $`curl -s -o /dev/null -w %{http_code} http://localhost:4321/bench`.nothrow().quiet().text()) === "200";
  const hasAgentBrowser = (await $`which agent-browser`.nothrow().quiet()).exitCode === 0;
  if (!reachable || !hasAgentBrowser) {
    results.browser = { skipped: !reachable ? "playground not running (mise run up)" : "agent-browser not installed" };
    console.log(`\nbrowser: skipped (${results.browser.skipped})`);
  } else {
    console.log("\n== browser (Chrome via agent-browser)");
    await $`agent-browser set viewport 1500 950`.nothrow().quiet();
    await $`agent-browser open ${"http://localhost:4321/bench?run"}`.quiet();
    const raw = await $`agent-browser eval ${"window.__bench.then((r) => JSON.stringify(r))"}`.quiet().text();
    results.browser = JSON.parse(JSON.parse(raw.trim()));
    console.log("done");
  }
} else results.browser = { skipped: quick ? "quick run" : "--no-browser" };

// ───────────────────────────── output ─────────────────────────────

const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
const ms = (x: number) => (x < 1 ? `${(x * 1000).toFixed(0)} µs` : `${x.toFixed(x < 10 ? 2 : 1)} ms`);
const k = (x: number) => (x >= 1000 ? `${Math.round(x / 1000)}k` : `${Math.round(x)}`);

function report(): string {
  const lines: string[] = [];
  const e = results.env;
  const rts = Object.keys(results.runtimes);
  const row = (...cells: string[]) => lines.push(`| ${cells.join(" | ")} |`);
  const head = (...cells: string[]) => {
    row(...cells);
    row(...cells.map(() => "---"));
  };
  lines.push("# Measurements", "");
  lines.push(`Generated by \`mise run bench\` (\`scripts/bench.ts\`) on ${results.date.slice(0, 10)}. Raw data: \`bench/results/\`.`, "");
  lines.push(
    `**Machine:** ${e.cpu}, ${e.cores} cores, ${e.memoryGB} GB, ${e.os}. **Runtimes:** Bun ${e.bun}${e.node ? `, Node ${e.node}` : ""}.`,
    "",
  );
  lines.push("Runtime numbers come from the built package (`dist/`), each measure in a fresh process. Medians unless noted.", "");

  lines.push("## Startup (cold, fresh process)", "");
  lines.push("Importing the entry point; for the sandbox this includes instantiating QuickJS (WebAssembly).", "");
  head("", ...rts.map((r) => `${r} median (p95)`));
  for (const model of ["sandboxed", "trusted"])
    row(
      model,
      ...rts.map(
        (r) => `${ms(results.runtimes[r].coldStart[model].totalMs.median)} (${ms(results.runtimes[r].coldStart[model].totalMs.p95)})`,
      ),
    );
  lines.push("");

  lines.push("## Compiling charts", "");
  lines.push(
    "Parsing (happy-dom's DOMParser in these runtimes; browsers use their own) and compiling + validating. Compiling is the library's cost.",
    "",
  );
  head("chart", "states", "transitions", ...rts.flatMap((r) => [`parse (${r})`, `compile (${r})`]));
  for (const id of Object.keys(charts)) {
    const c = results.runtimes[rts[0]!].compile[id];
    row(
      id,
      String(c.states),
      String(c.transitions),
      ...rts.flatMap((r) => [ms(results.runtimes[r].compile[id].parseMs.median), ms(results.runtimes[r].compile[id].compileMs.median)]),
    );
  }
  lines.push("");

  lines.push("## Sessions: creation and memory", "");
  lines.push(
    `Creating and starting ${C.sessions} gatekeeper sessions (one machine) and ${C.systems} support-desk systems (a root that invokes 14 child machines on start), after one warm-up session. Memory is the growth per session after a full GC: RSS, JS heap, and the QuickJS WebAssembly memory (which grows in large steps, so it often reads 0 for small counts).`,
    "",
  );
  head("model", "chart", ...rts.flatMap((r) => [`create+start (${r})`, `RSS / heap per session (${r})`]));
  for (const model of ["sandboxed", "trusted"])
    for (const chart of ["gatekeeper", "support-desk"]) {
      row(
        model,
        chart,
        ...rts.flatMap((r) => {
          const s = results.runtimes[r].sessions[model][chart];
          const wasm = s.perSessionBytes.wasm ? ` + ${kb(s.perSessionBytes.wasm)} wasm` : "";
          return [ms(s.createStartMs.median), `${kb(s.perSessionBytes.rss)} / ${kb(s.perSessionBytes.heapUsed)}${wasm}`];
        }),
      );
    }
  lines.push("");

  lines.push("## Throughput", "");
  lines.push(
    `External events: ${k(C.events)} \`send()\`s processed by a two-state machine that assigns a counter per transition. Microsteps: one macrostep of ${k(C.microsteps)} eventless transitions with a guard and an assignment each. Median of 5 runs.`,
    "",
  );
  head("model", ...rts.flatMap((r) => [`events/s (${r})`, `microsteps/s (${r})`]));
  for (const model of ["sandboxed", "trusted"])
    row(
      model,
      ...rts.flatMap((r) => [
        k(results.runtimes[r].throughput[model].eventsPerSec.median),
        k(results.runtimes[r].throughput[model].microstepsPerSec.median),
      ]),
    );
  lines.push("");

  lines.push("## Leak check", "");
  lines.push(
    `${k(C.leakCycles)} cycles of create → start → send → dispose (a 40-state chart), after 100 warm-up cycles; memory after a full GC at four checkpoints. Growth per cycle between the first and last checkpoint (≈ 0 means no leak; RSS includes allocator noise).`,
    "",
  );
  head("model", ...rts.flatMap((r) => [`heap / RSS / wasm per cycle (${r})`, `heap MB at checkpoints (${r})`]));
  for (const model of ["sandboxed", "trusted"])
    row(
      model,
      ...rts.flatMap((r) => {
        const l = results.runtimes[r].leak[model];
        const g = l.growthPerCycleBytes;
        const series = l.checkpoints.map((c: { heapUsed: number }) => (c.heapUsed / 2 ** 20).toFixed(2)).join(" → ");
        return [`${Math.round(g.heapUsed)} B / ${Math.round(g.rss)} B / ${Math.round(g.wasm)} B`, series];
      }),
    );
  lines.push("");

  lines.push("## Browser", "");
  const b = results.browser;
  if (b?.skipped) lines.push(`Skipped: ${b.skipped}.`, "");
  else if (b) {
    lines.push(
      `Chrome ${b.browser}, viewport ${b.viewport.join("×")}, trusted sessions. Times run until the content is in the DOM (checked once per animation frame, so anything under ~17 ms means "within a frame"). Median of 3.`,
      "",
    );
    lines.push("### `<scxml-explorer>`", "");
    head("chart", "states", "first render", "tree rows in DOM", "tree scroll: rows, median / p95 frame", "long tasks while scrolling");
    for (const x of b.explorer)
      row(
        x.chart,
        String(x.states),
        ms(x.firstRenderMs),
        String(x.treeRowsInDom),
        x.scroll ? `${x.scroll.treeRows} rows, ${ms(x.scroll.medianFrameMs)} / ${ms(x.scroll.p95FrameMs)}` : "",
        x.scroll ? String(x.scroll.longTasks) : "",
      );
    lines.push("");
    lines.push("### `<scxml-view>`", "");
    lines.push(
      "`session` = a host-provided, running session. `source` = SCXML text with the `trusted` attribute: parse, compile, load the engine, lay out and draw.",
      "",
    );
    head("chart", "state boxes drawn", "render (session)", "render (source)");
    for (const x of b.view) row(x.chart, String(x.stateBoxes), ms(x.renderWithSessionMs), ms(x.sourceToRenderMs));
    lines.push("", "Charts over the view's `max-states` (150) are folded: large compound states become single boxes.", "");
  }
  return lines.join("\n");
}

const md = report();
console.log(`\n${md}`);
const stamp = results.date.slice(0, 10);
const json = quick ? "bench/.fixtures/quick.json" : `bench/results/${stamp}.json`;
await Bun.write(`${root}${json}`, `${JSON.stringify(results, null, 2)}\n`);
if (!quick) await Bun.write(`${root}docs/measurements.md`, `${md}\n`);
console.log(`\nwrote ${json}${quick ? "" : " and docs/measurements.md"}`);
