# What the flight recorder found (2026-11-26)

How these were found: `tools/explore.mjs` drove the real page (animation loop running, real pointer,
wheel, key and touch events) as five kinds of first-time visitor over six targets, 15 sessions of 40
app-seconds each (`?live=microwave` clicker, impatient, phone; `?live=llm-chat` clicker, orbiter;
`?system=single-microwave` clicker, orbiter, lost; `?system=llm-chat` clicker, impatient, phone;
`?system=pi-durable` clicker, orbiter; `?system=many` clicker, lost). Each log went through
`tools/analyse.mjs`, and the sessions below were watched with `tools/replay.mjs`. Logs, analyses and
replays are in `out/explore/before/<run>/` and `out/explore/after/<run>/` (not committed: `out/` is
ignored; rerun with `tools/explore.mjs`).

Caveats. The renderer here is SwiftShader: 1 to 9 fps, so nothing below is about frame rate (the
analyser skips feel findings for software sessions) and the explorers pace themselves in APP time
(they wait for what they see to move). The personas are crude: they choose by size on screen, not
by meaning, and the impatient one presses Escape at random (its "regret" findings are the persona,
not the app). Treat every finding as a hypothesis for the owner's real log to confirm.

Ranked by how much it would confuse or annoy a visitor. **Fixed** items are clear defects in the
engine/world/camera/pick path; **Options** items are about the room not being useful, left for the
owner's real log.

## 1. Nothing in the room can be read from where the visitor starts (Options)

