# Design principles

These are the visual rules for `<scxml-view>`, `<scxml-explorer>` and the demos on the website.
They are for contributors and coding agents who change the elements' UI. Two things take
precedence over them: the user's own words (every string can be replaced, see
[Custom UI](custom-ui.md#translations)), and the theme tokens (`--scxml-*`, see
[Theming](theming.md)).

## Notation over narration

Text is for names and values: state names, event names, data values. Everything else is carried
by shape, a glyph, position or colour. That includes the kind of a thing, its role, its
relationships, counts, and whether it is active.

Every glyph still has a text name. The name is the element's accessible name and its tooltip,
so screen readers lose nothing.

## Shape tells the kind

The elements use statechart notation, the same as `<scxml-view>`'s diagram:

- A rounded box is a state.
- A double outline is a final state.
- `H` and `H*` are shallow and deep history.
- `∥` marks a parallel state.

Don't write "compound" or "atomic". A container's number of states is a badge with the layers
glyph. The badge is also the container's "go inside" button. Write `44` with the glyph, not
"44 inside →".

## One small, fixed set of glyphs

The glyphs are [Lucide](https://lucide.dev) icons (ISC licence): a 24×24 grid, 2px stroke,
round caps and joins, drawn in `currentColor`. There are at most about a dozen meanings. Each
glyph has exactly one meaning, and both elements share them.

| Lucide glyph | Meaning | Replaces |
|---|---|---|
| `log-in` | actions on entry | "on entry …" |
| `log-out` | actions on exit | "on exit …" |
| `send` | sends an event or message | "send email:onHold" |
| `logs` | logs | "log on hold" |
| `diamond` | the transition has a condition (the guard; UML's decision diamond) | "if In('active')" |
| `workflow` | invokes a child machine | "2 invokes" |
| `layers` | a container and its number of states; opens it | "44 inside →" |
| `door-open` | a way out of the focused state (an exit) | "Leaves to … in … · from …" |
| `corner-down-right` | a way into the focused state (an entry) | "Entered from …" |
| `locate` / `locate-fixed` | Follow off / on (a map's "show my location") | a dot |
| `list` / `network` | show the focus as a list / as a diagram | "List" / "Diagram" |
| `funnel` | only active states | an "active" checkbox |
| `play`, `pause`, `step-forward` | playback | "▶ Play", "Step ⏭" |
| `chevron-down` / `chevron-right` | fold / unfold a container | |
| `circle-help` | what a state is about (its description) | |
| `scan`, `minus`, `plus` | fit, zoom out, zoom in | |

A new glyph is added to this table first. The table is the only list of glyphs. An icon that
means something else in another place is a bug.

## How icons are made

Icons are SVG, built as DOM nodes inside the components: `icon()` in
`packages/scxmljs/src/ui/svg.ts` draws one icon from `packages/scxmljs/src/ui/icons.ts`, where each
icon is its own export of Lucide element and attribute pairs (so a bundle carries only the icons
its element uses).
Icons are never fetched or bundled as files. They are never parsed from markup either, because
the elements must work under Trusted Types and a strict Content-Security-Policy (see
[CSP](csp.md)).

Icons are decorative and `aria-hidden`. The button or element around an icon carries the name.

Sizes: 16px in controls, 14px inline in text.

## Event names: the event chip

An event name is never broken up and never gets a glyph inside it. It is shown the way the
system shows code, in IBM Plex Mono, exactly as written, built from two parts the Tinyactors
design system already has:

- **The name.** The namespace is quieter (`--scxml-fg-muted`) and the last part is at full
  strength: `email.paymentFailed.` then `done`. When there isn't room, the namespace is cut from
  the left (`…Failed.done`), never the last part. The target of a transition is never cut either.
- **The event chip.** Where an event is something you can click (it sends the event), it sits in
  the event chip: a pill with a hairline border, like the playground's suggested events. Where it
  is only mentioned (a transition that can't be sent now, an exit, a label on an arrow), it is
  plain text, like inline code.
- **Its kind, in the state colours.** A completion (`done.state.*`, `done.invoke.*`, or any name
  whose last part is `done`) takes the done pair, `--scxml-done` on `--scxml-done-bg`, like a
  "done" status pill. An error (`error`, `error.*`, or any name whose last part is `error`) takes
  the error pair, `--scxml-error` on `--scxml-error-bg`. Plain text takes the colour; a chip takes
  the tinted pill. A wildcard (`carrier.*`) keeps its `*` as text, quieter.

The colour never stands alone: the kind is also in the name itself (`done`, `error`, `*`).

The builders live in `packages/scxmljs/src/ui/notation.ts`: `eventName()` for event names (with
`eventKind()`), `actionGlyphs()` for what a state does, `glyph()` for one named glyph. Give the
element around a clickable event name the `ev-chip` class and it takes the tint. Use them rather
than building names or glyphs by hand.

## One place says where you are

The breadcrumb is the title. Its last place is large, and its parents are small before it.
Don't repeat the location in a subtitle or a second header.

## Show what happened, don't write it

The last step is shown in two ways: the transition taken gets the "just happened" colour, and
the state entered gets a brief highlight. Screen readers hear the step from the polite live
region. No sentences on screen narrate the steps.

## Controls are icons with names

Playback, zoom, view switches and filters are icon buttons. Each has an accessible name and a
tooltip. Numbers and values stay text: `¼×`, `0.7 s`, `65%`.

## Colour means one thing each

This is the explorer's rule (see the header comment of
`packages/scxmljs/src/explorer/styles.ts`), and it applies to both elements:

- The running colour marks what is active.
- The waiting colour marks what just happened.
- The done and error colours mark completion and error events (and finished or failed machines).
- The accent colour marks keyboard focus.

Never use colour alone. Pair it with a shape or a glyph.

## Surfaces

- Surfaces are solid, with a hairline border. No translucency, no blur.
- Floating controls sit in fixed, logical places: on the bottom edge, inset like the content.
  Playback is bottom left, view controls are bottom right.
- Panels float over the content, like the panels of a map.
- Controls show only what is useful now, but they don't jump around. Prefer a control that is
  disabled in place. If a control must appear, it appears at the outer edge, so nothing else
  moves.

## Before and after

A row in the focus list, before:

```text
paymentFailed ▸
on entry  send email:paymentFailed
customer.payment.retry → paying
email.paymentFailed.done → closed
```

After:

```text
paymentFailed                         ⇥ ↗
…payment.retry → paying    …paymentFailed.done → closed
```

Here `⇥` and `↗` stand for the log-in and send glyphs: the state has actions on entry, and they
send something. The names of the actions are in the glyphs' tooltips. The namespaces are cut from
the left, never the last part. The last event is a completion: it is shown in the done colour.
