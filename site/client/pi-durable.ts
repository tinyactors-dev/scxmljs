/**
 * /demos/pi-durable/: Pi Durable, as statecharts, in this tab.
 *
 * The world (examples/pi-durable/src/system.ts) is a storage, a simulated machine and bank,
 * clients, and at most one harness process, all on one PlaybackClock. Each chapter of the tour
 * boots a fresh world and runs a scenario chart that drives it and captions it. This file only
 * renders it and turns clicks into the same calls a scenario makes.
 */
import "@tinyactors/scxmljs/explorer";
import { createSession, PlaybackClock, type SCXMLSession } from "@tinyactors/scxmljs";
import { ICONS, icon } from "../../examples/llm-chat/src/ui/icons.ts";
import checkoutChart from "../../examples/pi-durable/charts/checkout.scxml" with { type: "text" };
import clientChart from "../../examples/pi-durable/charts/client.scxml" with { type: "text" };
import compactionChart from "../../examples/pi-durable/charts/compaction.scxml" with { type: "text" };
import generationChart from "../../examples/pi-durable/charts/generation.scxml" with { type: "text" };
import harnessChart from "../../examples/pi-durable/charts/harness.scxml" with { type: "text" };
import paymentChart from "../../examples/pi-durable/charts/payment.scxml" with { type: "text" };
import reminderChart from "../../examples/pi-durable/charts/reminder.scxml" with { type: "text" };
import toolChart from "../../examples/pi-durable/charts/tool.scxml" with { type: "text" };
import tour01 from "../../examples/pi-durable/charts/tour/01-harness.scxml" with { type: "text" };
import tour02 from "../../examples/pi-durable/charts/tour/02-anywhere.scxml" with { type: "text" };
import tour03 from "../../examples/pi-durable/charts/tour/03-crashes.scxml" with { type: "text" };
import tour04 from "../../examples/pi-durable/charts/tour/04-conversations.scxml" with { type: "text" };
import tour05 from "../../examples/pi-durable/charts/tour/05-sections.scxml" with { type: "text" };
import tour06 from "../../examples/pi-durable/charts/tour/06-tools.scxml" with { type: "text" };
import tour07 from "../../examples/pi-durable/charts/tour/07-hooks.scxml" with { type: "text" };
import tour08 from "../../examples/pi-durable/charts/tour/08-tasks.scxml" with { type: "text" };
import tour09 from "../../examples/pi-durable/charts/tour/09-compaction.scxml" with { type: "text" };
import tour10 from "../../examples/pi-durable/charts/tour/10-documents.scxml" with { type: "text" };
import tour11 from "../../examples/pi-durable/charts/tour/11-malleable.scxml" with { type: "text" };
import tour12 from "../../examples/pi-durable/charts/tour/12-multiplayer.scxml" with { type: "text" };
import { CATALOG } from "../../examples/pi-durable/src/extensions.ts";
import type { ConversationView, EntryView } from "../../examples/pi-durable/src/harness.ts";
import { CITATIONS, PI_LOGO_SVG } from "../../examples/pi-durable/src/post.ts";
import { activeContext } from "../../examples/pi-durable/src/storage.ts";
import { DurableSystem, type Note } from "../../examples/pi-durable/src/system.ts";
import { CHAPTERS, type Chapter } from "../../examples/pi-durable/src/tour.ts";
import type { CommitRecord, TaskRecord, Write } from "../../examples/pi-durable/src/types.ts";

const TOURS: Record<string, string> = {
  "01-harness": tour01,
  "02-anywhere": tour02,
  "03-crashes": tour03,
  "04-conversations": tour04,
  "05-sections": tour05,
  "06-tools": tour06,
  "07-hooks": tour07,
  "08-tasks": tour08,
  "09-compaction": tour09,
  "10-documents": tour10,
  "11-malleable": tour11,
  "12-multiplayer": tour12,
};
const CHARTS = {
  harness: harnessChart,
  generation: generationChart,
  tool: toolChart,
  compaction: compactionChart,
  checkout: checkoutChart,
  payment: paymentChart,
  reminder: reminderChart,
  client: clientChart,
};
/** Things the simulated model knows how to do (free play). */
const TRY = [
  "What’s in the repo?",
  "Fix the flaky login test",
  "Deploy v1.5.1",
  "Checkout with visa-4242, amex-0005 and mc-0009",
  "Triage this issue: the app crashes when I log out",
  "Remind me to stretch",
  "Add to my list: buy milk and call Bo",
  "Add a house rule to AGENTS.md",
  "Why is checkout slow?",
  "Hand off and start over",
];
const NAMES = ["Bo", "Cy", "Dee", "Eli", "Fay"];
/** Half speed: slow enough to read along. */
const DEFAULT_SPEED = 0.5;
/** `?autoplay=1`: run straight through (no pause at captions), as the browser tests do. */
const AUTOPLAY = new URLSearchParams(location.search).get("autoplay") === "1";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number> = {},
  ...children: (Node | string | null | undefined | false)[]
) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
};
const at = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

const explorer = document.querySelector("scxml-explorer")!;
const clientsEl = $("#pd-clients");
const processEl = $("#pd-process");
const storageEl = $("#pd-storage");
const captionEl = $("#pd-caption");
const sessionPicker = $<HTMLSelectElement>("#pd-session");
const mainEl = $("#pd-main");
const inspectorEl = $("#pd-inspector");
const nextButton = $<HTMLButtonElement>("#pd-next");
const hintButton = $<HTMLButtonElement>("#pd-chart-hint");
const playButton = $<HTMLButtonElement>("#pd-play");
const stepButton = $<HTMLButtonElement>("#pd-step");
const timeEl = $("#pd-time");
const speedInputs = [...document.querySelectorAll<HTMLInputElement>("input[name=pd-speed]")];
const speedSelect = $<HTMLSelectElement>("#pd-speed-select");
const killButton = $<HTMLButtonElement>("#pd-kill");
const startButton = $<HTMLButtonElement>("#pd-start");
const statusEl = $("#pd-process-status");
const params = new URLSearchParams(location.search);

