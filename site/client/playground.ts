/**
 * The playground: pick an example, edit its SCXML, and it re-runs as you type, in the SANDBOXED
 * engine (user charts never run on the page's own JavaScript engine). The same session is shown by
 * <scxml-view> and <scxml-explorer>; a PlaybackClock drives it (and any fake services the example
 * opts into). Charts can be shared as links (see share.ts) and drafts are kept in localStorage.
 */
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";
import {
  compile,
  type IOProcessor,
  loadQuickJS,
  type Model,
  PlaybackClock,
  SCXMLParseError,
  type SCXMLSession,
  SCXMLValidationError,
  Session,
} from "@tinyactors/scxmljs";
import { BLANK_CHART, EXAMPLES, exampleById, LOADABLE_FILES, type PlaygroundExample } from "../src/playground-examples.ts";
import {
  maskNonMarkup,
  offsetAt,
  type PlaygroundDiagnostic,
  parseErrorMessage,
  parseErrorPosition,
  rangeOfElement,
  rangeOfProblem,
} from "./diagnostics.ts";
import type { PlaygroundEditor } from "./playground-editor.ts";
import { decodeChart, encodeChart, makeHash, readHash, ShareError } from "./share.ts";

/** Limits for user charts: a runaway script is stopped after this long, an eventless loop after this many microsteps. */
const SCRIPT_TIMEOUT_MS = 500;
const MAX_MICROSTEPS = 10_000;
const MEMORY_LIMIT = 32 * 1024 * 1024;
const RERUN_DELAY = 400;
const LOG_LIMIT = 300;
const DRAFT_KEY = (id: string) => `scxmljs-playground:draft:${id}`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = $<HTMLElement>("playground");
const picker = $<HTMLSelectElement>("pg-example");
const about = $<HTMLElement>("pg-about");
const status = $<HTMLElement>("pg-status");
const notice = $<HTMLElement>("pg-notice");
const editorHost = $<HTMLElement>("pg-editor");
const problems = $<HTMLElement>("pg-problems");
const problemCount = $<HTMLElement>("pg-problem-count");
const view = $<HTMLElement & { session?: SCXMLSession }>("pg-view");
const explorer = $<HTMLElement & { attach(o: { session: SCXMLSession; processors?: IOProcessor[]; clock?: PlaybackClock }): void }>(
  "pg-explorer",
);
const logList = $<HTMLOListElement>("pg-log");
const sendForm = $<HTMLFormElement>("pg-send");
const sendName = $<HTMLInputElement>("pg-send-name");
const sendData = $<HTMLInputElement>("pg-send-data");
const suggestions = $<HTMLElement>("pg-suggestions");

// ── state ─────────────────────────────────────────────────────────────────
let example: PlaygroundExample = EXAMPLES[0]!;
let original = "";
let editor: PlaygroundEditor;
let current:
  | { example: PlaygroundExample; session: SCXMLSession; clock: PlaybackClock; processors: IOProcessor[]; inject?: Services["inject"] }
  | undefined;
let generation = 0;
let rerun: ReturnType<typeof setTimeout> | undefined;
let explorerAttached: SCXMLSession | undefined;
let lastDiagnostics: PlaygroundDiagnostic[] = [];
const engine = loadQuickJS();

// ── small helpers ─────────────────────────────────────────────────────────
/** Until then, the clock doesn't overwrite the status line (it's saying something the user just did). */
let statusHeld = 0;
function setStatus(text: string, kind: "ok" | "busy" | "error" | "idle" = "ok", holdMs = 0) {
  statusHeld = holdMs ? Date.now() + holdMs : 0;
  status.textContent = text;
  status.dataset.kind = kind;
}

/**
 * The notice above the editor. `about` says what it's about: "chart" notices (errors, a stopped
 * script) describe one run and go when the next one starts; "page" notices (a restored draft, a
 * shared link) stay until something replaces them.
 */
