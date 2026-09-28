/**
 * The W3C conformance suite as a test, in both data models, so `bun test`
 * (and the coverage gate) include it. conformance/run.ts remains the
 * readable report.
 *
 * Every mandatory test must pass. Optional tests must pass too, except the
 * ones that need the Basic HTTP Event I/O Processor, which the library
 * doesn't include.
 */
import { describe, expect, test } from "bun:test";
import { manifest, runTest } from "./harness.ts";
import { traceManual } from "./manual.ts";

/** Optional tests that need the Basic HTTP Event I/O Processor (not included). */
const HTTP_PROCESSOR = new Set(["201", "509", "510", "518", "519", "520", "522", "531", "532", "534", "567", "577"]);

for (const trusted of [false, true]) {
  describe(trusted ? "conformance (trusted)" : "conformance (sandboxed)", () => {
    for (const entry of manifest.filter((e) => !e.manual)) {
      const expected = entry.conformance === "optional" && HTTP_PROCESSOR.has(entry.id) ? "fail-or-timeout" : "pass";
      test(`${entry.id} [${entry.conformance}]`, async () => {
        const r = await runTest(entry, trusted);
        if (expected === "pass") expect(`${r.outcome} ${r.detail}`.trim()).toBe("pass");
        else expect(r.outcome).not.toBe("pass");
      });
    }
  });
}

/**
 * The "manual" tests, read once by a person (verdicts and reasoning in
 * MANUAL.md) and pinned here so they can't regress. 513 is not applicable:
 * it tests the Basic HTTP Event I/O Processor by hand, with wget.
 */
for (const trusted of [false, true]) {
  describe(trusted ? "manual conformance tests (trusted)" : "manual conformance tests (sandboxed)", () => {
    const strip = (lines: string[], who: string) => lines.filter((l) => l.startsWith(`${who} `)).map((l) => l.slice(who.length + 1));

    test("178: duplicate <param> names are all kept", async () => {
      const t = await traceManual("178", trusted);
      expect(t.ended).toEqual(["final"]);
      expect(t.payloads.find((p) => p.name === "event1")?.data).toEqual({ Var1: [2, 3] });
    });

    test("230: an autoforwarded event has the same fields in parent and child", async () => {
      const t = await traceManual("230", trusted);
      const root = strip(t.lines, "root");
      const child = t.lines.filter((l) => !l.startsWith("root ")).map((l) => l.slice(l.indexOf(" ") + 1));
      expect(root).toHaveLength(7);
      expect(child).toEqual(root);
    });

    test("250: a cancelled invocation runs its onexit handlers", async () => {
      const t = await traceManual("250", trusted);
      const child = t.lines.filter((l) => !l.startsWith("root "));
      expect(child.map((l) => l.slice(l.indexOf(" ") + 1))).toEqual(['log "Exiting sub01"', 'log "Exiting sub0"']);
    });

    test("301: a script that can't be loaded rejects the document", async () => {
      expect((await traceManual("301", trusted)).status).toBe("rejected");
    });

    test("307: late binding — an unloaded variable and a missing substructure behave the same", async () => {
      const t = await traceManual("307", trusted);
      expect(t.events).toEqual(["foo", "bar"]);
      expect(t.lines).toEqual([
        "root log entering s0 value of Var 1 is: undefined",
        "root log no error in s0undefined",
        "root log entering s1, value of non-existent substructure of Var 1 is: undefined",
        "root log No error in s1undefined",
      ]);
    });

    test("313 and 314: an illegal expression raises error.execution when evaluated, not before", async () => {
      expect((await traceManual("313", trusted)).ended).toEqual(["pass"]);
      expect((await traceManual("314", trusted)).ended).toEqual(["pass"]);
    });

    test("415: entering a top-level final state halts before raised events are processed", async () => {
      const t = await traceManual("415", trusted);
      expect([t.status, t.ended, t.events]).toEqual(["done", ["final"], []]);
    });
  });
}
