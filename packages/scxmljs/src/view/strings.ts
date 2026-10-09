/**
 * Every user-visible string of `<scxml-view>`, with English defaults.
 *
 * Hosts translate by setting a partial override:
 *
 *   view.strings = { expand: "Aufklappen", statesInside: (n) => `${n} Zustände` };
 *
 * Keys that interpolate values or counts are functions, so a translation
 * controls word order and plural forms.
 */

/** The kinds of state the view names. */
export type ViewStateKind = "atomic" | "compound" | "parallel" | "final" | "history";

/** Every user-visible string of `<scxml-view>`. Set `view.strings` to a partial object to translate. */
export interface ViewStrings {
  /** Accessible name of the diagram. */
  diagramLabel: (chart: string) => string;
  /** Accessible name of a state box (`kind` is the translated kind name from `kinds`). */
  /** Accessible name of a state box; `reached`: where a terminated session ended. */
  stateLabel: (name: string, kind: string, active: boolean, reached?: boolean) => string;
  /** Kind names, as used in accessible names. */
  kinds: Record<ViewStateKind, string>;
  /** Accessible name of a transition button. */
  transitionLabel: (events: string, targets: string) => string;
  /** Tooltip of a transition whose source isn't active (its event would do nothing now). */
  transitionInactive: string;
  /** Label of an eventless transition. */
  eventless: string;
  /** More internal transitions than a box shows. */
  moreInternal: (n: number) => string;
  /** Badge on a folded container. */
  statesInside: (n: number) => string;
  /** Button that unfolds a folded container. */
  expand: string;
  /** Button that folds an expanded container again. */
  collapse: string;
  /** Accessible name of the help button on a state (`name` is the state's id or kind). */
  helpLabel: (name: string) => string;
  /** The help popover of a state with no description (no comments in the source, none set with `descriptions`). */
  noDescription: string;
  /** Heading of the list of a state's transitions in its help popover. */
  helpTransitions: string;
  /** Button that zooms in. */
  zoomIn: string;
  /** Button that zooms out. */
  zoomOut: string;
  /** Button that goes back to the automatic size (fitted to the element's width). */
  zoomReset: string;
  /** The zoom level readout, e.g. "80%"; it's a button that sets 100%. */
  zoomLevel: (percent: number) => string;
  /** Tooltip of the zoom readout. */
  zoomActual: string;
  /** Accessible name of the zoom toolbar (mentions the shortcuts). */
  zoomToolbar: string;
  /** Notice when a large chart was folded to fit `max-states`. */
  foldedNotice: (hiddenStates: number, groups: number) => string;
  /** Button in the folded-chart notice that unfolds everything. */
  expandAll: string;
  /** Shown while the chart source is fetched and compiled. */
  loading: string;
  /** No src and no inline source. */
  noSource: string;
  /** Heading of the error panel. */
  errorTitle: string;
  /** The machine reached a top-level final state (or was cancelled). */
  terminated: string;
  /** Summary of the authoring-warnings list (`model.warnings`). */
  warningsSummary: (n: number) => string;
  /** Tooltip of a warning that focuses its state when clicked. */
  showWarningState: string;
  // playback (with a PlaybackClock)
  /** Play button (while paused). */
  play: string;
  /** Pause button (while playing). */
  pause: string;
  /** Tooltip of the play/pause button (mentions the Space shortcut). */
  playHint: string;
  /** Step button. */
  step: string;
  /** Tooltip of the step button (mentions the `.` shortcut). */
  stepHint: string;
  /** Accessible name of the speed buttons. */
  speedLabel: string;
  /** The virtual time readout. */
  clockTime: (time: string) => string;
  // live region
  /** Live-region text for a step: the triggering event (if any) and the entered states. */
  announceStep: (event: string | undefined, entered: string[]) => string;
  /** Live-region text when a label sends an event. */
  announceSent: (name: string) => string;
  /** A clicked event took no transition. */
  sentNothing: (name: string) => string;
  /** Evaluating a clicked event raised an error (e.g. a condition that throws). */
  sentError: (name: string, message: string) => string;
}

const plural = new Intl.PluralRules("en");

/** The English defaults of `ViewStrings`; unset keys of `view.strings` fall back to these. */
export const defaultViewStrings: ViewStrings = {
  diagramLabel: (chart) => `Statechart ${chart}`,
  stateLabel: (name, kind, active, reached) => `${name}, ${kind}${active ? ", active" : reached ? ", reached" : ""}`,
  kinds: {
    atomic: "state",
    compound: "compound state",
    parallel: "parallel state",
    final: "final state",
    history: "history",
  },
  transitionLabel: (events, targets) => `${events}${targets ? ` → ${targets}` : ""}`,
  transitionInactive: "Not accepted in the current state",
  eventless: "ε",
  moreInternal: (n) => `+${n} more`,
  statesInside: (n) => `${n} ${plural.select(n) === "one" ? "state" : "states"}`,
  expand: "Expand",
  collapse: "Collapse",
  helpLabel: (name) => `About ${name}`,
  noDescription: "No description: document a state with an XML comment right before it, or set the view's descriptions property.",
  helpTransitions: "Transitions",
  zoomIn: "Zoom in (+)",
  zoomOut: "Zoom out (−)",
  zoomReset: "Fit to width (0)",
  zoomLevel: (p) => `${p}%`,
  zoomActual: "Actual size",
  zoomToolbar: "Zoom: Ctrl or ⌘ + scroll wheel, pinch, or + and −; drag to pan",
  foldedNotice: (hidden, groups) =>
    `Large chart: ${hidden} ${plural.select(hidden) === "one" ? "state is" : "states are"} folded into ${groups} ${plural.select(groups) === "one" ? "group" : "groups"}. Expand a group to see inside, or explore the chart level by level with <scxml-explorer>.`,
  expandAll: "Expand all",
  loading: "Loading chart…",
  noSource: 'No SCXML to show: set the src attribute, add an inline <script type="application/scxml+xml">, or set the session property.',
  errorTitle: "This chart can't be shown",
  terminated: "The machine has terminated.",
  warningsSummary: (n) => `⚠ ${n} ${plural.select(n) === "one" ? "warning" : "warnings"} about this chart`,
  showWarningState: "Show the state",
  play: "▶ Play",
  pause: "⏸ Pause",
  playHint: "Play / pause (Space)",
  step: "Step ⏭",
  stepHint: "Run until the next step (.)",
  speedLabel: "Speed",
  clockTime: (t) => `t = ${t}`,
  announceStep: (event, entered) => `${event ?? "Started"}: ${entered.length ? `now in ${entered.join(", ")}` : "no change"}`,
  announceSent: (name) => `Sent ${name}`,
  sentNothing: (name) => `${name} changed nothing: no active state takes it right now, or its condition was false.`,
  sentError: (name, message) => `${name} raised an error, so nothing changed: ${message}`,
};
