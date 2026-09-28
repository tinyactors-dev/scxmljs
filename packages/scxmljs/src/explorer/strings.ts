/**
 * Every user-visible string of `<scxml-explorer>`, with English defaults.
 *
 * Hosts translate by setting a partial override:
 *
 *   explorer.strings = { follow: "Folgen", transitions: (n) => `${n} Übergänge` };
 *
 * Plain keys are strings; keys that interpolate values or counts are functions,
 * so a translation controls word order and plural forms (the English defaults
 * use `Intl.PluralRules`).
 */
import type { StepInfo } from "./viewmodel.ts";

/** The kinds of state the explorer names. */
export type StateKindName = "atomic" | "compound" | "parallel" | "final" | "history" | "scxml";

/** Every user-visible string of `<scxml-explorer>`. Set `explorer.strings` to a partial object to translate. */
export interface ExplorerStrings {
  // ── header ──
  /** Level switch: the System level. */
  levelSystem: string;
  /** Level switch: the Machine level. */
  levelMachine: string;
  /** Accessible name of the level switch. */
  levelLabel: string;
  /** Accessible name of the breadcrumb navigation. */
  breadcrumbLabel: string;
  /** Title of the "…" crumb that expands a long path. */
  showWholePath: string;
  /** The follow toggle. */
  follow: string;
  /** Tooltip of the follow toggle. */
  followHint: string;

  // ── playback ──
  /** Play button (while paused). English: "▶ Play". */
  play: string;
  /** Pause button (while playing). English: "⏸ Pause". */
  pause: string;
  /** Tooltip of the play/pause button. English: "Play / pause (Space)". */
  playHint: string;
  /** Step button. English: "Step ⏭". */
  step: string;
  /** Tooltip of the step button. English: "Run until the next step of any machine (.)". */
  stepHint: string;
  /** Accessible name of the speed buttons. English: "Speed". */
  speedLabel: string;
  /** Tooltip of the virtual time readout. English: "virtual time". */
  virtualTime: string;
  /** Virtual time display, e.g. "t = 12.4 s". */
  clockTime: (formatted: string) => string;
  /** Tasks ready to run now. */
  queued: (n: number) => string;
  /** Time until the next timer fires. */
  nextTimer: (formatted: string) => string;
  /** Nothing pending on the clock. */
  idle: string;
  /** The machine's first step (no triggering event). */
  start: string;
  /** A step in which no transition fired. */
  noTransition: string;

  // ── tree ──
  /** Heading of the tree pane. English: "States". */
  statesPane: string;
  /** Placeholder of the tree filter. English: "Find state…". */
  findState: string;
  /** Accessible name of the tree filter. English: "Filter states". */
  filterStates: string;
  /** Label of the "active states only" toggle. English: "active". */
  activeOnly: string;
  /** Accessible name of the tree. English: "States". */
  treeLabel: string;
  /** Tree count while filtering: matches of total. */
  matchesOf: (matches: number, total: number) => string;
  /** Tree empty state while filtering. English: "No state matches.". */
  noStateMatches: string;
  /** Tree empty state for a chart without states. English: "No states.". */
  noStates: string;
  /** Accessible name of a tree row's expand button. English: "Expand". */
  expand: string;
  /** Accessible name of a tree row's collapse button. English: "Collapse". */
  collapse: string;

  // ── state status (visible badges and screen-reader text) ──
  /** Badge on active states. English: "active". */
  active: string;
  /** Badge on inactive states. English: "inactive". */
  inactive: string;
  /** Badge on active states waiting on an I/O processor or invoked service. English: "waiting". */
  waiting: string;
  /** Badge on a terminated machine. English: "terminated". */
  terminated: string;
  /** Screen-reader suffix for a state on the active path that isn't active itself. */
  containsActive: string;
  /** Name of a kind of state. */
  kind: (kind: StateKindName) => string;
  /** Title of the initial-state marker. */
  initial: string;