let system: DurableSystem;
let clock: PlaybackClock;
let generation = 0;
let chapter: Chapter | null = null;
let macrosteps = 0;
let inspected = "harness";
let unsubscribeClock: (() => void) | null = null;

// ── citations: the post's passages, in popovers (rendered by the page) ──────

function cite(id: string, label?: string): HTMLButtonElement {
  const c = CITATIONS[id]!;
  const b = h(
    "button",
    {
      type: "button",
      class: "pd-cite-btn",
      popovertarget: `cite-${id}`,
      "aria-label": `From the post: ${c.section}`,
      title: `From the post: ${c.section}`,
    },
    h("span", { "aria-hidden": "true" }, "¶"),
    label ? ` ${label}` : null,
  ) as HTMLButtonElement;
  return b;
}

/** Open each popover next to the button that opened it. */
let opener: HTMLElement | null = null;
document.addEventListener("click", (e) => {
  const b = (e.target as Element).closest?.<HTMLElement>("[popovertarget]");
  if (b) opener = b;
});
/** Popovers live in the top layer (nothing clips them); place one by the button that opened it. */
function placePopover(pop: HTMLElement): void {
  pop.addEventListener("toggle", (e) => {
    if ((e as ToggleEvent).newState !== "open" || !opener?.isConnected) return;
    const r = opener.getBoundingClientRect();
    const w = Math.min(pop.offsetWidth, innerWidth - 32);
    pop.style.left = `${Math.max(16, Math.min(r.left, innerWidth - w - 16))}px`;
    const below = r.bottom + 8;
    pop.style.top = below + pop.offsetHeight < innerHeight - 16 ? `${below}px` : `${Math.max(16, r.top - pop.offsetHeight - 8)}px`;
  });
}
for (const pop of document.querySelectorAll<HTMLElement>(".pd-cite[popover]")) placePopover(pop);

// ── lifecycle ──────────────────────────────────────────────────────────────

async function boot(id: string | null): Promise<void> {
  const gen = ++generation;
  const speed = clock?.speed ?? (Number(params.get("speed")) || DEFAULT_SPEED);
  closeInspector();
  queued.clear();
  system?.dispose();
  clock?.dispose();
  unsubscribeClock?.();
  chapter = CHAPTERS.find((c) => c.id === id) ?? null;
  renderChapter();
  clientsEl.replaceChildren();
  panels.clear();
  logEl = null;
  lastSeq = 0;
  captionEl.replaceChildren();
  hintButton.hidden = true;
  suggestion = null;
  showPanel(chapter?.panel ?? "process");
  // a chapter opens paused: it runs when you press Next (or Play), and pauses at every caption
  clock = new PlaybackClock({ speed, playing: AUTOPLAY });
  system = await DurableSystem.create({
    clock,
    engine: createSession,
    charts: CHARTS,
    ...(chapter?.settings ? { settings: chapter.settings } : {}),
    ...(chapter?.rootAgent ? { rootAgent: chapter.rootAgent } : {}),
  });
  if (gen !== generation) return;
  system.addEventListener("note", (e) => note((e as CustomEvent<Note>).detail));
  system.addEventListener("clients", () => syncPanels());
  system.addEventListener("change", () => {
    macrosteps++;
    schedule(renderAll);
  });
  system.addEventListener("commit", () => schedule(renderStorage));
  system.addEventListener("process", () => {
    if (!system.up && !inspected.startsWith("client:") && inspected !== "director") {
      explorer.detach();
      inspected = "";
    }
    schedule(renderAll);
  });
  system.addEventListener("session", () => schedule(syncSessionPicker));
  system.addEventListener("inspect", (e) => inspectKind((e as CustomEvent<{ kind: string; label?: string }>).detail));
  unsubscribeClock = clock.subscribe(() => schedule(renderPlayback));
  if (chapter) await system.runScenario(TOURS[chapter.file]!);
  else {
    await system.addClient("you", "You");
    note({
      text: "Free play: everything installed, nothing scripted. Press Play, type into a client (Try… lists what the simulated model knows), add clients, kill the process whenever you like.",
      at: 0,
    });
  }
  renderAll();
}

// ── rendering, at most once a frame per part ───────────────────────────────

const queued = new Set<() => void>();
function schedule(fn: () => void): void {
  if (queued.size === 0)
    requestAnimationFrame(() => {
      const fns = [...queued];
      queued.clear();
      for (const f of fns) f();
    });
  queued.add(fn);
}

function renderAll(): void {
  renderProcessControls();
  renderPlayback();
  for (const p of panels.values()) p.render();
  renderProcess();
  renderStorage();
  syncSessionPicker();
}

function note(n: Note): void {
  captionEl.replaceChildren(h("span", { class: "pd-caption-at" }, at(n.at)), " ", n.text, " ", ...(n.cite ? [cite(n.cite)] : []));
  if (n.panel) showPanel(n.panel);
  if (!AUTOPLAY && clock.playing) clock.pause();
  renderNext();
}

/** Next: shown while paused; it plays on to the next caption. */
function renderNext(): void {
  nextButton.hidden = clock.playing;
  const finished = !!system?.director && system.director.activeStateIds().length === 0;
  nextButton.textContent = clock.now() === 0 ? "Start" : finished ? "Keep running" : "Next";
}
nextButton.addEventListener("click", () => {
  // the first press: bring the stage up under the sticky toolbar
  if (clock.now() === 0)
    $(".pd-story").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  clock.play();
  renderNext();
});

// ── the sidebar: Process or Storage, one at a time (docked right, resizable) ──

const sidebar = $("#pd-sidebar");
const sideToggle = $<HTMLButtonElement>("#pd-side-toggle");
const resizer = $("#pd-sidebar-resize");
const SIDEBAR_KEY = "pi-durable:sidebar";
let sidebarWidth = 440;
try {
  sidebarWidth = Number(JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? "{}").width) || 440;
} catch {
  // storage may be unavailable: the default width will do
}

