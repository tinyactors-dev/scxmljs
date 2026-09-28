/**
 * DOM events → SCXML events: drive a statechart from ordinary page UI.
 *
 *   connect(session, button, "click", "go")                       // imperative
 *   bind(session, document, { reflectEnabled: true })             // declarative:
 *   <button data-scxml-send="go">Go</button>
 *   <form data-scxml-send="login"><input name="user"><button>Log in</button></form>
 *
 * Both return a disposer, accept `{ signal }`, and disconnect by themselves
 * when the session terminates (its `signal` aborts).
 */
import { nameMatch } from "./events.ts";
import type { SCXMLSession } from "./session.ts";

export interface ConnectOptions {
  /** Disconnect when this signal aborts. */
  signal?: AbortSignal;
  /** Listen in the capture phase. */
  capture?: boolean;
}

/** An SCXML event name, or a function choosing one per DOM event (null/undefined: send nothing). */
export type EventNameMapper = string | ((e: Event) => string | null | undefined);

/**
 * Send an SCXML event whenever `target` fires `domType` (one type or several).
 * `data` computes the event data from the DOM event.
 */
export function connect(
  session: SCXMLSession,
  target: EventTarget,
  domType: string | readonly string[],
  scxmlEvent: EventNameMapper,
  data?: (e: Event) => unknown,
  options: ConnectOptions = {},
): () => void {
  const types = typeof domType === "string" ? domType.split(/\s+/).filter(Boolean) : [...domType];
  const handler = (e: Event) => {
    let name: string | null | undefined;
    let payload: unknown;
    try {
      name = typeof scxmlEvent === "string" ? scxmlEvent : scxmlEvent(e);
      if (!name) return;
      payload = data ? data(e) : undefined;
    } catch (err) {
      console.error("scxml connect: mapping a DOM event failed", err);
      return;
    }
    session.send(name, payload);
  };
  return listen(session, options.signal, () => {
    for (const t of types) target.addEventListener(t, handler, options.capture);
    return () => {
      for (const t of types) target.removeEventListener(t, handler, options.capture);
    };
  });
}

/** Options for `bind()`. */
export interface BindOptions {
  /** Unbind when this signal aborts (the binding also ends when the session terminates). */
  signal?: AbortSignal;
  /**
   * Keep `data-scxml-enabled` on bound elements whose event some active state
   * has a transition for (conditions are ignored), so CSS can dim controls
   * that would do nothing. Updated after every macrostep.
   */
  reflectEnabled?: boolean;
  /** Extra DOM event types to listen for, beyond the built-in set and those found in `data-scxml-on` at bind time. */
  events?: readonly string[];
}

const SEND = "data-scxml-send";
const ON = "data-scxml-on";
const DATA = "data-scxml-data";
const TARGET_SESSION = "data-scxml-session";
const ENABLED = "data-scxml-enabled";
const BUILTIN_TYPES = [
  "click",
  "dblclick",
  "submit",
  "change",
  "input",
  "focusin",
  "focusout",
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "contextmenu",
];

/**
 * Declarative sends, by event delegation on `root`:
 *
 * - `data-scxml-send="name"`: send `name`. Default trigger: `click`; for a
 *   `<form>`, `submit` (default prevented; data = the form's fields);
 *   for `<input>/<select>/<textarea>`, `change` (data = `{ name, value }`,
 *   plus `checked` for checkboxes and radios).
 * - A submit button with `data-scxml-send` inside a form names the event its
 *   submission sends (data = the form's fields): one form, several actions.
 * - `data-scxml-on="dblclick keydown"`: override the trigger(s).
 * - `data-scxml-data='{"json": true}'`: static data, merged over the
 *   dynamic data (invalid JSON: nothing is sent).
 * - `data-scxml-session="<sessionId>"` on the element or an ancestor: only
 *   that session reacts. Unmarked elements inside `root` go to every session
 *   bound to `root`.
 */