function showNotice(html: string | null, kind: "info" | "warning" = "info", about: "page" | "chart" = "page") {
  if (html == null) {
    notice.hidden = true;
    notice.innerHTML = "";
    return;
  }
  notice.hidden = false;
  notice.dataset.kind = kind;
  notice.dataset.about = about;
  notice.innerHTML = html;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // blocked (private mode, sandboxed iframe): drafts just aren't kept
  }
}

function loadDraft(id: string): string | undefined {
  try {
    return storage()?.getItem(DRAFT_KEY(id)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveDraft(id: string, text: string) {
  try {
    const s = storage();
    if (!s) return;
    if (text === original) s.removeItem(DRAFT_KEY(id));
    else s.setItem(DRAFT_KEY(id), text);
  } catch {
    /* quota or blocked: the draft lives only in the editor */
  }
}

function logLine(kind: "log" | "error" | "step" | "info" | "send", text: string) {
  const li = document.createElement("li");
  li.dataset.kind = kind;
  li.textContent = text;
  const atBottom = logList.scrollHeight - logList.scrollTop - logList.clientHeight < 24;
  logList.append(li);
  while (logList.childElementCount > LOG_LIMIT) logList.firstElementChild!.remove();
  if (atBottom) logList.scrollTop = logList.scrollHeight;
}

function short(value: unknown): string {
  if (value === undefined) return "";
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > 160 ? `${s.slice(0, 159)}…` : s;
  } catch {
    return String(value);
  }
}

// ── editor (a textarea until CodeMirror has loaded) ────────────────────────
function textareaEditor(text: string, onChange: (t: string) => void): PlaygroundEditor {
  const area = document.createElement("textarea");
  area.className = "pg-fallback";
  area.spellcheck = false;
  area.value = text;
  area.setAttribute("aria-label", "SCXML source");
  area.addEventListener("input", () => onChange(area.value));
  editorHost.replaceChildren(area);
  return {
    getText: () => area.value,
    setText(t) {
      area.value = t;
      onChange(t);
    },
    setDiagnostics() {},
    goTo(offset) {
      area.focus();
      area.setSelectionRange(offset, offset);
    },
    focus: () => area.focus(),
  };
}

function onEdit(text: string) {
  saveDraft(example.id, text);
  root.dataset.stale = "";
  setStatus("Edited — re-running…", "busy");
  clearTimeout(rerun);
  rerun = setTimeout(() => void runChart(text), RERUN_DELAY);
}

// ── diagnostics ───────────────────────────────────────────────────────────
function showDiagnostics(text: string, list: PlaygroundDiagnostic[]) {
  lastDiagnostics = list;
  editor.setDiagnostics(list);
  const errors = list.filter((d) => d.severity === "error").length;
  const warnings = list.length - errors;
  problemCount.textContent = list.length
    ? [errors && `${errors} error${errors > 1 ? "s" : ""}`, warnings && `${warnings} warning${warnings > 1 ? "s" : ""}`]
        .filter(Boolean)
        .join(", ")
    : "none";
  problems.replaceChildren(
    ...list.map((d) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.severity = d.severity;
      const line = text.slice(0, d.from).split("\n").length;
      b.innerHTML = `<span class="pg-sev">${d.severity}</span> <span class="pg-line">line ${line}</span> ${esc(d.message)} <code>${esc(d.code)}</code>`;
      b.addEventListener("click", () => editor.goTo(d.from));
      li.append(b);
      return li;
    }),
  );
}

// ── the loader: only the playground's own example files ─────────────────
function loader(src: string): Promise<string> {
  const name =
    src
      .replace(/^file:/, "")
      .split(/[?#]/)[0]!
      .split("/")
      .pop() ?? "";
  if (!LOADABLE_FILES.has(name))
    return Promise.reject(new Error(`the playground only loads its own example files; "${src}" isn't one of them`));
  // never the given URL: always the site's own copy
  return fetch(`/charts/${name}`).then((r) => {
    if (!r.ok) throw new Error(`couldn't load ${name} (${r.status})`);
    return r.text();
  });
}

/** Fake services an example opts into, and (optionally) a way for sent events to go through them. */
interface Services {
  processors: IOProcessor[];
  /** Handles an event from the form instead of sending it to the session; returns false to send it normally. */
  inject?: (name: string, data: unknown) => boolean;
}

async function servicesFor(ex: PlaygroundExample, clock: PlaybackClock): Promise<Services> {
  if (ex.services === "github") {
    const [{ FakeGitHub }, { GitHubIOProcessor, issuesWebhook }] = await Promise.all([
      import("../../examples/playground/src/scxml/fake-github.ts"),
      import("../../examples/playground/src/scxml/github-ioprocessor.ts"),
    ]);
    const gh = new FakeGitHub(0);
    const github = new GitHubIOProcessor(gh);
    return {
      processors: [github],
      // a new issue is opened on the fake GitHub first, so commenting on and closing it works
      inject(name, data) {
        if (name !== "issues.opened") return false;
        const d = (data ?? {}) as { repo?: string; author?: string; title?: string };
        const repo = d.repo || "acme/widgets";
        const issue = gh.open(repo, d.author || "octocat", d.title || "Untitled");
        github.receiveWebhook("issues", issuesWebhook("opened", repo, issue.number, issue.author, issue.title));
        return true;
      },
    };
  }
  if (ex.services === "fulfillment")
    return {
      processors: (await import("../../examples/playground/src/explorer/fulfillment-sample.ts")).fulfillmentSample.ioprocessors(clock),
    };
  return { processors: [] };
}

// ── check + run ───────────────────────────────────────────────────────────
async function runChart(text: string) {
  const gen = ++generation;
  setStatus("Checking…", "busy");
  const masked = maskNonMarkup(text);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.getElementsByTagName("parsererror")[0];
  const fail = (list: PlaygroundDiagnostic[], summary: string) => {
    showDiagnostics(text, list);
    setStatus(summary, "error");
    if (current) root.dataset.stale = "";
    showNotice(
      current ? "The chart has errors: the diagram shows the last version that ran. Fix the problems below the editor." : null,
      "warning",
      "chart",
    );
  };
  if (parseError) {
    const pos = parseErrorPosition(parseError.textContent ?? "");
    const from = pos ? offsetAt(text, pos.line, pos.column) : 0;
    return fail(
      [{ from, to: from + 1, severity: "error", message: parseErrorMessage(parseError.textContent ?? ""), code: "SCXML_PARSE" }],
      "Not well-formed XML",
    );
  }
  const rootEl = doc.documentElement;
  if (rootEl.localName !== "scxml") {
    const r = rangeOfElement(masked, doc, rootEl) ?? { from: 0, to: 1 };
    return fail(
      [{ ...r, severity: "error", message: `The root element must be <scxml>, not <${rootEl.localName}>.`, code: "SCXML_PARSE" }],
      "Not an SCXML document",
    );
  }
  let model: Model;
  try {
    model = await compile(rootEl, { loader });
  } catch (e) {
    if (gen !== generation) return;
    if (e instanceof SCXMLValidationError)
      return fail(
        e.problems.map((p) => ({ ...rangeOfProblem(text, masked, p), severity: "error" as const, message: p, code: e.code })),
        `Invalid: ${e.problems.length} problem${e.problems.length > 1 ? "s" : ""}`,
      );
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof SCXMLParseError ? e.code : "SCXML_INVALID";
    return fail([{ ...rangeOfProblem(text, masked, ""), severity: "error", message, code }], "Couldn't compile");
  }
  if (gen !== generation) return;
  const warnings: PlaygroundDiagnostic[] = model.warnings.map((w) => {
    const el = w.element ?? w.state?.element ?? null;
    const r = (el && rangeOfElement(masked, doc, el)) || rangeOfProblem(text, masked, w.message);
    return { ...r, severity: "warning", message: w.message, code: w.code };
  });
  showDiagnostics(text, warnings);
  if (!current) setStatus("Loading the sandboxed engine…", "busy");
  await engine;
  if (gen !== generation) return;
  await start(model);
}

async function start(model: Model) {
  // a re-run keeps the speed and pause state; another example starts at its own speed
  const same = current?.example === example;
  const speed = same ? current!.clock.speed : (example.speed ?? 1);
  const playing = same ? current!.clock.playing : true;
  const previous = current;
  const clock = new PlaybackClock({ speed, playing });
  const { processors, inject } = await servicesFor(example, clock);
  const session = new Session(model, {
    clock,
    loader,
    ioprocessors: processors,
    scriptTimeoutMs: SCRIPT_TIMEOUT_MS,
    maxMicrosteps: MAX_MICROSTEPS,
    memoryLimitBytes: MEMORY_LIMIT,
  });
  wire(session, "", session);
  current = { example, session, clock, processors, inject };
  view.session = session;
  explorerAttached = undefined;
  if (root.dataset.tab === "explore") attachExplorer();
  // the old run goes only now, so the diagram never flashes empty
  previous?.session.dispose();
  previous?.clock.dispose();
  delete root.dataset.stale;
  if (notice.dataset.about === "chart") showNotice(null);
  logLine("info", `— started ${model.name || "chart"} (${model.states.length} states) —`);
  try {
    session.start();
  } catch (e) {
    logLine("error", `start failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  setStatus(session.status === "done" ? "Finished (reached a top-level final state)" : playing ? "Running" : "Paused", "ok");
  clock.subscribe(() => {
    // while the editor is ahead of the run (edited, or not compiling) the status line is about the edit
    if (current?.clock !== clock || root.dataset.stale !== undefined || Date.now() < statusHeld) return;
    if (current.session.status === "done") setStatus("Finished (reached a top-level final state)", "idle");
    else setStatus(clock.playing ? "Running" : "Paused", "ok");
  });
}

/** Logs what `session` (the run `owner`, or one of its invoked children) does, while `owner` is the current run. */
function wire(session: SCXMLSession, prefix: string, owner: SCXMLSession) {
  const log = (kind: Parameters<typeof logLine>[0], text: string) => {
    if (current?.session === owner) logLine(kind, text);
  };
  session.addEventListener("log", (e) => log("log", `${prefix}${e.label ? `${e.label}: ` : ""}${short(e.value)}`));
  session.addEventListener("error", (e) => {
    if (current?.session !== owner) return;
    log("error", `${prefix}${e.kind}: ${e.message}`);
    if (/interrupted/i.test(e.message))
      showNotice(
        `A script ran longer than ${SCRIPT_TIMEOUT_MS} ms and was stopped (<code>${esc(e.kind)}</code>). The chart keeps running; the log has the details.`,
        "warning",
        "chart",
      );
    else if (/microsteps/i.test(e.message))
      showNotice(
        `The chart kept taking eventless transitions (over ${MAX_MICROSTEPS.toLocaleString("en")} in one step) and was stopped.`,
        "warning",
        "chart",
      );
  });
  session.addEventListener("macrostep", (e) => {
    const leaves = e.configuration.filter((s) => s.children.length === 0).map((s) => s.id);
    log("step", `${prefix}${e.event ? e.event.name : "start"} → ${leaves.join(", ") || "(none)"}`);
  });
  session.addEventListener("send", (e) => {
    if (e.message.target && e.message.target !== "#_internal")
      log("send", `${prefix}send ${e.message.event} → ${e.message.target || e.message.type}`);
  });
  session.addEventListener("child", (e) => wire(e.child, `${prefix}[${e.invokeid}] `, owner));
  session.addEventListener("done", () => log("info", `${prefix}— reached a top-level final state —`));
}

function attachExplorer() {
  if (!current || explorerAttached === current.session) return;
  explorer.attach({ session: current.session, processors: current.processors, clock: current.clock });
  explorerAttached = current.session;
}

// ── examples ──────────────────────────────────────────────────────────────
async function sourceOf(ex: PlaygroundExample): Promise<string> {
  if (!ex.file) return BLANK_CHART;
  const r = await fetch(`/charts/${ex.file}`);
  if (!r.ok) throw new Error(`couldn't load ${ex.file}`);
  return r.text();
}

function renderSuggestions() {
  suggestions.replaceChildren(
    ...example.events.map((ev) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = ev.label ?? ev.name;
      b.title = ev.data === undefined ? ev.name : `${ev.name} ${JSON.stringify(ev.data)}`;
      b.addEventListener("click", () => {
        sendName.value = ev.name;
        sendData.value = ev.data === undefined ? "" : JSON.stringify(ev.data);
        send(ev.name, ev.data);
      });
      return b;
    }),
  );
}

async function selectExample(ex: PlaygroundExample, text?: string, restored?: string) {
  example = ex;
  picker.value = ex.id;
  about.textContent = ex.text;
  renderSuggestions();
  logList.replaceChildren();
  original = await sourceOf(ex);
  const draft = text === undefined ? loadDraft(ex.id) : undefined;
  const initial = text ?? draft ?? original;
  if (editor) editor.setText(initial);
  else editor = textareaEditor(initial, onEdit);
  clearTimeout(rerun);
  void runChart(initial);
  if (restored) showNotice(restored);
  else if (draft !== undefined && draft !== original)
    showNotice(
      'Your edited version of this example was restored. <button type="button" class="linklike" data-reset>Reset to the example</button>',
    );
}

function send(name: string, data: unknown) {
  if (!current) return;
  logLine("send", `you → ${name}${data === undefined ? "" : ` ${short(data)}`}`);
  if (!current.inject?.(name, data)) current.session.send(name, data);
  deliverWhilePaused(name);
}

/** When paused, run the clock just until `name` has been processed (the session's queued work goes before timers). */
function deliverWhilePaused(name: string) {
  if (!current || current.clock.playing) return;
  const { session, clock } = current;
  let seen = false;
  const onStep = (e: { event?: { name: string } }) => {
    if (e.event?.name === name) seen = true;
  };
  session.addEventListener("macrostep", onStep);
  clock.step(() => seen || clock.pending === 0, 100);
  session.removeEventListener("macrostep", onStep);
}

/** Data for an event sent without any: the example's suggested data for it, if it has some. */
const suggestedData = (name: string) => example.events.find((ev) => ev.name === name && ev.data !== undefined)?.data;

// ── wiring ────────────────────────────────────────────────────────────────
picker.addEventListener("change", () => {
  const ex = exampleById(picker.value) ?? EXAMPLES[0]!;
  history.replaceState(null, "", `/playground/?example=${ex.id}`);
  showNotice(null);
  void selectExample(ex);
});

$<HTMLButtonElement>("pg-reset").addEventListener("click", resetToExample);
notice.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-reset]")) resetToExample();
});
function resetToExample() {
  saveDraft(example.id, original);
  showNotice(null);
  history.replaceState(null, "", `/playground/?example=${example.id}`);
  editor.setText(original);
}

$<HTMLButtonElement>("pg-share").addEventListener("click", async () => {
  try {
    const hash = makeHash(await encodeChart(editor.getText()), example.id);
    history.replaceState(null, "", `/playground/${hash}`);
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied to the clipboard", "ok", 3000);
    } catch {
      showNotice(`Copy this link: <input class="pg-link" readonly value="${esc(url)}" aria-label="Share link" onfocus="this.select()">`);
    }
  } catch (e) {
    showNotice(e instanceof ShareError ? `Can't share this chart as a link: ${esc(e.message)}.` : "Couldn't create a link.", "warning");
  }
});

