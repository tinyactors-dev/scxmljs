/**
 * /demos/llm-chat/: a group chat with a language model, run by statecharts, in this tab.
 *
 * The system (examples/llm-chat/src/system.ts) is the host chart, a client chart per
 * participant, the bus, the chat log and the models, all on one PlaybackClock: the explorer's
 * play/pause/step controls drive everything. This file only renders it and turns clicks into
 * the same calls a scenario makes.
 */
import "@tinyactors/scxmljs/explorer";
import { createSession, type IOProcessor, PlaybackClock, type SCXMLSession } from "@tinyactors/scxmljs";
import clientChart from "../../examples/llm-chat/charts/client.scxml" with { type: "text" };
import hostChart from "../../examples/llm-chat/charts/host.scxml" with { type: "text" };
import packageChart from "../../examples/llm-chat/charts/package.scxml" with { type: "text" };
import providerLeaves from "../../examples/llm-chat/charts/scenarios/provider-leaves.scxml" with { type: "text" };
import queueAndSteer from "../../examples/llm-chat/charts/scenarios/queue-and-steer.scxml" with { type: "text" };
import threeInARow from "../../examples/llm-chat/charts/scenarios/three-in-a-row.scxml" with { type: "text" };
import workspaceChart from "../../examples/llm-chat/charts/workspace.scxml" with { type: "text" };
import type { BusRecord } from "../../examples/llm-chat/src/bus.ts";
import { CATALOG } from "../../examples/llm-chat/src/catalog.ts";
import { KeyVault } from "../../examples/llm-chat/src/key-vault.ts";
import { LazyClaude } from "../../examples/llm-chat/src/lazy-claude.ts";
import type { Role } from "../../examples/llm-chat/src/protocol.ts";
import type { FaultKind } from "../../examples/llm-chat/src/sim-model.ts";
import { ChatSystem, type ClientHandle } from "../../examples/llm-chat/src/system.ts";
import { formatBytes, PACKAGES, type PackageDownload, SDK, TOOL_PACKAGES } from "../../examples/llm-chat/src/tools/packages.ts";
import type { RealState } from "../../examples/llm-chat/src/tools/runtime.ts";
import "../../examples/llm-chat/src/ui/chat-prompt.ts";
import { ICONS, icon } from "../../examples/llm-chat/src/ui/icons.ts";
import type { ConversationView, Item } from "../../examples/llm-chat/src/view.ts";

const SCENARIOS: Record<string, { title: string; source: string }> = {
  "provider-leaves": { title: "A tool provider leaves mid-call", source: providerLeaves },
  "three-in-a-row": { title: "Three messages in a row", source: threeInARow },
  "queue-and-steer": { title: "Queue, steer and stop", source: queueAndSteer },
};
const PEOPLE = new Set(["ada", "bo"]);
const ROLES: Role[] = ["input", "control", "tools"];

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  ...children: (Node | string | null | undefined | false)[]
) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
};

const vault = new KeyVault();
const claude = new LazyClaude(vault);
const explorer = document.querySelector("scxml-explorer")!;
const clientsEl = $("#chat-clients");
const hostEl = $("#chat-host-body");
const timelineEl = $("#chat-timeline");
const captionEl = $("#chat-caption");
const sessionPicker = $<HTMLSelectElement>("#chat-session");
const switcherEl = $("#chat-switcher");
const demoEl = $(".chat-demo");
const playButton = $<HTMLButtonElement>("#chat-play");
const stepButton = $<HTMLButtonElement>("#chat-step");
const timeEl = $("#chat-time");
const speedInputs = [...document.querySelectorAll<HTMLInputElement>("input[name=chat-speed]")];
const speedSelect = $<HTMLSelectElement>("#chat-speed-select");
const dlEl = $("#chat-dl");
const dlToggle = $<HTMLButtonElement>("#chat-dl-toggle");
const dlText = $("#chat-dl-text");
const dlBar = $<HTMLProgressElement>("#chat-dl-bar");
const dlList = $("#chat-dl-list");
const setupEl = $<HTMLDetailsElement>("#chat-setup");
const params = new URLSearchParams(location.search);
/** `?fake-downloads[=fast,cached,fail]`: scripted downloads instead of real ones (see src/ui/fake-downloads.ts). */
const fakeParam = params.get("fake-downloads");
const fakeDownloads = fakeParam === null ? null : import("../../examples/llm-chat/src/ui/fake-downloads.ts");
const wide = matchMedia("(min-width: 1000px)");
/** Half speed: the simulated model writes about 20 words a second and tool calls take 1–3 s, slow enough to read along. */
const DEFAULT_SPEED = 0.5;

let system: ChatSystem;
let clock: PlaybackClock;
let generation = 0;
/** The client shown on small screens (one at a time). */
let current = "ada";
/** Macrosteps of any session, for the Step button (run until the system has moved). */
let macrosteps = 0;
let unsubscribeClock: (() => void) | null = null;

// ── lifecycle ──────────────────────────────────────────────────────────────