export function bind(session: SCXMLSession, root: Element | Document, options: BindOptions = {}): () => void {
  const types = new Set([...BUILTIN_TYPES, ...(options.events ?? [])]);
  for (const el of Array.from(root.querySelectorAll(`[${ON}]`))) for (const t of el.getAttribute(ON)!.split(/\s+/)) if (t) types.add(t);

  const handler = (e: Event) => {
    if (e.type === "submit") return onSubmit(e);
    for (let el = isNode(e.target) ? closestElement(e.target) : null; el; el = el.parentElement) {
      if (!contains(root, el)) return;
      if (!el.hasAttribute(SEND) || !triggers(el).includes(e.type)) continue;
      if (!targetsSession(el, session)) return;
      dispatch(el, el.getAttribute(SEND)!, controlData(el));
      return;
    }
  };

  const onSubmit = (e: Event) => {
    const form = e.target as HTMLFormElement;
    if (!isElement(form) || form.localName !== "form" || !contains(root, form)) return;
    const submitter = (e as SubmitEvent).submitter ?? null;
    const source = submitter?.hasAttribute(SEND) ? submitter : form.hasAttribute(SEND) ? form : null;
    if (!source || !triggers(source).includes("submit") || !targetsSession(source, session)) return;
    e.preventDefault();
    const fields = formData(form);
    const formStatic = source !== form && form.hasAttribute(DATA) ? parseStatic(form) : undefined;
    if (formStatic === INVALID) return;
    dispatch(source, source.getAttribute(SEND)!, merge(fields, formStatic));
  };

  const dispatch = (el: Element, name: string, dynamic: unknown) => {
    if (!name) return;
    const stat = el.hasAttribute(DATA) ? parseStatic(el) : undefined;
    if (stat === INVALID) return;
    session.send(name, merge(dynamic, stat));
  };

  const reflect = () => {
    for (const el of boundElements(root, session)) {
      const name = el.getAttribute(SEND)!;
      const on = session.configuration.some((s) => s.transitions.some((t) => t.events.length > 0 && nameMatch(t.events, name)));
      if (on) el.setAttribute(ENABLED, "");
      else el.removeAttribute(ENABLED);
    }
  };

  return listen(session, options.signal, () => {
    for (const t of types) root.addEventListener(t, handler, true);
    if (options.reflectEnabled) {
      session.addEventListener("macrostep", reflect);
      reflect();
    }
    return () => {
      for (const t of types) root.removeEventListener(t, handler, true);
      if (options.reflectEnabled) {
        session.removeEventListener("macrostep", reflect);
        for (const el of boundElements(root, session)) el.removeAttribute(ENABLED);
      }
    };
  });
}

// ─────────────────────────────── helpers ───────────────────────────────

/** Runs `attach`; the returned teardown runs once, on dispose, on `signal` abort, or when the session terminates. */
function listen(session: SCXMLSession, signal: AbortSignal | undefined, attach: () => () => void): () => void {
  if (signal?.aborted || session.signal.aborted) return () => {};
  const detach = attach();
  let done = false;
  const dispose = () => {
    if (done) return;
    done = true;
    detach();
    signal?.removeEventListener("abort", dispose);
    session.signal.removeEventListener("abort", dispose);
  };
  signal?.addEventListener("abort", dispose);
  session.signal.addEventListener("abort", dispose);
  return dispose;
}

function triggers(el: Element): string[] {
  const explicit = el.getAttribute(ON);
  if (explicit != null) return explicit.split(/\s+/).filter(Boolean);
  if (el.localName === "form") return ["submit"];
  if (isSubmitButton(el) && (el as HTMLButtonElement).form) return ["submit"];
  if (el.localName === "input" || el.localName === "select" || el.localName === "textarea") return ["change"];
  return ["click"];
}

function isSubmitButton(el: Element) {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return (
    (el.localName === "button" && (type === "" || type === "submit")) ||
    (el.localName === "input" && (type === "submit" || type === "image"))
  );
}

function targetsSession(el: Element, session: SCXMLSession) {
  const marked = el.closest(`[${TARGET_SESSION}]`);
  return !marked || marked.getAttribute(TARGET_SESSION) === session.sessionId;
}

function boundElements(root: Element | Document, session: SCXMLSession): Element[] {
  const all = Array.from(root.querySelectorAll(`[${SEND}]`));
  if (isElement(root) && root.hasAttribute(SEND)) all.unshift(root);
  return all.filter((el) => targetsSession(el, session));
}

function controlData(el: Element): unknown {
  const n = el.localName;
  if (n !== "input" && n !== "select" && n !== "textarea") return undefined;
  const control = el as HTMLInputElement;
  const out: Record<string, unknown> = { name: control.name, value: control.value };
  if (n === "input" && (control.type === "checkbox" || control.type === "radio")) out.checked = control.checked;
  return out;
}

/** The form's fields as a plain object; repeated names become arrays. */
function formData(form: HTMLFormElement): Record<string, unknown> {
  const FD: typeof FormData = (form.ownerDocument?.defaultView as { FormData?: typeof FormData } | null)?.FormData ?? FormData;
  const out: Record<string, unknown> = {};
  for (const [k, v] of new FD(form) as unknown as Iterable<[string, FormDataEntryValue]>) {
    const value = typeof v === "string" ? v : v.name;
    if (!(k in out)) out[k] = value;
    else if (Array.isArray(out[k])) (out[k] as unknown[]).push(value);
    else out[k] = [out[k], value];
  }
  return out;
}

const INVALID = Symbol("invalid");

function parseStatic(el: Element): unknown {
  try {
    return JSON.parse(el.getAttribute(DATA)!);
  } catch (err) {
    console.error(`scxml bind: invalid JSON in ${DATA} of`, el, err);
    return INVALID;
  }
}

function merge(dynamic: unknown, stat: unknown): unknown {
  if (stat === undefined) return dynamic;
  if (dynamic === undefined) return stat;
  if (isPlainObject(dynamic) && isPlainObject(stat)) return { ...dynamic, ...stat };
  return stat;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isElement(v: unknown): v is Element {
  return typeof v === "object" && v !== null && (v as Node).nodeType === 1;
}

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && typeof (v as Node).nodeType === "number";
}

function closestElement(node: Node): Element | null {
  return isElement(node) ? node : node.parentElement;
}

function contains(root: Element | Document, el: Element) {
  return root === el || root.contains(el);
}