$<HTMLButtonElement>("pg-download").addEventListener("click", () => {
  const blob = new Blob([editor.getText()], { type: "application/xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${example.id === "blank" ? "chart" : example.id}.scxml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$<HTMLButtonElement>("pg-log-clear").addEventListener("click", () => logList.replaceChildren());

sendForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = sendName.value.trim();
  if (!name) return sendName.reportValidity();
  let data: unknown;
  if (sendData.value.trim()) {
    try {
      data = JSON.parse(sendData.value);
      sendData.setCustomValidity("");
    } catch {
      sendData.setCustomValidity("Not valid JSON");
      sendData.reportValidity();
      return;
    }
  }
  send(name, data);
});
sendData.addEventListener("input", () => sendData.setCustomValidity(""));

// a click on a transition label in the diagram: send the example's data for that event, through its fake services
view.addEventListener("scxml-send", (e) => {
  const detail = (e as CustomEvent<{ name: string; data?: unknown }>).detail;
  if (detail.data === undefined) detail.data = suggestedData(detail.name);
  if (current?.inject) {
    e.preventDefault(); // the services may handle it (e.g. open the issue on the fake GitHub first)
    send(detail.name, detail.data);
    return;
  }
  logLine("send", `you → ${detail.name}${detail.data === undefined ? "" : ` ${short(detail.data)}`}`);
  queueMicrotask(() => deliverWhilePaused(detail.name)); // after the view has sent it
});

// tabs: Edit / View / Explore on narrow screens; View / Explore beside the editor on wide ones
for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-pg-tab]"))
  tab.addEventListener("click", () => selectTab(tab.dataset.pgTab as "edit" | "view" | "explore"));
function selectTab(tab: "edit" | "view" | "explore") {
  root.dataset.tab = tab;
  for (const t of document.querySelectorAll<HTMLButtonElement>("[data-pg-tab]"))
    t.setAttribute("aria-selected", String(t.dataset.pgTab === tab));
  if (tab === "explore") attachExplorer();
}

window.addEventListener("hashchange", () => void loadFromLocation());

async function loadFromLocation() {
  const { chart, example: exId } = readHash(location.hash);
  const params = new URLSearchParams(location.search);
  if (chart) {
    try {
      const text = await decodeChart(chart);
      await selectExample(
        exampleById(exId) ?? exampleById("blank")!,
        text,
        "This chart came from a shared link. Your edits are kept as a draft of this example.",
      );
      saveDraft(example.id, text);
      return;
    } catch (e) {
      showNotice(
        `The chart in this link couldn't be opened: ${esc(e instanceof Error ? e.message : String(e))}. Showing an example instead.`,
        "warning",
      );
    }
  }
  await selectExample(exampleById(params.get("example") ?? exId) ?? EXAMPLES[0]!, undefined);
}

// ── start ─────────────────────────────────────────────────────────────────
selectTab("view");
setStatus("Loading…", "busy");
await loadFromLocation();
// the real editor, once its (lazy) code is here; the textarea keeps working until then
import("./playground-editor.ts")
  .then(({ createEditor }) => {
    const text = editor.getText();
    const hadFocus = editorHost.contains(document.activeElement);
    editorHost.replaceChildren();
    editor = createEditor(editorHost, text, onEdit);
    editorHost.dataset.ready = "";
    editor.setDiagnostics(lastDiagnostics);
    if (hadFocus) editor.focus();
  })
  .catch(() => {
    /* the textarea stays: editing and diagnostics in the list still work */
  });

// for the site's browser tests
Object.assign(window, {
  __playground: {
    getText: () => editor.getText(),
    setText: (t: string) => editor.setText(t),
    get session() {
      return current?.session;
    },
    get clock() {
      return current?.clock;
    },
  },
});