function showPanel(panel: "process" | "storage"): void {
  mainEl.dataset.panel = panel;
  for (const tab of sidebar.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
    const on = tab.dataset.panel === panel;
    tab.setAttribute("aria-selected", String(on));
    $(`#${tab.getAttribute("aria-controls")}`).hidden = !on;
  }
}
for (const tab of sidebar.querySelectorAll<HTMLButtonElement>("[role=tab]"))
  tab.addEventListener("click", () => {
    showPanel(tab.dataset.panel as "process" | "storage");
    setSide(true);
  });

function setSide(open: boolean): void {
  sidebar.dataset.open = String(open);
  sideToggle.setAttribute("aria-expanded", String(open));
  sideToggle.textContent = open ? "»" : "«";
  sideToggle.setAttribute("aria-label", open ? "Collapse the sidebar" : "Expand the sidebar");
  applyWidth();
}
function applyWidth(): void {
  sidebarWidth = Math.max(300, Math.min(760, Math.round(sidebarWidth), innerWidth - 360));
  document.body.style.setProperty("--pd-sidebar-w", `${sidebarWidth}px`);
  document.body.dataset.pdSidebar = sidebar.dataset.open === "true" ? "open" : "closed";
  resizer.setAttribute("aria-valuenow", String(sidebarWidth));
}
function saveWidth(): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ width: sidebarWidth }));
  } catch {
    // not remembered: fine
  }
}
sideToggle.addEventListener("click", () => setSide(sidebar.dataset.open !== "true"));
resizer.addEventListener("pointerdown", (e) => {
  resizer.setPointerCapture(e.pointerId);
  const move = (m: PointerEvent) => {
    sidebarWidth = innerWidth - m.clientX;
    applyWidth();
  };
  const up = () => {
    resizer.removeEventListener("pointermove", move);
    resizer.removeEventListener("pointerup", up);
    saveWidth();
  };
  resizer.addEventListener("pointermove", move);
  resizer.addEventListener("pointerup", up);
});
resizer.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 80 : 20;
  if (e.key === "ArrowLeft") sidebarWidth += step;
  else if (e.key === "ArrowRight") sidebarWidth -= step;
  else return;
  e.preventDefault();
  applyWidth();
  saveWidth();
});
addEventListener("resize", applyWidth);
setSide(!matchMedia("(max-width: 900px)").matches);

function renderChapter(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(".pd-chapters button"))
    b.setAttribute("aria-pressed", String((b.dataset.chapter || null) === (chapter?.id ?? null)));
  $("#pd-chapter-title").textContent = chapter ? `${CHAPTERS.indexOf(chapter) + 1}. ${chapter.title}` : "Free play";
  $("#pd-chapter-cite").replaceChildren(chapter ? cite(chapter.cite, "the post") : "");
  $("#pd-chapter-blurb").textContent = chapter?.blurb ?? "Everything installed, nothing scripted.";
  const url = new URL(location.href);
  if (chapter) url.searchParams.set("chapter", chapter.id);
  else url.searchParams.delete("chapter");
  history.replaceState(null, "", url);
}

// ── the process: its controls, its harness, its registry, its tasks ─────────

function renderProcessControls(): void {
  const up = system.up;
  const state = up
    ? (system
        .harness!.session.activeStateIds()
        .filter((s) => s !== "open")
        .at(-1) ?? "")
    : "";
  statusEl.textContent = up
    ? `${system.harness!.processId} · ${state}`
    : `no process (${system.processes ? `${system.harness?.processId} died` : "not started"})`;
  statusEl.dataset.up = String(up);
  killButton.disabled = !up;
  startButton.disabled = up;
}

const STATUS_WORDS: Record<string, string> = {
  opening: "opening: taking ownership of the storage",
  reconciling: "reconciling: running tasks go back to pending (one commit, no task code)",
  paused: "open, paused: waiting for resume()",
  scheduling: "open, scheduling: running, waking and aborting tasks",
};

function renderProcess(): void {
  const h0 = system.harness;
  if (!h0 || h0.dead) {
    processEl.replaceChildren(
      h(
        "div",
        { class: "pd-dead" },
        h("strong", {}, h0 ? `${h0.processId} is dead.` : "No process."),
        " Its sessions, timers and promises are gone; storage still holds every task and its checkpoint. ",
        button("Start a new process", () => void system.start(), "chat-primary"),
      ),
      tasksSection(),
    );
    return;
  }
  const state =
    h0.session
      .activeStateIds()
      .filter((s) => s !== "open")
      .at(-1) ?? "";
  const harness = h(
    "div",
    { class: "pd-harness" },
    h(
      "div",
      { class: "pd-row" },
      h(
        "button",
        { type: "button", class: "pd-link", "data-inspect": "harness", title: "Show harness.scxml" },
        `harness · ${h0.processId}`,
      ),
      h("span", { class: `pd-pill pd-pill-${state === "scheduling" ? "running" : "waiting"}` }, state),
    ),
    h("p", { class: "pd-small" }, STATUS_WORDS[state] ?? ""),
  );
  processEl.replaceChildren(harness, tasksSection(), registrySection());
}

function registrySection(): HTMLElement {
  const reg = system.registry!;
  const list = h(
    "dl",
    { class: "pd-registry" },
    ...reg.extensions.flatMap((e) => [
      h("dt", {}, `${e.name}@${e.version}`),
      h(
        "dd",
        {},
        e.blurb,
        system.settings.extensions && !system.settings.extensions.includes(e.name)
          ? h("span", { class: "pd-badge" }, "not selected")
          : null,
      ),
    ]),
  );
  const install = h(
    "div",
    { class: "pd-row" },
    h("span", { class: "pd-small" }, "Install while it runs:"),
    ...Object.keys(CATALOG)
      .filter((k) => !reg.extensions.some((e) => `${e.name}@${e.version}` === k))
      .map((k) => button(k, () => system.install(k), "pd-mini")),
  );
  const changes = reg.changes.length ? h("p", { class: "pd-small" }, reg.changes.slice(-3).join(" · ")) : null;
  return h(
    "section",
    { class: "pd-section" },
    h(
      "div",
      { class: "pd-row" },
      h("h3", {}, "Registry"),
      cite("malleable"),
      h("span", { class: "pd-small" }, "code: installed by this process"),
    ),
    list,
    install,
    changes,
  );
}

