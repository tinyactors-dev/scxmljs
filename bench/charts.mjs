/**
 * Deterministic chart generators for the benchmarks (plain JS, so the same
 * file runs under Bun, Node and in the browser measurement page).
 */

const NS = "http://www.w3.org/2005/07/scxml";

/**
 * A nested chart with exactly `n` states (excluding <scxml>): compound states
 * with `fanout` children each, every 7th compound a <parallel>, leaves with a
 * few sibling/cousin transitions and guards, a datamodel counter, and
 * dotted event names. Shape is fixed by `n`, so the output never changes.
 */
export function generatedChart(n, fanout = 8) {
  let count = 0;
  let events = 0;
  const ev = () => `area${events % 13}.step${events++ % 29}`;
  const lines = [];
  // breadth-first: build the tree as parent → children id lists
  const children = new Map([["root", []]]);
  const kind = new Map([["root", "state"]]);
  const queue = ["root"];
  while (queue.length && count < n) {
    const parent = queue.shift();
    for (let i = 0; i < fanout && count < n; i++) {
      const id = `s${count++}`;
      children.get(parent).push(id);
      children.set(id, []);
      kind.set(id, count % 7 === 0 ? "parallel" : "state");
      queue.push(id);
    }
  }
  const siblingsOf = (id, parent) => children.get(parent).filter((c) => c !== id);
  const emit = (id, parent, depth) => {
    const pad = "  ".repeat(depth);
    const kids = children.get(id);
    const tag = kids.length ? kind.get(id) : "state";
    const sibs = siblingsOf(id, parent);
    const trans = [];
    if (sibs.length) {
      trans.push(`${pad}  <transition event="${ev()}" target="${sibs[0]}"/>`);
      trans.push(
        `${pad}  <transition event="${ev()}" cond="count % 2 === 0" target="${sibs[sibs.length - 1]}"><assign location="count" expr="count + 1"/></transition>`,
      );
    }
    if (depth % 3 === 0)
      trans.push(`${pad}  <transition event="${ev()}" type="internal"><assign location="count" expr="count + 1"/></transition>`);
    lines.push(`${pad}<${tag} id="${id}">`);
    lines.push(...trans);
    for (const k of kids) emit(k, id, depth + 1);
    lines.push(`${pad}</${tag}>`);
  };
  lines.push(`<scxml xmlns="${NS}" version="1.0" datamodel="ecmascript" name="generated-${n}">`);
  lines.push(`  <datamodel><data id="count" expr="0"/></datamodel>`);
  lines.push(`  <state id="top">`);
  for (const k of children.get("root")) emit(k, "root", 2);
  lines.push(`  </state>`);
  lines.push(`</scxml>`);
  return lines.join("\n");
}

/** One state that handles `tick` by incrementing a counter: measures external event throughput. */
export function hotLoopChart() {
  return `<scxml xmlns="${NS}" version="1.0" datamodel="ecmascript" name="hot-loop">
  <datamodel><data id="n" expr="0"/></datamodel>
  <state id="a"><transition event="tick" target="b"><assign location="n" expr="n + 1"/></transition></state>
  <state id="b"><transition event="tick" target="a"><assign location="n" expr="n + 1"/></transition></state>
</scxml>`;
}

/** Eventless ping-pong between two states until n reaches `limit`: measures microsteps. */
export function eventlessLoopChart(limit) {
  return `<scxml xmlns="${NS}" version="1.0" datamodel="ecmascript" name="eventless-loop">
  <datamodel><data id="n" expr="0"/></datamodel>
  <state id="ping"><transition cond="n &lt; ${limit}" target="pong"><assign location="n" expr="n + 1"/></transition>
    <transition cond="n &gt;= ${limit}" target="done"/></state>
  <state id="pong"><transition cond="n &lt; ${limit}" target="ping"><assign location="n" expr="n + 1"/></transition>
    <transition cond="n &gt;= ${limit}" target="done"/></state>
  <final id="done"/>
</scxml>`;
}
