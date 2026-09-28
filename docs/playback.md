# Playback and stepping

Every session takes its time from a *clock*: when delayed `<send>`s fire, and when queued events
are processed. Pick the clock when you create the session:

| Clock | Time | Use |
|---|---|---|
| `realClock` (default) | real time | production |
| `VirtualClock` | moves only when you call `run()`, `advance()` or `runNext()` | tests, simulations; see [testing](testing.md) |
| `PlaybackClock` | a `VirtualClock` that real time drives, at an adjustable speed; can be paused and stepped | demos, debugging, teaching |

## `PlaybackClock`

<!-- doctest: check prelude=session -->
```ts
import { PlaybackClock } from "@tinyactors/scxmljs";

const clock = new PlaybackClock({ speed: 0.5, playing: false }); // defaults: speed 1, playing

clock.play(); // real time drives the clock, at `speed` virtual ms per real ms
clock.pause(); // nothing happens until play() or step()
clock.toggle();
clock.speed = 4; // four times as fast; 0 stops time without pausing
clock.step(); // pause, then run exactly one task (jumping to the next timer if nothing is due)

const unsubscribe = clock.subscribe(() => {
  // after every tick, play/pause, speed change and step, and whenever work is queued
});
clock.dispose(); // pause and drop every subscriber
```

`step(until)` runs tasks one at a time until `until()` returns true or nothing is left. A task is
one piece of the session's work, such as processing one queued event or firing one timer. To step
from one stable configuration to the next, count macrosteps:

<!-- doctest: run files=traffic-light.scxml -->
```ts
import { readFile } from "node:fs/promises";
import { createSession, PlaybackClock } from "@tinyactors/scxmljs/trusted";
import { Window } from "happy-dom";

const { DOMParser } = new Window();
const clock = new PlaybackClock({ playing: false });
const session = await createSession(await readFile("traffic-light.scxml", "utf8"), {
  clock,
  domParser: new DOMParser(),
});
let steps = 0;
session.addEventListener("macrostep", () => steps++);
session.start();
console.log(`${clock.now()} ms: ${session.activeStateIds().join(" ")}`);

for (let i = 0; i < 3; i++) {
  const before = steps;
  clock.step(() => steps > before); // run until the next macrostep
  console.log(`${clock.now()} ms: ${session.activeStateIds().join(" ")}`);
}
session.dispose();
clock.dispose();
```

<!-- doctest: output -->
```text
0 ms: on red
3000 ms: on green
6000 ms: on yellow
7000 ms: on red
```

Stepping jumps over idle time: the timers fire at 3, 6 and 7 seconds of virtual time, but the
three steps take no real time at all.

While playing, the clock advances at most 250 ms of real time per frame. A tab that was in the
background doesn't fast-forward through minutes of timers when it comes back.

## In the elements

Both elements show playback controls when the session's clock is a `PlaybackClock`: play/pause,
step, speeds from ¼× to 4×, and the virtual time. Their Step button does exactly what the example
above does: it runs until the next macrostep. Space plays and pauses, and `.` steps.

- `<scxml-view>`: set its `clock` property; the element creates the session with it.
- `<scxml-explorer>`: create the session with the clock and pass both to `attach()`.

Everything that should pause with the chart must use the same clock: invokers, I/O processors
that simulate a backend, fake environments. Take time from `clock.setTimeout()` instead of the
global `setTimeout()`, as the [countdown invoker](invokers.md#example-a-countdown) does.