const showFinished = { value: true };

/** The second line of a task row: what it waits on, what it holds, its marks. */
function meta(t: TaskRecord, done: boolean, outcome: string | null): HTMLElement | null {
  const s = t.state;
  const parts = [
    s.status === "waiting" ? h("span", {}, `waits on ${s.on.join(", ")} · ${s.policy}`) : null,
    outcome && s.status === "completing" ? h("span", {}, `holds ${outcome}`) : null,
    t.background ? h("span", { class: "pd-badge" }, "background") : null,
    t.abortRequested && !done ? h("span", { class: "pd-badge pd-badge-abort" }, "abort mark") : null,
    t.memos && Object.keys(t.memos).length
      ? h(
          "span",
          { class: "pd-badge" },
          `memo ${Object.entries(t.memos)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(" ")}`,
        )
      : null,
  ].filter((x): x is HTMLElement => !!x);
  return parts.length ? h("span", { class: "pd-task-meta" }, ...parts) : null;
}

function tasksSection(): HTMLElement {
  const { storage } = system;
  const tasks = [...storage.tasks.values()];
  const convs = [...storage.conversations.values()];
  const inMemory = (t: TaskRecord) => !!system.harness && !system.harness.dead && system.harness.sessions.has(t.id);
  const renderTask = (t: TaskRecord): HTMLElement => {
    const s = t.state;
    const done = s.status === "terminal";
    const outcome = s.status === "terminal" || s.status === "completing" ? s.outcome.status : null;
    const phase = "checkpoint" in s ? String(s.checkpoint.phase) : "";
    const pill = done ? `done-${outcome}` : s.status;
    const children = [
      ...tasks.filter((c) => c.owner === t.id).map(renderTask),
      ...convs.filter((c) => c.owner?.taskId === t.id).map(renderConv),
    ].filter((x) => x.childElementCount || !x.hidden);
    const row = h(
      "li",
      { class: `pd-task${done ? " pd-done" : ""}`, hidden: done && !showFinished.value && !children.length },
      h(
        "button",
        {
          type: "button",
          class: "pd-task-row",
          "data-inspect": t.id,
          title: inMemory(t) ? "Show its chart" : "In storage only: no session in this process",
        },
        h("span", {
          class: `pd-mem${inMemory(t) ? " pd-mem-on" : ""}`,
          "aria-label": inMemory(t) ? "running in this process" : "in storage only",
        }),
        h("span", { class: `pd-pill pd-pill-${pill}` }, done ? outcome! : s.status),
        h(
          "span",
          { class: "pd-task-title" },
          h("span", { class: "pd-label" }, t.label),
          h("code", { class: "pd-kind" }, t.kind),
          h("span", { class: "pd-id" }, t.id),
          phase ? h("span", { class: "pd-phase" }, phase) : null,
        ),
        meta(t, done, outcome),
      ),
      children.length ? h("ul", {}, ...children) : null,
    );
    return row;
  };
  const renderConv = (c: {
    id: string;
    title: string;
    parent?: { conversationId: string; at: string };
    owner?: { taskId: string };
  }): HTMLElement => {
    const live = storage.doc({ kind: "pi.live", fork: "initial", initial: () => ({}) as { run?: unknown } }, c.id);
    const top = tasks.filter((t) => t.conversationId === c.id && !t.owner);
    return h(
      "li",
      { class: "pd-conv" },
      h(
        "div",
        { class: "pd-conv-row" },
        h("strong", {}, c.title),
        h("span", { class: "pd-id" }, c.id),
        h("span", { class: `pd-pill pd-pill-${live.run ? "running" : "idle"}` }, live.run ? "busy" : "idle"),
        c.parent ? h("span", { class: "pd-small" }, `fork of ${c.parent.conversationId} at ${c.parent.at}`) : null,
        c.owner ? h("span", { class: "pd-small" }, `owned by ${c.owner.taskId}`) : null,
      ),
      top.length ? h("ul", {}, ...top.map(renderTask)) : null,
    );
  };
  const roots = convs.filter((c) => !c.owner);
  const toggle = h(
    "label",
    { class: "pd-small pd-toggle" },
    h("input", { type: "checkbox", checked: showFinished.value }),
    " show finished",
  );
  toggle.querySelector("input")!.addEventListener("change", (e) => {
    showFinished.value = (e.target as HTMLInputElement).checked;
    renderProcess();
  });
  return h(
    "section",
    { class: "pd-section" },
    h("div", { class: "pd-row" }, h("h3", {}, "Tasks and conversations"), cite("tasks"), toggle),
    h(
      "p",
      { class: "pd-small" },
      "One ownership tree. ",
      h("span", { class: "pd-mem pd-mem-on" }),
      " has a session in this process; ",
      h("span", { class: "pd-mem" }),
      " exists only in storage. Click a task for its chart.",
    ),
    h("ul", { class: "pd-tree" }, ...roots.map(renderConv)),
  );
}

processEl.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>("[data-inspect]");
  if (b) inspect(b.dataset.inspect!);
});

// ── storage: records, working set, the commit log ───────────────────────────

let logEl: HTMLOListElement | null = null;
let lastSeq = 0;