  // ── focus ──
  /** Accessible name of the focus layout switch. English: "Layout". */
  layoutLabel: string;
  /** Focus layout switch: automatic. English: "Auto". */
  layoutAuto: string;
  /** Focus layout switch: diagram. English: "Diagram". */
  layoutDiagram: string;
  /** Focus layout switch: list. English: "List". */
  layoutList: string;
  /** Subtitle of the focus: kind, direct children, all descendants (the English default leaves the last out). */
  focusSummary: (kind: string, children: number, inside: number) => string;
  /** Link to the parent state. */
  up: (parent: string) => string;
  /** Heading of the exits ("doors" leaving the focus). English: "Leaves to". */
  leavesTo: string;
  /** Heading of the entries ("doors" into the focus). English: "Entered from". */
  enteredFrom: string;
  /** Heading of a state's authoring warnings (`model.warnings`) in its detail. */
  warningsTitle: string;
  /** Tooltip of a door. */
  transitions: (n: number) => string;
  /** Where a door's state lives. */
  inState: (container: string) => string;
  /** Which child of the focus a door leaves from. */
  fromState: (child: string) => string;
  /** Stand-in for the machine as a door's container. */
  machine: string;
  /** Collapse a list expanded with "+N more". English: "Show fewer". */
  showFewer: string;
  /** "+N more" buttons. */
  more: (n: number) => string;
  /** Drill into a card's states. */
  inside: (n: number) => string;
  /** Number of invokes in a state. */
  invokes: (n: number) => string;
  /** Tooltip for the count of transitions that stay inside a state. */
  staysInside: string;
  /** Number of events a state reacts to. */
  events: (n: number) => string;
  /** List group: children on the active path. English: "On the active path". */
  groupActivePath: string;
  /** List group: children one transition away from the active path. English: "One step away". */
  groupOneStep: string;
  /** List group: all other children. English: "Everything else". */
  groupElse: string;
  /** Count after a list group title. */
  groupCount: (title: string, n: number) => string;
  /** Title of a list row's drill-in button. */
  statesInside: (n: number) => string;
  /** More targets than shown. */
  moreTargets: (n: number) => string;
  /** Search in a large focus list. */
  findAmongStates: (n: number) => string;
  /** Show every child of a large focus list (with count). */
  showAll: (n: number) => string;
  /** Open a lane that has more states than shown. */
  openLane: (n: number) => string;
  /** Label before a list row's entry actions and invokes. English: "on entry". */
  onEntry: string;
  /** A transition without an event. English: "always". */
  eventless: string;
  /** Tooltip and screen-reader text of a transition's condition. English: "if <cond>". */
  guard: (cond: string) => string;
  /** Marks a transition taken in the last step. English: "just taken". */
  justTaken: string;
  /** Marks the state the machine was in before the last step. English: "last visited". */
  lastVisited: string;
  /** Opens the detail of a state from its expanded list row. English: "Details →". */
  openDetail: string;
  /** Accessible name of the last-step line. English: "Last step". */
  lastStep: string;

  // ── system ──
  /** Title of the System level. English: "System". */
  system: string;
  /** Subtitle of the System level. */
  systemSummary: (machines: number, services: number, messages: number) => string;
  /** Heading of the machines column. English: "Machines". */
  machines: string;
  /** Heading of the external services column. English: "External services". */
  services: string;
  /** Placeholder of the machine filter (with the number of machines). */
  findAmongMachines: (n: number) => string;
  /** How an invoked machine was started. */
  invokedAs: (invokeid: string, from?: string) => string;
  /** Machine card: the machines and services it talks to. */
  talksTo: (names: string) => string;
  /** A machine's status. */
  status: (status: "idle" | "running" | "done") => string;
  /** Tooltip of a service's traffic counts. */
  trafficHint: string;
  /** Traffic on a service card: messages to it and from it (the English default gives the total). */
  traffic: (out: number, inn: number) => string;
  /** Detail pane prompt before a service is selected. English: "Select a service or a machine.". */
  selectService: string;
  /** Heading of a service's connections. English: "Talks with". */
  talksWith: string;
  /** Heading of a service's traffic log. English: "Recent traffic". */
  recentTraffic: string;

