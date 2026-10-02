/**
 * The extensions this demo installs: the post's examples, trimmed to run in a browser against
 * the simulated machine. Each is a named bundle of tools, system prompt sections, hooks, wraps
 * and tasks; conversations select them by name.
 */
import { createConversation } from "./conversation.ts";
import type { Extension, ToolDef, ToolResult } from "./registry.ts";
import { Todos } from "./types.ts";

const text = (t: string, isError = false): ToolResult => ({ text: t, ...(isError ? { isError } : {}) });
const str = (v: unknown) => String(v ?? "");

// ── coding: read, write, edit, bash ─────────────────────────────────────────

const bash: ToolDef = {
  name: "bash",
  description: "Run a shell command in the conversation's working directory",
  // no replay: a command interrupted by a crash is reported to the model, never repeated
  execute: async (args, api) => {
    const { code, output } = await api.env.exec(str(args.command), (line) => api.output(`${line}\n`), api.signal);
    return text(output || "(no output)", code !== 0);
  },
};

export const Coding: Extension = {
  name: "coding",
  version: 1,
  blurb: "read, write, edit, bash (CodingTools)",
  tools: [
    {
      name: "read",
      description: "Read a file",
      replay: "safe",
      execute: async (args, api) => {
        await api.sleep(400);
        const t = api.env.read(str(args.path));
        return t === undefined ? text(`no such file: ${args.path}`, true) : text(t);
      },
    },
    {
      name: "write",
      description: "Write a file",
      execute: async (args, api) => {
        await api.sleep(300);
        api.env.write(str(args.path), str(args.content));
        return text(`wrote ${args.path}`);
      },
    },
    {
      name: "edit",
      description: "Replace text in a file",
      execute: async (args, api) => {
        await api.sleep(500);
        const before = api.env.read(str(args.path));
        if (before === undefined || !before.includes(str(args.find))) return text(`could not find the text in ${args.path}`, true);
        api.env.write(str(args.path), before.replace(str(args.find), str(args.replace)));
        return text(`edited ${args.path}`);
      },
    },
    bash,
  ],
};

// ── project-context: system prompt sections from the execution environment ──

export const ProjectContext: Extension = {
  name: "project-context",
  version: 1,
  blurb: "the agents_md section, read from the conversation's environment",
  sections: [{ key: "agents_md", render: (input) => input.env.read("AGENTS.md")?.trimEnd() }],
};

// ── ops: search_issues (safe) and deploy (not safe), in two versions ─────────

const ISSUES: Record<string, string> = {
  "flaky login": "#208 login test times out when the token is slow (open)\n#97 flaky CI on Mondays (closed)",
  "deploy failure": "#311 deploy v1.5.0 failed: migration 0042 timed out (open)",
};

function ops(version: 1 | 2): Extension {
  return {
    name: "ops",
    version,
    blurb: version === 1 ? "search_issues (safe), deploy" : "search_issues (safe), deploy with a canary",
    tools: [
      {
        name: "search_issues",
        description: "Search the issue tracker",
        replay: "safe", // only reads, so a rerun after a crash is fine
        execute: async (args, api) => {
          api.output(`searching for ${args.query}\n`); // streamed to every client watching
          await api.sleep(2500);
          return text(ISSUES[str(args.query)] ?? "no issues found");
        },
      },
      {
        name: "deploy",
        description: "Deploy a version to production",
        // no replay: a deploy interrupted by a crash is reported to the model, never repeated
        execute: async (args, api) => {
          const steps =
            version === 1
              ? [`ops@1: building ${args.version}`, "ops@1: pushing image", `ops@1: ${args.version} is live`]
              : [
                  `ops@2: building ${args.version}`,
                  "ops@2: canary at 10%",
                  "ops@2: canary healthy, 100%",
                  `ops@2: ${args.version} is live`,
                ];
          for (const step of steps) {
            await api.sleep(1500);
            api.output(`${step}\n`);
          }
          return text(steps.join("\n"));
        },
      },
    ],
  };
}
export const OpsV1 = ops(1);
export const OpsV2 = ops(2);

