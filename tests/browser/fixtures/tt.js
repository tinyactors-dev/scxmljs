// Under `require-trusted-types-for 'script'`: SCXML text reaches DOMParser through the page's own
// policy (docs/csp.md); everything else in the elements must work unchanged.
import { createSession, PlaybackClock } from "@tinyactors/scxmljs";
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";
import { PLAYER } from "./chart.js";

const policy = globalThis.trustedTypes?.createPolicy("scxml", { createHTML: (s) => s }) ?? { createHTML: (s) => s };
const domParser = { parseFromString: (text, type) => new DOMParser().parseFromString(policy.createHTML(text), type) };

const view = document.createElement("scxml-view");
view.id = "src";
view.options = { domParser };
view.addEventListener("scxml-load", () => window.__events.push("src:load"));
view.addEventListener("scxml-error", (e) => window.__events.push(`src:error:${e.detail.message}`));
view.src = "/charts/traffic-light.scxml";
document.getElementById("views").append(view);

const clock = new PlaybackClock({ playing: false });
const session = await createSession(PLAYER, { clock, domParser });
document.getElementById("wide").attach({ session, clock });
session.start();
window.__session = session;
window.__ready = true;
