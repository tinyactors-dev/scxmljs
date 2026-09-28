/**
 * @tinyactors/scxmljs — a correctness-first SCXML 1.0 interpreter for the
 * ECMAScript data model, running directly on DOM elements.
 *
 * This entry point uses the SANDBOXED data model: every session evaluates its
 * ECMAScript in its own QuickJS (WebAssembly) context. Use it for charts that
 * users author. For charts you trust and a smaller download, import
 * `@tinyactors/scxmljs/trusted` instead — same API.
 *
 * @packageDocumentation
 */
import { loadQuickJS, sandboxedDataModel } from "./datamodel-quickjs.ts";
import type { Model } from "./model.ts";
import { resolveModel, SCXMLSession, type SessionOptions } from "./session.ts";

export * from "./common.ts";
export { loadQuickJS };

/**
 * A session with the sandboxed data model (QuickJS/WebAssembly).
 *
 * Constructing one directly requires QuickJS to be loaded: `await loadQuickJS()`
 * once first (`createSession` does it for you). Use this to create many
 * sessions synchronously from one compiled model.
 */
export class Session extends SCXMLSession {
  constructor(model: Model, opts: SessionOptions = {}) {
    super(model, { datamodel: sandboxedDataModel, ...opts });
  }
}

/**
 * Load QuickJS (once), compile the document and create a session. The session
 * is not started: call `start()`. Call `dispose()` when you are done with it.
 *
 * `source` is SCXML text, an `<scxml>` element or a model from `compile()`.
 * Parsing text outside browsers needs `opts.domParser`.
 */
export async function createSession(source: string | Element | Model, opts: SessionOptions = {}): Promise<Session> {
  await loadQuickJS();
  return new Session(await resolveModel(source, opts), opts);
}
