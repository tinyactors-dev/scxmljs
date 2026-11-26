/**
 * Any playground explorer sample (examples/playground/src/explorer/samples.ts), run the way the
 * explorer runs it: its root chart, its fake services, its loader and its own drive() script, for
 * a fixed stretch of virtual time. No code per sample.
 *   support-desk   the generated stress chart: 14 invoked machines, a 10-region parallel floor, 600+ transitions
 *   gatekeeper     the GitHub gatekeeper sample (one session, a queue of issues)
 * Run: bun prototypes/office/tracer/drivers/samples.ts [support-desk|gatekeeper|fulfillment] [--ms N]
 */
import { createSession, VirtualClock } from "@tinyactors/scxmljs/trusted";
import { Window } from "happy-dom";
import { samples } from "../../../../examples/playground/src/explorer/samples.ts";
import { createTracer } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const args = process.argv.slice(2);
const msAt = args.indexOf("--ms");
const runMs = msAt >= 0 ? Number(args[msAt + 1]) : 60_000;
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--ms");
const domParser = new (new Window().DOMParser)() as never;
for (const sample of samples) {
  if (!(ids.length ? ids.includes(sample.id) : ["support-desk", "gatekeeper"].includes(sample.id))) continue;
  const clock = new VirtualClock();
  const tracer = createTracer({
    system: sample.id === "gatekeeper" ? "gatekeeper-sample" : sample.id,
    scenario: "sample-drive",
    clock,
    app: { id: "environment", label: "the sample's environment (its drive script)", kind: "user" },
  });
  const engine = tracer.wrapEngine(createSession, () => ({ id: sample.id, label: sample.title, purpose: sample.description }));
  const session = await engine(await sample.source(), {
    clock,
    domParser,
    loader: sample.loader,
    ioprocessors: sample.ioprocessors(clock),
    ...(sample.data ? { data: sample.data } : {}),
  });
  tracer.caption(sample.description);
  session.start();
  const stop = sample.drive?.(session, clock);
  const { wait } = clockDriver(clock, 50);
  await wait(runMs);
  stop?.();
  await wait(2000);
  const trace = tracer.finish();
  session.dispose();
  await writeTrace(tracer.events[0] ? (sample.id === "gatekeeper" ? "gatekeeper-sample" : sample.id) : sample.id, trace);
}
process.exit(0);
