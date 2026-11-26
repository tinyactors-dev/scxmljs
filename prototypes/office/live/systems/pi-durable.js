// examples/pi-durable, the real system (vendor/pi-durable.js), in the page: a harness process runs
// one chart per durable task (generation, tool, compaction, checkout, payment, reminder) and
// checkpoints every step to storage, which survives the process. Live:
//   - at the people's hatch, Ada (and Bo, once he attaches) ask for things that start tasks;
//   - the process machine has LET IT WORK (virtual time runs while a task or a turn is busy),
//     the red KILL PROCESS switch and START PROCESS, which resumes every task from its checkpoint;
//   - everything else waits for ADVANCE TIME.
import { charts, DurableSystem } from "../vendor/pi-durable.js";

const SAY = {
  you: [["REMIND ME", "Remind me to stretch"], ["WHAT'S IN THE REPO?", "What's in the repo?"], ["WHY SLOW?", "Why is checkout slow?"], ["DURABILITY?", "Tell me about durability"]],
  bo: [["CHECKOUT 3 CARDS", "Checkout with visa-4242, amex-0005 and mc-0009"], ["CHECKOUT 2 CARDS", "Checkout with visa-4242 and amex-0005"]],
};
const slug = (s) => String(s).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
const fileOf = new Map(Object.entries(charts).map(([k, v]) => [(/<scxml[^>]*\bname="([^"]*)"/.exec(v)?.[1] ?? k).split(" · ")[0], k]));

const paused = (ctx) => [...ctx.sessions()].some(([id, s]) => id.startsWith("harness") && s.isActive("paused"));

export default {
  title: "Pi durable",
  app: { id: "people", label: "the people at the keyboards", kind: "user" },
  externals: [
    { id: "process", label: "the harness process", kind: "app" },
    { id: "durable", label: "durable storage", kind: "storage" },
  ],
  office: { plan: { stations: ["process", "durable"] } },
  appCause: "same-tick",
  identify(_s, info) {
    const base = info.name.split(" · ")[0];
    const chart = fileOf.get(base) || base;
    const p = this.process || 1;
    if (base === "harness") return { id: "harness", label: `harness (process ${p})`, identity: "harness", chart };
    if (base === "client") return { id: String(info.data.clientId), label: String(info.data.name), identity: `client ${info.data.clientId}`, chart };
    const task = info.data.task;
    if (task?.id) return { id: `${task.id}-${slug(task.label ?? task.kind ?? "")}`, label: `${task.kind} ${task.id}`, identity: `task ${task.id}`, chart };
    return undefined;
  },
  resolveOrigin: (alias, origin) => (alias === "wire" && origin === "harness" ? "process" : alias === "wire" && origin === "ui" ? "people" : undefined),
  inputs: { only: [] },
  async boot(ctx) {
    this.process = 1;
    const sys = await DurableSystem.create({ clock: ctx.clock, engine: ctx.engine(), charts, settings: { compaction: { contextWindow: 900, reserveTokens: 150, backgroundTokens: 300, keepRecentTokens: 150 } } });
    ctx.state.sys = sys;
    await sys.addClient("you", "Ada");
    // the process opens its storage and attaches Ada: that start-up is not the visitor's to wait for
    await ctx.advanceWhile(() => !(sys.clients.get("you")?.session.isActive("live")) || paused(ctx), 200);
  },
  dispose(ctx) { try { ctx.state.sys?.dispose(); } catch {} },
  controls(ctx) {
    const sys = ctx.state.sys; if (!sys) return [];
    const def = this;
    const alive = !!sys.harness && !sys.harness.dead;
    const tasks = () => [...sys.storage.tasks.values()];
    // busy: a turn is running in the conversation, or a task (but a reminder's long wait) is not done
    const turn = () => { try { return !!sys.storage.doc({ kind: "pi.live", fork: "initial", initial: () => ({}) }, "c1").run; } catch { return false; } };
    const working = () => !!sys.harness && !sys.harness.dead && (turn() || tasks().some((t) => t.state.status !== "terminal" && t.kind !== "app.reminder"));
    const out = [];
    for (const [id, c] of sys.clients) for (const [label, text] of SAY[id] || [])
      out.push({ id: `say:${id}:${label}`, at: "people", console: id, title: c.name, label, color: "#3d73c4", enabled: alive && c.session.isActive("live"), press: () => ctx.as("people", () => sys.type(id, text)) });
    if (!sys.clients.has("bo")) out.push({ id: "join:bo", at: "people", console: "door", title: "WHO JOINS", label: "BO ATTACHES", color: "#3b9a5a", press: async () => { await ctx.as("people", () => sys.addClient("bo", "Bo")); await ctx.advanceWhile(() => !sys.clients.get("bo")?.session.isActive("live"), 100); } });
    out.push({ id: "process:work", at: "process", console: "process", title: alive ? "THE PROCESS" : "PROCESS DEAD", label: "LET IT WORK", kind: "lever", color: "#3b9a5a", enabled: alive && ctx.clock.nextTimerAt !== undefined, press: () => { let started = false, k = 0; return ctx.advanceWhile(() => { const w = working(); if (w) started = true; return w || (!started && k++ < 60); }, 800); } });
    out.push({ id: `process:kill:${alive}`, at: "process", console: "process", title: alive ? "THE PROCESS" : "PROCESS DEAD", label: alive ? "KILL PROCESS" : "START PROCESS", kind: "lever", color: alive ? "#d8432f" : "#3b9a5a", on: !alive, enabled: true,
      press: async () => {
        if (alive) { sys.kill(); return; }
        def.process = (def.process || 1) + 1;
        await sys.start();
        await ctx.advanceWhile(() => !(sys.clients.get("you")?.session.isActive("live")) || paused(ctx), 200);
      } });
    return out;
  },
  snapshot: (ctx) => { const sys = ctx.state.sys; return sys ? { alive: !!sys.harness && !sys.harness.dead, tasks: [...sys.storage.tasks.values()].map((t) => `${t.kind}:${t.state.status}`) } : undefined; },
};
