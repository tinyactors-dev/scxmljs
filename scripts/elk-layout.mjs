#!/usr/bin/env node
/**
 * Helper for scripts/eval-view-layout.ts: lays out ELK JSON graphs with elkjs
 * under Node (elkjs's worker shim doesn't load in Bun). Reads a JSON array of
 * graphs on stdin, writes [{ graph, ms }] (ms = median of 5 runs) to stdout.
 */
import ELK from "elkjs";

const input = JSON.parse(await new Response(process.stdin).text());
const elk = new ELK();
const out = [];
for (const graph of input) {
  const times = [];
  let result;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    result = await elk.layout(structuredClone(graph));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  out.push({ graph: result, ms: times[2] });
}
process.stdout.write(JSON.stringify(out));
