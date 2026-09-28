/**
 * The media stage (built by scripts/lib/media/media.ts, photographed by render.mjs). One scene per
 * URL, all on a stopped clock that only the renderer moves:
 *
 *   ?scene=explorer&theme=tinyactors|neutral   <scxml-explorer> on the fulfilment sample
 *   ?scene=view&theme=neutral                  <scxml-view> with docs/examples/player.scxml
 *
 * The colour scheme comes from the browser (prefers-color-scheme), which the renderer sets.
 * The view runs on a VirtualClock (no playback controls). When the scene is ready, `globalThis.stage` holds the clock and session.
 */
import "../../../packages/scxmljs/src/explorer.ts";
import "../../../packages/scxmljs/src/view.ts";
import { sampleById } from "../../../examples/playground/src/explorer/samples.ts";
import tinyactorsTheme from "../../../packages/scxmljs/src/themes/tinyactors.css" with { type: "text" };
import { createSession, PlaybackClock, VirtualClock } from "../../../packages/scxmljs/src/trusted.ts";

const params = new URLSearchParams(location.search);
const scene = params.get("scene");
const theme = params.get("theme") === "tinyactors" ? "tinyactors" : "neutral";
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.dataset.theme = dark ? "dark" : "light";
document.body.dataset.stage = theme;
if (theme === "tinyactors") document.head.append(Object.assign(document.createElement("style"), { textContent: tinyactorsTheme }));

const clock = new PlaybackClock({ playing: false });

if (scene === "explorer") {
  const sample = sampleById(params.get("sample") ?? "fulfillment")!;
  const explorer = document.createElement("scxml-explorer");
  document.body.append(explorer);
  const processors = sample.ioprocessors(clock);
  const session = await createSession(await sample.source(), { clock, loader: sample.loader, ioprocessors: processors, data: sample.data });
  explorer.attach({ session, processors, clock });
  session.start();
  sample.drive?.(session, clock);
  Object.assign(globalThis, { stage: { clock, session } });
} else if (scene === "view") {
  const frame = Object.assign(document.createElement("div"), { id: "stage-frame" });
  const view = document.createElement("scxml-view");
  frame.append(view);
  document.body.append(frame);
  // a VirtualClock: time stands still too, but without the playback controls a PlaybackClock adds
  const still = new VirtualClock();
  const session = await createSession(await (await fetch("/charts/player.scxml")).text(), { clock: still });
  view.session = session;
  session.start();
  Object.assign(globalThis, { stage: { clock: still, session } });
} else throw new Error(`unknown scene: ${scene}`);
