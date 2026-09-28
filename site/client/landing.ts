/** Landing page: the hero <scxml-view> gets a PlaybackClock, so it can be paused and stepped. */
import { PlaybackClock } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/view";

const hero = document.getElementById("hero-view");
if (hero) (hero as HTMLElement & { clock: PlaybackClock }).clock = new PlaybackClock({ speed: 1 });