// ── approval: a beforeTool hook whose decision is stored in a memo ───────────

export const Approval: Extension = {
  name: "approval",
  version: 1,
  blurb: "beforeTool: a person approves every deploy (memo: approval:deploy)",
  hooks: {
    beforeTool: async (call, api) => {
      if (call.name !== "deploy") return undefined;
      // after a restart the hook finds the stored answer instead of asking again
      let approved = api.memo<boolean>("approval:deploy");
      approved ??= api.memo("approval:deploy", await api.ask(`Deploy ${call.args.version}?`));
      return approved ? undefined : { block: "Nobody approved the deploy." };
    },
  },
};

/** A second beforeTool hook, after approval in the chain: checks the change calendar (slowly). */
export const Freeze: Extension = {
  name: "freeze",
  version: 1,
  blurb: "beforeTool: no deploys during a change freeze",
  hooks: {
    beforeTool: async (call, api) => {
      if (call.name !== "deploy") return undefined;
      await api.sleep(2500); // asks the change calendar
      return String(call.args.version).endsWith("-friday") ? { block: "Change freeze: no deploys on Fridays." } : undefined;
    },
  },
};

// ── venv and timing: a tool override and a wrap ─────────────────────────────

export const Venv: Extension = {
  name: "venv",
  version: 1,
  blurb: "replaces bash with one that runs inside a Python virtualenv",
  tools: [
    {
      ...bash,
      execute: async (args, api) => {
        const { code, output } = await api.env.exec(str(args.command), (line) => api.output(`(venv) ${line}\n`), api.signal);
        return text(output ? output.replace(/^/gm, "(venv) ") : "(no output)", code !== 0);
      },
    },
  ],
};

export const Timing: Extension = {
  name: "timing",
  version: 1,
  blurb: "wraps whichever bash won, and times every call",
  wraps: [
    {
      tool: "bash",
      wrap: (inner) => ({
        ...inner,
        execute: async (args, api) => {
          const start = api.now();
          try {
            return await inner.execute(args, api);
          } finally {
            api.details({ timing: `${((api.now() - start) / 1000).toFixed(1)} s` });
          }
        },
      }),
    },
  ],
};

// ── subagents: triage, a conversation owned by the tool call ────────────────

export const Subagents: Extension = {
  name: "subagents",
  version: 1,
  blurb: "triage: a subagent in a conversation owned by the call",
  tools: [
    {
      name: "triage",
      description: "Label an incoming issue as bug, feature, or question",
      // a rerun after a crash finds the same subagent and the same submission
      replay: "safe",
      execute: async (args, api) => {
        const child = api.commit("triage.subagent", (tx) => {
          const existing = tx.conversations().find((c) => c.owner?.taskId === api.taskId);
          if (existing) return existing.id;
          // owned by this call, so aborting the call aborts the subagent; a small model without tools
          return createConversation(tx, {
            title: "triage (subagent)",
            ownership: { kind: "task", taskId: api.taskId },
            agent: { model: "sim-luna", tools: [], instructions: "Answer with one word: bug, feature, or question." },
          });
        });
        api.details({ conversationId: child }); // lets a UI show the subagent under the call
        const id = api.submit(child, { text: str(args.issue), requestId: `triage:${api.taskId}` });
        const settled = await api.waitForSubmission(id);
        if (settled.status !== "done") return text(`the subagent didn't answer (${settled.reason})`, true);
        return text(api.answerText(settled.answer!));
      },
    },
  ],
};

// ── shop: the checkout tool and its two tasks ───────────────────────────────

