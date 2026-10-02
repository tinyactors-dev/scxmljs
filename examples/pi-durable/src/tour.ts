/**
 * The tour: one chapter per section of the post. Each chapter starts a fresh world (its own
 * settings and root agent), then runs its scenario chart (charts/tour/*.scxml), which drives the
 * world through the `stage` processor and captions each step with the passage it illustrates.
 */
import type { Settings } from "./harness.ts";
import type { AgentState } from "./types.ts";

export interface Chapter {
  id: string;
  /** charts/tour/<file>.scxml */
  file: string;
  title: string;
  /** CITATIONS key: the post's section. */
  cite: string;
  blurb: string;
  settings?: Partial<Settings>;
  rootAgent?: AgentState;
  /** Story focus: the side panel the chapter opens with (captions may switch it). */
  panel?: "process" | "storage";
}

export const CHAPTERS: Chapter[] = [
  {
    id: "harness",
    file: "01-harness",
    title: "What is a harness?",
    cite: "harness",
    blurb: "Storage, a conversation, an agent, tools in an environment; everything a task.",
  },
  {
    id: "anywhere",
    file: "02-anywhere",
    title: "Long runs anywhere",
    cite: "anywhere",
    blurb: "A storage backend owned by one process; an environment per conversation.",
  },
  {
    id: "crashes",
    file: "03-crashes",
    title: "Survives crashes",
    cite: "crashes",
    blurb: "job-42: two crashes; safe calls rerun, unsafe ones are reported, nothing is asked twice.",
  },
  {
    id: "conversations",
    file: "04-conversations",
    title: "Many conversations at once",
    cite: "conversations",
    blurb: "A channel and a thread forked from it, each with its own agent, both running.",
  },
  {
    id: "sections",
    file: "05-sections",
    title: "System prompt sections",
    cite: "sections",
    blurb: "A changed AGENTS.md, recorded in the transcript where it changed.",
  },
  {
    id: "tools",
    file: "06-tools",
    title: "Tools",
    cite: "tools",
    blurb: "A subagent owned by a tool call, through a crash; then an override and a wrap.",
  },
  { id: "hooks", file: "07-hooks", title: "Hooks", cite: "hooks", blurb: "A beforeTool chain; an approval kept in a memo across a crash." },
  {
    id: "tasks",
    file: "08-tasks",
    title: "Tasks",
    cite: "tasks",
    blurb: "The post's checkout: failFast, bottom-up abort, refunds. Foreground vs background.",
  },
  {
    id: "compaction",
    file: "09-compaction",
    title: "Compaction",
    cite: "compaction",
    blurb: "A tiny context window: background and manual compaction, a handoff, and a search of what came before.",
    settings: { compaction: { contextWindow: 900, reserveTokens: 150, backgroundTokens: 300, keepRecentTokens: 150 } },
  },
  {
    id: "documents",
    file: "10-documents",
    title: "Durable application state",
    cite: "documents",
    blurb: "A todo document committed with the transcript; a fork's todos as of the fork.",
  },
  {
    id: "malleable",
    file: "11-malleable",
    title: "Malleable",
    cite: "malleable",
    blurb: "Replace an extension while one of its calls runs.",
    settings: { extensions: ["coding", "project-context", "ops"] },
  },
  {
    id: "multiplayer",
    file: "12-multiplayer",
    title: "Multiplayer",
    cite: "multiplayer",
    blurb: "A late joiner gets the view, then ops; a steer, a follow-up, a rejection.",
  },
];
