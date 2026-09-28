/**
 * @tinyactors/scxmljs/explorer — the `<scxml-explorer>` custom element and the
 * view-model behind it.
 *
 * Importing this module registers `<scxml-explorer>`. It works with sessions
 * from either entry point (`@tinyactors/scxmljs` or `…/trusted`) and never
 * pulls a data model in itself, so it adds no WebAssembly to your bundle.
 *
 *   import { createSession, PlaybackClock } from "@tinyactors/scxmljs/trusted";
 *   import "@tinyactors/scxmljs/explorer";
 *
 *   const clock = new PlaybackClock();
 *   const session = await createSession(source, { clock });
 *   document.querySelector("scxml-explorer").attach({ session, clock });
 *   session.start();
 *
 * @packageDocumentation
 */

export {
  type AnnounceMode,
  type ExplorerAttachOptions,
  type ExplorerFocusDetail,
  type ExplorerSelectDetail,
  type ExplorerSendDetail,
  ScxmlExplorer,
} from "./explorer/element.ts";
export { defaultStrings as defaultExplorerStrings, type ExplorerStrings, type StateKindName } from "./explorer/strings.ts";
export {
  type AcceptedEvent,
  type AcceptedTransition,
  acceptedEvents,
  activeExpansion,
  type ChildSummary,
  childContaining,
  type Door,
  descendantCount,
  type EventGroup,
  type EventScope,
  type FocusEdge,
  type FocusScope,
  focusScope,
  followTarget,
  groupEvents,
  isContainer,
  label,
  type MachineInfo,
  pathTo,
  type ServiceInfo,
  type StepInfo,
  type SystemLink,
  SystemTracker,
  type SystemTrackerOptions,
  sendableName,
  type TreeOptions,
  type TreeRow,
  total,
  treeRows,
  within,
  wouldAccept,
} from "./explorer/viewmodel.ts";
