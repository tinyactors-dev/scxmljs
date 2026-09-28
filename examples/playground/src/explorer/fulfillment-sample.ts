/**
 * Sample: an e-commerce order system. Three machines (order → payment,
 * order → shipment) and six fake services (risk, crm, warehouse, email,
 * payments, carrier). A full run on the real clock takes about half a minute.
 */
import type { Clock } from "@tinyactors/scxmljs/trusted";
import { FakeService } from "./fake-services.ts";
import { chartFile, type Sample } from "./sample.ts";

const urn = (name: string) => `urn:example:${name}`;

function services(clock: Clock): FakeService[] {
  let labels = 0;

  const risk = new FakeService({
    type: urn("risk"),
    alias: "risk",
    clock,
    latencyMs: 700,
    handle: (m, reply) => {
      const { amount = 0 } = (m.data ?? {}) as { amount?: number };
      // large first orders look suspicious; everything else passes
      const score = amount > 5000 ? 0.92 : amount > 2000 ? 0.65 : 0.18;
      reply(`risk.${m.event}.done`, { score, model: "velocity-v3" });
    },
  });

  const crm = new FakeService({
    type: urn("crm"),
    alias: "crm",
    clock,
    latencyMs: 500,
    handle: (m, reply) => {
      const { customer } = (m.data ?? {}) as { customer?: { id?: string } };
      reply(`crm.${m.event}.done`, { tier: customer?.id?.endsWith("7") ? "gold" : "standard", lifetimeValue: 1843.2, orders: 12 });
    },
  });

  const warehouse = new FakeService({
    type: urn("warehouse"),
    alias: "warehouse",
    clock,
    latencyMs: (m) => ({ reserve: 900, restock: 4000, pick: 1600, scan: 700, pack: 1200 })[m.event] ?? 800,
    handle: (m, reply) => {
      const data = (m.data ?? {}) as { items?: { sku: string; qty: number }[] };
      switch (m.event) {
        case "reserve": {
          // pre-order SKUs are never in stock the first time round
          const backorder = (data.items ?? []).some((i) => i.sku.startsWith("PRE-"));
          if (backorder) for (const i of data.items ?? []) i.sku = i.sku.replace(/^PRE-/, "");
          reply("warehouse.reserve.done", { backorder, location: "AMS-2" });
          break;
        }
        case "pack":
          reply("warehouse.pack.done", { parcel: { weightKg: 2.4, dims: "40x30x15", packer: "station-4" } });
          break;
        default:
          reply(`warehouse.${m.event}.done`, data);
      }
    },
  });

  const email = new FakeService({ type: urn("email"), alias: "email", clock, latencyMs: 350 });

  const payments = new FakeService({
    type: urn("payments"),
    alias: "payments",
    clock,
    latencyMs: 800,
    handle: (m, reply) => {
      const data = (m.data ?? {}) as { amount?: number; orderId?: string };
      switch (m.event) {
        case "authorize":
          if ((data.amount ?? 0) > 500) {
            // Strong Customer Authentication: the customer confirms in their banking app
            reply("payments.authorize.done", { challenge: true, method: "3ds2" });
            reply("payments.challenge.completed", { orderId: data.orderId }, 4000);
          } else reply("payments.authorize.done", { authCode: authCode() });
          break;
        case "verify":
          reply("payments.verify.done", { authCode: authCode() });
          break;
        case "capture":
          reply("payments.capture.done", { captureId: `cap_${Math.floor(clock.now()).toString(36)}` });
          break;
        default:
          reply(`payments.${m.event}.done`, data);
      }
    },
  });

  const carrier = new FakeService({
    type: urn("carrier"),
    alias: "carrier",
    clock,
    latencyMs: 900,
    handle: (m, reply) => {
      if (m.event !== "createLabel") return reply(`carrier.${m.event}.done`, m.data);
      const trackingNumber = `1Z${String(100000 + ++labels * 7919).padStart(8, "0")}`;
      reply("carrier.createLabel.done", { trackingNumber });
      // the parcel's journey, as webhooks; every third parcel gets delayed at the hub
      const hiccup = labels % 3 === 0;
      const steps: [string, number, unknown?][] = [
        ["carrier.picked_up", 3000, { hub: "Amsterdam" }],
        ["carrier.in_transit", 6000, { hub: "Utrecht" }],
        ...(hiccup
          ? ([
              ["carrier.exception", 8000, { reason: "address label damaged" }],
              ["carrier.in_transit", 10000, { hub: "Utrecht" }],
            ] as [string, number, unknown][])
          : []),
        ["carrier.in_transit", hiccup ? 12000 : 9000, { hub: "Rotterdam" }],
        ["carrier.out_for_delivery", hiccup ? 15000 : 12000, { van: "RT-17" }],
        ["carrier.delivered", hiccup ? 18000 : 15000, { signedBy: "J. de Vries" }],
      ];
      for (const [name, delay, data] of steps) reply(name, { trackingNumber, ...(data as object) }, delay);
    },
  });

  return [risk, crm, warehouse, email, payments, carrier];

  function authCode() {
    return `A${Math.floor(clock.now() % 1e6)
      .toString(36)
      .toUpperCase()}`;
  }
}

export const fulfillmentSample: Sample = {
  id: "fulfillment",
  title: "Order fulfilment",
  description:
    "An e-commerce order across three machines (order, payment, shipment) and six services: fraud screening, 3-D Secure, warehouse, carrier webhooks and customer email.",
  source: async () => chartFile("fulfillment.scxml"),
  loader: chartFile,
  ioprocessors: services,
  drive(session, clock) {
    const timers: unknown[] = [];
    const at = (ms: number, fn: () => void) => timers.push(clock.setTimeout(fn, ms));
    at(800, () =>
      session.send("order.placed", {
        id: "SO-10482",
        customer: { id: "cus_3317", name: "Jana de Vries", email: "jana@example.org" },
        items: [
          { sku: "LMP-DESK-OAK", name: "Desk lamp, oak", qty: 1, price: 189.0 },
          { sku: "CBL-USB-C-2M", name: "USB-C cable 2 m", qty: 2, price: 14.95 },
          { sku: "CHR-ERG-GRY", name: "Ergonomic chair, grey", qty: 1, price: 431.0 },
        ],
        amount: 649.9,
        currency: "EUR",
        address: { street: "Prinsengracht 263", postcode: "1016 GV", city: "Amsterdam", country: "NL" },
      }),
    );
    at(2500, () => session.send("customer.message", { text: "Can you deliver after 17:00?" }));
    at(9000, () => session.send("admin.hold", { reason: "stock audit in aisle 12" }));
    at(11500, () => session.send("admin.release"));
    at(17000, () =>
      session.send("customer.address.changed", {
        address: { street: "Keizersgracht 123", postcode: "1015 CJ", city: "Amsterdam", country: "NL" },
      }),
    );
    at(21000, () => session.send("customer.cancel")); // too late: refused, the parcel is on its way
    return () => {
      for (const t of timers) clock.clearTimeout(t);
    };
  },
};
