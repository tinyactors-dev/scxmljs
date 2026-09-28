/** Gallery: every <scxml-view data-gallery> gets its own PlaybackClock (play, pause, step, speed). */
import { PlaybackClock } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/view";

for (const view of document.querySelectorAll<HTMLElement & { clock: PlaybackClock }>("scxml-view[data-gallery]"))
  view.clock = new PlaybackClock({ speed: 1 });
