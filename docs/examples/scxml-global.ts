// The interpreter and <scxml-explorer> for classic scripts: `scxml.createSession(…)`.
import * as scxml from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";

Object.assign(globalThis, { scxml });
