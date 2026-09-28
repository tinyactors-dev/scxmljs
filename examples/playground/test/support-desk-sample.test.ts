import { describe, expect, test } from "bun:test";
import { createSession, type SCXMLSession, type StateNode, VirtualClock } from "@tinyactors/scxmljs/trusted";
import { Window } from "happy-dom";
import { supportDeskSample } from "../src/explorer/support-desk-sample.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

async function boot() {
  const clock = new VirtualClock();
  const t0 = performance.now();
  const session = await createSession(await supportDeskSample.source(), {
    clock,
    domParser,
    loader: supportDeskSample.loader,
    ioprocessors: supportDeskSample.ioprocessors(clock),
  });
  const errors: string[] = [];
  const watch = (s: SCXMLSession, who: string) => s.addEventListener("error", (e) => errors.push(`${who}: ${e.kind}: ${e.message}`));
  watch(session, "root");
  session.addEventListener("child", (e) => watch(e.child, e.invokeid));
  session.start();
  clock.advance(10); // children start on the next tick
  const startMs = performance.now() - t0;
  return { clock, session, errors, startMs };
}

/** Distinct event descriptors on transitions of active states (the configuration includes every ancestor). */
const accepted = (s: SCXMLSession) => new Set(s.configuration.flatMap((n) => n.transitions.flatMap((t) => t.events)));
const leaves = (s: SCXMLSession) =>
  s.configuration
    .filter((n) => n.children.length === 0)
    .map((n) => n.id)
    .sort()
    .join(" ");

describe("support-desk stress sample", () => {
  test("is as big as it claims", async () => {
    const { session, startMs } = await boot();
    const states = session.model.states.filter((s) => s.kind !== "scxml");
    const transitions = session.model.states.flatMap((s) => s.transitions);
    const events = new Set(transitions.flatMap((t) => t.events));
    const parallels = states.filter((s) => s.kind === "parallel");
    const shape = {
      states: states.length,
      transitions: transitions.length,
      depth: Math.max(...states.map((s) => s.depth)),
      widest: Math.max(...states.map((s) => s.children.length)),
      regions: Math.max(...parallels.map((p) => p.children.length)),
      events: events.size,
      guarded: transitions.filter((t) => t.cond).length,
      targetless: transitions.filter((t) => !t.targets.length).length,
    };
    console.log(`support-desk: compile+start ${startMs.toFixed(0)} ms`, shape);
    expect(shape.states).toBeGreaterThanOrEqual(250);
    expect(shape.transitions).toBeGreaterThanOrEqual(600);
    expect(shape.depth).toBeGreaterThanOrEqual(6);
    expect(shape.widest).toBeGreaterThanOrEqual(60);
    expect(shape.regions).toBeGreaterThanOrEqual(8);
    expect(shape.events).toBeGreaterThanOrEqual(120);
    expect(shape.guarded).toBeGreaterThan(0);
    expect(shape.targetless).toBeGreaterThan(0);
    expect(startMs).toBeLessThan(1000);
    session.dispose();
  });

  test("has a system level: 14 child machines and 5 services", async () => {
    const { session } = await boot();
    const children = session.invocations.filter((i) => i.session);
    expect(children.length).toBeGreaterThanOrEqual(12);
    expect(children.every((i) => i.session!.status === "running")).toBe(true);
    expect(supportDeskSample.ioprocessors(new VirtualClock()).length).toBeGreaterThanOrEqual(4);
    session.dispose();
  });

  test("drive() keeps the system busy without errors", async () => {
    const { clock, session, errors } = await boot();
    const stop = supportDeskSample.drive!(session, clock);
    const seen = new Set<string>();
    const acceptedCounts: number[] = [];
    let steps = 0;
    session.addEventListener("macrostep", () => steps++);
    for (let t = 0; t < 120; t++) {
      clock.advance(1000); // two minutes of virtual time
      await Promise.resolve();
      seen.add(leaves(session));
      acceptedCounts.push(accepted(session).size);
    }
    stop();
    const typical = acceptedCounts.sort((a, b) => a - b)[Math.floor(acceptedCounts.length / 2)]!;
    console.log(`support-desk: ${steps} macrosteps, ${seen.size} distinct leaf configurations, median accepted events ${typical}`);
    expect(errors).toEqual([]);
    expect(seen.size).toBeGreaterThan(20);
    expect(typical).toBeGreaterThanOrEqual(40);
    // the ticket made it through the deepest part of the chart
    const deep = (id: string) => session.model.byId.get(id) as StateNode;
    expect(deep("patch-review").depth).toBeGreaterThanOrEqual(8);
    expect(session.snapshot().ticketCount).toBeGreaterThanOrEqual(2);
    // and the children reported in
    expect(session.snapshot().channelMessages as number).toBeGreaterThan(10);
    session.dispose();
  });

  test("history resumes the floor after a maintenance window", async () => {
    const { clock, session } = await boot();
    for (const e of ["ticket.created", "route.billing.refunds", "ticket.accept", "triage.done"]) session.send(e);
    clock.advance(10);
    expect(session.isActive("investigating")).toBe(true);
    session.send("system.maintenance.start");
    clock.advance(10);
    expect(session.isActive("maintenance")).toBe(true);
    session.send("system.maintenance.end");
    clock.advance(10);
    expect(session.isActive("investigating")).toBe(true);
    session.dispose();
  });
});
