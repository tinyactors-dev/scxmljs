# Custom I/O processors

An *Event I/O Processor* carries `<send>` messages out of a chart and delivers events back in
(SCXML spec §6.2.4 and Appendix C). The built-in SCXML processor handles sessions talking to each
other: `#_internal`, `#_parent`, `#_<invokeid>` and `#_scxml_<sessionid>` targets. Anything else
(a server, a worker, a message bus) is a custom processor that you pass to `createSession()`.

The spec's Basic HTTP processor isn't included; the [example below](#example-http-with-fetch)
shows how to write one.

## The interface

<!-- doctest: check -->
```ts
import type { IOProcessor } from "@tinyactors/scxmljs";

const processor: IOProcessor = {
  type: "urn:example:api", // canonical type URI: the key in _ioprocessors, and _event.origintype
  aliases: ["api"], // short names allowed in <send type="…">
  location: (session) => `urn:example:api/${session.sessionId}`, // _ioprocessors[type].location
  attach(session) {}, // a session using this processor started: keep `session` to deliver events
  detach(session) {}, // it terminated or was disposed: stop delivering
  send(message, session) {}, // transport one message; throwing raises error.communication
};
```

`send()` receives an `OutboundSend`: `event`, `target`, `type` (the canonical URI), `data` (the
`<param>`/`namelist` values as an object, or the `<content>` value) and `sendid`. It runs when the
send is due, so `delay` has already passed.

`session.deliver(name, data?, origin?)` puts an event on the session's external queue. The event
arrives with `origintype` set to your `type` and `origin` set to what you pass, so the chart can
reply with `<send type="…" targetexpr="_event.origin">`.

One processor object can serve many sessions: `attach` and `detach` tell it which ones exist.
Invoked child sessions get the same processors as their parent.

## Example: a backend

`order.scxml` sends a request when it starts and waits for the answer:

<!-- doctest: scxml file=order.scxml -->
```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="order" initial="saving">
  <state id="saving">
    <onentry>
      <send type="api" target="/orders" event="order.create">
        <param name="item" expr="'tea'"/>
      </send>
    </onentry>
    <transition event="order.created" target="saved"/>
    <transition event="error.communication" target="failed"/>
  </state>
  <final id="saved">
    <donedata><param name="id" expr="_event.data.id"/></donedata>
  </final>
  <final id="failed"/>
</scxml>
```

A processor that pretends to be the backend:

<!-- doctest: run files=order.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession, type IOProcessor } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const api: IOProcessor = {
  type: "urn:example:api",
  aliases: ["api"],
  location: (session) => `urn:example:api/${session.sessionId}`,
  send(message, session) {
    console.log("request", message.target, message.event, JSON.stringify(message.data));
    if (message.event !== "order.create") throw new Error(`unknown request ${message.event}`);
    setTimeout(() => session.deliver("order.created", { id: 42 }, message.target), 10);
  },
};

const { DOMParser } = new Window();
const session = await createSession(await readFile("order.scxml", "utf8"), {
  domParser: new DOMParser(),
  ioprocessors: [api],
});
session.start();
console.log("done", JSON.stringify(await session.done));
session.dispose();
```

<!-- doctest: output -->
```text
request /orders order.create {"item":"tea"}
done {"id":42}
```

If `send()` throws, the chart gets `error.communication` and moves to `failed`. A `<send>` with a
`type` that no processor handles raises `error.execution`.

## Example: HTTP with `fetch`

A processor that POSTs the event as JSON and delivers the response as `<event>.done`, or
`error.communication` when the request fails:

<!-- doctest: check -->
```ts
import type { IOProcessor, IOSession } from "@tinyactors/scxmljs";

export function httpProcessor(base: string): IOProcessor {
  const live = new Set<IOSession>();
  return {
    type: "urn:example:http",
    aliases: ["http"],
    location: () => base,
    attach: (session) => void live.add(session),
    detach: (session) => void live.delete(session),
    send(message, session) {
      fetch(new URL(message.target, base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: message.event, data: message.data }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          if (live.has(session)) session.deliver(`${message.event}.done`, body, message.target);
        })
        .catch((error) => {
          if (live.has(session)) session.deliver("error.communication", { message: String(error) }, message.target);
        });
    },
  };
}
```

Failures that happen after `send()` returns can't raise the chart's internal `error.communication`
any more, so this processor delivers an external event with that name instead. The `live` set
stops it from delivering to sessions that have ended.

## In the explorer

Pass the same processors to `<scxml-explorer>` (`attach({ session, processors })`) to see each
one as a service at the System level, with the messages flowing to and from it. The service's
slot is named after its first alias (`service:api`).
