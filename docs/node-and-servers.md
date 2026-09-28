# Node, Bun and servers

The interpreter runs the same outside browsers: Node 22.3 or later, and Bun. (Deno hasn't been
verified yet.) Server-side charts are useful for workflows, protocol handling, and anything that
must behave the same on the server and in the page.

## What's different

**A DOMParser.** SCXML text is XML, and Node and Bun have no XML parser built in. Pass one as
`domParser`; any standards-compliant implementation works, such as
[happy-dom](https://github.com/capricorn86/happy-dom)'s or [linkedom](https://github.com/WebReflection/linkedom)'s:

<!-- doctest: check -->
```ts
import { createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const session = await createSession("<scxml xmlns='http://www.w3.org/2005/07/scxml' version='1.0'/>", {
  domParser: new DOMParser(),
});
```

Without one, `createSession()` and `parseSCXML()` throw an `SCXMLParseError` with
`code: "SCXML_NO_DOMPARSER"` and instructions. Instead of text, you can also pass an `Element`
you parsed yourself, or a compiled `Model`. Sessions keep the parser to read SCXML that arrives
at run time (for example an `<invoke>` with `<content expr>`).

**The trusted data model** runs chart code in a `node:vm` context per session. `node:vm` is *not*
a security boundary: code in the context can reach the host (see [SECURITY.md](../SECURITY.md)).
On a server, use it only for charts you wrote. The sandboxed entry point works the same as in
browsers.

**Loading `src`.** Charts that use `<script src>`, `<data src>` or `<invoke src>` need a `loader`:

<!-- doctest: check -->
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const dir = "charts";
const loader = (src: string) => readFile(join(dir, src), "utf8");
const session = await createSession(await loader("main.scxml"), { loader, domParser: new new Window().DOMParser() });
```

**The elements** can be imported on the server (for example during server-side rendering). The
import does nothing there: the elements register only where `customElements` exists.

## A session per user

Compile the chart once and create a session per user, conversation or order. This server (Bun)
drives [`login.scxml`](examples/login.scxml) over HTTP:

<!-- doctest: run files=login.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { compile, createSession, parseSCXML, type SCXMLSession } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";

const domParser = new new Window().DOMParser();
const model = await compile(parseSCXML(await readFile("login.scxml", "utf8"), domParser));
const sessions = new Map<string, SCXMLSession>();

const server = Bun.serve({
  port: 0,
  routes: {
    "/sessions/:id/events/:event": {
      POST: async (req) => {
        const { id, event } = req.params;
        let session = sessions.get(id);
        if (!session) {
          session = await createSession(model, { domParser, sessionId: id });
          sessions.set(id, session.start());
          session.addEventListener("done", () => sessions.delete(id));
        }
        session.send(event, await req.json());
        await session.settled();
        return Response.json({ states: session.activeStateIds(), data: session.snapshot() });
      },
    },
  },
});

// try it
const post = async (path: string, body: unknown) =>
  (await fetch(new URL(path, server.url), { method: "POST", body: JSON.stringify(body) })).json();
console.log(JSON.stringify(await post("/sessions/ada/events/login", { user: "ada" })));
console.log(JSON.stringify(await post("/sessions/ada/events/logout", {})));

for (const s of sessions.values()) s.dispose();
server.stop();
```

<!-- doctest: output -->
```text
{"states":["signed-in"],"data":{"user":"ada"}}
{"states":["signed-out"],"data":{"user":null}}
```

`await session.settled()` returns once the event and everything it caused internally has been
processed, so the response shows the new state. Delayed `<send>`s and replies from services
don't count; the session is settled while it waits for them.

Things to plan for:

- **Memory.** A session costs from about 100 KB (small chart) to a few MB (large system); see
  [measurements](measurements.md). Dispose sessions you no longer need.
- **Persistence.** Sessions live in memory. `session.snapshot()` returns the data model, but not
  the active states, pending timers or invoked children, and there is no way to restore a session
  from it. To survive restarts, store the events you sent, with their times, and replay them
  into a new session driven by a `VirtualClock`. That only works if your I/O processors and
  invokers can replay their side too.
- **Timers.** Delayed `<send>`s use the session's clock: real time by default. They're lost when
  the process exits.
- **Isolation.** With the sandboxed entry point, one session's chart code can't see another's, and
  a runaway script is interrupted after `scriptTimeoutMs`. See [SECURITY.md](../SECURITY.md) for
  what that does and doesn't protect against.
