# Driving charts from the page

A chart often *is* the logic of a piece of UI: a login form, a wizard, a media player. This guide
shows how page events reach the chart, and how the page follows the chart's state. You don't need
either custom element for any of it.

The examples use `login.scxml`:

<!-- doctest: scxml file=login.scxml -->
```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="login" initial="signed-out">
  <datamodel>
    <data id="user" expr="null"/>
  </datamodel>
  <state id="signed-out">
    <transition event="login" cond="_event.data.user" target="signed-in">
      <assign location="user" expr="_event.data.user"/>
    </transition>
  </state>
  <state id="signed-in">
    <transition event="logout" target="signed-out">
      <assign location="user" expr="null"/>
    </transition>
  </state>
</scxml>
```

## Sending events

`session.send(name, data?)` queues an external event. The session processes it shortly after,
not during the call; `await session.settled()` waits until it has.

<!-- doctest: check prelude=session -->
```ts
session.send("login", { user: "ada" });
await session.settled();
```

`connect()` sends an event whenever a DOM event fires:

<!-- doctest: check prelude=session -->
```ts
import { connect } from "@tinyactors/scxmljs";

const input = document.querySelector<HTMLInputElement>("#user")!;
const button = document.querySelector("#login")!;
connect(session, button, "click", "login", () => ({ user: input.value }));

// the event name can depend on the DOM event; returning nothing sends nothing
connect(session, document, "keydown", (e) => ((e as KeyboardEvent).key === "Escape" ? "logout" : undefined));
```

## Declarative: `bind()` and `data-scxml-*`

`bind(session, root)` listens on `root` (by event delegation) and sends events for marked
elements, including ones added later:

<!-- doctest: html -->
```html
<form data-scxml-send="login">
  <input name="user">
  <button>Log in</button>
</form>
<button data-scxml-send="logout">Log out</button>
```

<!-- doctest: check prelude=session -->
```ts
import { bind } from "@tinyactors/scxmljs";

const unbind = bind(session, document, { reflectEnabled: true });
```

| Attribute | |
|---|---|
| `data-scxml-send="name"` | send `name`. A button sends on `click`. A `<form>` sends on submit (the default is prevented) with its fields as data. An `<input>`, `<select>` or `<textarea>` sends on `change` with `{ name, value }` as data, plus `checked` for checkboxes and radios. |
| `data-scxml-send` on a submit button | the form sends this event instead, so one form can have several actions |
| `data-scxml-on="dblclick keyup"` | the DOM events that trigger the send, instead of the default |
| `data-scxml-data='{"step": 2}'` | fixed data, merged over the fields or `{ name, value }`. Invalid JSON sends nothing. |
| `data-scxml-session="<sessionId>"` | on the element or an ancestor: only the session with that id reacts. Without it, every session bound to `root` does. |

Form fields become an object; a name that appears several times becomes an array.

With `reflectEnabled: true`, `bind()` keeps a `data-scxml-enabled` attribute on each marked element
whose event some active state has a transition for. Conditions aren't evaluated, so this means
"the chart listens for it now", not "it will do something". CSS can then dim what does nothing:

```css
[data-scxml-send]:not([data-scxml-enabled]) { opacity: 0.5; pointer-events: none; }
```

Both functions return a function that undoes them. They also take a `signal` option, and they stop
by themselves when the session terminates or is disposed.

## Following the chart's state

The session is an `EventTarget`. Its events are typed:

| Event | When |
|---|---|
| `macrostep` | the session is stable again after an event. `configuration` lists the active states. |
| `microstep` | after each set of transitions: `transitions`, `exited`, `entered` |
| `done` | the chart reached a top-level final state, or was cancelled or disposed (`disposed` says which). `data` is the `<donedata>`. Always the last event. |
| `error` | an `error.*` event was raised: `kind`, `message`, and the `element` that failed |
| `log` | a `<log>` ran: `label`, `value` |
| `send` | a `<send>` was dispatched, after its delay: `message`, the custom `processor` it went to, its `delay` |
| `sendscheduled`, `sendcancelled` | a `<send>` with a delay was scheduled; one was discarded before its dispatch (`reason`: `cancel` or `exit`) |
| `enqueue` | an event reached the session's external or internal queue, from any source: `id`, `event`, `queue`, `processor`, `dropped` |
| `invoke`, `child` | an `<invoke>` started; an invoked SCXML child session was created |

