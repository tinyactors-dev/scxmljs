# viz3d trace schema (data/trace.json)

One recorded run of a real statechart system (examples/llm-chat, one scenario) on a virtual clock.

```ts
interface Trace {
  system: string;            // "llm-chat"
  scenario: string;          // e.g. "queue-and-steer"
  duration: number;          // ms of virtual time covered
  charts: Record<string, { root: StateNode }>;   // keyed by chart name: host, client, workspace, package, ...
  actors: Actor[];           // running chart instances
  externals: External[];     // endpoints that are not charts: the user/stage, the bus, the chat log, the model (llm), tools, timers...
  events: TraceEvent[];      // sorted by t, stable order within equal t
}
interface StateNode {
  id: string;                               // SCXML state id (unique within a chart)
  kind: "compound" | "parallel" | "atomic" | "final" | "history";
  initial?: string[];                       // ids
  children: StateNode[];
  transitions: { event?: string; cond?: string; targets: string[] }[];  // targets = state ids, [] for targetless
  invokes?: { type: string; id?: string; src?: string }[];
}
interface Actor { id: string; chart: string; label: string; role: string; parent?: string; bornAt: number; diedAt?: number }
interface External { id: string; label: string; kind: string }
type TraceEvent =
  | { t: number; type: "spawn"; actor: string }
  | { t: number; type: "end"; actor: string }
  | { t: number; type: "config"; actor: string; active: string[] }                 // full active configuration after a step (all ancestors included)
  | { t: number; type: "transition"; actor: string; event: string; from: string[]; to: string[] }  // exited / entered state ids
  | { t: number; type: "message"; from: string; to: string; name: string; summary?: string }       // from/to are actor or external ids
  | { t: number; type: "data"; actor: string; key: string; summary: string }       // a datamodel value worth showing changed (short text)
  | { t: number; type: "caption"; text: string };                                  // plain-language narration of what the system is doing now
```

## v2 additions (round 2: static structure + datamodel). All additive; v1 fields unchanged.

```ts
interface Trace {
  // ...v1 fields...
  charts: Record<string, {
    root: StateNode;
    purpose?: string;                       // one plain sentence: what this chart is for
    datamodel?: DataDecl[];                 // every <data> of the chart (ECMAScript datamodel)
    source?: string;                        // file name, e.g. "host.scxml"
  }>;
  wiring?: Wire[];                          // STATIC communication graph, derived from the charts' <send>/<invoke> (not from the run)
}
interface DataDecl { id: string; expr?: string; type?: "number"|"string"|"boolean"|"array"|"object"|"null"|"unknown"; doc?: string; scope?: string /* state id when declared inside a state */ }
interface StateNode {
  // ...v1 fields...
  doc?: string;                             // plain-language meaning of the state (from a comment in the SCXML when present, else a short inference)
  onentry?: Action[]; onexit?: Action[];
  transitions: { event?: string; cond?: string; targets: string[]; actions?: Action[]; internal?: boolean }[];
}
type Action =
  | { type: "assign"; location: string; expr?: string }      // writes a datamodel location
  | { type: "send"; event?: string; eventexpr?: string; target?: string; targetexpr?: string; sendType?: string; delay?: string; id?: string; to?: string /* resolved actor-chart name or external id when it can be derived statically */ }
  | { type: "raise"; event: string }
  | { type: "cancel"; sendid?: string }
  | { type: "script"; code: string }
  | { type: "log"; label?: string; expr?: string }
  | { type: "if"; cond: string; then: Action[]; else?: Action[] }
  | { type: "foreach"; array: string; item: string; body: Action[] };
// reads/writes summary per chart variable, derived from conds/exprs/assigns/scripts (best-effort identifier scan):
//   charts[name].datamodel[i].readBy?: string[]  (state ids whose transitions' cond/expr mention it)
//   charts[name].datamodel[i].writtenBy?: string[] (state ids whose actions assign it)
interface Wire { from: string /* chart name or external id */; to: string; event: string; fromState?: string; count?: number /* times seen in the recorded run, 0 if never */ }
type TraceEvent =
  // ...v1...
  | { t: number; type: "data"; actor: string; key: string; summary: string; value?: unknown /* JSON value after the change, truncated: strings ≤ 200 chars, arrays ≤ 20 items, depth ≤ 3 */ }
  | { t: number; type: "snapshot"; actor: string; values: Record<string, unknown> };  // full datamodel of an actor (same truncation): at spawn and at each stable point where anything changed
```

## v3 additions (round 3: behaviours = causal paths across actors; what-if worlds). Additive.

```ts
// 1. Causality inside a trace: every event gets an id; effects point at their cause.
//    transition.cause = id of the message (or timer/spawn) whose delivery triggered it
//    message.cause    = id of the transition (or message, for externals that just reply) that sent it
//    data/snapshot.cause = id of the transition that wrote it
type TraceEvent = /* v1+v2 */ & { id: string; cause?: string };

// 2. Stories: the behaviours a newcomer would ask about, each one causal path across actors.
interface Trace {
  stories?: Story[];
  worlds?: WorldRef[];        // what-if variants of this run (separate files, same schema)
}
interface Story {
  id: string;
  question: string;           // how a newcomer would ask it: "What happens when someone sends a message?"
  answer: string;             // one or two plain sentences
  steps: StoryStep[];         // 4–9 steps, in causal order
}
interface StoryStep {
  text: string;               // plain language: "The host accepts it and starts a turn"
  actor: string;              // who acts in this step (actor or external id)
  events: string[];           // ids of the trace events that implement this step (transitions, messages, data writes)
  t0: number; t1: number;     // virtual time span
}
// 3. Worlds: the same system forked at a decision point with one thing changed.
interface WorldRef {
  id: string;                 // "model-fails", "client-offline-during-tool", "steer-while-busy", "stop", ...
  file: string;               // data/worlds/<id>.json — a full Trace (v1–v3), identical to the base run up to forkAt
  forkAt: number;             // virtual ms where it diverges from the base run
  change: string;             // plain language: "The model's reply fails with an overload error"
  outcome: string;            // plain language: "The host backs off and retries; after 4 attempts it gives up and tells everyone"
  divergesAtEvent?: string;   // id of the last shared event
}
```