function renderStorage(): void {
  const s = system.storage;
  const tasks = [...s.tasks.values()];
  const ws = s.workingSet();
  const stats = h(
    "dl",
    { class: "pd-stats" },
    h("dt", {}, "backend"),
    h("dd", {}, "MemoryStorage"),
    h("dt", {}, "owner"),
    h("dd", {}, s.owner ? `${s.owner}${system.up ? "" : " (dead)"}` : "none"),
    h("dt", {}, "commits"),
    h("dd", {}, String(s.seq)),
    h("dt", {}, "records"),
    h(
      "dd",
      {},
      `${s.conversations.size} conversations · ${s.entries.size} entries · ${tasks.length} tasks (${tasks.filter((t) => t.state.status !== "terminal").length} live) · ${s.submissions.size} submissions · ${s.docs.size} documents`,
    ),
    h("dt", {}, "working set"),
    h("dd", {}, `${ws.entries} active entries · ${ws.tasks} live tasks · ${ws.submissions} pending submissions`),
  );
  if (!logEl) {
    logEl = h("ol", { class: "pd-log", "aria-label": "Commit log, one line per commit" }) as HTMLOListElement;
    storageEl.replaceChildren(
      stats,
      h(
        "div",
        { class: "pd-row" },
        h("h3", {}, "Commit log"),
        h("span", { class: "pd-small" }, "the JSONL backend's file: one line per commit"),
      ),
      logEl,
    );
  } else storageEl.firstElementChild!.replaceWith(stats);
  const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  for (const c of s.log.slice(lastSeq)) logEl.append(commitRow(c));
  lastSeq = s.log.length;
  while (logEl.childElementCount > 400) logEl.firstElementChild?.remove();
  if (nearBottom) logEl.scrollTop = logEl.scrollHeight;
}

function writeWords(w: Write): string {
  switch (w.type) {
    case "conversation":
      return `conversation ${w.record.id}`;
    case "entry":
      return `entry ${w.record.id} ${w.record.data.kind}`;
    case "task": {
      const s = w.record.state;
      const what = "outcome" in s ? `${s.status} ${s.outcome.status}` : `${s.status} · ${s.checkpoint.phase}`;
      return `task ${w.record.id} ${what}${w.record.abortRequested ? " ⚑" : ""}`;
    }
    case "submission":
      return `submission ${w.record.id} ${w.record.status}${w.record.requestId ? ` (${w.record.requestId})` : ""}`;
    case "doc":
      return `doc ${w.kind}@${w.scope}`;
    case "owner":
      return `owner ${w.owner}`;
  }
}

function commitRow(c: CommitRecord): HTMLElement {
  return h(
    "li",
    { "data-by": c.by.startsWith("t") ? "task" : c.by },
    h(
      "details",
      {},
      h(
        "summary",
        {},
        h("span", { class: "pd-seq" }, `#${c.seq}`),
        h("span", { class: "pd-at" }, at(c.at)),
        h("span", { class: "pd-by" }, c.by),
        h("code", {}, c.name),
        h("span", { class: "pd-writes" }, c.writes.map(writeWords).join(", ")),
      ),
      h("pre", {}, JSON.stringify(c)),
    ),
  );
}

// ── clients ────────────────────────────────────────────────────────────────

const panels = new Map<string, { el: HTMLElement; render: () => void }>();

function syncPanels(): void {
  for (const [id, p] of panels)
    if (!system.clients.has(id)) {
      p.el.remove();
      panels.delete(id);
    }
  for (const c of system.clients.values()) {
    if (panels.has(c.id)) continue;
    const p = panel(c.id, c.name, c.session);
    panels.set(c.id, p);
    clientsEl.append(p.el);
    p.render();
  }
  syncSessionPicker();
}

function panel(id: string, name: string, session: SCXMLSession): { el: HTMLElement; render: () => void } {
  const title = h("h3", {}, name);
  const link = h("span", { class: "pd-pill" });
  const counts = h("span", { class: "pd-small" });
  const switcher = h("select", { "aria-label": `${name}: conversation` }) as HTMLSelectElement;
  switcher.addEventListener("change", () => system.ui(id, "switch", { conversationId: switcher.value }));
  const inspectBtn = button("chart", () => inspect(`client:${id}`), "pd-mini");
  inspectBtn.title = "This client’s statechart (client.scxml)";
  const body = h("div", { class: "pd-client-body" });
  const transcript = h("ol", { class: "pd-transcript", "aria-label": `${name}: transcript` });
  const below = h("div", { class: "pd-client-below" });
  const text = h("textarea", { rows: 2, placeholder: "Message the agent…", "aria-label": `${name}: message` }) as HTMLTextAreaElement;
  const mode = h(
    "select",
    { "aria-label": "When busy", title: "whenBusy: what happens if the conversation is running" },
    h("option", { value: "followUp" }, "followUp"),
    h("option", { value: "steer" }, "steer"),
    h("option", { value: "reject" }, "reject"),
  ) as HTMLSelectElement;
  const send = () => {
    const t = text.value.trim();
    if (!t) return;
    system.type(id, t, { whenBusy: mode.value as "followUp" | "steer" | "reject" });
    text.value = "";
  };
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  // Try…: a popover (top layer), so no scrolling column can clip it
  const tryList = h("div", { popover: "", id: `try-${id}`, class: "pd-pop pd-try-list", role: "menu", "aria-label": "Try a message" });
  for (const t of TRY) {
    const item = button(t, () => {
      text.value = t;
      tryList.hidePopover();
      text.focus();
    });
    item.setAttribute("role", "menuitem");
    tryList.append(item);
  }
  placePopover(tryList);
  const tryMenu = h("button", { type: "button", class: "pd-mini chat-quiet", popovertarget: `try-${id}`, "aria-haspopup": "menu" }, "Try…");
  const composer = h(
    "div",
    { class: "pd-composer" },
    text,
    h(
      "div",
      { class: "pd-row" },
      h("label", { class: "pd-small" }, "whenBusy ", mode),
      cite("multiplayer"),
      button("Send", send, "chat-primary"),
      button("Stop (Esc)", () => system.ui(id, "abort"), "pd-mini"),
      button("Compact", () => system.ui(id, "compact", { instructions: "" }), "pd-mini"),
      tryMenu,
    ),
  );
  const el = h(
    "article",
    { class: "pd-client card", "data-client": id },
    h("header", {}, title, link, counts, switcher, inspectBtn),
    tryList,
    body,
    transcript,
    below,
    composer,
  );
  let lastKey = "";
  let lastTranscript = "";
  const render = () => {
    if (!system.clients.has(id)) return;
    const state = session.isActive("live") ? "live" : session.isActive("attaching") ? "attaching" : "offline";
    const view = session.datamodel.evaluate("view") as ConversationView | null;
    const frames = Number(session.datamodel.evaluate("frames"));
    const ops = Number(session.datamodel.evaluate("ops"));
    const conv = String(session.datamodel.evaluate("conversationId"));
    const approvals = system.up ? [...system.harness!.approvals.values()].filter((a) => a.conversationId === conv) : [];
    const key = `${state}|${frames}|${ops}|${conv}|${system.storage.conversations.size}|${approvals.length}|${view?.seq}`;
    if (key === lastKey) return;
    lastKey = key;
    link.textContent = state;
    link.className = `pd-pill pd-pill-${state === "live" ? "running" : state === "attaching" ? "waiting" : "error"}`;
    counts.textContent = `${frames} frame${frames === 1 ? "" : "s"} · ${ops} ops`;
    counts.title = "The first frame is the full view; every later one carries only a commit's operations";
    switcher.replaceChildren(
      ...[...system.storage.conversations.values()].map((c) =>
        h(
          "option",
          { value: c.id, selected: c.id === conv },
          `${c.title} (${c.id})${c.parent ? ` · fork of ${c.parent.conversationId}` : ""}${c.owner ? ` · subagent of ${c.owner.taskId}` : ""}`,
        ),
      ),
    );
    if (!view) {
      body.replaceChildren(
        h(
          "p",
          { class: "pd-small" },
          state === "offline" ? "Offline: no process is up. What you send waits here, and is sent again when a process is." : "Attaching…",
        ),
      );
      transcript.replaceChildren();
      lastTranscript = "";
      below.replaceChildren(requestsOf(session, conv));
      return;
    }
    body.replaceChildren(
      agentLine(view),
      contextMeter(view),
      ...(state === "offline" ? [h("p", { class: "pd-small pd-offline" }, "Offline: showing the last view this client had.")] : []),
    );
    const tkey = `${conv}|${view.entries.length}|${view.entries.find((e) => e.active)?.id}`;
    if (tkey !== lastTranscript) {
      lastTranscript = tkey;
      const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 40;
      transcript.replaceChildren(...view.entries.map((e) => entryItem(e, id, view)));
      if (nearBottom) transcript.scrollTop = transcript.scrollHeight;
    }
    below.replaceChildren(
      liveArea(view),
      ...approvals.map((a) => approvalCard(a.taskId, a.question)),
      inboxArea(view),
      todosArea(view),
      requestsOf(session, conv),
    );
  };
  return { el, render };
}