For UI, `macrostep` is usually what you want: render from `session.isActive(id)` or
`session.activeStateIds()`, and from data-model values.

<!-- doctest: check prelude=session -->
```ts
const status = document.querySelector("#status")!;
session.addEventListener("macrostep", () => {
  status.textContent = session.isActive("signed-in") ? `Hello, ${session.datamodel.evaluate("user")}` : "Signed out";
});
```

### Observing everything a session does

Tracers, logs and developer tools need more than the configuration: where each event came from
and what it caused. The session tells them without being changed:

- `enqueue` reports every event that reaches the session, whoever sent it: `session.send()`, an
  I/O processor (`processor`), another session's `<send>` (`event.origin`), an invoked child or
  service (`event.invokeid`), and the events the chart raises itself (`queue: "internal"`). Each
  gets an `id`, and the `microstep` and `macrostep` that process the event carry it as `eventId`.
  The ids are the host's alone: the chart's `_event` never sees them.
- `send.triggerId` names the event that was being processed when the `<send>` ran.
- A delayed `<send>` is seen when it is scheduled (`sendscheduled`), when it is dispatched (`send`,
  with the same `message` object) and when it is discarded first (`sendcancelled`).
- `session.processing` is true while a step runs; `session.options` are the options the session
  was made with; `model.source` is the text a chart was parsed from.

Listening costs nothing until you do: the events only observers need are only made for sessions
that have a listener for them.

<!-- doctest: run -->
```ts
import { createSession, VirtualClock } from "@tinyactors/scxmljs";

const clock = new VirtualClock();
const order = await createSession(
  `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
     <state id="cart">
       <transition event="checkout" target="paying"/>
     </state>
     <state id="paying">
       <onentry><send event="payment.timeout" delay="30s"/></onentry>
       <transition event="payment.timeout" target="cart"/>
     </state>
   </scxml>`,
  { clock },
);
const cause = new Map<number, string>(); // event id → where it came from
order.addEventListener("enqueue", (e) => cause.set(e.id, e.event.origin ? "the chart" : "the application"));
order.addEventListener("microstep", (e) => {
  if (e.eventId !== undefined) console.log(`${e.event!.name} from ${cause.get(e.eventId)} → ${e.entered.map((s) => s.id)}`);
});
order.addEventListener("sendscheduled", (e) => console.log(`${e.message.event} in ${e.delay} ms`));
order.start();
order.send("checkout");
clock.run();
order.dispose();
```

<!-- doctest: output -->
```text
payment.timeout in 30000 ms
checkout from the application → paying
payment.timeout from the chart → cart
```

## The chart as your markup

A chart is a DOM, so you can show *it*, and style it with CSS. Pass the parsed `<scxml>` element
to `createSession()` with either or both of these options:

- `reflect: true` keeps attributes on the chart's own elements:
  - `data-active` on active states;
  - `data-enabled` on transitions whose source state is active;
  - `data-fired` on transitions that just fired (for 900 ms of session time; set
    `reflect: { firedMs }` to change it);
  - `data-initial` on initial targets;
  - `data-status="running|done"` on `<scxml>`.
- `elementEvents: true` dispatches bubbling events on those elements: `scxml:enter` and
  `scxml:exit` on states, `scxml:transition` on transitions, `scxml:done` on `<scxml>`. They're
  typed on `Document`, `Element` and `Window`.

Both are off by default, because every session of a shared `Model` would write to the same
elements. Use them with one session per parsed chart.

<!-- doctest: check -->
```ts
import { createSession, parseSCXML } from "@tinyactors/scxmljs/trusted";

const source = await (await fetch("login.scxml")).text();
const chart = document.importNode(parseSCXML(source), true);
document.querySelector("#chart")!.append(chart); // the chart's elements are now in the page

const session = await createSession(chart, { reflect: true, elementEvents: true });
document.addEventListener("scxml:enter", (e) => console.log("entered", e.state.id));
session.start();
```

```css
@namespace s url(http://www.w3.org/2005/07/scxml);
s|state { display: block; margin: 4px; padding: 4px 8px; border: 1px solid #999; }
s|state[data-active] { border-color: green; font-weight: bold; }
s|state::before { content: attr(id); }
s|transition, s|datamodel { display: none; }
```

The same attributes and events are there when you draw the chart some other way, for example by
walking `session.model` and rendering your own components (see [custom UI](custom-ui.md#draw-it-yourself)).
