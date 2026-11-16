/**
 * Landing page: the hero <scxml-view> gets a paused PlaybackClock: nothing moves until the visitor
 * plays, steps or clicks an event. On phones it's drawn top to bottom, so its boxes stay big enough to tap.
 */
import { PlaybackClock } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/view";

const hero = document.getElementById("hero-view");
if (hero) {
  const clock = new PlaybackClock({ playing: false });
  (hero as HTMLElement & { clock: PlaybackClock }).clock = clock;
  // a paused clock holds sent events back: deliver a clicked event right away
  hero.addEventListener("scxml-send", () => {
    if (!clock.playing) setTimeout(() => clock.step());
  });
  const narrow = matchMedia("(max-width: 640px)");
  const direction = () => hero.setAttribute("direction", narrow.matches ? "down" : "right");
  direction();
  narrow.addEventListener("change", direction);
}
