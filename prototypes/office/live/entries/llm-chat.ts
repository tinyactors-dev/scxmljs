/**
 * The real examples/llm-chat system for live mode: its ChatSystem and its charts as text. Bundled
 * by ../build.ts into ../vendor/llm-chat.js, which imports the library as ./scxmljs.js.
 */
import clientChart from "../../../../examples/llm-chat/charts/client.scxml" with { type: "text" };
import hostChart from "../../../../examples/llm-chat/charts/host.scxml" with { type: "text" };
import packageChart from "../../../../examples/llm-chat/charts/package.scxml" with { type: "text" };
import workspaceChart from "../../../../examples/llm-chat/charts/workspace.scxml" with { type: "text" };

export { ChatSystem } from "../../../../examples/llm-chat/src/system.ts";
export { CATALOG } from "../../../../examples/llm-chat/src/catalog.ts";
export const charts = { host: hostChart, client: clientChart, workspace: workspaceChart, package: packageChart };