  // ── accepted events ──
  /** Inspector switch: the accepted events, with their count. */
  accepts: (n: number) => string;
  /** Inspector switch: state detail. English: "State". */
  stateTab: string;
  /** Inspector switch: service detail. English: "Service". */
  serviceTab: string;
  /** Accessible name of the event scope switch. English: "Scope". */
  scopeLabel: string;
  /** Scope switch: events accepted inside the focus (with count). */
  scopeHere: (n: number) => string;
  /** Scope switch: also those inherited from ancestors (with count). */
  scopeInherited: (n: number) => string;
  /** Scope switch: all accepted events (with count). */
  scopeAll: (n: number) => string;
  /** Tag on events accepted by an ancestor of the focus. */
  inherited: string;
  /** Tag on events accepted outside the focus. */
  elsewhere: string;
  /** Placeholder of the event filter. English: "Find event…". */
  findEvent: string;
  /** Accessible name of the event filter. English: "Filter events". */
  filterEvents: string;
  /** Label of the event data field. English: "data". */
  eventData: string;
  /** Accessible name of the event data field. English: "Event data (JSON)". */
  eventDataLabel: string;
  /** Validation message for event data that isn't JSON. English: "invalid JSON". */
  invalidJson: string;
  /** Events empty state while filtering. English: "No accepted event matches.". */
  noEventMatches: string;
  /** Events empty state after the machine terminated. English: "The machine has terminated.". */
  machineTerminated: string;
  /** Events empty state when nothing is accepted. English: "Nothing is accepted right now.". */
  nothingAccepted: string;
  /** Group name for events without a dotted prefix. English: "(no prefix)". */
  noPrefix: string;
  /** Send button. English: "Send". */
  send: string;
  /** Accessible name / tooltip of a Send button. */
  sendEvent: (name: string) => string;
  /** Tooltip of a disabled Send button for a wildcard descriptor. English: "a wildcard can't be sent". */
  cannotSendWildcard: string;
  /** A transition without a target. */
  stays: string;
  /** Marks an internal transition. English: "(internal)". */
  internal: string;
  /** Narrow layout: link to the full list of accepted events. */
  allEvents: (n: number) => string;
  /** Accessible name of the accepted-events list. English: "Accepted events". */
  acceptedEventsLabel: string;

  // ── detail ──
  /** Detail pane: where a top-level state lives. English: "top level". */
  topLevel: string;
  /** Detail pane row label: kind. English: "kind". */
  detailKind: string;
  /** Detail pane row label: id. English: "id". */
  detailId: string;
  /** Detail pane row label: nested states. English: "states". */
  detailStates: string;
  /** Direct children and all descendants. */
  directAndInside: (direct: number, inside: number) => string;
  /** Detail pane row label: initial state. English: "initial". */
  detailInitial: string;
  /** Detail pane row label: history type. English: "history". */
  detailHistory: string;
  /** Detail pane row label: data variables. English: "data". */
  detailData: string;
  /** Focus a state from its detail pane. */
  focusState: (name: string) => string;
  /** Detail pane heading: entry and exit actions. English: "Actions". */
  actions: string;
  /** Prefix for entry actions. English: "entry". */
  entry: string;
  /** Prefix for exit actions. English: "exit". */
  exit: string;
  /** Detail pane heading: invokes. English: "Invokes". */
  invokesTitle: string;
  /** An invoke without `src` (inline content). English: "(inline)". */
  inline: string;
  /** Detail pane heading: transitions. English: "Transitions". */
  transitionsTitle: string;
  /** Transitions table column: event. English: "event". */
  columnEvent: string;
  /** Transitions table column: condition. English: "if". */
  columnIf: string;
  /** Transitions table column: target. English: "to". */
  columnTo: string;

  // ── narrow layout tabs ──
  /** Narrow layout tab: System. English: "System". */
  tabSystem: string;
  /** Narrow layout tab: tree. English: "States". */
  tabStates: string;
  /** Narrow layout tab: focus. English: "Focus". */
  tabFocus: string;
  /** Narrow layout tab: accepted events. English: "Accepts". */
  tabEvents: string;
  /** Narrow layout tab: detail. English: "Detail". */
  tabDetail: string;

  // ── live region (screen readers) ──
  /** Announced after a step: machine, event and the transitions taken. */
  announceStep: (step: StepInfo) => string;
  /** Announced when the UI sends an event. */
  announceSent: (name: string, machine: string) => string;
}

const plural = new Intl.PluralRules("en");
/** English count phrase: "1 state", "3 states". */
const count = (n: number, one: string, other: string) => `${n} ${plural.select(n) === "one" ? one : other}`;