function avatar(): HTMLElement {
  const el = h("span", { class: "pd-avatar", title: "The agent (Pi)" });
  el.innerHTML = PI_LOGO_SVG; // a constant: the Pi logo
  return el;
}

function agentLine(view: ConversationView): HTMLElement {
  const a = view.docs.agent;
  const tools = Array.isArray(a.tools)
    ? `tools: ${a.tools.length ? a.tools.join(", ") : "none"}`
    : a.tools?.remove.length
      ? `without ${a.tools.remove.join(", ")}`
      : "all tools";
  return h(
    "p",
    { class: "pd-agent" },
    avatar(),
    h("span", { class: "pd-small" }, "pi.agent"),
    " ",
    h("code", {}, a.model ?? "sim-sol"),
    " · ",
    h("code", {}, a.cwd ?? "/work/repo"),
    " · ",
    tools,
    a.instructions ? ` · “${a.instructions}”` : "",
    " ",
    cite("conversations"),
  );
}

function contextMeter(view: ConversationView): HTMLElement {
  const { contextWindow, reserveTokens, backgroundTokens } = system.settings.compaction;
  const ctx = activeContext(view.entries);
  const tokens = ctx.entries.reduce((n, e) => n + e.tokens, 0) + Math.ceil((ctx.summary ?? ctx.handoff ?? "").length / 4);
  const pct = (n: number) => `${Math.min(100, (n / contextWindow) * 100).toFixed(1)}%`;
  const bar = h(
    "div",
    {
      class: "pd-meter",
      role: "meter",
      "aria-valuemin": 0,
      "aria-valuemax": contextWindow,
      "aria-valuenow": tokens,
      "aria-label": "Context",
    },
    h("span", { class: "pd-meter-fill", style: `width:${pct(tokens)}` }),
    h("span", {
      class: "pd-meter-tick",
      style: `left:${pct(contextWindow - reserveTokens - backgroundTokens)}`,
      title: "background compaction starts",
    }),
    h("span", {
      class: "pd-meter-tick pd-meter-hard",
      style: `left:${pct(contextWindow - reserveTokens)}`,
      title: "the next request waits for a summary",
    }),
  );
  return h(
    "div",
    { class: "pd-context" },
    h("span", { class: "pd-small" }, `context ${tokens} / ${contextWindow} tokens`),
    bar,
    cite("compaction"),
  );
}

