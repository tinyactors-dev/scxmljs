/**
 * Runs the W3C SCXML conformance tests (ECMAScript) against @tinyactors/scxmljs.
 *
 *   bun conformance/run.ts                 # all automatic tests
 *   bun conformance/run.ts 144 147 355     # just these
 *   bun conformance/run.ts --verbose 216   # with logs and errors
 *   bun conformance/run.ts --mandatory     # skip optional tests
 *
 * A test passes when its session reaches the top-level <final id="pass">.
 * Time is virtual: delayed events fire instantly, timeouts cost nothing.
 */
import { manifest, type Outcome, runTest as runOne } from "./harness.ts";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
// --trusted: run against the trusted data model (host JS engine, node:vm here) instead of QuickJS
const trusted = args.includes("--trusted");
const mandatoryOnly = args.includes("--mandatory");
const json = args.includes("--json");
const only = new Set(args.filter((a) => !a.startsWith("--")));

const selected = manifest.filter((e) => !e.manual && (!only.size || only.has(e.id)) && (!mandatoryOnly || e.conformance === "mandatory"));
const results: { id: string; conformance: string; outcome: Outcome; detail: string }[] = [];
for (const entry of selected) {
  const r = await runOne(entry, trusted);
  results.push({ id: entry.id, conformance: entry.conformance, outcome: r.outcome, detail: r.detail });
  if (!json && (r.outcome !== "pass" || verbose)) {
    console.log(`${r.outcome.toUpperCase().padEnd(7)} ${entry.id.padEnd(5)} [${entry.conformance}] ${entry.description.slice(0, 110)}`);
    if (r.detail) console.log(`        ${r.detail.split("\n").join("\n        ")}`);
    if (verbose) for (const l of r.logs) console.log(`        · ${l}`);
  }
}

const count = (c: string, o?: Outcome) => results.filter((r) => r.conformance === c && (!o || r.outcome === o)).length;
if (json) console.log(JSON.stringify(results, null, 2));
else {
  console.log(
    `\n${trusted ? "[trusted] " : "[sandboxed] "}mandatory: ${count("mandatory", "pass")}/${count("mandatory")} pass` +
      `   optional: ${count("optional", "pass")}/${count("optional")} pass` +
      `   (manual tests skipped: ${manifest.filter((e) => e.manual).length})`,
  );
}
process.exit(results.some((r) => r.conformance === "mandatory" && r.outcome !== "pass") ? 1 : 0);
