import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { compile, type Diagnostic, type Model, parseSCXML } from "../src/index.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const lint = (body: string) => {
  const m = compile(
    parseSCXML(`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">${body}</scxml>`, domParser),
  ) as Model;
  return m.warnings.map((w: Diagnostic) => ({ code: w.code, state: w.state?.id, tag: w.element?.localName }));
};

describe("warnings", () => {
  test("a clean chart has none", () => {
    expect(lint(`<state id="a"><transition event="go" target="b"/></state><final id="b"/>`)).toEqual([]);
  });

  describe("SCXML_W_EXITS_PARALLEL", () => {
    const region = (type = "") =>
      `<parallel id="floor">
         <state id="assignment"><state id="none"/><state id="team"/>
           <transition event="agent.assign" target="team" ${type}/></state>
         <state id="sla"/>
       </parallel>`;

    test("an external transition on a region to its own states exits the whole parallel state", () => {
      expect(lint(region())).toEqual([{ code: "SCXML_W_EXITS_PARALLEL", state: "assignment", tag: "transition" }]);
    });

    test('type="internal" is the fix, and silences it', () => {
      expect(lint(region('type="internal"'))).toEqual([]);
    });

    test("transitions that leave the region anyway are not flagged", () => {
      expect(
        lint(
          `<parallel id="p"><state id="r1"><state id="x"/><transition event="e" target="y"/></state><state id="r2"><state id="y"/></state></parallel>`,
        ),
      ).toEqual([]);
    });
  });

  describe("SCXML_W_UNREACHABLE", () => {
    test("reports the outermost state nothing leads to", () => {
      expect(lint(`<state id="a"/><state id="orphan"><state id="inner"/></state>`)).toEqual([
        { code: "SCXML_W_UNREACHABLE", state: "orphan", tag: "state" },
      ]);
    });

    test("initial states, parallel regions, history defaults and ancestors of targets all count", () => {
      expect(
        lint(`<state id="a" initial="a2">
                <state id="a1"/><state id="a2"><transition event="e" target="deep"/></state>
              </state>
              <state id="h-owner"><history id="h"><transition target="h2"/></history><state id="h1"/><state id="h2"/>
                <transition event="back" target="a1"/></state>
              <parallel id="p"><state id="r1"/><state id="r2"><state id="deep"/></state>
                <transition event="hist" target="h"/></parallel>`),
      ).toEqual([]);
    });
  });

  describe("SCXML_W_NEVER_DONE", () => {
    test("done.state for a state that can't complete, a final state, or no state", () => {
      expect(
        lint(`<state id="busy"><state id="x"/>
                <transition event="done.state.busy" target="end"/>
                <transition event="done.state.end" target="end"/>
                <transition event="done.state.ghost" target="end"/>
              </state><final id="end"/>`).map((w) => w.code),
      ).toEqual(["SCXML_W_NEVER_DONE", "SCXML_W_NEVER_DONE", "SCXML_W_NEVER_DONE"]);
    });

    test("done.state for states that can complete is fine (compound and parallel)", () => {
      expect(
        lint(`<parallel id="p"><state id="r1"><final id="f1"/></state><state id="r2"><final id="f2"/></state>
                <transition event="done.state.p done.state.r1" target="end"/></parallel><final id="end"/>`),
      ).toEqual([]);
    });

    test("done.invoke for an invoke id that doesn't exist", () => {
      expect(
        lint(`<state id="a"><invoke id="kid" src="x.scxml"/><transition event="done.invoke.kidd" target="b"/></state><state id="b"/>`),
      ).toEqual([{ code: "SCXML_W_NEVER_DONE", state: "a", tag: "transition" }]);
      expect(
        lint(`<state id="a"><invoke id="kid" src="x.scxml"/><transition event="done.invoke.kid" target="b"/></state><state id="b"/>`),
      ).toEqual([]);
      // generated ids (idlocation or no id) can't be checked, so nothing is reported
      expect(
        lint(`<state id="a"><invoke src="x.scxml"/><transition event="done.invoke.other" target="b"/></state><state id="b"/>`),
      ).toEqual([]);
    });
  });

  describe("SCXML_W_SHADOWED", () => {
    test("an earlier unconditional transition that handles every event wins", () => {
      expect(
        lint(`<state id="a">
                <transition event="order" target="b"/>
                <transition event="order.placed" target="c"/>
                <transition event="order.placed" cond="x" target="c"/>
              </state><state id="b"/><state id="c"/>`).map((w) => w.code),
      ).toEqual(["SCXML_W_SHADOWED", "SCXML_W_SHADOWED"]);
    });

    test("conditions, narrower earlier descriptors and wildcards later are fine", () => {
      expect(
        lint(`<datamodel><data id="x" expr="1"/></datamodel>
              <state id="a">
                <transition event="order" cond="x" target="b"/>
                <transition event="order.placed" target="c"/>
                <transition event="order" target="b"/>
                <transition event="*" target="b"/>
              </state><state id="b"/><state id="c"/>`),
      ).toEqual([]);
    });
  });
});