/** The English defaults of `ExplorerStrings`; unset keys of `explorer.strings` fall back to these. */
export const defaultStrings: ExplorerStrings = {
  levelSystem: "System",
  levelMachine: "Machine",
  levelLabel: "Level",
  breadcrumbLabel: "Breadcrumb",
  showWholePath: "Show the whole path",
  follow: "Follow",
  followHint: "Keep the focus on the part of the machine that is moving",

  play: "▶ Play",
  pause: "⏸ Pause",
  playHint: "Play / pause (Space)",
  step: "Step ⏭",
  stepHint: "Run until the next step of any machine (.)",
  speedLabel: "Speed",
  virtualTime: "virtual time",
  clockTime: (t) => `t = ${t}`,
  queued: (n) => `${n} queued`,
  nextTimer: (t) => `next timer in ${t}`,
  idle: "idle",
  start: "start",
  noTransition: "no transition",

  statesPane: "States",
  findState: "Find state…",
  filterStates: "Filter states",
  activeOnly: "active",
  treeLabel: "States",
  matchesOf: (m, t) => `${m} / ${t}`,
  noStateMatches: "No state matches.",
  noStates: "No states.",
  expand: "Expand",
  collapse: "Collapse",

  active: "active",
  inactive: "inactive",
  waiting: "waiting",
  terminated: "terminated",
  containsActive: "contains active states",
  kind: (k) => k,
  initial: "initial",

  layoutLabel: "Layout",
  layoutAuto: "Auto",
  layoutDiagram: "Diagram",
  layoutList: "List",
  focusSummary: (kind, n) => `${kind} · ${count(n, "state", "states")}`,
  up: (p) => `↑ ${p}`,
  leavesTo: "Leaves to",
  enteredFrom: "Entered from",
  warningsTitle: "Warnings",
  transitions: (n) => count(n, "transition", "transitions"),
  inState: (c) => `in ${c}`,
  fromState: (c) => `from ${c}`,
  machine: "machine",
  showFewer: "Show fewer",
  more: (n) => `+${n} more`,
  inside: (n) => `${n} inside →`,
  invokes: (n) => `⇲ ${count(n, "invoke", "invokes")}`,
  staysInside: "transitions that stay inside",
  events: (n) => count(n, "event", "events"),
  groupActivePath: "On the active path",
  groupOneStep: "One step away",
  groupElse: "Everything else",
  groupCount: (title, n) => `${title} · ${n}`,
  statesInside: (n) => `${count(n, "state", "states")} inside`,
  moreTargets: (n) => `+${count(n, "target", "targets")}`,
  findAmongStates: (n) => `Find among ${count(n, "state", "states")}…`,
  showAll: (n) => `Show all ${n}`,
  openLane: (n) => `+${n} more — open lane`,
  onEntry: "on entry",
  eventless: "always",
  guard: (cond) => `if ${cond}`,
  justTaken: "just taken",
  lastVisited: "last visited",
  openDetail: "Details →",
  lastStep: "Last step",

  system: "System",
  systemSummary: (m, s, msg) =>
    `${count(m, "machine", "machines")} · ${count(s, "external service", "external services")} · ${count(msg, "message", "messages")}`,
  machines: "Machines",
  services: "External services",
  findAmongMachines: (n) => `Find among ${count(n, "machine", "machines")}…`,
  invokedAs: (id, from) => `invoked as ${id}${from ? ` from ${from}` : ""}`,
  talksTo: (names) => `talks to ${names}`,
  status: (s) => s,
  trafficHint: "requests / replies and events",
  traffic: (out, inn) => count(out + inn, "message", "messages"),
  selectService: "Select a service or a machine.",
  talksWith: "Talks with",
  recentTraffic: "Recent traffic",

  accepts: (n) => `Accepts ${n}`,
  stateTab: "State",
  serviceTab: "Service",
  scopeLabel: "Scope",
  scopeHere: (n) => `Here ${n}`,
  scopeInherited: (n) => `+ inherited ${n}`,
  scopeAll: (n) => `All ${n}`,
  inherited: "inherited",
  elsewhere: "elsewhere",
  findEvent: "Find event…",
  filterEvents: "Filter events",
  eventData: "data",
  eventDataLabel: "Event data (JSON)",
  invalidJson: "invalid JSON",
  noEventMatches: "No accepted event matches.",
  machineTerminated: "The machine has terminated.",
  nothingAccepted: "Nothing is accepted right now.",
  noPrefix: "(no prefix)",
  send: "Send",
  sendEvent: (name) => `Send ${name}`,
  cannotSendWildcard: "a wildcard can't be sent",
  stays: "stays",
  internal: "(internal)",
  allEvents: (n) => `all ${n} →`,
  acceptedEventsLabel: "Accepted events",

  topLevel: "top level",
  detailKind: "kind",
  detailId: "id",
  detailStates: "states",
  directAndInside: (d, i) => `${d} direct · ${i} inside`,
  detailInitial: "initial",
  detailHistory: "history",
  detailData: "data",
  focusState: (name) => `Focus ${name} →`,
  actions: "Actions",
  entry: "entry",
  exit: "exit",
  invokesTitle: "Invokes",
  inline: "(inline)",
  transitionsTitle: "Transitions",
  columnEvent: "event",
  columnIf: "if",
  columnTo: "to",

  tabSystem: "System",
  tabStates: "States",
  tabFocus: "Focus",
  tabEvents: "Accepts",
  tabDetail: "Detail",

  announceStep: (s) => `${s.machine}: ${s.moves.length ? s.moves.join(", ") : `${s.event ?? "start"}, no transition`}`,
  announceSent: (name, machine) => `Sent ${name} to ${machine}`,
};
