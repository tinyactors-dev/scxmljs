import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  acceptedEvents,
  activeExpansion,
  focusScope,
  followTarget,
  groupEvents,
  SystemTracker,
  sendableName,
  treeRows,
  wouldAccept,
} from "../src/explorer/viewmodel.ts";
import { createSession, type IOProcessor, type IOSession, type Session, VirtualClock } from "../src/index.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const NS = `xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"`;

const SHOP = `<scxml ${NS} name="shop" initial="work">
  <datamodel><data id="n" expr="0"/></datamodel>
  <state id="work" initial="idle">
    <transition event="reset" target="work"/>
    <transition event="split" target="both"/>
    <state id="idle">
      <transition event="go" target="busy"/>
      <transition event="go.fast" cond="n &gt; 1" target="done"/>
      <transition event="jump" target="b2"/>
    </state>
    <state id="busy" initial="b1">
      <state id="b1"><transition event="next" target="b2"/><transition event="tick"/></state>
      <state id="b2"><transition event="back" target="idle"/></state>
      <transition event="finish" target="done"/>
    </state>
    <parallel id="both">
      <state id="left"><state id="l1"><transition event="l.go" target="l2"/></state><state id="l2"/></state>
      <state id="right"><state id="r1"/></state>
    </parallel>
  </state>
  <final id="done"/>
</scxml>`;

async function shop() {
  const clock = new VirtualClock();
  const s = await createSession(SHOP, { clock, domParser });
  s.start();
  clock.run();
  const $ = (id: string) => s.model.byId.get(id)!;
  const isActive = (n: { id: string }) => s.isActive(n.id);
  return { s, clock, $, isActive };
}

describe("tree", () => {
  test("rows follow the expansion; filters keep matches and their ancestors", async () => {
    const { s, $ } = await shop();
    const isActive = (n: Parameters<typeof s.isActiveNode>[0]) => s.isActiveNode(n);
    const expanded = activeExpansion(s.model, isActive);
    expect([...expanded].map((n) => n.id)).toEqual(["work"]);

    const rows = treeRows(s.model, { expanded, isActive });
    expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.node.id}`)).toEqual(["work", "  idle", "  busy", "  both", "done"]);
    expect(rows.find((r) => r.node.id === "idle")).toMatchObject({ active: true, onActivePath: true, expandable: false });
    expect(rows.find((r) => r.node.id === "busy")).toMatchObject({ expandable: true, expanded: false, childCount: 2 });

    const filtered = treeRows(s.model, { expanded: new Set(), isActive, filter: "b2" });
    expect(filtered.map((r) => [r.node.id, r.match])).toEqual([
      ["work", false],
      ["busy", false],
      ["b2", true],
    ]);

    const activeOnly = treeRows(s.model, { expanded: new Set([$("work"), $("busy")]), isActive, activeOnly: true });
    // the active path plus the direct children of states on it (the root is on it, so "done" shows)
    expect(activeOnly.map((r) => r.node.id)).toEqual(["work", "idle", "busy", "both", "done"]);
  });
});

describe("focus scope", () => {
  test("merges edges per pair, counts internal transitions, and lists doors", async () => {
    const { s, $, isActive } = await shop();
    const work = focusScope(s.model, $("work"), isActive);
    expect(work.children.map((c) => c.node.id)).toEqual(["idle", "busy", "both"]);
    expect(work.edges.map((e) => `${e.from.id}→${e.to.id} ${e.events}`)).toEqual(["idle→busy go,jump", "busy→idle back"]);
    const internal = Object.fromEntries(work.children.map((c) => [c.node.id, c.internal]));
    expect(internal).toEqual({ idle: 0, busy: 2, both: 1 });
    expect(work.children.find((c) => c.node.id === "idle")).toMatchObject({ initial: true, onActivePath: true });
    expect(work.frame.map((t) => t.events.join())).toContain("split");
    const toDone = work.exits.find((d) => d.other.id === "done")!;
    expect(toDone.events).toEqual(["go.fast", "finish"]);

    const busy = focusScope(s.model, $("busy"), isActive);
    expect(busy.edges.map((e) => `${e.from.id}→${e.to.id}`)).toEqual(["b1→b2"]);
    expect(busy.exits.map((d) => `${d.child.id}⇥${d.other.id}`).sort()).toEqual(["b2⇥idle", "busy⇥done"]);
    expect(busy.entries.map((d) => `${d.other.id}→${d.child.id} ${d.events}`)).toEqual(["idle→b2 jump"]);
  });

  test("parallel regions are children of the focus", async () => {
    const { s, $, isActive } = await shop();
    const both = focusScope(s.model, $("both"), isActive);
    expect(both.children.map((c) => c.node.id)).toEqual(["left", "right"]);
    expect(both.children.every((c) => !c.onActivePath)).toBe(true);
  });
});

