/**
 * The playground's order fulfilment: six orders, each its own order machine that invokes a payment
 * machine and later a shipment machine (children spawn and end with their invoke), all sharing
 * six fake services. One happy path with hold/release, address change and a refused late cancel;
 * one payment declined after three attempts; one cancelled while picking (refund); one rejected
 * by risk; one redirected in transit; one held for manual review and approved.
 * Run: bun prototypes/office/tracer/drivers/fulfillment.ts
 */
import { createSession, type SCXMLSession, VirtualClock } from "@tinyactors/scxmljs/trusted";
import { Window } from "happy-dom";
import type { FakeService } from "../../../../examples/playground/src/explorer/fake-services.ts";
import { fulfillmentSample } from "../../../../examples/playground/src/explorer/fulfillment-sample.ts";
import { createTracer } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const clock = new VirtualClock();
const domParser = new (new Window().DOMParser)() as never;
const tracer = createTracer({
  system: "fulfillment",
  scenario: "six-orders",
  clock,
  app: { id: "shop", label: "the web shop and the back office", kind: "user" },
  identify: (_s, info) =>
    info.invokeid ? { id: `${info.parent}/${info.invokeid}`, label: `${info.invokeid} of ${String(info.parent).replace(/^order-/, "")}` } : undefined,
});
tracer.external("shop", { label: "the web shop and the back office", kind: "user" });
let next: { id: string; label: string } = { id: "order", label: "order" };
const engine = tracer.wrapEngine(createSession, () => ({ ...next, source: "fulfillment.scxml", chart: "order-fulfillment" }));
const services = fulfillmentSample.ioprocessors(clock) as FakeService[];
const payments = services.find((s) => s.alias === "payments")!;
// SO-10483's card is declined at every attempt
const send = payments.send.bind(payments);
payments.send = (m, session) => {
  if (m.event === "authorize" && (m.data as { orderId?: string }).orderId === "SO-10483") payments.failNext("authorize");
  send(m, session);
};

const orders: SCXMLSession[] = [];
const source = await fulfillmentSample.source();
async function order(id: string, label: string) {
  next = { id: `order-${id}`, label };
  const s = await engine(source, { clock, domParser, loader: fulfillmentSample.loader, ioprocessors: services });
  s.start();
  orders.push(s);
  return s;
}
const shop = (fn: () => void) => tracer.as("shop", fn);
const customer = { id: "cus_3317", name: "Jana de Vries", email: "jana@example.org" };
const address = { street: "Prinsengracht 263", postcode: "1016 GV", city: "Amsterdam", country: "NL" };
const at = (ms: number, fn: () => void) => clock.setTimeout(() => shop(fn), ms);
const placed = (s: SCXMLSession, id: string, items: { sku: string; name: string; qty: number; price: number }[], extra: Record<string, unknown> = {}) =>
  s.send("order.placed", { id, customer, items, amount: items.reduce((n, i) => n + i.qty * i.price, 0), currency: "EUR", address, ...extra });

const { until, wait } = clockDriver(clock, 50);
tracer.caption("The shop opens: every order becomes an order machine.");

// A: the sample's own story
const a = await order("SO-10482", "Order SO-10482 (Jana)");
const stopA = fulfillmentSample.drive!(a, clock);
void stopA;
tracer.caption("SO-10482: a desk lamp, cables and a chair; the bank asks for 3-D Secure.");
await wait(2200);
// B: declined
const b = await order("SO-10483", "Order SO-10483 (declined card)");
at(200, () => placed(b, "SO-10483", [{ sku: "BK-NOTE-A5", name: "Notebook A5", qty: 3, price: 29.5 }], { customer: { ...customer, id: "cus_2048" } }));
at(150, () => tracer.caption("SO-10483: a small order whose card is declined three times."));
await wait(2000);
// C: cancelled while picking
const c = await order("SO-10484", "Order SO-10484 (cancelled)");
at(100, () => placed(c, "SO-10484", [{ sku: "KB-MECH-TKL", name: "Mechanical keyboard", qty: 1, price: 139 }]));
at(5200, () => {
  tracer.caption("SO-10484: the customer cancels while the warehouse is picking: the payment is refunded.");
  c.send("customer.cancel");
});
await wait(2000);
// D: rejected by risk
const d = await order("SO-10485", "Order SO-10485 (rejected)");
at(100, () => placed(d, "SO-10485", [{ sku: "TV-OLED-77", name: "OLED TV 77\"", qty: 2, price: 3600 }], { customer: { ...customer, id: "cus_9001" } }));
at(90, () => tracer.caption("SO-10485: two big TVs on a first order: fraud screening rejects it."));
await wait(2000);
// E: a gold customer who moves house while the parcel travels (the shipment machine redirects it)
const e = await order("SO-10486", "Order SO-10486 (redirected)");
at(100, () => placed(e, "SO-10486", [{ sku: "HS-WIRELESS-X", name: "Wireless headset", qty: 1, price: 249 }], { customer: { ...customer, id: "cus_4417" } }));
at(90, () => tracer.caption("SO-10486: a gold customer's headset; she changes the delivery address on the way."));
at(19000, () => e.send("customer.address.changed", { address: { street: "Oudegracht 12", postcode: "3511 AL", city: "Utrecht", country: "NL" } }));
await wait(2000);
// F: manual review, approved
const f = await order("SO-10487", "Order SO-10487 (manual review)");
at(100, () => placed(f, "SO-10487", [{ sku: "CAM-MIRROR-Z", name: "Mirrorless camera", qty: 1, price: 2450 }]));
at(4000, () => {
  tracer.caption("SO-10487: a reviewer approves the flagged order.");
  f.send("admin.approve");
});

await until(() => orders.every((o) => o.status === "done"), "every order to finish", 180_000).catch((err) => {
  for (const o of orders) if (o.status !== "done") console.log("still running:", tracer.actorOf(o), o.activeStateIds().join(" "));
  throw err;
});
await wait(1000);
console.log(orders.map((o) => `${o.sessionId}: ${o.status}`).join(", "));
const trace = tracer.finish();
for (const o of orders) o.dispose();
await writeTrace("fulfillment", trace);
process.exit(0);
