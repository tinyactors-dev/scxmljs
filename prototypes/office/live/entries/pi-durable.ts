/**
 * The real examples/pi-durable system for live mode: its DurableSystem and its charts as text.
 * Bundled by ../build.ts into ../vendor/pi-durable.js, which imports the library as ./scxmljs.js.
 */
import checkout from "../../../../examples/pi-durable/charts/checkout.scxml" with { type: "text" };
import client from "../../../../examples/pi-durable/charts/client.scxml" with { type: "text" };
import compaction from "../../../../examples/pi-durable/charts/compaction.scxml" with { type: "text" };
import generation from "../../../../examples/pi-durable/charts/generation.scxml" with { type: "text" };
import harness from "../../../../examples/pi-durable/charts/harness.scxml" with { type: "text" };
import payment from "../../../../examples/pi-durable/charts/payment.scxml" with { type: "text" };
import reminder from "../../../../examples/pi-durable/charts/reminder.scxml" with { type: "text" };
import tool from "../../../../examples/pi-durable/charts/tool.scxml" with { type: "text" };

export { DurableSystem } from "../../../../examples/pi-durable/src/system.ts";
export const charts = { harness, generation, tool, compaction, checkout, payment, reminder, client };