function entryItem(e: EntryView, client: string, view: ConversationView): HTMLElement {
  const d = e.data;
  const cls = `pd-entry pd-${d.kind.replace("pi.", "")}${e.active ? "" : " pd-inactive"}${e.inherited ? " pd-inherited" : ""}`;
  const meta = h(
    "span",
    { class: "pd-entry-meta" },
    h("span", { class: "pd-id" }, e.id),
    e.inherited ? h("span", { class: "pd-badge", title: "Seen through the fork, not copied" }, `from ${e.conversationId}`) : null,
    e.active
      ? null
      : h(
          "span",
          { class: "pd-badge", title: "Before the newest summary or handoff: still in storage, not sent to the model" },
          "not in context",
        ),
  );
  let body: (Node | string | null)[];
  switch (d.kind) {
    case "pi.user":
      body = [h("strong", {}, d.author), " ", h("span", {}, d.text)];
      break;
    case "pi.assistant":
      body = [
        d.stopReason === "aborted"
          ? h(
              "span",
              { class: "pd-badge pd-badge-abort", title: "Cut off by a crash or an abort; never sent to the model again" },
              "aborted partial",
            )
          : null,
        d.text,
        ...d.toolCalls.map((c) =>
          h(
            "code",
            { class: "pd-call" },
            `${c.name}(${Object.values(c.args)
              .map((v) => JSON.stringify(v))
              .join(", ")})`,
          ),
        ),
        d.stopReason === "stop" && !e.inherited
          ? button("fork here", () => system.ui(client, "fork", { at: e.id, title: `fork of ${view.conversation.id}` }), "pd-mini pd-fork")
          : null,
      ];
      break;
    case "pi.system": {
      const keys = Object.keys(d.sections);
      body = [
        h(
          "details",
          {},
          h(
            "summary",
            {},
            "system prompt ",
            keys.length ? `· ${keys.map((k) => (d.sections[k] === null ? `−${k}` : k)).join(", ")}` : "",
            d.toolsAdded.length ? ` · +${d.toolsAdded.length} tools` : "",
            d.toolsRemoved.length ? ` · −${d.toolsRemoved.join(", ")}` : "",
            " ",
          ),
          ...keys.map((k) => h("pre", {}, `<${k}>\n${d.sections[k] ?? "(removed)"}\n</${k}>`)),
          d.toolsAdded.length ? h("p", { class: "pd-small" }, `tools: ${d.toolsAdded.join(", ")}`) : null,
        ),
        cite("sections"),
      ];
      break;
    }
    case "pi.tool-result":
      body = [
        h("code", {}, d.name),
        d.code
          ? h("span", { class: `pd-badge${d.code === "interrupted" || d.code === "aborted" ? " pd-badge-abort" : ""}` }, d.code)
          : null,
        d.code === "interrupted" ? cite("crashes") : null,
        h("pre", {}, d.text),
      ];
      break;
    case "pi.compaction":
      body = [
        h("strong", {}, `summary (${d.reason})`),
        " ",
        cite("compaction"),
        h("p", {}, d.summary),
        h("span", { class: "pd-small" }, `keeps ${d.firstKept} on`),
      ];
      break;
    case "pi.reset":
      body = [h("strong", {}, "handoff: a new context"), " ", d.handoff ?? ""];
      break;
  }
  return h("li", { class: cls }, h("div", { class: "pd-entry-body" }, ...body), meta);
}

function liveArea(view: ConversationView): HTMLElement {
  const l = view.docs.live;
  const parts: (HTMLElement | null)[] = [];
  if (l.generation?.message) parts.push(h("p", { class: "pd-streaming" }, l.generation.message, h("span", { class: "pd-caret" })));
  if (l.generation?.retry)
    parts.push(h("p", { class: "pd-small" }, `retrying at ${at(l.generation.retry.at)}: ${l.generation.retry.error}`));
  for (const s of l.tools ?? [])
    parts.push(
      h(
        "div",
        { class: `pd-slot pd-slot-${s.status}` },
        h(
          "div",
          { class: "pd-row" },
          h("code", {}, s.name),
          h("span", { class: `pd-pill pd-pill-${s.status === "done" ? "done-completed" : s.status}` }, s.status),
          h("span", { class: "pd-id" }, s.taskId),
          system.harness?.sessions.has(s.taskId) ? button("chart", () => inspect(s.taskId), "pd-mini pd-slot-chart") : null,
        ),
        s.output ? h("pre", {}, s.output.trimEnd()) : null,
        s.details
          ? h(
              "p",
              { class: "pd-small" },
              Object.entries(s.details)
                .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
                .join(" · "),
            )
          : null,
      ),
    );
  for (const c of l.compactions ?? [])
    parts.push(h("p", { class: "pd-small" }, `compaction ${c.taskId}: ${c.reason}${c.blocking ? ", blocking" : ""}`));
  if (!parts.length) return h("div", { hidden: true });
  return h(
    "section",
    { class: "pd-live", "aria-label": "Live: pi.live" },
    h("div", { class: "pd-row" }, h("h4", {}, "pi.live"), h("span", { class: "pd-small" }, l.run ? `run ${l.run.taskId}` : "")),
    ...parts,
  );
}

function approvalCard(taskId: string, question: string): HTMLElement {
  return h(
    "div",
    { class: "pd-approval", role: "group", "aria-label": "Approval" },
    h("strong", {}, question),
    " ",
    h("span", { class: "pd-small" }, `asked by the approval hook of ${taskId}`),
    cite("hooks"),
    h(
      "div",
      { class: "pd-row" },
      button("Approve", () => system.harness?.approve(taskId, true), "chat-primary"),
      button("Deny", () => system.harness?.approve(taskId, false)),
    ),
  );
}

function inboxArea(view: ConversationView): HTMLElement {
  const items = view.docs.inbox.items;
  if (!items.length) return h("div", { hidden: true });
  return h(
    "section",
    { class: "pd-inbox", "aria-label": "Queued: pi.inbox" },
    h("div", { class: "pd-row" }, h("h4", {}, "pi.inbox"), h("span", { class: "pd-small" }, "queued until a boundary")),
    h(
      "ul",
      {},
      ...items.map((i) =>
        h("li", {}, h("span", { class: "pd-badge" }, i.mode), " ", i.author ? h("strong", {}, `${i.author} `) : null, i.text ?? ""),
      ),
    ),
  );
}

function todosArea(view: ConversationView): HTMLElement {
  const items = view.docs.todos.items;
  if (!items.length) return h("div", { hidden: true });
  return h(
    "section",
    { class: "pd-todos", "aria-label": "Todos: app.todos" },
    h("div", { class: "pd-row" }, h("h4", {}, "app.todos"), cite("documents")),
    h("ul", {}, ...items.map((i) => h("li", {}, i))),
  );
}

function requestsOf(session: SCXMLSession, conv: string): HTMLElement {
  const reqs = (
    (session.datamodel.evaluate("requests") as {
      requestId: string;
      conversationId: string;
      status: string;
      submissionId?: string;
      duplicate?: boolean;
      reason?: string;
    }[]) ?? []
  ).filter((r) => r.conversationId === conv);
  if (!reqs.length) return h("div", { hidden: true });
  return h(
    "details",
    { class: "pd-requests" },
    h("summary", {}, `Sent (${reqs.length}): each with its requestId`),
    h("p", { class: "pd-small" }, "Retried with the same requestId whenever the link comes back. ", cite("crashes")),
    h(
      "ul",
      {},
      ...reqs.map((r) =>
        h(
          "li",
          {},
          h("code", {}, r.requestId),
          ` → ${r.submissionId ?? "…"} ${r.status}`,
          r.duplicate
            ? h(
                "span",
                { class: "pd-badge", title: "Sent again after a reconnect: the harness returned the original submission" },
                "retried · same submission",
              )
            : null,
          r.reason ? ` (${r.reason})` : "",
        ),
      ),
    ),
  );
}

