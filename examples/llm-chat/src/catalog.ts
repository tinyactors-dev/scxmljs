/**
 * The kinds of client the page can add (PROTOCOL.md §7). The page starts with Ada.
 */
import type { Clock } from "@tinyactors/scxmljs";
import type { Role, ToolDef } from "./protocol.ts";
import type { ToolEntry } from "./tools/runtime.ts";
import { HumanDesk, runStatechart, simulatedPython, simulatedShell, simulatedSql } from "./tools/simulated.ts";

export interface ClientKind {
  kind: string;
  name: string;
  /** One line for the "+ add client" menu. */
  blurb: string;
  wants: Role[];
  tools: ToolDef[];
  /** Simulated latency per call, in ms (a knob in the panel). */
  latencyMs: number;
  /** Implementations by tool name; `desk` is the person's question inbox, when there is one. */
  implement(clock: Clock): { tools: Record<string, ToolEntry>; desk?: HumanDesk };
}

const text = (description: string) => ({ type: "string", description });

export const CATALOG: Record<string, ClientKind> = {
  ada: {
    kind: "ada",
    latencyMs: 0,
    name: "Ada",
    blurb: "A person: types, steers, stops, and answers questions the model asks her.",
    wants: ["input", "control", "tools"],
    tools: [
      {
        name: "ask_ada",
        description: "Ask Ada, a person in this conversation, a question and wait for her answer. Use it for decisions only she can make.",
        input_schema: { type: "object", properties: { question: text("The question, in one or two sentences") }, required: ["question"] },
      },
    ],
    implement() {
      const desk = new HumanDesk();
      return { tools: { ask_ada: { simulated: desk.ask } }, desk };
    },
  },
  bo: {
    kind: "bo",
    latencyMs: 0,
    name: "Bo",
    blurb: "A person who may type, but not steer or stop.",
    wants: ["input"],
    tools: [],
    implement: () => ({ tools: {} }),
  },
  terminal: {
    kind: "terminal",
    latencyMs: 400,
    name: "Terminal",
    blurb:
      "A bash shell with a small /workspace: simulated, or real (bash + coreutils in WebAssembly, ≈ 15 MB; the same /workspace as Python and psql).",
    wants: ["tools"],
    tools: [
      {
        name: "shell",
        description:
          "Run a shell command in /workspace (bash and coreutils) and return its output. When the other tools run for real, /workspace is shared with them: files written here are visible to the python and sql tools, and `python` and `psql` work here too once they are loaded.",
        input_schema: { type: "object", properties: { command: text("The command line") }, required: ["command"] },
      },
    ],
    implement: () => ({
      tools: { shell: { simulated: simulatedShell(), real: () => import("./tools/wasm.ts").then((m) => m.shellTool) } },
    }),
  },
  python: {
    kind: "python",
    latencyMs: 1500,
    name: "Python",
    blurb:
      "A Python interpreter: simulated (print() of integer arithmetic), or real (Python 3.13 in WebAssembly, ≈ 62 MB, with its own bash; files shared with the Terminal).",
    wants: ["tools"],
    tools: [
      {
        name: "python",
        description:
          "Run Python 3 code in /workspace and return what it prints. Files there can be read and written; when the shell tool runs for real it sees the same files.",
        input_schema: { type: "object", properties: { code: text("The program") }, required: ["code"] },
      },
    ],
    implement: () => ({
      tools: { python: { simulated: simulatedPython, real: () => import("./tools/wasm.ts").then((m) => m.pythonTool) } },
    }),
  },
  postgres: {
    kind: "postgres",
    latencyMs: 900,
    name: "Postgres",
    blurb:
      "A PostgreSQL database with an orders table: simulated (a few queries), or real (PGlite + psql in WebAssembly, ≈ 78 MB; psql can \\copy to and from /workspace).",
    wants: ["tools"],
    tools: [
      {
        name: "sql",
        description:
          "Run one SQL statement (or a psql command such as \\copy) against a PostgreSQL database with an `orders(id, status, total)` table. psql runs in /workspace, so \\copy can read and write files there.",
        input_schema: { type: "object", properties: { query: text("One SQL statement") }, required: ["query"] },
      },
    ],
    implement: () => ({
      tools: { sql: { simulated: simulatedSql, real: () => import("./tools/wasm.ts").then((m) => m.sqlTool) } },
    }),
  },
  lab: {
    kind: "lab",
    latencyMs: 300,
    name: "Statechart Lab",
    blurb: "Runs SCXML statecharts the model writes, in a sandbox, and reports where they end up.",
    wants: ["tools"],
    tools: [
      {
        name: "run_statechart",
        description:
          "Run an SCXML statechart (ECMAScript data model) in a sandbox, send it events in order, and report the active states after each.",
        input_schema: {
          type: "object",
          properties: {
            scxml: text("The whole <scxml> document"),
            events: { type: "array", items: { type: "string" }, description: "Event names to send, in order" },
          },
          required: ["scxml"],
        },
      },
    ],
    implement: () => ({ tools: { run_statechart: { simulated: runStatechart } } }),
  },
  viewer: {
    kind: "viewer",
    latencyMs: 0,
    name: "Viewer",
    blurb: "Watches the conversation; can't type.",
    wants: [],
    tools: [],
    implement: () => ({ tools: {} }),
  },
};
