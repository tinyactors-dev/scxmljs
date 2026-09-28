import { describe, expect, test } from "bun:test";
import { createSession, type Model, type SCXMLSession, VirtualClock } from "@tinyactors/scxmljs/trusted";
import { Window } from "happy-dom";
import type { FakeService } from "../src/explorer/fake-services.ts";
import { fulfillmentSample } from "../src/explorer/fulfillment-sample.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

interface Run {
  session: SCXMLSession;
  clock: VirtualClock;
  services: FakeService[];
  children: SCXMLSession[];
  errors: string[];
  entered: Set<string>;
  logs: string[];
}

async function runSample(opts: { maxMs?: number; drive?: boolean } = {}): Promise<Run> {
  const clock = new VirtualClock();
  const services = fulfillmentSample.ioprocessors(clock) as FakeService[];
  const session = await createSession(await fulfillmentSample.source(), {
    clock,
    domParser,
    loader: fulfillmentSample.loader,
    ioprocessors: services,
    data: fulfillmentSample.data,
  });
  const run: Run = { session, clock, services, children: [], errors: [], entered: new Set(), logs: [] };
  const watch = (s: SCXMLSession, name: string) => {
    s.addEventListener("error", (e) => run.errors.push(`${name}: ${e.kind} ${e.message}`));
    s.addEventListener("microstep", (e) => {
      for (const n of e.entered) run.entered.add(`${name}:${n.id}`);
    });
    s.addEventListener("log", (e) => run.logs.push(`${name}: ${e.label} ${String(e.value)}`));
    s.addEventListener("child", (e) => {
      run.children.push(e.child);
      watch(e.child, e.child.model.name);
    });
  };
  watch(session, "order");
  session.start();
  const stop = opts.drive === false ? () => {} : fulfillmentSample.drive!(session, clock);
  const maxMs = opts.maxMs ?? 120_000;
  while (session.status !== "done" && clock.now() < maxMs) {
    clock.advance(250);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  stop();
  return run;
}

const countStates = (m: Model) => m.states.filter((s) => s.kind !== "scxml" && s.kind !== "history").length;
const events = (m: Model) => m.states.flatMap((s) => s.transitions.flatMap((t) => t.events));

describe("fulfillment sample", () => {
  test("the happy path runs from order to completion", async () => {
    const run = await runSample();
    expect(run.errors).toEqual([]);
    expect(run.entered.has("order:completed")).toBe(true);
    // it passed through the interesting parts
    for (const id of ["challenged", "onHold", "packed", "onTheWay", "delivered", "notified"])
      expect(run.entered.has(`order:${id}`)).toBe(true);
    // both child machines ran to their finals
    expect(run.children.map((c) => c.model.name).sort()).toEqual(["payment", "shipment"]);
    expect(run.entered.has("payment:captured")).toBe(true);
    expect(run.entered.has("shipment:delivered")).toBe(true);
    // the late cancel was refused, not acted on
    expect(run.entered.has("order:cancelling")).toBe(false);
    expect(run.services.find((s) => s.alias === "email")!.traffic.some((t) => t.event === "cancelRefused")).toBe(true);
    // the address change reached the carrier via the shipment machine
    expect(run.services.find((s) => s.alias === "carrier")!.traffic.some((t) => t.event === "redirect")).toBe(true);
    // takes about half a minute of (virtual) time
    expect(run.clock.now()).toBeGreaterThan(20_000);
    expect(run.clock.now()).toBeLessThan(45_000);
  });

  test("while running, the system has both machines and six services", async () => {
    const run = await runSample({ maxMs: 20_000 });
    expect(run.session.status).toBe("running");
    const inv = run.session.invocations;
    expect(inv.map((i) => i.invokeid)).toEqual(["shipment"]);
    expect(inv[0]!.session?.model.name).toBe("shipment");
    expect(run.services.map((s) => s.alias)).toEqual(["risk", "crm", "warehouse", "email", "payments", "carrier"]);
    for (const s of run.services) expect(s.traffic.length).toBeGreaterThan(0);
  });

  test("meets the size targets", async () => {
    const run = await runSample({ maxMs: 20_000 });
    const models = [run.session.model, ...run.children.map((c) => c.model)];
    const states = models.reduce((n, m) => n + countStates(m), 0);
    const transitions = models.reduce((n, m) => n + m.states.reduce((k, s) => k + s.transitions.length, 0), 0);
    const distinct = new Set(models.flatMap(events));
    expect(states).toBeGreaterThanOrEqual(40);
    expect(Math.max(...models.flatMap((m) => m.states.map((s) => s.depth)))).toBeGreaterThanOrEqual(4);
    expect(distinct.size).toBeGreaterThanOrEqual(30);
    expect(transitions).toBeGreaterThan(80);
    // plenty is accepted at once: the global transitions on <order> apply everywhere
    const accepted = new Set(run.session.configuration.flatMap((s) => s.transitions.flatMap((t) => t.events)));
    expect(accepted.size).toBeGreaterThanOrEqual(10);
  });

  test("an unplaced order can be cancelled cleanly; a huge order is rejected by risk", async () => {
    const clock = new VirtualClock();
    const services = fulfillmentSample.ioprocessors(clock);
    const s = await createSession(await fulfillmentSample.source(), {
      clock,
      domParser,
      loader: fulfillmentSample.loader,
      ioprocessors: services,
    });
    const entered: string[] = [];
    s.addEventListener("microstep", (e) => {
      for (const n of e.entered) entered.push(n.id);
    });
    s.start();
    s.send("order.placed", {
      id: "SO-1",
      customer: { id: "cus_1", email: "a@example.org" },
      items: [{ sku: "X", qty: 1, price: 7000 }],
      amount: 7000,
      currency: "EUR",
      address: { postcode: "1000 AA" },
    });
    for (let i = 0; i < 40 && s.status !== "done"; i++) {
      clock.advance(250);
      await Promise.resolve();
    }
    expect(entered).toContain("rejected");
    expect(entered).toContain("closed");
  });
});