// ── the explorer: one session at a time ────────────────────────────────────

function sessions(): [string, string, SCXMLSession][] {
  const out: [string, string, SCXMLSession][] = [];
  const hz = system.harness;
  if (hz && !hz.dead) {
    out.push(["harness", `harness · ${hz.processId}`, hz.session]);
    const tasks = [...hz.sessions.entries()].reverse();
    for (const [id, s] of tasks) {
      const t = system.storage.tasks.get(id);
      out.push([id, `${t?.kind} · ${id} ${t?.label ?? ""}${t?.state.status === "terminal" ? " (finished)" : ""}`, s]);
    }
  }
  for (const c of system.clients.values()) out.push([`client:${c.id}`, `client · ${c.name}`, c.session]);
  if (system.director) out.push(["director", "the tour’s scenario", system.director]);
  return out;
}

function syncSessionPicker(): void {
  const list = sessions();
  const none = !list.some(([v]) => v === inspected);
  sessionPicker.replaceChildren(
    ...(none
      ? [h("option", { value: "", selected: true, disabled: true }, system.up ? "Pick a session" : "No process: its sessions are gone")]
      : []),
    ...list.map(([v, label]) => h("option", { value: v, selected: v === inspected }, label)),
  );
  if (none && !inspectorEl.hidden && system.up) inspect("harness");
}

/** Show a session's chart: the inspector replaces the stage; the clock keeps running. */
function inspect(which: string): void {
  const found = sessions().find(([v]) => v === which);
  if (!found) return;
  inspected = which;
  sessionPicker.value = which;
  explorer.attach({ session: found[2], processors: [], clock });
  if (inspectorEl.hidden) {
    inspectorEl.hidden = false;
    mainEl.hidden = true;
    inspectorEl.scrollIntoView({ block: "start" });
  }
}

function closeInspector(): void {
  explorer.detach();
  inspected = "";
  inspectorEl.hidden = true;
  mainEl.hidden = false;
}
$("#pd-back").addEventListener("click", closeInspector);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !inspectorEl.hidden && !document.querySelector(":popover-open")) closeInspector();
});

/** The tour points at a chart: offer it in the caption (or switch to it, if the inspector is open). */
let suggestion: string | null = null;
function suggest(key: string): void {
  suggestion = key;
  const label = sessions().find(([v]) => v === key)?.[1] ?? key;
  hintButton.textContent = `Open the chart: ${label}`;
  hintButton.hidden = false;
  if (!inspectorEl.hidden) inspect(key);
}
hintButton.addEventListener("click", () => suggestion && inspect(suggestion));

function inspectKind({ kind, label }: { kind: string; label?: string }): void {
  if (kind === "harness") {
    suggest("harness");
    return;
  }
  const hz = system.harness;
  if (!hz) return;
  const match = [...hz.sessions.keys()].reverse().find((id) => {
    const t = system.storage.tasks.get(id);
    return t?.kind === kind && (!label || t.label === label);
  });
  if (match) suggest(match);
  else {
    // the session is starting: try again once it has
    const retry = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const t = system.storage.tasks.get(id);
      if (t?.kind !== kind || (label && t.label !== label)) return;
      system.removeEventListener("session", retry);
      suggest(id);
    };
    system.addEventListener("session", retry);
  }
}

sessionPicker.addEventListener("change", () => inspect(sessionPicker.value));

// ── playback: one clock for the whole world ────────────────────────────────

function renderPlayback(): void {
  if (!clock) return;
  const playing = clock.playing;
  if (playButton.dataset.playing !== String(playing)) {
    playButton.dataset.playing = String(playing);
    playButton.replaceChildren(icon(playing ? ICONS.Pause : ICONS.Play, 18));
    playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
    playButton.title = playing ? "Pause (the whole world)" : "Play";
  }
  for (const input of speedInputs) input.checked = Number(input.value) === clock.speed;
  if (Number(speedSelect.value) !== clock.speed) speedSelect.value = String(clock.speed);
  timeEl.textContent = `${(clock.now() / 1000).toFixed(1)} s`;
  renderNext();
}

playButton.addEventListener("click", () => clock.toggle());
stepButton.prepend(icon(ICONS.StepForward));
stepButton.title = "Pause, then run until something changes";
stepButton.addEventListener("click", () => {
  const before = macrosteps;
  clock.step(() => macrosteps > before);
});
for (const input of speedInputs) input.addEventListener("change", () => (clock.speed = Number(input.value)));
speedSelect.addEventListener("change", () => (clock.speed = Number(speedSelect.value)));

killButton.addEventListener("click", () => system.kill());
startButton.addEventListener("click", () => void system.start());

// ── chapters ───────────────────────────────────────────────────────────────

for (const b of document.querySelectorAll<HTMLButtonElement>(".pd-chapters button"))
  b.addEventListener("click", () => void boot(b.dataset.chapter || null));
$("#pd-replay").addEventListener("click", () => void boot(chapter?.id ?? null));
$("#pd-add-client").addEventListener("click", () => {
  const n = system.clients.size - 1;
  const name = NAMES[n % NAMES.length]! + (n >= NAMES.length ? ` ${Math.floor(n / NAMES.length) + 1}` : "");
  void system.addClient(name.toLowerCase().replace(/\s+/g, "-"), name);
});

function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { type: "button", class: cls }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

const initial = params.get("chapter");
void boot(initial === null ? CHAPTERS[0]!.id : initial || null);

// for the site's browser test
(window as unknown as { piDurable: () => DurableSystem }).piDurable = () => system;
