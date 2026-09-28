import { createSession, PlaybackClock } from "@tinyactors/scxmljs";
import "@tinyactors/scxmljs/explorer";
import { PLAYER } from "./chart.js";

// A sandboxed session on a paused clock: nothing happens unless the test steps or sends.
const clock = new PlaybackClock({ playing: false });
const session = await createSession(PLAYER, { clock });
for (const id of ["wide", "small"]) document.getElementById(id).attach({ session, clock });
session.start();
window.__session = session;
window.__clock = clock;
window.__ready = true;
