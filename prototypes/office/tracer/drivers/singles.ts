/**
 * The small examples, each as its own system (the degenerate cases): one session per chart, fed the
 * events the playground suggests, on a VirtualClock. Writes data/<name>/trace.json for each:
 *   single-login      flat, a guard on event data, <assign>              (docs/examples/login.scxml)
 *   single-checkout   flat with a datamodel, ends in a final              (docs/examples/checkout.scxml)
 *   single-player     <parallel> regions and a shallow <history>          (docs/examples/player.scxml)
 *   single-microwave  <parallel> with In() and a delayed self-send timer  (site/charts/microwave.scxml)
 *   downloads         invoked child machines that spawn and end           (site/charts/downloads.scxml)
 *   launch            a custom invoker (countdown), three launches, one aborted (docs/examples/countdown.scxml)
 *   order-api         an I/O processor request/answer, three orders, one failing (docs/examples/order.scxml)
 *   single-blank      the playground's blank chart                        (site/src/playground-examples.ts)
 *   frameworks-player the framework apps' chart (examples/frameworks/*\/src/chart.ts)
 * Run: bun prototypes/office/tracer/drivers/singles.ts [name ...]
 */
import { readFile } from "node:fs/promises";
import { createSession, type Invoker, type IOProcessor, type SCXMLSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { PLAYER } from "../../../../examples/frameworks/react/src/chart.ts";
import { BLANK_CHART } from "../../../../site/src/playground-examples.ts";
import { createTracer } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const repo = new URL("../../../../", import.meta.url);
const read = (p: string) => readFile(new URL(p, repo), "utf8");
const domParser = new (new Window().DOMParser)() as never;
type Step = [wait: number, event: string, data?: unknown, caption?: string];

interface Spec {
  name: string;
  file: string;
  source: () => Promise<string>;
  /** Sessions to run (several = several launches of the same chart). */
  runs: { id: string; label: string; at: number; script: Step[] }[];
  invokers?: (clock: VirtualClock) => Record<string, Invoker>;
  ioprocessors?: (clock: VirtualClock) => IOProcessor[];
  tail?: number;
}

const countdown =
  (clock: VirtualClock): Invoker =>
  (ctx) => {
    let left = Number(ctx.params.from);
    const tick = () => {
      left--;
      if (left > 0) {
        ctx.sendToParent("tick", { left });
        timer = clock.setTimeout(tick, 1000);
      } else ctx.done();
    };
    let timer = clock.setTimeout(tick, 1000);
    return { send() {}, cancel: () => clock.clearTimeout(timer) };
  };
/** docs/io-processors.md's api processor: answers each request after 300 ms; the third one fails. */
const api = (clock: VirtualClock): IOProcessor => {
  let n = 0;
  const sessions = new Map<string, { deliver(name: string, data?: unknown): void }>();
  return {
    type: "urn:example:api",
    aliases: ["api"],
    location: () => "urn:example:api",
    attach: (s) => void sessions.set(s.sessionId, s),
    detach: (s) => void sessions.delete(s.sessionId),
    send(m, s) {
      if (++n === 3) throw new Error("503 from /orders");
      clock.setTimeout(() => s.deliver("order.created", { id: `ord_${100 + n}`, ...(m.data as object) }), 300);
    },
  };
};

const SPECS: Spec[] = [
  {
    name: "single-login",
    file: "docs/examples/login.scxml",
    source: () => read("docs/examples/login.scxml"),
    runs: [
      {
        id: "login",
        label: "sign-in",
        at: 0,
        script: [
          [800, "login", {}, "A login without a user is refused by the guard."],
          [1000, "login", { user: "ada" }, "Ada signs in."],
          [2500, "logout", undefined, "She signs out."],
          [1200, "login", { user: "bo" }, "Bo signs in."],
          [3000, "logout"],
        ],
      },
    ],
  },
  {
    name: "single-checkout",
    file: "docs/examples/checkout.scxml",
    source: () => read("docs/examples/checkout.scxml"),
    runs: [
      {
        id: "checkout",
        label: "checkout",
        at: 0,
        script: [
          [500, "checkout", undefined, "Checking out an empty cart does nothing."],
          [800, "add", { sku: "TEA-GREEN", quantity: 2 }, "Two products go into the cart, one comes out again."],
          [700, "add", { sku: "MUG-BLUE", quantity: 1, gift: true }],
          [900, "remove", { sku: "MUG-BLUE" }],
          [900, "checkout"],
          [1200, "back", undefined, "Back to the cart, then on to shipping and payment."],
          [800, "checkout"],
          [1500, "ship", { name: "Jana de Vries", street: "Prinsengracht 263", city: "Amsterdam", country: "NL" }],
          [1500, "pay", { card: { number: "4242424242424242", expiry: "12/29" } }, "Paid by card: the order is placed."],
        ],
      },
    ],
  },
  {
    name: "single-player",
    file: "docs/examples/player.scxml",
    source: () => read("docs/examples/player.scxml"),
    runs: [
      {
        id: "player",
        label: "media player",
        at: 0,
        script: [
          [600, "play", undefined, "Play: transport and sound run in parallel."],
          [1500, "mute"],
          [1200, "volume", { value: 7 }],
          [800, "next"],
          [1200, "pause"],
          [1000, "play"],
          [1500, "stop", undefined, "Stop, then play again: the sound region's history remembers muting."],
          [1200, "play"],
          [1500, "mute"],
          [1000, "volume", { value: 3 }],
          [1500, "stop"],
        ],
      },
    ],
  },
  {
    name: "single-microwave",
    file: "site/charts/microwave.scxml",
    source: () => read("site/charts/microwave.scxml"),
    runs: [
      {
        id: "microwave",
        label: "microwave",
        at: 0,
        script: [
          [500, "turn.on", undefined, "On, door closed: it cooks, one tick a second."],
          [2500, "door.open", undefined, "The door opens: cooking pauses."],
          [1500, "door.close", undefined, "Closed again: it goes on until the time is up."],
          [6000, "turn.on", undefined, "A second run, switched off by hand."],
          [2200, "turn.off"],
        ],
      },
    ],
  },
  {
    name: "downloads",
    file: "site/charts/downloads.scxml",
    source: () => read("site/charts/downloads.scxml"),
    runs: [
      {
        id: "downloads",
        label: "download manager",
        at: 0,
        script: [
          [500, "start", undefined, "A download starts: an invoked child machine fetches it chunk by chunk."],
          [4000, "start", undefined, "Done; another download starts..."],
          [1500, "cancel", undefined, "...and is cancelled: leaving the state cancels the child."],
          [800, "start", undefined, "A third one runs to the end."],
          [4000, "start"],
        ],
      },
    ],
    tail: 4000,
  },
  {
    name: "launch",
    file: "docs/examples/countdown.scxml",
    source: () => read("docs/examples/countdown.scxml"),
    invokers: (clock) => ({ countdown: countdown(clock) }),
    runs: [
      { id: "launch-1", label: "launch 1", at: 0, script: [] },
      { id: "launch-2", label: "launch 2", at: 1500, script: [[2000, "abort", undefined, "Launch 2 is aborted during its countdown."]] },
      { id: "launch-3", label: "launch 3", at: 4500, script: [] },
    ],
    tail: 4000,
  },
  {
    name: "order-api",
    file: "docs/examples/order.scxml",
    source: () => read("docs/examples/order.scxml"),
    ioprocessors: (clock) => [api(clock)],
    runs: [
      { id: "order-1", label: "order 1", at: 0, script: [] },
      { id: "order-2", label: "order 2", at: 700, script: [] },
      { id: "order-3", label: "order 3 (the API fails)", at: 1400, script: [] },
      { id: "order-4", label: "order 4", at: 2100, script: [] },
    ],
    tail: 1500,
  },
  {
    name: "single-blank",
    file: "site/src/playground-examples.ts (BLANK_CHART)",
    source: async () => BLANK_CHART,
    runs: [{ id: "my-chart", label: "my chart", at: 0, script: [[500, "go"], [2000, "go"], [600, "go", undefined, "A go while busy is ignored."], [2000, "go"]] }],
    tail: 1500,
  },
  {
    name: "frameworks-player",
    file: "examples/frameworks/react/src/chart.ts (PLAYER)",
    source: async () => PLAYER,
    runs: [{ id: "player", label: "player", at: 0, script: [[700, "play"], [2000, "stop"], [700, "play"], [1500, "stop"]] }],
  },
];

const only = process.argv.slice(2);
for (const spec of SPECS) {
  if (only.length && !only.includes(spec.name)) continue;
  const clock = new VirtualClock();
  const tracer = createTracer({ system: spec.name, scenario: "suggested-events", clock, app: { id: "user", label: "the person using it", kind: "user" } });
  const source = await spec.source();
  let next = spec.runs[0]!;
  const engine = tracer.wrapEngine(createSession, () => ({ id: next.id, label: next.label, source: spec.file.split("/").pop()!, identity: next.id }));
  const sessions: SCXMLSession[] = [];
  const { wait } = clockDriver(clock, 20);
  const end = Math.max(...spec.runs.map((r) => r.at + r.script.reduce((n, s) => n + s[0], 0))) + (spec.tail ?? 1500);
  const timers: Promise<void>[] = [];
  // one set of processors and invokers for every run of the spec (as one host would have)
  const ioprocessors = spec.ioprocessors?.(clock);
  const invokers = spec.invokers?.(clock);
  const started = new Set<string>();
  for (const run of spec.runs) {
    timers.push(
      (async () => {
        await wait(0);
        while (clock.now() < run.at) await new Promise((r) => setImmediate(r));
        next = run;
        const s = await engine(source, {
          clock,
          domParser,
          ...(invokers ? { invokers } : {}),
          ...(ioprocessors ? { ioprocessors } : {}),
        });
        sessions.push(s);
        s.start();
        started.add(run.id);
        let t = clock.now();
        for (const [ms, event, data, caption] of run.script) {
          t += ms;
          clock.setTimeout(() => {
            if (caption) tracer.caption(caption);
            s.send(event, data);
          }, t - clock.now());
        }
      })(),
    );
  }
  // one driver loop advances the clock; the runs above only schedule
  while (clock.now() < end) {
    // a run due now must have made its session first (creating one is asynchronous)
    if (spec.runs.some((r) => r.at <= clock.now() && !started.has(r.id))) {
      await new Promise((r) => setImmediate(r));
      continue;
    }
    clock.advance(20);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }
  await Promise.all(timers);
  const trace = tracer.finish();
  for (const s of sessions) s.dispose();
  await writeTrace(spec.name, trace);
}
process.exit(0);
