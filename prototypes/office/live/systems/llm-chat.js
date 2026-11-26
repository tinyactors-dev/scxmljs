// examples/llm-chat, the real system (vendor/llm-chat.js: its ChatSystem and charts), in the page:
// a host chart owns the conversation, a client chart per participant, a shared workspace, the bus,
// the chat log and the simulated model, all on the live clock. Live:
//   - at the people's hatch, each person present has buttons for a few things to say;
//   - the model is an oracle that answers only when the visitor pulls its ANSWER lever (the
//     lever lets virtual time run until the answer is written: the stream's ticks are its timers);
//   - the tools run when the visitor pulls RUN THE TOOLS on the tool machine;
//   - people and tool providers join at the door console and leave from their desk.
import { ChatSystem, charts } from "../vendor/llm-chat.js";

const KINDS = [
  { kind: "bo", label: "BO JOINS" },
  { kind: "terminal", label: "TERMINAL JOINS" },
  { kind: "python", label: "PYTHON JOINS" },
  { kind: "postgres", label: "POSTGRES JOINS" },
  { kind: "lab", label: "STATECHART LAB JOINS" },
];
const SAY = {
  ada: [["HELLO", "Hello! Who is here?"], ["FILES?", "How many files are in the workspace?"], ["2**32 IN PYTHON", "Compute 2**32 in python."]],
  bo: [["ORDERS?", "How many orders are in the database table?"], ["THANKS", "Thanks, that is all."]],
};
const PEOPLE = new Set(["ada", "bo"]);
const sources = new Map(Object.entries(charts).map(([k, v]) => [v, k]));

export default {
  title: "LLM chat",
  app: { id: "people", label: "the people at the keyboards", kind: "user" },
  externals: [
    { id: "llm", label: "the model", kind: "model" },
    { id: "tool", label: "the tools", kind: "tool" },
    { id: "log", label: "chat log", kind: "log" },
  ],
  office: { plan: { stations: ["llm", "tool", "log"] } },
  appCause: "same-tick",
  identify: (_s, info) => {
    if (typeof info.data.clientId === "string") return { id: info.data.clientId, label: String(info.data.name), role: `client (${info.data.kind})`, chart: "client", identity: info.data.clientId };
    if (info.invokeid) return { id: `package:${String(info.data.key ?? info.invokeid)}`, label: `package ${String(info.data.key ?? "")}`, chart: "package" };
    return undefined;
  },
  resolveOrigin: (alias, origin) => (alias === "bus" && origin === "host" ? "log" : alias === "bus" && origin === "ui" ? "people" : undefined),
  inputs: { only: [] }, // the people act through the system's own calls, not raw events
  async boot(ctx) {
    const engine = ctx.engine((source) => { const k = sources.get(String(source)); return k === "host" ? { id: "host", label: "host", chart: "host" } : k === "workspace" ? { id: "workspace", label: "shared workspace", chart: "workspace" } : undefined; });
    // package downloads are instant: nothing to watch there
    const packageLoader = (key, { onProgress }) => { onProgress?.({ id: key, label: key, approxBytes: 2e6, phase: "ready", cached: true, shared: false, downloadedBytes: 2e6, totalBytes: 2e6, percent: 100 }); return Promise.resolve(); };
    ctx.state.system = await ChatSystem.create({ clock: ctx.clock, engine, charts, packageLoader });
    await ctx.state.system.addClient("ada");
  },
  dispose(ctx) { try { ctx.state.system?.dispose(); } catch {} },
  controls(ctx) {
    const sys = ctx.state.system; if (!sys) return [];
    const host = sys.host;
    const live = (id) => sys.clients.get(id)?.session.isActive("live") ?? false;
    const out = [];
    // what the people say, at their hatch
    for (const [id, c] of sys.clients) if (PEOPLE.has(c.kind)) for (const [label, text] of SAY[c.kind] || [])
      out.push({ id: `say:${id}:${label}`, at: "people", console: id, title: c.name, label, color: "#3d73c4", enabled: live(id), press: () => ctx.as("people", () => sys.type(id, text)) });
    // the model answers when told to
    out.push({ id: "llm:answer", at: "llm", kind: "lever", title: "THE MODEL", label: "ANSWER", color: "#9a4fb0", enabled: host.isActive("requesting"), press: () => ctx.advanceWhile(() => host.isActive("requesting")) });
    out.push({ id: "tool:run", at: "tool", kind: "lever", title: "THE TOOLS", label: "RUN THE TOOLS", color: "#2fa3a3", enabled: host.isActive("tools"), press: () => ctx.advanceWhile(() => host.isActive("tools")) });
    // who is here: joins at the door console, leaving from one's own desk
    for (const k of KINDS) if (![...sys.clients.values()].some((c) => c.kind === k.kind))
      out.push({ id: `join:${k.kind}`, at: "people", console: "door", title: "WHO JOINS", label: k.label, color: "#3b9a5a", press: () => ctx.as("people", () => sys.addClient(k.kind)) });
    for (const [id, c] of sys.clients) {
      out.push({ id: `leave:${id}`, at: id, console: "own", title: c.name, label: "LEAVE", color: "#d8432f", press: async () => { ctx.as("people", () => sys.removeClient(id)); await ctx.advanceBy(sys.bus.latencyMs + 1); } });
      if (PEOPLE.has(c.kind)) {
        const on = sys.bus.isOnline ? sys.bus.isOnline(id) : !c.offline;
        out.push({ id: `net:${id}:${on ? "off" : "on"}`, at: id, console: "own", title: c.name, label: on ? "GO OFFLINE" : "BACK ONLINE", color: "#e2b33c", press: () => { c.offline = on; ctx.as("people", () => sys.setOnline(id, !on)); } });
      }
    }
    return out;
  },
  snapshot: (ctx) => { const sys = ctx.state.system; return sys ? { host: sys.host.activeStateIds().filter((x) => !x.startsWith("__")), clients: [...sys.clients.keys()] } : undefined; },
};
