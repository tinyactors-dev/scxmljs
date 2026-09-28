// IIFE entry for the classic-script fixture: the trusted interpreter on window.scxml, and
// <scxml-explorer> registered (docs/bundling.md, "Classic scripts").
import * as scxml from "../../../../packages/scxmljs/dist/trusted.js";
import "../../../../packages/scxmljs/dist/explorer.js";

Object.assign(globalThis, { scxml });
