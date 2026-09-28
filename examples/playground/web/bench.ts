/**
 * Browser measurements (used by scripts/bench.ts via agent-browser):
 *   /bench?run  →  window.__bench resolves to the results.
 *
 * Every number is the median of a few runs. Timings end two animation
 * frames after the change, i.e. once the browser has rendered it.
 */
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";
import { createSession, type SCXMLSession, VirtualClock } from "@tinyactors/scxmljs/trusted";
import { generatedChart } from "../../../bench/charts.mjs";
import { sampleById } from "../src/explorer/samples.ts";

const stage = document.getElementById("stage")!;
const status = document.getElementById("status")!;
const RUNS = 3;

const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
};
/** Resolves on the first animation frame at which `ready()` holds (checked once per frame, 10 s cap). */
const until = async (ready: () => boolean) => {
  for (let i = 0; i < 600 && !ready(); i++) await frames(1);
  if (!ready()) throw new Error("timed out waiting for render");
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

interface Chart {
  id: string;
  source: () => Promise<string>;
  loader: (src: string) => string | Promise<string>;
}

async function charts(): Promise<Chart[]> {
  const fromSample = (id: string): Chart => {
    const s = sampleById(id)!;
    return { id, source: () => s.source(), loader: s.loader };
  };
  const generated = (n: number): Chart => ({ id: `generated-${n}`, source: async () => generatedChart(n), loader: () => "" });
  return [fromSample("gatekeeper"), fromSample("fulfillment"), fromSample("support-desk"), generated(1000), generated(5000)];
}

async function newSession(c: Chart): Promise<SCXMLSession> {
  return createSession(await c.source(), { clock: new VirtualClock(), loader: c.loader });
}

/** Explorer: first render, then tree scrolling (frame times + long tasks). */
async function measureExplorer(c: Chart) {
  const render: number[] = [];
  let rowsInDom = 0;
  let matchingRows = 0;
  let totalStates = 0;
  let scroll: { frames: number; medianFrameMs: number; p95FrameMs: number; longTasks: number } | undefined;
  for (let run = 0; run < RUNS; run++) {
    const session = await newSession(c);
    const host = document.createElement("scxml-explorer");
    host.setAttribute("follow", "true");
    stage.replaceChildren(host);
    const t0 = performance.now();
    host.attach({ session });
    session.start();
    const root = host.shadowRoot!;
    await until(() => root.querySelectorAll('[role="treeitem"]').length > 0 && !!root.querySelector("h2"));
    render.push(performance.now() - t0);
    rowsInDom = root.querySelectorAll('[role="treeitem"]').length;
    totalStates = session.model.states.filter((s) => s.kind !== "scxml" && s.kind !== "history").length;
    if (run === RUNS - 1) {
      // make the tree long: a search shows every match with its ancestors expanded
      // (generated ids are s0…sN; the samples' ids mostly contain an "e")
      const scroller = root.querySelector(".tree-pane .pane-scroll") as HTMLElement;
      const search = root.querySelector('[part~="tree-search"]') as HTMLInputElement;
      search.value = c.id.startsWith("generated") ? "s" : "e";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await frames();
      matchingRows = Math.round(scroller.scrollHeight / (root.querySelector('[role="treeitem"]')?.getBoundingClientRect().height || 30));
      const longTasks: number[] = [];
      const obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) longTasks.push(e.duration);
      });
      try {
        obs.observe({ type: "longtask", buffered: false });
      } catch {
        /* not supported */
      }
      const frameTimes: number[] = [];
      let last = performance.now();
      for (let y = 0; y < scroller.scrollHeight && frameTimes.length < 120; y += scroller.clientHeight * 0.8) {
        scroller.scrollTop = y;
        scroller.dispatchEvent(new Event("scroll"));
        await frames(1);
        const t = performance.now();
        frameTimes.push(t - last);
        last = t;
      }
      obs.disconnect();
      const sorted = [...frameTimes].sort((a, b) => a - b);
      scroll = {
        frames: frameTimes.length,
        medianFrameMs: median(frameTimes),
        p95FrameMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
        longTasks: longTasks.length,
      };
    }
    host.detach();
    session.dispose();
  }
  return {
    chart: c.id,
    states: totalStates,
    firstRenderMs: median(render),
    treeRowsInDom: rowsInDom,
    scroll: scroll && { ...scroll, treeRows: matchingRows },
  };
}

/** <scxml-view>: render a host session; and the zero-JS path (source text + trusted engine). */
async function measureView(c: Chart) {
  const withSession: number[] = [];
  const zeroJs: number[] = [];
  let boxes = 0;
  for (let run = 0; run < RUNS; run++) {
    const session = await newSession(c);
    session.start();
    const view = document.createElement("scxml-view");
    stage.replaceChildren(view);
    const t0 = performance.now();
    view.session = session;
    await until(() => view.shadowRoot!.querySelectorAll('[part~="state"]').length > 0);
    withSession.push(performance.now() - t0);
    boxes = view.shadowRoot!.querySelectorAll('[part~="state"]').length;
    view.remove();
    session.dispose();

    const source = await c.source();
    const v2 = document.createElement("scxml-view");
    v2.setAttribute("trusted", "");
    v2.options = { loader: c.loader };
    stage.replaceChildren(v2);
    const t1 = performance.now();
    const loaded = new Promise((r) => v2.addEventListener("scxml-load", r, { once: true }));
    v2.source = source;
    await loaded;
    await until(() => v2.shadowRoot!.querySelectorAll('[part~="state"]').length > 0);
    zeroJs.push(performance.now() - t1);
    v2.remove();
  }
  return { chart: c.id, stateBoxes: boxes, renderWithSessionMs: median(withSession), sourceToRenderMs: median(zeroJs) };
}

async function runAll() {
  const list = await charts();
  const explorer = [];
  const view = [];
  for (const c of list) {
    status.textContent = `explorer: ${c.id}…`;
    explorer.push(await measureExplorer(c));
  }
  for (const c of list.filter((c) => !c.id.startsWith("generated-5000"))) {
    status.textContent = `view: ${c.id}…`;
    view.push(await measureView(c));
  }
  stage.replaceChildren();
  const chrome = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? navigator.userAgent;
  const results = { browser: chrome, devicePixelRatio: devicePixelRatio, viewport: [innerWidth, innerHeight], explorer, view };
  status.textContent = JSON.stringify(results, null, 2);
  return results;
}

if (new URLSearchParams(location.search).has("run")) (window as unknown as { __bench: unknown }).__bench = runAll();
