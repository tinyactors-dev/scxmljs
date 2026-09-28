/**
 * Opt-in integration with the chart's own DOM: bubbling events on the source
 * elements (`elementEvents`) and live attributes for CSS (`reflect`).
 *
 * Both are off by default: one compiled model can be shared by many sessions,
 * and their events and attributes would collide on the same elements.
 */

import type { Clock } from "./clock.ts";
import type { SCXMLEvent } from "./events.ts";
import type { Model, StateNode, TransitionNode } from "./model.ts";
import type { SCXMLSession } from "./session.ts";

/** `scxml:enter` / `scxml:exit`, dispatched on a state's source element. Bubbles, composed. */
export interface StateElementEvent extends Event {
  /** The session that entered or exited the state. */
  readonly session: SCXMLSession;
  /** The state, as a model node (its `element` is the event's target). */
  readonly state: StateNode;
  /** The SCXML event that triggered the microstep, if any. */
  readonly event?: SCXMLEvent;
}

/** `scxml:transition`, dispatched on a fired `<transition>` element. Bubbles, composed. */
export interface TransitionElementEvent extends Event {
  /** The session that took the transition. */
  readonly session: SCXMLSession;
  /** The transition, as a model node. */
  readonly transition: TransitionNode;
  /** The SCXML event that triggered it, if any (eventless transitions have none). */
  readonly event?: SCXMLEvent;
}

/** `scxml:done`, dispatched on the `<scxml>` element when the session terminates. Bubbles, composed. */
export interface ChartDoneElementEvent extends Event {
  /** The session that terminated. */
  readonly session: SCXMLSession;
  /** The top-level final state's `<donedata>`, if any. */
  readonly data: unknown;
}

/**
 * The events `elementEvents: true` dispatches on the chart's own elements.
 * Merged into the DOM's `ElementEventMap`, `DocumentEventMap` and
 * `WindowEventMap`, so `document.addEventListener("scxml:enter", …)` is typed.
 */
export interface ElementEventsMap {
  /** A state was entered (on the state's element). */
  "scxml:enter": StateElementEvent;
  /** A state was exited (on the state's element). */
  "scxml:exit": StateElementEvent;
  /** A transition fired (on the `<transition>` element). */
  "scxml:transition": TransitionElementEvent;
  /** The session terminated (on the `<scxml>` element). */
  "scxml:done": ChartDoneElementEvent;
}

declare global {
  interface ElementEventMap extends ElementEventsMap {}
  interface DocumentEventMap extends ElementEventsMap {}
  interface WindowEventMap extends ElementEventsMap {}
}

/** Options for `SessionOptions.reflect` (or pass `true` for the defaults). */
export interface ReflectOptions {
  /** How long `data-fired` stays on a transition element (session clock, ms). Default 900. */
  firedMs?: number;
}

const ATTRIBUTES = ["data-active", "data-enabled", "data-fired", "data-initial", "data-status"] as const;

/**
 * Creates the event with the element's own realm, so it can be dispatched on
 * elements from other windows (iframes, happy-dom) as well as the page's.
 */
function makeEvent<T extends Event>(target: Element, type: string, fields: Record<string, unknown>): T {
  const Ctor: typeof Event = (target.ownerDocument?.defaultView as { Event?: typeof Event } | null)?.Event ?? Event;
  const ev = new Ctor(type, { bubbles: true, composed: true });
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(ev, k, { value: v, enumerable: true });
  return ev as T;
}

export class ElementBridge {
  private readonly firedMs: number;
  private readonly timers = new Map<Element, unknown>();

  constructor(
    private readonly session: SCXMLSession,
    private readonly model: Model,
    private readonly clock: Clock,
    private readonly events: boolean,
    private readonly reflect: false | ReflectOptions,
  ) {
    this.firedMs = reflect ? (reflect.firedMs ?? 900) : 0;
  }

  /** Before the first microstep. */
  start() {
    if (!this.reflect) return;
    for (const s of this.model.states) for (const t of s.initial?.targets ?? []) t.element.setAttribute("data-initial", "");
    this.model.root.element.setAttribute("data-status", "running");
  }

  /** After each microstep, once the configuration is consistent. */
  microstep(transitions: TransitionNode[], exited: StateNode[], entered: StateNode[], event: SCXMLEvent | undefined) {
    if (this.reflect) {
      for (const s of exited) s.element.removeAttribute("data-active");
      for (const s of entered) s.element.setAttribute("data-active", "");
      this.syncEnabled();
      for (const t of transitions) if (t.element) this.fire(t.element);
    }
    if (!this.events) return;
    for (const s of exited) this.dispatch(s.element, "scxml:exit", { session: this.session, state: s, event });
    for (const t of transitions)
      if (t.element) this.dispatch(t.element, "scxml:transition", { session: this.session, transition: t, event });
    for (const s of entered) this.dispatch(s.element, "scxml:enter", { session: this.session, state: s, event });
  }

  /** The session terminated. The last configuration stays visible; nothing is enabled any more. */
  done(data: unknown) {
    if (this.reflect) {
      for (const s of this.model.states) for (const t of s.transitions) t.element?.removeAttribute("data-enabled");
      this.model.root.element.setAttribute("data-status", "done");
    }
    if (this.events) this.dispatch(this.model.root.element, "scxml:done", { session: this.session, data });
  }

  /** Remove every attribute this session set (on dispose/cancel). */
  cleanup() {
    if (!this.reflect) return;
    for (const t of this.timers.values()) this.clock.clearTimeout(t);
    this.timers.clear();
    const elements = new Set<Element>([this.model.root.element]);
    for (const s of this.model.states) {
      elements.add(s.element);
      for (const t of s.transitions) if (t.element) elements.add(t.element);
    }
    for (const el of elements) for (const a of ATTRIBUTES) el.removeAttribute(a);
  }

  private syncEnabled() {
    for (const s of this.model.states) {
      const on = this.session.isActiveNode(s);
      for (const t of s.transitions) {
        if (!t.element) continue;
        if (on) t.element.setAttribute("data-enabled", "");
        else t.element.removeAttribute("data-enabled");
      }
    }
  }

  private fire(el: Element) {
    el.setAttribute("data-fired", "");
    const prev = this.timers.get(el);
    if (prev !== undefined) this.clock.clearTimeout(prev);
    this.timers.set(
      el,
      this.clock.setTimeout(() => {
        this.timers.delete(el);
        el.removeAttribute("data-fired");
      }, this.firedMs),
    );
  }

  private dispatch(target: Element, type: keyof ElementEventsMap, fields: Record<string, unknown>) {
    try {
      target.dispatchEvent(makeEvent(target, type, fields));
    } catch (e) {
      // a host bug must never corrupt a step
      console.error(`scxml: error while dispatching ${type}:`, e);
    }
  }
}
