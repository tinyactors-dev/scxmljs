/**
 * Everything both entry points share. Import from `@tinyactors/scxmljs`
 * (sandboxed) or `@tinyactors/scxmljs/trusted` instead of this file.
 */

export { type BindOptions, bind, type ConnectOptions, connect, type EventNameMapper } from "./bridge.ts";
export { type Clock, PlaybackClock, realClock, VirtualClock } from "./clock.ts";
// Data model extension point (advanced): implement `DataModel` to plug in another engine
// via `SessionOptions.datamodel`.
export { type DataModel, DataModelError, type DataModelFactory, type DataModelOptions } from "./datamodel-base.ts";
export type { Diagnostic, DiagnosticCode } from "./diagnostics.ts";
export type {
  ChartDoneElementEvent,
  ElementEventsMap,
  ReflectOptions,
  StateElementEvent,
  TransitionElementEvent,
} from "./element-events.ts";
export { nameMatch, parseDelay, SCXML_IOPROCESSOR, SCXML_NS, type SCXMLEvent } from "./events.ts";
export type { InvokeNode, Loader, Model, StateKind, StateNode, TransitionNode } from "./model.ts";
export {
  compile,
  documentOrder,
  isAtomic,
  isCompound,
  isDescendant,
  properAncestors,
  SCXMLParseError,
  SCXMLValidationError,
  scxmlChildren,
} from "./model.ts";
export type {
  DOMParserLike,
  Invocation,
  InvokeContext,
  InvokedService,
  Invoker,
  IOProcessor,
  IOSession,
  OutboundSend,
  ParentInvocation,
  SessionOptions,
  WaitCondition,
  WaitForOptions,
} from "./session.ts";
export { parseSCXML, SCXMLSession } from "./session.ts";
export {
  ChildSessionEvent,
  DoneEvent,
  InvokeEvent,
  LogEvent,
  MacrostepEvent,
  MicrostepEvent,
  SCXMLErrorEvent,
  type SCXMLErrorKind,
  SendEvent,
  type SessionEventMap,
} from "./session-events.ts";
