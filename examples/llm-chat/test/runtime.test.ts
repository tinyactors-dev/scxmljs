import { describe, expect, test } from "bun:test";
import { VirtualClock } from "@tinyactors/scxmljs";
import { downloadSize, initialDownloads, PACKAGES, SDK } from "../src/tools/packages.ts";
import { ToolRuntime } from "../src/tools/runtime.ts";
import { loadPackage, seedSql } from "../src/tools/wasm.ts";

const tick = () => new Promise((r) => setImmediate(r));

/** A runtime with one tool that has a simulated and a real version. */
function setup() {
  const clock = new VirtualClock();
  let imports = 0;
  const runtime = new ToolRuntime(
    clock,
    {
      shell: {
        simulated: async () => "simulated output",
        real: async () => {
          imports++;
          return async () => "real output";
        },
      },
    },
    500,
  );
  const done: { callId: string; isError: boolean; content: string }[] = [];
  runtime.attach({ sessionId: "t", deliver: (_name, data) => done.push(data as (typeof done)[number]) });
  const run = (callId: string, real: boolean) =>
    runtime.send({ event: "run", target: "", type: "", data: { callId, name: "shell", input: { command: "ls" }, real } });
  return { clock, runtime, done, run, imports: () => imports };
}

describe("tool runtime: the chart says simulated or real, per call", () => {
  test("simulated calls take the simulated latency", async () => {
    const { clock, done, run } = setup();
    run("a", false);
    clock.advance(499);
    await tick();
    expect(done).toEqual([]);
    clock.advance(1);
    await tick();
    await tick();
    expect(done).toEqual([{ callId: "a", isError: false, content: "simulated output" }]);
  });

  test("real calls run the real tool at once, imported once", async () => {
    const { done, run, imports } = setup();
    run("a", true);
    run("b", true);
    for (let i = 0; i < 5; i++) await tick();
    expect(done.map((d) => d.content)).toEqual(["real output", "real output"]);
    expect(imports()).toBe(1);
  });

  test("without a link to the charts, it is simulated and idle", () => {
    const { runtime } = setup();
    expect(runtime.mode).toBe("simulated");
    expect(runtime.realState("shell")).toEqual({ status: "idle" });
    expect(runtime.hasReal).toBe(true);
  });
});

describe("download sizes, per package", () => {
  test("a tool lists the runtime and every package it needs, waiting, before anything loads", () => {
    const names = (tool: string) => initialDownloads(tool).map((e) => [e.label, e.phase]);
    expect(names("shell")).toEqual([
      ["Wasmer runtime", "waiting"],
      ["bash", "waiting"],
      ["coreutils", "waiting"],
    ]);
    // Python's package brings bash and coreutils: whichever of Terminal and Python goes first downloads them
    expect(initialDownloads("python").map((e) => e.label)).toEqual(["Wasmer runtime", "bash", "coreutils", "Python 3.13"]);
    expect(initialDownloads("sql").map((e) => e.label)).toEqual(["Wasmer runtime", "PostgreSQL (PGlite)", "psql"]);
  });

  test("the up-front size counts shared packages once", () => {
    const { bash, coreutils, python } = PACKAGES;
    expect(downloadSize(["shell", "python"])).toBe(SDK.approxBytes + bash!.approxBytes + coreutils!.approxBytes + python!.approxBytes);
  });

  test("outside a cross-origin isolated page, the real loader refuses, with the reason", async () => {
    await expect(loadPackage("sdk")).rejects.toThrow(/cross-origin isolated/);
  });
});

test("the real database starts with the simulation's orders", () => {
  expect(seedSql()).toBe(
    "CREATE TABLE orders (id integer PRIMARY KEY, status text NOT NULL, total integer NOT NULL);\n" +
      "INSERT INTO orders VALUES (1, 'shipped', 20), (2, 'pending', 35), (3, 'shipped', 12), (4, 'cancelled', 8);",
  );
});
