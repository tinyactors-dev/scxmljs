/**
 * Runtime measurements for @tinyactors/scxmljs, run against the BUILT package
 * (packages/scxmljs/dist) so Bun and Node measure the same code:
 *
 *   bun  bench/runtime.mjs <measure> [args…]
 *   node --expose-gc bench/runtime.mjs <measure> [args…]
 *
 * Prints one JSON object on stdout. scripts/bench.ts runs these as
 * subprocesses (a fresh process per cold-start sample) and aggregates.
 *
 * Measures:
 *   load <sandboxed|trusted>                 cold import (+ QuickJS instantiation)
 *   compile <fixture.scxml> <runs>           DOMParser parse + compile
 *   sessions <sandboxed|trusted> <fixture> <n>  create+start n sessions: time and memory per session
 *   throughput <sandboxed|trusted> <events> <microsteps>
 *   leak <sandboxed|trusted> <cycles>        create/start/dispose; memory at checkpoints
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../packages/scxmljs/dist");
const entryFile = (model) => join(dist, model === "trusted" ? "trusted.js" : "index.js");
const now = () => performance.now();
const [measure, ...args] = process.argv.slice(2);
const isBun = typeof Bun !== "undefined";

function gc() {
  if (isBun) Bun.gc(true);
  else if (typeof globalThis.gc === "function") {
    globalThis.gc();
    globalThis.gc();
  } else throw new Error("run node with --expose-gc");
}

function memory(extra = 0) {
  gc();
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, external: m.external, wasm: extra };
}

async function domParser() {
  const { Window } = await import("happy-dom");
  return new new Window().DOMParser();
}

/** WebAssembly memory of the shared QuickJS module (sandboxed sessions live there). */
async function wasmBytes() {
  try {
    const q = await import(join(dist, "datamodel-quickjs.js"));
    return q.quickJSModule().getWasmMemory().buffer.byteLength;
  } catch {
    return 0;
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function p95(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

switch (measure) {
  case "load": {
    const model = args[0];
    const t0 = now();
    const m = await import(entryFile(model));
    const t1 = now();
    if (model !== "trusted") await m.loadQuickJS();
    const t2 = now();
    out({ importMs: t1 - t0, engineMs: t2 - t1, totalMs: t2 - t0 });
    break;
  }

  case "compile": {
    const [file, runsArg] = args;
    const runs = Number(runsArg);
    const m = await import(entryFile("trusted"));
    const parser = await domParser();
    const source = readFileSync(file, "utf8");
    const parse = [];
    const compile = [];
    let states = 0;
    let transitions = 0;
    for (let i = 0; i < runs; i++) {
      const t0 = now();
      const root = m.parseSCXML(source, parser);
      const t1 = now();
      const model = m.compile(root);
      const t2 = now();
      parse.push(t1 - t0);
      compile.push(t2 - t1);
      states = model.states.filter((s) => s.kind !== "scxml").length;
      transitions = model.states.reduce((n, s) => n + s.transitions.length, 0);
    }
    out({
      states,
      transitions,
      parseMs: { median: median(parse), p95: p95(parse) },
      compileMs: { median: median(compile), p95: p95(compile) },
    });
    break;
  }

  case "sessions": {
    const [model, file, nArg] = args;
    const n = Number(nArg);
    const m = await import(entryFile(model));
    if (model !== "trusted") await m.loadQuickJS();
    const parser = await domParser();
    const compiled = m.compile(m.parseSCXML(readFileSync(file, "utf8"), parser));
    const clock = new m.VirtualClock();
    // warm up: the first session pays for one-time setup (JIT, realm templates, wasm growth)
    const warm = new m.Session(compiled, { clock, domParser: parser, loader: () => "<scxml/>" });
    warm.start();
    clock.run();
    const before = memory(await wasmBytes());
    const times = [];
    const sessions = [];
    for (let i = 0; i < n; i++) {
      const t0 = now();
      const s = new m.Session(compiled, { clock, domParser: parser });
      s.start();
      clock.run();
      times.push(now() - t0);
      sessions.push(s);
    }
    const after = memory(await wasmBytes());
    const children = sessions.reduce((k, s) => k + s.invocations.length, 0);
    out({
      n,
      childSessions: children,
      createStartMs: { median: median(times), p95: p95(times) },
      perSessionBytes: {
        rss: (after.rss - before.rss) / n,
        heapUsed: (after.heapUsed - before.heapUsed) / n,
        wasm: (after.wasm - before.wasm) / n,
      },
    });
    for (const s of sessions) s.dispose();
    warm.dispose();
    break;
  }

  case "throughput": {
    const [model, eventsArg, microArg] = args;
    const events = Number(eventsArg);
    const micro = Number(microArg);
    const m = await import(entryFile(model));
    const charts = await import(join(here, "charts.mjs"));
    if (model !== "trusted") await m.loadQuickJS();
    const parser = await domParser();

    // external events: send a batch, then let the clock process them
    const evRates = [];
    for (let run = 0; run < 5; run++) {
      const clock = new m.VirtualClock();
      const s = await m.createSession(charts.hotLoopChart(), { clock, domParser: parser });
      s.start();
      const t0 = now();
      for (let i = 0; i < events; i++) s.send("tick");
      clock.run();
      const dt = now() - t0;
      const n = s.snapshot().n;
      if (n !== events) throw new Error(`expected ${events} ticks, got ${n}`);
      evRates.push(events / (dt / 1000));
      s.dispose();
    }

    // microsteps: one macrostep that ping-pongs `micro` times
    const msRates = [];
    for (let run = 0; run < 5; run++) {
      const clock = new m.VirtualClock();
      const s = await m.createSession(charts.eventlessLoopChart(micro), { clock, domParser: parser, maxMicrosteps: micro * 2 });
      const t0 = now();
      s.start();
      const dt = now() - t0;
      if (s.status !== "done") throw new Error("eventless loop did not finish");
      msRates.push(micro / (dt / 1000));
      s.dispose();
    }
    out({
      eventsPerSec: { median: median(evRates), min: Math.min(...evRates) },
      microstepsPerSec: { median: median(msRates), min: Math.min(...msRates) },
    });
    break;
  }

  case "leak": {
    const [model, cyclesArg] = args;
    const cycles = Number(cyclesArg);
    const m = await import(entryFile(model));
    const charts = await import(join(here, "charts.mjs"));
    if (model !== "trusted") await m.loadQuickJS();
    const parser = await domParser();
    const compiled = m.compile(m.parseSCXML(charts.generatedChart(40), parser));
    const clock = new m.VirtualClock();
    const cycle = () => {
      const s = new m.Session(compiled, { clock, domParser: parser });
      s.start();
      s.send("area0.step0");
      clock.run();
      s.dispose();
    };
    for (let i = 0; i < 100; i++) cycle(); // warm-up: allocators and JITs reach steady state
    const checkpoints = [];
    const step = Math.max(1, Math.floor(cycles / 4));
    for (let done = 0; done < cycles; ) {
      for (let i = 0; i < step && done < cycles; i++, done++) cycle();
      checkpoints.push({ cycles: done, ...memory(await wasmBytes()) });
    }
    const first = checkpoints[0];
    const last = checkpoints[checkpoints.length - 1];
    const span = last.cycles - first.cycles || 1;
    out({
      cycles,
      checkpoints,
      growthPerCycleBytes: {
        rss: (last.rss - first.rss) / span,
        heapUsed: (last.heapUsed - first.heapUsed) / span,
        wasm: (last.wasm - first.wasm) / span,
      },
    });
    break;
  }

  default:
    throw new Error(`unknown measure "${measure}"`);
}
