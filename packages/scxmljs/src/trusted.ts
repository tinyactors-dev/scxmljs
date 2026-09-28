/**
 * @tinyactors/scxmljs/trusted — the same interpreter with the TRUSTED data
 * model: ECMAScript runs in the host's own engine (a hidden iframe realm in
 * browsers, a node:vm context in Node/Bun), so there is no WebAssembly to
 * download. Semantics are identical (it passes the same conformance suite),
 * but the chart is not isolated from the page and a runaway script can't be
 * interrupted — only use it for charts you trust.
 *
 * @packageDocumentation
 */
import { trustedDataModel } from "./datamodel-trusted.ts";
import type { Model } from "./model.ts";
import { resolveModel, SCXMLSession, type SessionOptions } from "./session.ts";

export * from "./common.ts";

/** A session with the trusted data model. Construction is synchronous. */
export class Session extends SCXMLSession {
  constructor(model: Model, opts: SessionOptions = {}) {
    super(model, { datamodel: trustedDataModel, ...opts });
  }
}

/**
 * Compile the document and create a session. The session is not started:
 * call `start()`. Call `dispose()` when you are done with it.
 *
 * `source` is SCXML text, an `<scxml>` element or a model from `compile()`.
 * Parsing text outside browsers needs `opts.domParser`.
 */
export async function createSession(source: string | Element | Model, opts: SessionOptions = {}): Promise<Session> {
  return new Session(await resolveModel(source, opts), opts);
}