Evidence: every session starts in the overview with no readable plate: 0 of 31 (single-microwave),
the largest glyph on screen 3.6 px (`view/frame`, `bestGlyph`, at 0.3 s in any `before` log). No
readable text in view for most of each session (`view.readable-share`): llm-chat clicker 58 %, live
llm-chat orbiter 80 %, single-microwave lost 100 %, pi-durable orbiter 100 %. In the overview a
person covers 0.5 % of the screen (single-microwave) to 0.1 % (llm-chat, `tap.tiny-target`: "tapped
actor workspace, which covers 0.1% of the screen"); on a phone held upright the home view stands
about 80 m up (`camera` ring of llm-chat-phone: py 75-81) because it fits the room's width into
390 px. Frames: `out/explore/before/live-microwave-clicker/replay/sheet-2.png` (the whole room,
every label a smear).

Cause: `homeView()` (main.js:65) frames the whole room from the south-east; plates are sized for
reading at 1-3 m (world/kit.js `plate`).

Options:
1. Start at eye level in front of the busiest person (the sweep's "eye" shot), the overview one
   Escape away: the room is learned by looking around, not from above.
2. Keep the overview but make it a map: a few big plates on the floor (bay names, the hub's name)
   sized for the overview distance, shown only from above (as the ceiling is hidden from above).
3. On portrait screens frame the room's long axis vertically (look from the west) and stop where a
   person is at least ~2 % of the screen; the rest is a drag away.

## 2. Live: presses that do nothing visible (Options; the log now records them)

Evidence: `live.no-effect` 5 times for the live-microwave clicker and 13 for the impatient one
("press in:microwave:turn.on: nothing happened in the room"). The clicker's FIRST tap is the
FLOW · STEP lever (the biggest blue thing by the clock; `act press time:mode` at 12 s); from then on
every input is held until ONE HOP is pressed: TURN ON at 25 s, DOOR OPEN at 108 s, TURN OFF at 145 s
show nothing. Other presses were of inert buttons (DOOR CLOSE while closed) or ADVANCE TIME with no
timer due. Frames: `out/explore/before/live-microwave-clicker/replay/sheet-2.png`. A refused press
only shivers its cap, invisible at 0.1 % of the screen.

Cause: live/controls.js:149 (the lever) and live/controls.js:220 (`press` of an inert control):
nothing in the room says "held back: press ONE HOP" or "already closed".

Done here: the log now says what each press did, `world/press {id, ok, stepping, pending}` (main.js
`perform`), so the owner's log shows inert and held-back presses directly.

Options:
1. Make STEP visible from anywhere: the lever lights the clock's face blue, held capsules wait
   visibly at their tube mouths, ONE HOP blinks while something waits.
2. Do not offer STEP until the visitor has seen FLOW once (the lever appears after the first chain
   has played).
3. A refused press answers where the visitor looks: the cap flashes red and its plate says why
   ("ALREADY CLOSED", "NOTHING DUE").

## 3. Live controls are tiny and crowded from the default view (Options)

Evidence: `tap.tiny-target` in every live session: "tapped control time:hop, which covers 0.1% of
the screen, with time:mode, time:advance within 12 px"; "control in:microwave:turn.on ... with
in:microwave:door.close, user, in:microwave:door.open within 12 px". It is easy to press the
neighbour.

Cause: consoles are built at real size (live/controls.js) and used from the overview.

Options: 1. a tap on a console from afar first flies to it (as a tap on a station does);
2. consoles keep a minimum size on screen with distance, as the head's plates do; 3. a console takes
taps only once the camera is within ~4 m, and says so by lighting up.

## 4. Taps on a desk or what is on it did nothing (Fixed)

Evidence: `tap.scenery` (12 taps in the before runs) and `tap.near-miss` "tap hit furniture and did
nothing; actor workspace was 0 px away (inside its outline)" (llm-chat impatient 29.1 s and 30.3 s,
then `tap.repeat` on the same spot). A seated person is mostly behind their desk and monitor: a
visitor aiming at the person hits the desk.

Cause: `pickAt` (main.js) returned `furniture` for anything under `desks.root`, which does nothing.

Fix: a desk, its chair and the things on it belong to their sitter: `deskOwner(point)` (main.js)
picks the present occupant of the nearest seat within 1.4 m, so the tap selects the person, and a
second tap enters their head as it does on the person. Checked: a click on the microwave's desk
front picks `["actor","microwave","desk"]` and selects it.

## 5. Taps that just miss a person or a station fell through (Fixed)

Evidence: 30 `tap.near-miss` in the before runs, e.g. "tap meant for station user (13 px away) fell
through to the floor and walked the camera" (single-microwave clicker 17.6 s), "tap hit NOTHING and
did nothing; station customers was 0 px away" (many clicker 420.7 s: the hatch's silhouettes have
gaps), "tap meant for actor T-023 (6 px away) fell through to the floor" (many lost 574 s).

Cause: only live controls had a reach (`liveControls.near`, 26 px); people and stations had to be
hit exactly.

Fix: a tap on the floor, a wall or nothing within 14 px of a person's or a station's outline on
screen means them (main.js `nearSubject`; not inside a head). The hover cursor follows the same path.

## 6. A selected station was a dead end (Fixed)

Evidence: pi-durable clicker: `select prepare` at 35.7 s flies to a close-up of one purple box
(38.7 % of the screen) with nothing else to tap; then 11 taps in 370 s do nothing, 8 of them on the
selected station again ("tap hit actor:prepare and did nothing"), 3 on the wall at the frame's edge;
`comp.lost` for 195 s and 225 s. Frames:
`out/explore/before/pi-durable-clicker/replay-66-100/sheet-1.png`.

Cause: `intentOf` (main.js) did nothing for a tap on the station already selected.

Fix: a tap on the selected station steps back out (`back`): the way out that a mouse visitor who
does not know Escape can find. Proposed next (not done): frame a station together with the desk it
serves, from ~5 m.

## 7. Inside a head on a phone held upright, the machines were cut off (Fixed, partly)

Evidence: live-microwave phone, `head:microwave` from 25 s: the `on` machine is cut by the right
edge and `off` by the left; 5 `tap.head-miss` taps on the wall and floor around them. Frames:
`out/explore/before/live-microwave-phone/replay/sheet-3.png`.

Cause: the view inside a head (main.js `insideView`) was fixed for fov 42 on a 16:10 screen; at
390 x 800 the horizontal view is a third of that.

Fix: on screens narrower than 16:10 the camera widens its fov inside a head (up to 90) and stands
back by what is still missing of 85 % of the width; the head's detail and skin follow distance in
those units (main.js `insideFov`, `headK`). Landscape screens are unchanged (k = 1, fov 42; film
frames are pixel-identical). After: `out/explore/fixes/head2.png` (microwave) and `host.png`
(llm-chat's host) at 390 x 800: every machine is in frame. Left: the dome's edge and the room
outside show at the corners, which the head's own room (INSIDE) could close off for portrait. The
price: plates are smaller, so less is readable at once (live-microwave phone: no readable text 33 %
of the session before, 79 % after); a tap on a machine (focus) still brings its plates close. If the
owner prefers reading to seeing the whole head, lower the 0.85 in `headK`.

## 8. Invoked children sat inside each other, and the view of one is filled by the others (Fixed, partly)

Evidence: live llm-chat clicker, `select package:sdk` at 100 s: the view of one package visitor is
filled by the two on the next stools, shoulders inside each other (`view/frame`:
`actor:package:pglite 16%, actor:package:sdk 15.5%, actor:package:coreutils 10.6%`). Frames:
`out/explore/before/live-llm-chat-clicker/replay/sheet-11.png`.

Cause: core/plan.js:165 put visitors' stools 0.75 m apart; an avatar is ~0.7 m across.

Fix: stools 1.0 m apart in a row, rows 0.85 m apart (core/plan.js:165). `check-plan` finds no
clashes (llm-chat-dynamic, pi-durable, fulfillment); the pose check passes.

Not fixed: the after replay (`out/explore/after/live-llm-chat-clicker/replay-15-70/sheet-1.png`)
shows the same picture: six package visitors in two rows, and the conversational view of one of
them (`frameOf`, world/camera.js `frame`) ends at the end of the row, so the others overlap it in
perspective (`view`: selected 14.3 %, pglite 17 %, coreutils 11.4 %); the flight there also passes
low through the group (25.0 s). Options: 1. frame a visitor from across their parent's desk, high
(over the parent's shoulder), which the row cannot block; 2. selecting a visitor dims the other
visitors of that desk; 3. visitors of one parent sit in a single arc around the desk's front, never
in rows.

## 9. No feedback before a tap; none at all on touch (Fixed for the mouse)

Evidence: `hover.cursor-only` in every mouse session ("8 hover changes, 4 onto something tappable;
the only feedback is the cursor"); `hover.touch` in every phone session.

Fix: a pale ring on the floor under the person or station the pointer is on (main.js `hoverRing`):
in the world, not a HUD (GENERIC.md). Touch has no hover; see item 3's options.

## 10. The board redrew and re-uploaded 5.8 MB whenever its playhead moved a pixel (Fixed; cost unmeasured on a GPU)

Evidence: the `board` tag is on 81 % of the frames of single-microwave clicker and 100 % of many
clicker (`frame/long` tags): the 1600 x 900 canvas is redrawn and uploaded as a texture whenever the
playhead moves a pixel, which on a real GPU at 60 Hz is most frames while the run plays. Whether it
costs the owner's GPU 0.5 ms or 5 ms a frame, their log will say (`frame/long` with `board`).

The canvas redraw itself is cheap (0.06 ms measured in the page); the cost is the upload.

Fix: the board updates at most 15 times a second and not while it is out of view; a touch of the
board redraws it at once (main.js, the `boardSeen()` line). Film mode keeps every frame.

## 11. Flights ignore taps while entering and leaving a head (Options)

Evidence: `camera.fought` (low) in phone and clicker sessions: "the visitor down during a enter
flight, which kept flying and overrode it". Entering takes 2.6 s and leaving 2.8 s; a tap in that
time is lost (by design: a drag must not strand the camera between the lid and the head).

Options: 1. shorten both to ~1.6 s; 2. queue a tap made during the flight and do it on arrival;
3. Escape during an enter reverses it at once.

## 12. The first tap on the big clock pauses the whole room (Options)

Evidence: single-microwave clicker and llm-chat clicker: the first action is `pause` (the clock is
the biggest bright thing in view), `overview +paused` for 31 s; the llm-chat clicker then spent its
whole session paused (`comp.modes`: person +paused 7, head +paused 5).

Options: 1. pausing shows in the room (the lamps dim, capsules freeze, a STOPPED plate on the
clock); 2. pause from the lever, not the face; 3. a tap on the clock frames it first, as a station.

## Before and after

The same 15 runs (personas, seeds, 40 app-seconds each), before the fixes and after; the personas
react to what they see, so the sessions diverge after the first difference. Numbers from
`tools/analyse.mjs` (totals over the 15 runs):

| | before | after |
|---|---|---|
| taps | 198 | 187 |
| taps that did nothing (all) | 56 | 31 |
| ... outside a head | 41 | 16 |
| ... inside a head (`tap.head-miss`; not addressed) | 15 | 15 |
| taps that fell through to the floor and walked | 23 | 11 |
| near misses (something within 30 px, or the tap inside its outline) | 30 | 2 |
| taps on desks that did nothing (`tap.scenery`) | 12 | 2 |
| changes of mode (the visitor got somewhere) | 137 | 158 |
| live presses with no visible effect (item 2; not addressed) | 18 | 18 |
| `comp.lost` stretches | 13 | 10 |
| medium and high findings | 84 | 52 |

Per run, the clearest: pi-durable clicker 11 dead taps and 3 mode changes before, 0 and 15 after
(item 6); llm-chat impatient 10 dead, 8 near misses, 7 desk taps before, 3, 1 and 0 after (items 4
and 5). Unchanged by design: the lost and orbiter personas (they aim at nothing), and every
readable-text share on a landscape screen (item 1 is left for the owner).