describe("follow", () => {
  test("one leaf → its parent; parallel regions → the parallel state", async () => {
    const { s, clock, $ } = await shop();
    expect(followTarget(s.configuration, s.model.root).id).toBe("work");
    s.send("split");
    clock.run();
    expect(s.activeStateIds()).toEqual(["work", "both", "left", "l1", "right", "r1"]);
    expect(followTarget(s.configuration, $("work")).id).toBe("both");
  });
});

describe("accepted events", () => {
  test("are scoped to the focus, carry guards, and group by prefix", async () => {
    const { s, $ } = await shop();
    const atWork = acceptedEvents(s, $("work"));
    expect(atWork.map((e) => `${e.descriptor}:${e.scope}`).sort()).toEqual([
      "go.fast:here",
      "go:here",
      "jump:here",
      "reset:here",
      "split:here",
    ]);
    expect(atWork.find((e) => e.descriptor === "go.fast")!.transitions[0]!.guarded).toBe(true);

    const atBusy = acceptedEvents(s, $("busy"));
    const scopes = Object.fromEntries(atBusy.map((e) => [e.descriptor, e.scope]));
    expect(scopes).toMatchObject({ reset: "inherited", split: "inherited", go: "elsewhere" });
    // sorted: here, then inherited, then elsewhere
    expect(atBusy.map((e) => e.scope)).toEqual(
      [...atBusy.map((e) => e.scope)].sort(
        (a, b) => ["here", "inherited", "elsewhere"].indexOf(a) - ["here", "inherited", "elsewhere"].indexOf(b),
      ),
    );

    expect(groupEvents(atWork).map((g) => `${g.prefix}:${g.events.length}`)).toEqual(["·:4", "go:1"]);
    expect([sendableName("a.b"), sendableName("a.*"), sendableName("*")]).toEqual(["a.b", "a.done", null]);
    expect([wouldAccept(s, "go"), wouldAccept(s, "nope")]).toEqual([true, false]);
  });
});

describe("system tracker", () => {
  test("finds invoked children, separates declared from observed traffic, and times it on the session clock", async () => {
    const clock = new VirtualClock();
    const attached = new Set<string>();
    const echo: IOProcessor = {
      type: "urn:test:echo",
      aliases: ["echo"],
      location: () => "echo:",
      attach: (s: IOSession) => {
        attached.add(s.sessionId);
      },
      send: (m, s) => {
        clock.setTimeout(() => s.deliver(`echo.${m.event}.done`, m.data, "echo:"), 100);
      },
    };
    const source = `<scxml ${NS} name="parent">
      <state id="p">
        <onentry><send type="echo" event="ping"/></onentry>
        <invoke id="kid"><content>
          <scxml ${NS} name="child"><state id="k"><onentry><send target="#_parent" event="hi"/></onentry></state></scxml>
        </content></invoke>
        <transition event="echo.ping.done" target="q"/>
        <transition event="never" target="q"><send type="echo" event="unused"/></transition>
      </state>
      <state id="q"/>
    </scxml>`;
    const s: Session = await createSession(source, { clock, domParser, ioprocessors: [echo] });
    const tracker = new SystemTracker(s, [echo]);
    expect(tracker.clock).toBe(clock); // defaults to the session's clock
    s.start();
    clock.run(50);
    expect(attached.has(s.sessionId)).toBe(true); // (invoked children inherit the processor too)

    const [parent, child] = tracker.machineList();
    expect([parent?.name, child?.name, child?.depth, child?.invokeid, child?.invokedFrom]).toEqual(["parent", "child", 1, "kid", "p"]);

    const link = (from: string, to: string) => tracker.links.get(`${from}→${to}`)!;
    const out = link(s.sessionId, echo.type);
    expect([...out.declared].sort()).toEqual(["ping", "unused"]);
    expect([...out.observed]).toEqual([["ping", 1]]);
    expect(link(s.sessionId, child!.key).kind).toBe("invoke");
    expect([...link(child!.key, s.sessionId).observed]).toEqual([["hi", 1]]);

    clock.run(200); // the echo reply arrives at t = 100
    const back = link(echo.type, s.sessionId);
    expect([...back.observed]).toEqual([["echo.ping.done", 1]]);
    expect(back.lastAt).toBe(100);
    expect(tracker.isHot(back)).toBe(true);
    clock.advance(2000);
    expect(tracker.isHot(back)).toBe(false);
    expect(tracker.isHot(link(s.sessionId, child!.key))).toBe(false); // never observed

    expect(tracker.stepCount).toBeGreaterThan(0);
    expect(tracker.lastStep?.machine).toBe("parent");
    expect(s.isActive("q")).toBe(true);
    expect(tracker.linksOf(s.sessionId)[0]).toBeDefined();
    tracker.dispose();
    s.dispose();
  });
});
