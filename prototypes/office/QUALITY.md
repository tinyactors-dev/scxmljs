# Quality issues found in the owner's recording (2026-11-26)

The owner used the live page (`?system=single-microwave`) and sent a 13 s screen recording with:
"Lots of quality issues, analyze the frames and find them." Frames are in
`/tmp/claude-0/-home-user/19e70ce1-309c-5dc0-ad87-76ee6162c0d6/scratchpad/rec/` (f-01…f-13.jpg one per second, mid.jpg, end.jpg
contact sheets); the recording itself is
`/root/.claude/uploads/19e70ce1-309c-5dc0-ad87-76ee6162c0d6/642514bb-CleanShot_2026-11-26_at_13.05.50.mp4`. Look at them yourself first.

Why we missed these: every earlier check was an overview shot or a scripted film path. Nobody
looked at a person from one metre away, from the angles a visitor actually ends up at.

## Inside the head (f-01 … f-05)
H1. The head is a bare, flat maroon box with a shelf: a void, no sense of being inside a head.
    The machines fill a fifth of the frame; most of the view is empty wall.
H2. A mail capsule hangs in mid-air above and beside the machine (f-04), nowhere near a funnel.
H3. The nested machine (`on` › cooking…) is a tiny glass box whose plates are illegible and
    overlap each other; going closer did not make it readable. Semantic zoom is not working
    for a 2-level chart at this size.
H4. `on` is drawn twice: as a pad with the marble AND as a small housing behind it. Which one is
    "the state"? The marble sits on the pad at the housing's edge, clipping its wall.
H5. Brass cones float at odd angles with no visible purpose (one on a pole pointing sideways at
    the left wall, one hovering inside `door`): the "initial spout" and hoppers read as debris.
H6. The timer clock floats off the corner of the housing on a red stick; its plate is unreadable.
H7. The two tracks between `off` and `on` overlap into one thick bundle with sleepers showing
    through; direction cannot be read.
H8. Two unexplained dots (black, yellow) on each housing's front.
H9. The view drifts between frames without the visitor asking.

## Leaving the head (mid.jpg)
X1. Hard cut from the head room to an extreme close-up of the face, with the hair "lid" hovering
    above the skull. No transition back out; the camera then sits a hand's width from the person
    for seconds, where nothing is readable.
X2. The lid never closes: for the rest of the recording the hair block floats tilted above the
    head (end.jpg, every frame).

## The person (mid.jpg, f-07, end.jpg)
P1. "Hands on head" pose: both arms pass through the head and cover the face; hands meet in a
    triangle in front of the eyes; forearms intersect each other and the hair.
P2. Arms are detached wedges: visible seams/bright edges at the shoulders, upper arms not meeting
    the torso, sleeves z-fighting with the body.
P3. The head sinks into the shoulders with no neck and tilts ~25° while working, as if broken;
    the face rotates away from where the person is looking.
P4. The reaching arm stretches to about twice its length to touch the mail basket, passes
    through the monitor, and in the next frame folds back across the head at an impossible angle.
P5. The same reach repeats every second or so like a twitch.
P6. Dark blobs on the floor that do not match the body (shadows detached from the figure).

## The desk and the room (end.jpg, f-10, f-13)
D1. Desk objects are unidentifiable: black slabs (monitor? keyboard?), a white cylinder with a
    black cap on a red base, a grey tray. Nothing says "this is a value" or which value.
D2. Mail capsules change size wildly: a purple blob in the tray, then a pill as tall as the
    person's head standing on the desk, then gone.
D3. The tube ends in mid-air above the desk; rings float; it is not connected to the tray.
D4. The plaque on the station behind ("PERSON USING IT") renders as garbled, flickering glyphs
    that change from frame to frame.
D5. A cubicle partition cuts across the bottom of the frame: the camera sits inside furniture.
D6. No ceiling: sky shows above the walls at eye level, so the room reads as a film set and the
    tubes hang from nothing.
D7. The board's chips overlap and are cut off ("DOOR OPEN", "DOOR CLOSE", "TURN ON" collide),
    and from where the visitor stands the board is half hidden behind the person.
D8. The cursor shows a pointing hand over empty wall.

## The pattern behind them
- Poses were authored as joint angles with no check that limbs do not intersect the body.
- Cameras were tuned for the film's path, not for where a click leaves a visitor.
- Small systems (one actor, one small chart) were only checked for "loads without errors".

## Status of the world's items (X, P, D), 2026-11-26

How to see it: `node tools/inspect.mjs` (one person, every pose, 8 angles at 1 m and 3 m, and an
oriented-box intersection check that fails on penetration or stretch: `out/inspect/`);
`node tools/sweep.mjs <dir>` (every system: overview, eye level, after a click, after leaving a
head); before/after pairs in `out/quality/pair-*.png`.

- X1 fixed: entering rises over the person, the lid swings open on its hinge, the camera descends
  into the head; leaving is the reverse and ends in the conversational view (2.5-3 m, above eye level).
- X2 fixed: the lid is tied to the camera's flight and closes on the way out; an interrupted flight
  still closes it.
- P1-P5 fixed: a new rig (joint hierarchy, shoulder caps, a neck, two-bone IK on fixed limb lengths,
  lean before reach, roll-free limited look-at), poses as hand targets clear of the body, hands
  moving in arcs between poses, reactions once per event (3 s apart at least). Exception is
  "hands thrown up beside the head" with the desk's red alarm lamp.
- P6 fixed: people cast no shadow-map shadows; a soft blob under each.
- D1 mostly: monitor (shows the state), keyboard, phone, in-basket under the tube's hatch,
  hourglass, desk lamp, alarm lamp, value objects on the back edge with plates on the desk's edge.
- D2, D3 fixed: one capsule size; mail lands in the basket through the hatch and rests there; tubes
  have clamps on hangers from the ceiling, no rings without a tube.
- D4 fixed (cause: the hatch's plaque was coplanar with the window's face, z-fighting).
- D5 fixed: the camera is kept out of furniture, walls and people (sphere against boxes), framing
  checks the line of sight to the face.
- D6 fixed: ceiling, beams, lamps and the upper south/east walls show at eye level, hidden from above.
- D7 partly: the board is mounted larger in small rooms (4.4 m in single-*); its span labels still
  collide at small span widths (board owner).
- D8 fixed: walls, partitions and desks occlude picking; the cursor is a pointer only over what
  responds; hidden things take no clicks.
- Small systems: a cosy room; the externals stand at arm's length (the person using it is a control
  panel beside the desk).