export const Shop: Extension = {
  name: "shop",
  version: 1,
  blurb: "checkout: tasks shop.checkout and shop.payment (failFast)",
  tools: [
    {
      name: "checkout",
      description: "Pay for the cart, split across several cards",
      execute: async (args, api) => {
        const cards = (args.cards as string[]) ?? [];
        // owned by this call: aborting the call aborts the checkout and refunds its payments
        const id = api.createTask(
          "shop.checkout",
          { cards },
          { ownership: { kind: "task", taskId: api.taskId }, label: `checkout (${cards.length} cards)` },
        );
        api.details({ taskId: id });
        const done = await api.waitForTask(id);
        const outcome = done.state.status === "terminal" ? done.state.outcome : undefined;
        return outcome?.status === "completed"
          ? text(String(outcome.result))
          : text(`${outcome?.status}: ${outcome?.error?.message ?? ""}`.trim(), true);
      },
    },
  ],
  tasks: [
    { name: "shop.checkout", version: 1, chart: "checkout", initial: () => ({ phase: "pay" }) },
    { name: "shop.payment", version: 1, chart: "payment", initial: () => ({ phase: "charge" }) },
  ],
};

// ── reminders: a background task with a timer that survives restarts ────────

export const Reminders: Extension = {
  name: "reminders",
  version: 1,
  blurb: "remind_me: a background app.reminder task",
  tools: [
    {
      name: "remind_me",
      description: "Remind the user later",
      execute: async (args, api) => {
        const until = api.now() + Number(args.inSeconds ?? 20) * 1000;
        // side work: the conversation goes idle while it runs, and Esc leaves it alone
        api.createTask(
          "app.reminder",
          { text: str(args.text), until },
          { ownership: { kind: "conversation" }, background: true, label: "reminder" },
        );
        return text(`reminder set for +${args.inSeconds ?? 20} s`);
      },
    },
  ],
  tasks: [{ name: "app.reminder", version: 1, chart: "reminder", initial: (input) => ({ phase: "sleep", until: input.until }) }],
};

// ── todo: a document, a tool that changes it, a section that shows it ───────

export const Todo: Extension = {
  name: "todo",
  version: 1,
  blurb: "the app.todos document, its tool and its section",
  tools: [
    {
      name: "todo",
      description: "Add an item to your todo list",
      execute: async (args, api) => {
        await api.sleep(300);
        api.commit("todo.add", (tx) => {
          const todos = tx.doc(Todos, api.conversationId);
          todos.items.push(str(args.item));
        });
        return text(`Added ${args.item}`);
      },
    },
  ],
  // the model sees the list before every request
  sections: [{ key: "todos", render: (input) => input.read(Todos).items.join("\n") || undefined }],
};

// ── history: handoff, and search_history over everything before it ──────────

export const History: Extension = {
  name: "history",
  version: 1,
  blurb: "handoff, search_history",
  tools: [
    {
      name: "handoff",
      description: "Start over from a handoff note. Older messages stay searchable with search_history.",
      execute: async (args, api) => {
        // queued behind the handoff, so it starts the next run in the new context
        api.submit(api.conversationId, { text: "Continue.", requestId: `handoff:${api.taskId}` });
        return { text: "Handing off.", control: { handoff: str(args.note) } };
      },
    },
    {
      name: "search_history",
      description: "Search older messages, including those before a handoff",
      replay: "safe",
      execute: async (args, api) => {
        await api.sleep(400);
        const hits = api.allEntries().filter((e) => e.text.includes(str(args.text)));
        return text(hits.map((e) => `${e.id}: ${e.text.slice(0, 80)}`).join("\n") || "nothing found");
      },
    },
  ],
};

/** What a new process installs ("the code on disk"), in install order. */
export const DEPLOYED: Extension[] = [Coding, ProjectContext, OpsV1, Approval, Freeze, Subagents, Shop, Reminders, Todo, History];
/** Everything the page can install while the process runs. */
export const CATALOG: Record<string, Extension> = {
  "ops@1": OpsV1,
  "ops@2": OpsV2,
  "venv@1": Venv,
  "timing@1": Timing,
};
