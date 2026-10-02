/**
 * The post this demo follows, "Pi Durable" (Earendil, 1 October 2026), and the passages each
 * part of the demo illustrates. Quotes are verbatim; each links to its passage with a text
 * fragment (`#:~:text=start,end`), so the browser scrolls to it and highlights it.
 */

export const POST_URL = "https://earendil.com/posts/pi-durable/";
export const POST_TITLE = "Pi Durable";
export const REPO_URL = "https://github.com/earendil-works/pi/tree/main/packages/durable";

export interface Citation {
  id: string;
  /** The post's section heading. */
  section: string;
  quotes: string[];
}

export const CITATIONS: Record<string, Citation> = {
  harness: {
    id: "harness",
    section: "What is a harness?",
    quotes: [
      "A harness is storage plus the machinery needed to run one or more conversations with large language models in parallel. It provides the tools those models call, and the execution environments the tools run in.",
      "Everything the harness runs, from calling the model to executing a tool, is a task.",
    ],
  },
  anywhere: {
    id: "anywhere",
    section: "Long runs anywhere",
    quotes: [
      "In Pi Durable, a harness opens over a storage backend.",
      "One process owns a storage at a time, and other clients attach to that process.",
      "Your env function builds the environment for every tool call, from the conversation's working directory, so each conversation can run in a different place.",
    ],
  },
  crashes: {
    id: "crashes",
    section: "Survives crashes",
    quotes: [
      "In Pi Durable, every step of a run is a task that stores a checkpoint before it moves on. If the process dies, a new process opens the same storage, finds the unfinished tasks, and continues each one from its last checkpoint.",
      "A model request that was cut off is sent again; the partial answer stays in the transcript, marked as aborted. A tool call that was cut off reruns if it is safe to; otherwise the model is told it was interrupted.",
      "Queued messages are still queued. A requestId makes a submission exactly-once, so a client that retries after a crash gets the original submission back instead of asking twice.",
    ],
  },
  conversations: {
    id: "conversations",
    section: "Many conversations at once",
    quotes: [
      "A conversation starts fresh or forks another one at any point in its transcript, and sees the parent's history up to that point without copying it.",
      "A reviewer next to the main agent can use a cheaper model, read-only tools, and its own checkout.",
    ],
  },
  sections: {
    id: "sections",
    section: "Extensions › System prompt sections",
    quotes: [
      "The system prompt is rebuilt from the sections of the conversation's extensions before every request, so a changed section is picked up by the next request. Pi Durable records what changed in the transcript, at the position where it changed, so a restart or a fork sees exactly what the model saw.",
    ],
  },
  tools: {
    id: "tools",
    section: "Extensions › Tools",
    quotes: [
      "Every tool call runs as its own durable task, and its intent is stored before it runs. After a crash, a tool reruns only if it says that is safe.",
      "A tool creates a conversation it owns, gives it a smaller model and its own instructions, and waits for its answer.",
      "A tool with the same name in a later extension replaces the earlier one, for example a bash that runs inside a Python virtualenv. A wrap decorates whichever tool won, wherever the wrapping extension is selected.",
    ],
  },
  hooks: {
    id: "hooks",
    section: "Extensions › Hooks",
    quotes: [
      "A hook can run again after a crash, so a hook that makes a decision stores it in a memo: a small value stored with the task, where the first write wins.",
      "Their hooks run as a chain, in the order the conversation selects the extensions, and each hook defines how its chain runs.",
    ],
  },
  tasks: {
    id: "tasks",
    section: "Extensions › Tasks",
    quotes: [
      "A checkout that splits the bill across several cards charges every card at once. If one card is declined, the other payments are aborted and refund themselves",
      "Tasks and conversations form one ownership tree. Aborting a task aborts what it owns, bottom-up, so every task cleans up its own effects first, and a task only finishes once the work it owns has finished.",
      "A background task belongs to the conversation, but not to its current work. The conversation goes idle while it runs, and an ordinary abort leaves it and everything it owns alone.",
    ],
  },
  compaction: {
    id: "compaction",
    section: "Compaction",
    quotes: [
      "When the context gets close to the model's limit, a background compaction summarizes the older messages, and the summary is placed at the next turn boundary. The conversation only waits for a summary when the next request would not fit otherwise.",
      "Because nothing is deleted, a second tool can still search everything before the handoff.",
    ],
  },
  documents: {
    id: "documents",
    section: "Durable application state",
    quotes: [
      "Documents are typed JSON stored next to the transcript and changed in the same atomic commits, so the state never disagrees with the transcript that produced it. Each document says what a fork starts with: the parent's value at the fork point, its current value, or a fresh one.",
    ],
  },
  malleable: {
    id: "malleable",
    section: "Malleable",
    quotes: [
      "Installing an extension under a name that is already installed replaces it in one step. A tool call that is already running finishes on the code it started with; the next call uses the new code.",
      "Conversations store extension and tool names, never code, so after a restart they pick up whatever the new process installs.",
    ],
  },
  multiplayer: {
    id: "multiplayer",
    section: "Multiplayer",
    quotes: [
      "A client gets the current view first: the transcript, the answer being streamed, running tools and their output, queued messages, the agent, and usage. After that it only gets what changes.",
      "Any client can steer a running conversation or queue a follow-up.",
    ],
  },
};

/** A link that scrolls to the quote and highlights it. */
export function quoteLink(quote: string): string {
  const words = quote.split(/\s+/);
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  if (words.length <= 10) return `${POST_URL}#:~:text=${enc(quote)}`;
  return `${POST_URL}#:~:text=${enc(words.slice(0, 6).join(" "))},${enc(words.slice(-5).join(" "))}`;
}

/** The Pi logo (https://pi.dev/logo-auto.svg; Pi is MIT-licensed). */
export const PI_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="165 165 470 470" aria-hidden="true">' +
  '<path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z"/>' +
  '<path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"/>' +
  '<path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z"/></svg>';

/** A small "external link" arrow (lucide's square-arrow-out-up-right), for a quote that is a link. */
export const EXTERNAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/></svg>';