async function boot(scenario?: string): Promise<void> {
  const gen = ++generation;
  const speed = clock?.speed ?? (Number(params.get("speed")) || DEFAULT_SPEED);
  // nothing may touch the old sessions once they are disposed: not the explorer, not a queued render
  explorer.detach();
  queued.clear();
  system?.dispose();
  clock?.dispose();
  unsubscribeClock?.();
  clientsEl.replaceChildren();
  panels.clear();
  current = "ada";
  lastRoster = "";
  lastModel = "";
  timelineEl.replaceChildren();
  captionEl.textContent = "";
  dlEl.hidden = true;
  dlList.hidden = true;
  toolRenders.clear();
  clock = new PlaybackClock({ speed, playing: params.get("paused") !== "1" });
  const fake = fakeDownloads ? await fakeDownloads : null;
  system = await ChatSystem.create({
    clock,
    engine: createSession,
    charts: { host: hostChart, client: clientChart, workspace: workspaceChart, package: packageChart },
    claude,
    // ?fake-downloads: made-up bytes through the same package machines (src/ui/fake-downloads.ts)
    ...(fake ? { packageLoader: fake.fakeLoader(fake.fakeOptions(fakeParam ?? "")) } : {}),
  });
  if (gen !== generation) return;
  system.bus.tap(onBus);
  system.addEventListener("note", (e) => note((e as CustomEvent<string>).detail));
  system.addEventListener("clients", () => syncPanels());
  system.hostView.addEventListener("change", () => schedule(renderHost));
  system.host.addEventListener("macrostep", () => {
    macrosteps++;
    schedule(renderHost);
  });
  unsubscribeClock = clock.subscribe(() => schedule(renderPlayback));
  renderPlayback();
  system.bus.onControlReply = (event, data) => {
    if (event === "input.rejected") note(`The host refused: ${(data as { reason: string }).reason}.`);
  };
  await system.addClient("ada");
  renderHost();
  inspect("host");
  if (scenario && SCENARIOS[scenario]) {
    note(`Scenario: ${SCENARIOS[scenario].title}.`);
    await system.runScenario(SCENARIOS[scenario].source);
    syncSessionPicker();
  }
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

function note(text: string): void {
  captionEl.textContent = text;
  addTimeline(h("li", { class: "tl-note" }, h("span", { class: "tl-at" }, at(clock.now())), text));
}

const at = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

// ── the host's control room ────────────────────────────────────────────────

function conversationState(host: SCXMLSession): string {
  const active = (id: string) => host.isActive(id);
  if (active("idle")) return "idle";
  if (active("backoff")) return "waiting to retry";
  if (active("tools")) return `running tools (${Object.keys((host.datamodel.evaluate("pending") as object) ?? {}).length} open)`;
  for (const s of ["connecting", "thinking", "writing", "calling"])
    if (active(s)) return `model ${s === "calling" ? "writing a tool call" : s}`;
  return host.activeStateIds().join(", ");
}

const disclosure = (summary: string, open = false) => {
  const body = h("div", { class: "chat-disclosure-body" });
  const sum = h("summary", {}, summary);
  const el = h("details", { class: "chat-disclosure", open }, sum, body) as HTMLDetailsElement;
  return { el, body, summary: sum };
};
/** Shown for Claude: the model ClaudeModel uses (examples/llm-chat/src/claude-model.ts). */
const CLAUDE_LABEL = "Claude Haiku 4.5";
const ROLE_HELP: Record<Role, string> = {
  input: "may send messages",
  control: "may steer and stop turns",
  tools: "may run tools for the model",
};

const hostParts = (() => {
  const status = h("div", { class: "chat-status", role: "status" });
  const stop = h("button", { type: "button", class: "chat-stop", hidden: true }, icon(ICONS.Square, 12), "Stop") as HTMLButtonElement;
  stop.addEventListener("click", () => system.control("input.interrupt"));
  const roster = disclosure("Clients", wide.matches);
  const model = disclosure("Model", wide.matches);
  const fault = disclosure("Simulate a failure");
  const usage = h("dl", { class: "chat-host-stats" });
  fault.body.append(faultPicker());
  for (const d of [roster, model, fault]) d.el.classList.add("chat-section");
  hostEl.replaceChildren(h("div", { class: "chat-host-status" }, status, stop), roster.el, model.el, fault.el, usage);
  return { status, stop, roster, model, usage };
})();
let lastRoster = "";
let lastModel = "";
/** The person asked to type a different key (the key card shows the form again). */
let replacingKey = false;

function modelState(host: SCXMLSession): string {
  if (host.isActive("simulated")) return "Simulated";
  if (host.isActive("unlocked")) return `${CLAUDE_LABEL} · ready`;
  if (host.isActive("verifying")) return `${CLAUDE_LABEL} · checking the key…`;
  return `${CLAUDE_LABEL} · needs a key`;
}

function renderHost(): void {
  const { host, hostView } = system;
  const claudeMode = host.isActive("claude");
  const status = conversationState(host);

  hostParts.status.replaceChildren(
    h("span", { class: "chat-chip", "data-kind": status === "idle" ? "idle" : status.startsWith("waiting") ? "error" : "busy" }, status),
    h("span", { class: "chat-chip" }, modelState(host)),
    hostView.steers.length ? h("span", { class: "chat-chip", "data-kind": "busy" }, `${hostView.steers.length} steer held`) : "",
  );
  hostParts.stop.hidden = status === "idle";
  hostParts.roster.summary.textContent = `Clients · ${hostView.roster.length}`;
  hostParts.model.summary.textContent = `Model · ${modelState(host)}`;
  hostParts.usage.replaceChildren(
    h("div", {}, h("dt", {}, "Log entries"), h("dd", {}, system.log.seq.toLocaleString("en"))),
    h("div", {}, h("dt", {}, "Output tokens"), h("dd", {}, hostView.usage.output.toLocaleString("en"))),
  );

  // re-render the roster and the model form only when they change (keeps focus and typed keys)
  const rosterKey = JSON.stringify([hostView.roster, [...system.clients.keys()].map((id) => system.bus.isOnline(id))]);
  if (rosterKey !== lastRoster) {
    lastRoster = rosterKey;
    hostParts.roster.body.replaceChildren(rosterList());
  }
  const keyState = host.isActive("unlocked") ? "ready" : host.isActive("verifying") ? "checking" : "locked";
  const modelKey = `${claudeMode}|${!!vault.get()}|${vault.remembered}|${replacingKey}|${keyState}`;
  if (modelKey !== lastModel) {
    lastModel = modelKey;
    hostParts.model.body.replaceChildren(modelControls(claudeMode, keyState));
  }
}

/** One row per client: who, whether it is reachable, what it provides, and its roles as toggles. */
function rosterList(): HTMLElement {
  return h(
    "ul",
    { class: "chat-roster-list" },
    ...system.hostView.roster.map((c) => {
      const online = !system.clients.has(c.id) || system.bus.isOnline(c.id);
      return h(
        "li",
        {},
        h(
          "div",
          { class: "chat-roster-who" },
          h("span", { class: "chat-dot", "data-kind": online ? "idle" : "error", "aria-hidden": "true" }),
          h("strong", {}, c.name),
          online ? null : h("span", { class: "chat-roster-note" }, "offline"),
          c.tools.length ? h("span", { class: "chat-roster-tools" }, c.tools.join(", ")) : null,
        ),
        h(
          "div",
          { class: "chat-role-toggles", role: "group", "aria-label": `${c.name}: roles` },
          ...ROLES.map((r) => {
            const on = c.roles.includes(r);
            const b = h(
              "button",
              {
                type: "button",
                class: "chat-role",
                "aria-pressed": String(on),
                "aria-label": `${c.name}: ${r}`,
                title: `${r}: ${ROLE_HELP[r]}`,
              },
              on ? icon(ICONS.Check, 12) : null,
              r,
            );
            b.addEventListener("click", () => {
              const roles = ROLES.filter((x) => (x === r ? !on : c.roles.includes(x)));
              system.control("roles.set", { clientId: c.id, roles });
            });
            return b;
          }),
        ),
      );
    }),
  );
}

let armedFault: FaultKind | "" = "";
function faultPicker(): HTMLElement {
  const select = h(
    "select",
    { id: "chat-fault", "aria-label": "Make the next simulated request fail" },
    h("option", { value: "" }, "Next request: normal"),
    ...(["rate_limit", "overloaded", "stream", "max_tokens", "refusal", "hang"] as const).map((k) =>
      h("option", { value: k, selected: armedFault === k }, `Next request: ${k.replace("_", " ")}`),
    ),
  ) as HTMLSelectElement;
  select.addEventListener("change", () => {
    armedFault = select.value as FaultKind | "";
    if (armedFault) {
      system.sim.fault({ kind: armedFault, retryAfterMs: 3000 });
      note(`The next simulated request will fail: ${armedFault.replace("_", " ")}.`);
      armedFault = "";
    }
  });
  return h("label", { class: "chat-inline" }, select);
}

function modelControls(claudeMode: boolean, keyState: "ready" | "checking" | "locked"): HTMLElement {
  const choice = (value: "simulated" | "claude", label: string) => {
    const input = h("input", {
      type: "radio",
      name: "chat-model",
      value,
      checked: (value === "claude") === claudeMode,
    }) as HTMLInputElement;
    input.addEventListener("change", () => system.control(value === "claude" ? "mode.claude" : "mode.simulated"));
    return h("label", {}, input, h("span", {}, label));
  };
  const box = h(
    "div",
    { class: "chat-model" },
    h(
      "fieldset",
      { class: "chat-segmented" },
      h("legend", { class: "visually-hidden" }, "Model"),
      choice("simulated", "Simulated"),
      choice("claude", "Claude"),
    ),
    h(
      "p",
      { class: "chat-small" },
      claudeMode
        ? `${CLAUDE_LABEL} with your own Anthropic API key. Fast and cheap: a demo turn costs well under a cent.`
        : "Rule-based answers made up in this tab. Free, no key; good for following the machinery.",
    ),
  );
  if (claudeMode) box.append(keyCard(keyState));
  return box;
}

/** Everything about the API key in one card: the key (or its state), remembering it, where to get one. */
function keyCard(keyState: "ready" | "checking" | "locked"): HTMLElement {
  const help = h(
    "p",
    { class: "chat-key-help" },
    "No key yet? ",
    h(
      "a",
      { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener noreferrer" },
      "Create one in the Anthropic Console",
    ),
    ", ideally in a workspace with a spend limit. It stays in this tab and only ever goes to api.anthropic.com.",
  );
  const rerender = () => {
    lastModel = "";
    renderHost();
  };

  if (vault.get() && !replacingKey) {
    const state = { ready: "working", checking: "checking…", locked: "not accepted" }[keyState];
    return h(
      "div",
      { class: "chat-key-card", "data-state": keyState },
      h(
        "div",
        { class: "chat-key-line" },
        icon(ICONS.KeyRound, 16),
        h("span", {}, h("strong", {}, "API key set"), ` · ${vault.remembered ? "saved on this device" : "for this tab only"} · ${state}`),
      ),
      h(
        "div",
        { class: "chat-key-actions", "data-align": "start" },
        quiet("Replace", () => {
          replacingKey = true;
          rerender();
        }),
        quiet("Forget", () => {
          vault.forget();
          system.control("key.forget");
          rerender();
        }),
      ),
      keyState === "locked" ? h("p", { class: "chat-key-help" }, "The API didn't accept this key: replace it with a valid one.") : null,
    );
  }

  const key = h("input", {
    type: "password",
    autocomplete: "off",
    placeholder: "sk-ant-…",
    "aria-label": "Anthropic API key",
  }) as HTMLInputElement;
  let remember = vault.remembered;
  const rememberSwitch = h(
    "button",
    {
      type: "button",
      class: "chat-switch",
      role: "switch",
      "aria-checked": String(remember),
      "aria-label": "Remember the key on this device",
    },
    h("span", { class: "chat-switch-track", "aria-hidden": "true" }),
    h("span", {}, "Remember on this device"),
  );
  rememberSwitch.addEventListener("click", () => {
    remember = !remember;
    rememberSwitch.setAttribute("aria-checked", String(remember));
  });
  const use = () => {
    if (!key.value.trim()) return key.focus();
    vault.set(key.value, remember);
    key.value = "";
    replacingKey = false;
    system.control("key.set");
    rerender();
  };
  key.addEventListener("keydown", (e) => e.key === "Enter" && use());
  const useButton = h("button", { type: "button", class: "chat-primary" }, "Use key");
  useButton.addEventListener("click", use);
  return h(
    "div",
    { class: "chat-key-card" },
    h("div", { class: "chat-combo" }, key, useButton),
    h(
      "div",
      { class: "chat-key-actions" },
      rememberSwitch,
      replacingKey
        ? quiet("Cancel", () => {
            replacingKey = false;
            rerender();
          })
        : null,
    ),
    help,
  );
}

function quiet(label: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", { type: "button", class: "chat-quiet" }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

// ── client panels ──────────────────────────────────────────────────────────

const panels = new Map<string, { el: HTMLElement; render: () => void }>();

function syncPanels(): void {
  for (const [id, p] of panels)
    if (!system.clients.has(id)) {
      p.el.remove();
      panels.delete(id);
    }
  for (const c of system.clients.values())
    if (!panels.has(c.id)) {
      // fake downloads install nothing real: the simulated tools stand in once "installed"
      if (fakeDownloads) for (const t of Object.values(c.runtime.tools)) if (t.real) t.real = async () => t.simulated;
      panels.set(c.id, panel(c));
    }
  downloadsChanged();
  if (!system.clients.has(current)) current = system.clients.keys().next().value ?? "ada";
  for (const [pid, p] of panels) p.el.toggleAttribute("data-current", pid === current);
  syncSessionPicker();
  schedule(renderHost);
  schedule(renderSwitcher);
}

/** Small screens show one client at a time; this picks which, with what each is up to. */
function renderSwitcher(): void {
  const chips = [...system.clients.values()].map((c) => {
    const queued = system.queueOf(c.id).length;
    const working = c.runtime.running.length;
    const asking = c.desk?.pending.length ?? 0;
    const online = system.bus.isOnline(c.id);
    const b = h(
      "button",
      { type: "button", "aria-pressed": String(c.id === current), "data-client-tab": c.id },
      h("span", { class: "dot", "data-kind": online ? (working || asking ? "busy" : "idle") : "error", "aria-hidden": "true" }),
      c.name,
      queued ? h("span", { class: "badge", title: `${queued} queued` }, String(queued)) : null,
      working ? h("span", { class: "badge" }, "working") : null,
      asking ? h("span", { class: "badge" }, "asks you") : null,
      online ? null : h("span", { class: "visually-hidden" }, " (offline)"),
    ) as HTMLButtonElement;
    b.addEventListener("click", () => showClient(c.id));
    return b;
  });
  const add = h("button", { type: "button", class: "add", "aria-label": "Add a client" }, icon(ICONS.Plus), "Add") as HTMLButtonElement;
  add.addEventListener("click", () => {
    setupEl.open = true;
    $<HTMLSelectElement>("#chat-add").focus();
  });
  switcherEl.replaceChildren(...chips, add);
}

function showClient(id: string): void {
  current = id;
  for (const [pid, p] of panels) p.el.toggleAttribute("data-current", pid === id);
  renderSwitcher();
}

function panel(c: ClientHandle): { el: HTMLElement; render: () => void } {
  const kind = CATALOG[c.kind]!;
  const el = h("article", { class: "chat-client card", "aria-label": c.name, "data-client": c.id, "data-current": c.id === current });
  const chip = h("span", { class: "chat-chip" });
  const roles = h("span", { class: "chat-roles" });
  const blurb = h("p", { class: "chat-small" });
  const offline = button("Go offline", () => {
    system.setOnline(c.id, !system.bus.isOnline(c.id));
    schedule(render);
    schedule(renderSwitcher);
  });
  const leave = button("Leave", () => system.removeClient(c.id));
  const options = h(
    "details",
    { class: "chat-client-options" },
    h("summary", { "aria-label": `Options for ${c.name}` }, "Options"),
    h("div", { class: "chat-client-options-body" }, blurb, h("div", { class: "chat-row" }, offline, leave)),
  );
  const head = h("header", {}, h("h3", {}, c.name), chip, roles, options);
  const body = h("div", { class: "chat-client-body" });
  el.append(head, body);
  clientsEl.append(el);

  const person = PEOPLE.has(c.kind);
  const transcript =
    person || c.kind === "viewer" ? h("ol", { class: "chat-transcript", "aria-label": `What ${c.name} sees`, "aria-live": "off" }) : null;
  const questions = c.desk ? h("div", { class: "chat-questions" }) : null;
  const composer = person ? composerFor(c) : null;
  const tools = kind.tools.length && !person ? h("div", { class: "chat-tools" }) : null;
  const knobs = kind.tools.length && !person ? knobsFor(c) : null;
  body.append(...[transcript, questions, composer?.el, tools, knobs].filter((x): x is HTMLElement => !!x));

  const render = () => {
    if (system.clients.get(c.id) !== c) return; // left, or from before a reset
    const s = c.session;
    const link = system.bus.isOnline(c.id)
      ? s.isActive("live")
        ? "live"
        : s.isActive("syncing")
          ? "catching up"
          : s.isActive("joining")
            ? "joining"
            : "left"
      : "offline";
    const granted = (s.datamodel.evaluate("granted") as Role[] | undefined) ?? [];
    chip.textContent = link;
    chip.dataset.kind = link === "live" ? "idle" : link === "offline" ? "error" : "busy";
    roles.textContent = granted.length ? granted.join(" · ") : "watches";
    blurb.textContent = `${kind.blurb} Has seen ${c.view.seq} of ${system.log.seq} log entries.`;
    offline.textContent = system.bus.isOnline(c.id) ? "Go offline" : "Go online";
    if (transcript) renderTranscript(transcript, c.view);
    if (tools) renderTools(tools, c);
    if (questions && c.desk) renderQuestions(questions, c);
    composer?.render();
  };
  const update = () => {
    schedule(render);
    schedule(renderSwitcher);
  };
  c.view.addEventListener("change", update);
  c.session.addEventListener("macrostep", () => {
    macrosteps++;
    update();
  });
  c.desk?.addEventListener("change", update);
  render();
  return { el, render };
}

function composerFor(c: ClientHandle): { el: HTMLElement; render: () => void } {
  const prompt = document.createElement("chat-prompt");
  prompt.setAttribute("label", `Message from ${c.name}`);
  prompt.setAttribute("placeholder", `Message as ${c.name}…`);
  const detail = <T>(e: Event) => (e as CustomEvent<T>).detail;
  prompt.addEventListener("prompt-submit", (e) => system.type(c.id, detail<{ text: string }>(e).text));
  prompt.addEventListener("prompt-steer", (e) => system.type(c.id, detail<{ text: string }>(e).text, true));
  prompt.addEventListener("prompt-stop", () => system.interrupt(c.id));
  prompt.addEventListener("prompt-queue-edit", (e) => system.editQueued(c.id, detail<{ id: string }>(e).id));
  prompt.addEventListener("prompt-queue-remove", (e) => system.removeQueued(c.id, detail<{ id: string }>(e).id));
  // the chart hands text back (an edited queued message, a refused steer): append, never replace
  c.panel.addEventListener("restore", (e) => prompt.appendText(detail<string>(e)));
  const render = () => {
    const s = c.session;
    const granted = (s.datamodel.evaluate("granted") as Role[] | undefined) ?? [];
    prompt.disabled = s.isActive("readonly") || s.isActive("left");
    prompt.busy = s.isActive("host-busy") || s.isActive("sending");
    prompt.canSteer = granted.includes("control");
    prompt.canStop = granted.includes("control");
    prompt.queue = system.queueOf(c.id);
    const reason = s.isActive("rejected") ? String(s.datamodel.evaluate("rejection")) : "";
    const steers = c.view.steers.filter((q) => q.author === c.name).length;
    prompt.status = reason
      ? `Refused: ${reason}.`
      : prompt.disabled
        ? `${c.name} may not type (no input role).`
        : steers
          ? `${steers} steer${steers > 1 ? "s" : ""} on the way to the model (with the next tool results, or as the next turn).`
          : "";
  };
  return { el: prompt, render };
}

// ── real tools: what they cost, and live progress while they download ──────

/** A tool's packages with their live state; placeholders (from packages.ts) until the runtime reports. */
function packagesOf(state: RealState, tool: string): PackageDownload[] {
  if (state.packages?.length) return state.packages;
  const phase = state.status === "ready" ? "ready" : state.status === "failed" ? "failed" : "waiting";
  return (TOOL_PACKAGES[tool] ?? []).map((key) => ({
    ...PACKAGES[key]!,
    phase,
    cached: false,
    shared: false,
    downloadedBytes: 0,
    totalBytes: null,
    percent: phase === "ready" ? 100 : null,
  }));
}

/** Every package a client's real tools need (unique by id), with the tool's state. */
function downloadsOf(c: ClientHandle): { packages: PackageDownload[]; states: RealState[] } {
  const byId = new Map<string, PackageDownload>();
  const states: RealState[] = [];
  for (const [name, entry] of Object.entries(c.runtime.tools)) {
    if (!entry.real || !TOOL_PACKAGES[name]) continue;
    const state = c.runtime.realState(name);
    states.push(state);
    for (const p of packagesOf(state, name)) byId.set(p.id, p);
  }
  return { packages: [...byId.values()], states };
}

/** Bytes to fetch (cached and shared packages cost nothing), bytes fetched, and percent. */
function totalOf(packages: PackageDownload[]): { done: number; total: number; percent: number | null } {
  let done = 0;
  let total = 0;
  let known = true;
  for (const p of packages) {
    if (p.cached || p.shared) continue;
    const size = p.totalBytes ?? p.approxBytes;
    if (p.totalBytes === null && p.phase !== "ready") known = false;
    total += size;
    done += p.phase === "loading" || p.phase === "ready" ? size : p.downloadedBytes;
  }
  return { done, total, percent: total === 0 ? 100 : known || done > 0 ? Math.min(100, Math.round((done / total) * 100)) : null };
}

/** The client (other than `self`) whose tools share a package, for "shared with Terminal". */
function sharedWith(self: ClientHandle, id: string): string | undefined {
  for (const c of system.clients.values()) {
    if (c === self) continue;
    const p = downloadsOf(c).packages.find((x) => x.id === id && x.phase === "ready" && !x.shared);
    if (p) return c.name;
  }
  return undefined;
}

function phaseWords(p: PackageDownload, owner: ClientHandle, error?: string): string {
  switch (p.phase) {
    case "waiting":
      return "waiting";
    case "resolving":
      return "looking it up";
    case "downloading":
      return `downloading ${formatBytes(p.downloadedBytes)} of ${formatBytes(p.totalBytes ?? p.approxBytes)}`;
    case "loading":
      return "starting";
    case "ready":
      return p.cached
        ? "ready, from this browser's cache"
        : p.shared
          ? `ready, shared with ${sharedWith(owner, p.id) ?? "another client"}`
          : "ready";
    case "failed":
      return `failed${error ? `: ${error}` : ""}`;
  }
}

/** What switching to Real will download, leaving out what another client already has here. */
function costWords(c: ClientHandle, packages: PackageDownload[]): string {
  const here = packages.filter((p) => p.phase === "ready" || sharedWith(c, p.id));
  const fetch = packages.filter((p) => !here.includes(p));
  const bytes = fetch.reduce((n, p) => n + p.approxBytes, 0);
  const anyReal = [...system.clients.values()].some((x) => x !== c && downloadsOf(x).states.some((st) => st.status !== "idle"));
  const already = here.length ? ` (${here.map((p) => p.label).join(" and ")} already here)` : "";
  const runtime = anyReal ? "" : ` plus the ${formatBytes(SDK.approxBytes)} Wasmer runtime the first time`;
  return fetch.length
    ? `Downloads about ${formatBytes(bytes)}${already} once, then cached${runtime ? `,${runtime}` : ""}. Runs in WebAssembly, in this tab.`
    : `Nothing to download${already}. Runs in WebAssembly, in this tab.`;
}

/** A progress bar: determinate with a percent, indeterminate (no value) while the size is unknown. */
function setBar(bar: HTMLProgressElement, percent: number | null, busy: boolean): void {
  if (percent === null && busy) bar.removeAttribute("value");
  else bar.value = percent ?? 0;
}

function knobsFor(c: ClientHandle): HTMLElement {
  const box = h("div", { class: "chat-client-tools" });
  const { runtime } = c;
  if (runtime.hasReal) {
    const group = `tools-mode-${c.id}`;
    const option = (mode: "simulated" | "real", title: string, note: string) => {
      const input = h("input", { type: "radio", name: group, value: mode, checked: runtime.mode === mode }) as HTMLInputElement;
      input.addEventListener("change", () => input.checked && runtime.setMode(mode));
      return h("label", { class: "chat-mode-option" }, input, h("span", {}, h("strong", {}, title), h("small", {}, note)));
    };
    const realNote = h("small", {});
    const realOption = option("real", "Real", "");
    realOption.querySelector("small")!.replaceWith(realNote);
    const modes = h(
      "fieldset",
      { class: "chat-tools-mode" },
      h("legend", {}, "Tools"),
      option("simulated", "Simulated", "Canned answers, instant. Nothing to download."),
      realOption,
    );
    // live progress: a total and one row per package (keyed, so the bars move smoothly)
    const totalText = h("span", { class: "chat-dl-total-text" });
    const totalBar = h("progress", { max: "100", "aria-label": `${c.name}: all downloads` }) as HTMLProgressElement;
    const retry = button("Try again", () => runtime.setMode("real"));
    const rows = h("ul", { class: "chat-dl-rows" });
    const detail = h("div", { class: "chat-dl-detail" }, h("p", { class: "chat-dl-total" }, totalText, totalBar), rows, retry);
    const live = h("p", { class: "visually-hidden", "aria-live": "polite" });
    const credit = h(
      "p",
      { class: "chat-credit" },
      "Real tools run on ",
      h("a", { href: "https://wasmer.io" }, "Wasmer"),
      ", in WebAssembly.",
    );
    const rowEls = new Map<string, { li: HTMLElement; bar: HTMLProgressElement; words: HTMLElement }>();
    const announced = new Map<string, string>();
    let announcedStatus = "";

    const render = () => {
      if (system.clients.get(c.id) !== c) return;
      const { packages, states } = downloadsOf(c);
      const failed = states.find((st) => st.status === "failed");
      const loading = states.some((st) => st.status === "loading");
      const ready = states.length > 0 && states.every((st) => st.status === "ready");
      const status = failed ? "failed" : loading ? "loading" : ready ? "ready" : "idle";
      realNote.textContent = ready ? "Downloaded and running, in WebAssembly in this tab." : costWords(c, packages);
      detail.hidden = status === "idle" && runtime.mode !== "real";
      const t = totalOf(packages);
      totalText.textContent =
        status === "ready"
          ? "Ready."
          : status === "failed"
            ? `Download failed: ${failed?.error ?? "unknown error"}`
            : status === "loading"
              ? `Downloading ${formatBytes(t.done)} of about ${formatBytes(t.total)}${t.percent === null ? "" : ` · ${t.percent}%`}`
              : "Waiting to start.";
      totalBar.hidden = status === "ready";
      setBar(totalBar, t.percent, status === "loading");
      retry.hidden = status !== "failed";
      for (const p of packages) {
        let row = rowEls.get(p.id);
        if (!row) {
          const bar = h("progress", { max: "100", "aria-label": `${p.label} download` }) as HTMLProgressElement;
          const words = h("span", { class: "chat-dl-words" });
          const li = h(
            "li",
            {},
            h("span", { class: "chat-dl-name" }, p.label),
            h("span", { class: "chat-dl-size" }, formatBytes(p.approxBytes)),
            bar,
            words,
          );
          row = { li, bar, words };
          rowEls.set(p.id, row);
          rows.append(li);
        }
        row.li.dataset.phase = p.phase;
        const text = phaseWords(p, c, failed?.error);
        if (row.words.textContent !== text) row.words.textContent = text;
        setBar(
          row.bar,
          p.phase === "ready" ? 100 : p.phase === "loading" ? null : p.percent,
          p.phase !== "waiting" && p.phase !== "failed",
        );
        // announce phase changes only, never every byte
        if (announced.get(p.id) !== p.phase) {
          announced.set(p.id, p.phase);
          if (p.phase !== "waiting")
            live.textContent = `${c.name}, ${p.label}: ${p.phase === "downloading" ? "downloading" : phaseWords(p, c, failed?.error)}`;
        }
      }
      if (status !== announcedStatus) {
        if (status === "ready") live.textContent = `${c.name}: real tools ready`;
        announcedStatus = status;
      }
    };
    toolRenders.add(render);
    // any client's progress can change this one's wording ("already here", "shared with")
    runtime.addEventListener("change", downloadsChanged);
    render();
    box.append(modes, detail, live, credit);
  }
  const wrap = h(
    "details",
    { class: "chat-knobs" },
    h("summary", {}, runtime.hasReal ? "Simulation knobs (latency, failures)" : "Simulation knobs"),
  );
  box.append(wrap);
  for (const [name, k] of c.runtime.knobs) {
    const latency = h("input", {
      type: "number",
      min: "0",
      step: "100",
      value: String(k.latencyMs),
      "aria-label": `${name} latency in ms`,
    }) as HTMLInputElement;
    latency.addEventListener("change", () => (k.latencyMs = Number(latency.value) || 0));
    const fail = h("input", { type: "checkbox", checked: k.failNext }) as HTMLInputElement;
    fail.addEventListener("change", () => (k.failNext = fail.checked));
    const hang = h("input", { type: "checkbox", checked: k.hang }) as HTMLInputElement;
    hang.addEventListener("change", () => (k.hang = hang.checked));
    wrap.append(
      h(
        "div",
        { class: "chat-row" },
        h("code", {}, name),
        h("label", {}, "latency ", latency, " ms"),
        h("label", {}, fail, " fail next call"),
        h("label", {}, hang, " hang"),
      ),
    );
  }
  return box;
}

// ── the page-level downloads indicator (in the sticky bar) ─────────────────

/** Every client's tools block; all of them re-render when any download moves. */
const toolRenders = new Set<() => void>();
function downloadsChanged(): void {
  for (const r of toolRenders) schedule(r);
  schedule(renderDownloads);
}

function renderDownloads(): void {
  if (!system) return;
  const active = [...system.clients.values()]
    .map((c) => ({ c, ...downloadsOf(c) }))
    .filter(({ c, states }) => states.some((st) => st.status === "loading" || (st.status === "failed" && c.runtime.mode === "real")));
  dlEl.hidden = active.length === 0;
  if (!active.length) {
    dlList.hidden = true;
    dlToggle.setAttribute("aria-expanded", "false");
    return;
  }
  const unique = new Map<string, PackageDownload>();
  for (const a of active) for (const p of a.packages) unique.set(p.id, p);
  const t = totalOf([...unique.values()]);
  const failed = active.filter((a) => a.states.some((st) => st.status === "failed"));
  dlEl.dataset.state = failed.length ? "failed" : "loading";
  dlText.textContent = failed.length
    ? `Download failed: ${failed.map((a) => a.c.name).join(", ")}`
    : `Downloading ${formatBytes(t.done)} of ${formatBytes(t.total)}${t.percent === null ? "" : ` · ${t.percent}%`}`;
  setBar(dlBar, t.percent, !failed.length);
  dlBar.hidden = failed.length > 0;
  dlList.replaceChildren(
    ...active.map(({ c, packages, states }) => {
      const ct = totalOf(packages);
      const st = states.find((x) => x.status === "failed") ? "failed" : `${ct.percent ?? 0}%`;
      const show = button(`Show ${c.name}`, () => {
        showView("chat");
        showClient(c.id);
        panels.get(c.id)?.el.scrollIntoView({ block: "start", behavior: "smooth" });
        dlList.hidden = true;
        dlToggle.setAttribute("aria-expanded", "false");
      });
      return h("li", {}, h("span", {}, `${c.name}: ${st}`), show);
    }),
  );
}
dlToggle.addEventListener("click", () => {
  const open = dlToggle.getAttribute("aria-expanded") !== "true";
  dlToggle.setAttribute("aria-expanded", String(open));
  dlList.hidden = !open;
});

function renderQuestions(el: HTMLElement, c: ClientHandle): void {
  const desk = c.desk!;
  if (!desk.pending.length) {
    el.replaceChildren();
    return;
  }
  const q = desk.pending[0]!;
  const input = h("input", { type: "text", "aria-label": `${c.name}'s answer`, placeholder: "Your answer" }) as HTMLInputElement;
  const answer = () => input.value.trim() && q.answer(input.value.trim());
  input.addEventListener("keydown", (e) => e.key === "Enter" && answer());
  el.replaceChildren(
    h("p", {}, h("strong", {}, "The model asks you: "), q.question),
    h("div", { class: "chat-row" }, input, button("Answer", answer)),
  );
}

function renderTools(el: HTMLElement, c: ClientHandle): void {
  const calls = c.view.items.flatMap((i) =>
    i.type === "tools" ? i.calls.filter((x) => x.provider === c.id).map((x) => ({ ...x, card: i })) : [],
  );
  const running = new Set(c.runtime.running);
  el.replaceChildren(
    calls.length
      ? h(
          "ol",
          { class: "chat-calls" },
          ...calls
            .slice(-4)
            .map((x) =>
              h(
                "li",
                { "data-status": running.has(x.id) ? "running" : x.status, ...timeoutAttrs(x.status, x.card) },
                h("code", {}, x.name),
                ` ${running.has(x.id) ? "running…" : x.status}`,
                x.content ? h("pre", {}, x.content) : null,
              ),
            ),
        )
      : h("p", { class: "chat-small" }, "No calls yet. Ask the model something this tool can do."),
  );
}

// ── the host's tool timeout, drawn as the running row's background filling up ──

/** A running call's row carries when the host's timer was armed and when it fires (clock time). */
function timeoutAttrs(status: string, card: { armedAt?: number; deadline?: number }): Record<string, string> {
  if (status !== "running" || card.armedAt === undefined || card.deadline === undefined) return {};
  return { "data-armed": String(card.armedAt), "data-deadline": String(card.deadline) };
}

/** Every frame: how far each running row is towards its timeout (paused clock, frozen fill). */
function drawTimeouts(): void {
  const now = clock?.now() ?? 0;
  for (const el of document.querySelectorAll<HTMLElement>("[data-deadline]")) {
    const armed = Number(el.dataset.armed);
    const deadline = Number(el.dataset.deadline);
    const f = Math.min(1, Math.max(0, (now - armed) / (deadline - armed)));
    el.style.setProperty("--timeout", f.toFixed(4));
    el.toggleAttribute("data-late", f > 0.75);
    el.title = `times out in ${Math.max(0, Math.ceil((deadline - now) / 1000))} s (simulated time)`;
  }
  requestAnimationFrame(drawTimeouts);
}
requestAnimationFrame(drawTimeouts);

function renderTranscript(el: HTMLElement, view: ConversationView): void {
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.replaceChildren(...view.items.map(item));
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function item(i: Item): HTMLElement {
  switch (i.type) {
    case "user":
      return h(
        "li",
        { class: "msg user", "data-steer": i.steer },
        h("span", { class: "who" }, i.steer ? `${i.author} (steer)` : i.author),
        h("span", { class: "text" }, i.text),
      );
    case "assistant":
      return h(
        "li",
        { class: "msg assistant", "data-status": i.status },
        h("span", { class: "who" }, i.status === "discarded" ? `model (dropped: ${i.note ?? ""})` : "model"),
        ...i.blocks.map((b) =>
          b.kind === "tool_use"
            ? h("span", { class: "call" }, "calls ", h("code", {}, b.name ?? "?"), h("code", { class: "json" }, b.json ?? ""))
            : h("span", { class: `text ${b.kind}` }, b.text),
        ),
        i.status === "streaming" ? h("span", { class: "cursor", "aria-hidden": "true" }, "▍") : null,
      );
    case "tools":
      return h(
        "li",
        { class: "msg tools" },
        h("span", { class: "who" }, i.calls.length > 1 ? `${i.calls.length} tool calls, in parallel` : "1 tool call"),
        h(
          "ul",
          {},
          ...i.calls.map((c) =>
            h(
              "li",
              { "data-status": c.status, ...timeoutAttrs(c.status, i) },
              h("code", {}, c.name),
              ` on ${c.provider ? (system.clients.get(c.provider)?.name ?? c.provider) : "nobody"}: ${c.status}`,
              c.content ? h("pre", {}, c.content) : null,
            ),
          ),
        ),
      );
    default:
      return h("li", { class: "msg notice", "data-level": i.level }, i.text);
  }
}

// ── inspector: explorer + timeline ─────────────────────────────────────────

function syncSessionPicker(): void {
  const current = sessionPicker.value || "host";
  const options: [string, string][] = [
    ["host", "Host"],
    ...[...system.clients.values()].map((c): [string, string] => [c.id, c.name]),
    ["workspace", "Workspace (downloads)"],
  ];
  if (system.director) options.push(["scenario", "Scenario"]);
  sessionPicker.replaceChildren(...options.map(([v, label]) => h("option", { value: v, selected: v === current }, label)));
  if (!options.some(([v]) => v === current)) inspect("host");
}

function inspect(which: string): void {
  let session: SCXMLSession;
  let processors: IOProcessor[];
  if (which === "host") {
    session = system.host;
    processors = [system.bus, system.log];
  } else if (which === "workspace") {
    // one package.scxml machine per download: its System view lists them
    session = system.workspace;
    processors = [system.workspaceLink];
  } else if (which === "scenario" && system.director) {
    session = system.director;
    processors = [];
  } else {
    const c = system.clients.get(which);
    if (!c) {
      inspect("host");
      return;
    }
    session = c.session;
    processors = [system.bus, c.runtime];
  }
  sessionPicker.value = which;
  explorer.attach({ session, processors, clock });
}

const GLOSS: Record<string, (r: BusRecord) => string> = {
  "client.hello": () => "joins and asks for roles",
  welcome: () => "is admitted",
  snapshot: () => "gets everything so far",
  "client.resync": () => "missed something, asks for a snapshot",
  "client.bye": () => "leaves",
  "input.submit": () => "sends a message",
  "input.steer": () => "steers",
  "input.interrupt": () => "asks to stop",
  "input.accepted": (r) => {
    const d = r.data as { queued: boolean; steer?: boolean };
    return d.steer ? "steer held for the next boundary" : d.queued ? "message held until the turn ends" : "message starts a turn";
  },
  "input.rejected": (r) => {
    const d = r.data as { code: string; reason: string };
    return d.code === "busy" ? "busy: another message got there first; back to the head of its queue" : `refused: ${d.reason}`;
  },
  "host.busy": () => "a turn started: new messages wait in their queues",
  "host.idle": (r) => {
    const by = (r.data as { stoppedBy: string | null }).stoppedBy;
    return by ? `idle (stopped by ${system.clients.get(by)?.name ?? by}): queues may send` : "idle: the next queued message may go";
  },
  "tool.call": (r) => `run ${(r.data as { name: string }).name}`,
  "tool.cancel": () => "cancel that call",
  "tool.result": (r) => ((r.data as { isError: boolean }).isError ? "tool failed" : "tool result"),
  "roles.changed": (r) => `roles now: ${(r.data as { granted: string[] }).granted.join(", ") || "none"}`,
  "log.batch": (r) => {
    const b = r.data as { first: number; last: number };
    return `log entries ${b.first}–${b.last}`;
  },
};

const showBatches = $<HTMLInputElement>("#chat-batches");
function onBus(r: BusRecord): void {
  if (r.event === "log.batch" && !showBatches.checked) return;
  if (r.from === "ui") return; // the panel's own clicks: the next message shows their effect
  const who = (a: string) => (a === "host" ? "Host" : (system.clients.get(a)?.name ?? a));
  addTimeline(
    h(
      "li",
      { "data-dropped": r.dropped ?? false },
      h("span", { class: "tl-at" }, at(r.at)),
      h("span", { class: "tl-route" }, `${who(r.from)} → ${who(r.to)}`),
      h("code", {}, r.event),
      h("span", { class: "tl-gloss" }, `${GLOSS[r.event]?.(r) ?? ""}${r.dropped ? ` (dropped: ${r.dropped})` : ""}`),
    ),
  );
}

function addTimeline(li: HTMLElement): void {
  const nearBottom = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 40;
  timelineEl.append(li);
  while (timelineEl.childElementCount > 400) timelineEl.firstElementChild?.remove();
  if (nearBottom) timelineEl.scrollTop = timelineEl.scrollHeight;
}

function button(label: string, onClick: () => void, opts: { disabled?: boolean } = {}): HTMLButtonElement {
  const b = h("button", { type: "button", disabled: !!opts.disabled }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

// ── playback: one clock for the whole system ───────────────────────────────

function renderPlayback(): void {
  if (!clock) return;
  const playing = clock.playing;
  if (playButton.dataset.playing !== String(playing)) {
    playButton.dataset.playing = String(playing);
    playButton.replaceChildren(icon(playing ? ICONS.Pause : ICONS.Play, 18));
    playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
    playButton.title = playing ? "Pause (the whole system)" : "Play";
  }
  for (const input of speedInputs) input.checked = Number(input.value) === clock.speed;
  if (Number(speedSelect.value) !== clock.speed) speedSelect.value = String(clock.speed);
  timeEl.textContent = `${(clock.now() / 1000).toFixed(1)} s`;
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

// ── small screens: one activity at a time ──────────────────────────────────

function showView(view: string): void {
  demoEl.dataset.view = view;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".chat-views button"))
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".chat-views button"))
  b.addEventListener("click", () => showView(b.dataset.view!));
setupEl.open = wide.matches;

// ── the bar ────────────────────────────────────────────────────────────────

const scenarioPicker = $<HTMLSelectElement>("#chat-scenario");
scenarioPicker.append(...Object.entries(SCENARIOS).map(([id, s]) => h("option", { value: id }, s.title)));
$("#chat-run").addEventListener("click", () => void boot(scenarioPicker.value || undefined));
$("#chat-reset").addEventListener("click", () => void boot());
const addPicker = $<HTMLSelectElement>("#chat-add");
addPicker.append(...Object.values(CATALOG).map((k) => h("option", { value: k.kind, title: k.blurb }, k.name)));
$("#chat-add-button").addEventListener("click", async () => {
  const c = await system.addClient(addPicker.value);
  showClient(c.id);
  if (!wide.matches) setupEl.open = false;
});
sessionPicker.addEventListener("change", () => inspect(sessionPicker.value));
showBatches.addEventListener("change", () => note(showBatches.checked ? "The timeline now shows log batches too." : "Log batches hidden."));

const initial = params.get("scenario") ?? undefined;
if (initial) scenarioPicker.value = initial;
void boot(initial);

// for the site's browser test
(window as unknown as { llmChat: () => ChatSystem }).llmChat = () => system;
