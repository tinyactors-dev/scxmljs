#!/usr/bin/env node
/**
 * Smoke test of the BUILT package in Node: both entry points, through the
 * package's "exports" map (self-reference by name), with happy-dom's DOMParser.
 *
 *   node scripts/smoke-node.mjs                      # this package (after `bun run build`)
 *   node scripts/smoke-node.mjs <package-specifier>  # e.g. an installed tarball's name
 *
 * Exits non-zero on the first failure.
 */
import { Window } from "happy-dom";

const base = process.argv[2] ?? "@tinyactors/scxmljs";
const domParser = new new Window().DOMParser();

const chart = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="a">
  <datamodel><data id="n" expr="41"/></datamodel>
  <script>function inc(x) { return x + 1; }</script>
  <state id="a">
    <onentry><send event="tick" delay="10ms"/></onentry>
    <transition event="tick" target="b"/>
  </state>
  <state id="b">
    <invoke id="child"><content>
      <scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
        <final id="f"><donedata><content expr="'hello from the child'"/></donedata></final>
      </scxml>
    </content></invoke>
    <transition event="done.invoke.child" cond="inc(n) === 42 &amp;&amp; _event.data === 'hello from the child'" target="done"/>
  </state>
  <final id="done"><donedata><param name="answer" expr="inc(n)"/></donedata></final>
</scxml>`;

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`✗ ${msg}`);
};

for (const specifier of [base, `${base}/trusted`]) {
  try {
    const lib = await import(specifier);
    const clock = new lib.VirtualClock();
    const t0 = performance.now();
    const session = await lib.createSession(chart, { domParser, clock });
    session.start();
    for (let i = 0; i < 20 && session.status !== "done"; i++) {
      clock.run();
      await new Promise((r) => setTimeout(r, 0));
    }
    const data = await Promise.race([session.done, new Promise((r) => setTimeout(() => r("timeout"), 2000))]);
    session.dispose();
    if (data?.answer !== 42) fail(`${specifier}: expected done data { answer: 42 }, got ${JSON.stringify(data)}`);
    else console.log(`✓ ${specifier}: chart ran to completion in ${(performance.now() - t0).toFixed(0)} ms`);

    // outside browsers, parsing text without a DOMParser must fail with a helpful, coded error
    try {
      await lib.createSession(chart);
      fail(`${specifier}: expected an SCXMLParseError without a DOMParser`);
    } catch (e) {
      if (e?.code !== "SCXML_NO_DOMPARSER") fail(`${specifier}: expected code SCXML_NO_DOMPARSER, got ${e?.code}: ${e?.message}`);
      else console.log(`✓ ${specifier}: missing DOMParser → ${e.name} (${e.code})`);
    }
  } catch (e) {
    fail(`${specifier}: ${e?.stack ?? e}`);
  }
}

// the explorer entry must load where there is no DOM (server-side rendering): it registers nothing
try {
  const explorer = await import("@tinyactors/scxmljs/explorer");
  if (typeof explorer.ScxmlExplorer !== "function" || typeof explorer.focusScope !== "function")
    fail("@tinyactors/scxmljs/explorer: missing exports");
  else console.log("✓ @tinyactors/scxmljs/explorer: imports without a DOM");
} catch (e) {
  fail(`@tinyactors/scxmljs/explorer: ${e?.stack ?? e}`);
}

// so must the view entry; its layout is plain data and runs anywhere
try {
  const view = await import("@tinyactors/scxmljs/view");
  const lib = await import(base);
  const model = await lib.compile(lib.parseSCXML(chart, domParser));
  const layout = view.layoutChart(model.root, { measure: () => ({ w: 80, h: 36 }), labelSize: () => ({ w: 40, h: 20 }) });
  if (typeof view.ScxmlView !== "function") fail("@tinyactors/scxmljs/view: missing exports");
  else if (layout.boxes.length < 3 || !layout.edges.length) fail(`@tinyactors/scxmljs/view: unexpected layout ${JSON.stringify(layout)}`);
  else console.log(`✓ @tinyactors/scxmljs/view: imports without a DOM, lays out ${layout.boxes.length} boxes`);
} catch (e) {
  fail(`@tinyactors/scxmljs/view: ${e?.stack ?? e}`);
}

process.exit(failed ? 1 : 0);
