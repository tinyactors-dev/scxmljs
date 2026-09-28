import { createSession, PlaybackClock } from "@tinyactors/scxmljs";
import "@tinyactors/scxmljs/view";

for (const v of document.querySelectorAll("scxml-view")) {
  v.addEventListener("scxml-load", () => window.__events.push(`${v.id}:load`));
  v.addEventListener("scxml-error", (e) => window.__events.push(`${v.id}:error:${e.detail.message}`));
}

// The host-session path: the page owns a sandboxed session on a paused PlaybackClock.
const clock = new PlaybackClock({ playing: false });
const text = await (await fetch("/charts/traffic-light.scxml")).text();
const session = await createSession(text, { clock });
const host = document.getElementById("host");
host.session = session;
host.clock = clock;
session.start();
window.__host = { session, clock };
window.__ready = true;
