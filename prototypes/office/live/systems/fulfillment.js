// Order fulfilment (examples/playground's sample): every order is its own machine that invokes a
// payment machine and later a shipment machine, and talks to six services. Live:
//   - the shop's console places orders of four kinds (small, large, risky, one for review);
//   - each order's desk console has the back office's and the customer's buttons;
//   - the bank (the payments service) does not decide by itself: an authorization waits at its
//     console until the visitor approves or declines it;
//   - every other service answers after its latency, which only the wall clock lets pass.
const urn = (n) => `urn:example:${n}`;
const LATENCY = { risk: 700, crm: 500, warehouse: { reserve: 900, restock: 4000, pick: 1600, scan: 700, pack: 1200 }, email: 350, payments: 800, carrier: 900 };

/** An SCXML Event I/O processor standing in for a service: answers `<alias>.<verb>.done` after its latency on the clock. */
function service(alias, clock, handle) {
  const sessions = new Set();
  const lat = (m) => { const l = LATENCY[alias]; return typeof l === "object" ? l[m.event] ?? 800 : l ?? 400; };
  const svc = {
    type: urn(alias), aliases: [alias],
    location: (s) => `${alias}:${s.sessionId}`,
    attach: (s) => sessions.add(s), detach: (s) => sessions.delete(s),
    deliver(s, name, data) { if (sessions.has(s)) s.deliver(name, data, svc.location(s)); },
    send(m, s) {
      const reply = (name, data, ms = lat(m)) => clock.setTimeout(() => svc.deliver(s, name, data), ms);
      if (handle) handle(m, reply, s);
      else reply(`${alias}.${m.event}.done`, m.data);
    },
  };
  return svc;
}

function services(ctx) {
  const { clock } = ctx;
  let labels = 0;
  const st = ctx.state;
  st.waiting = []; // authorizations the bank holds for the visitor: {session, data}
  const risk = service("risk", clock, (m, reply) => { const amount = m.data?.amount ?? 0; reply("risk.score.done", { score: amount > 5000 ? 0.92 : amount > 2000 ? 0.65 : 0.18 }); });
  const crm = service("crm", clock, (m, reply) => reply("crm.lookup.done", { tier: "standard", orders: 12 }));
  const warehouse = service("warehouse", clock, (m, reply) => {
    if (m.event === "reserve") reply("warehouse.reserve.done", { backorder: false, location: "AMS-2" });
    else if (m.event === "pack") reply("warehouse.pack.done", { parcel: { weightKg: 2.4, dims: "40x30x15" } });
    else reply(`warehouse.${m.event}.done`, m.data);
  });
  const email = service("email", clock);
  const payments = service("payments", clock, (m, reply, s) => {
    if (m.event === "authorize") { st.waiting.push({ s, data: m.data, n: ++st.seq || (st.seq = 1) }); return; } // the visitor decides
    if (m.event === "capture") return reply("payments.capture.done", { captureId: `cap_${Math.floor(clock.now()).toString(36)}` });
    reply(`payments.${m.event}.done`, m.data);
  });
  const carrier = service("carrier", clock, (m, reply) => {
    if (m.event !== "createLabel") return reply(`carrier.${m.event}.done`, m.data);
    const trackingNumber = `1Z${String(100000 + ++labels * 7919).padStart(8, "0")}`;
    reply("carrier.createLabel.done", { trackingNumber });
    for (const [name, delay, data] of [["carrier.picked_up", 3000, { hub: "Amsterdam" }], ["carrier.in_transit", 6000, { hub: "Utrecht" }], ["carrier.out_for_delivery", 9000, { van: "RT-17" }], ["carrier.delivered", 12000, { signedBy: "J. de Vries" }]])
      reply(name, { trackingNumber, ...data }, delay);
  });
  st.payments = payments;
  return [risk, crm, warehouse, email, payments, carrier];
}

const customer = { id: "cus_3317", name: "Jana de Vries", email: "jana@example.org" };
const address = { street: "Prinsengracht 263", postcode: "1016 GV", city: "Amsterdam", country: "NL" };
const KINDS = [
  { label: "SMALL ORDER", items: [{ sku: "BK-NOTE-A5", name: "Notebook A5", qty: 3, price: 29.5 }] },
  { label: "DESK LAMP ORDER", items: [{ sku: "LMP-DESK-OAK", name: "Desk lamp, oak", qty: 1, price: 189 }, { sku: "CBL-USB-C-2M", name: "USB-C cable", qty: 2, price: 14.95 }] },
  { label: "CAMERA (REVIEW)", items: [{ sku: "CAM-MIRROR-Z", name: "Mirrorless camera", qty: 1, price: 2450 }] },
  { label: "TWO TVS (RISKY)", items: [{ sku: "TV-OLED-77", name: "OLED TV 77\"", qty: 2, price: 3600 }] },
];

export default {
  title: "Order fulfilment",
  app: { id: "shop", label: "the web shop and the back office", kind: "user" },
  externals: [
    { id: "payments", label: "the bank", kind: "service" },
    { id: "risk", label: "fraud screening", kind: "service" },
    { id: "warehouse", label: "the warehouse", kind: "service" },
    { id: "carrier", label: "the carrier", kind: "service" },
    { id: "crm", label: "customer records", kind: "service" },
    { id: "email", label: "customer email", kind: "log" },
  ],
  office: { plan: { stations: ["payments", "risk", "warehouse", "carrier", "crm", "email"] } },
  preload: ["fulfillment.scxml", "fulfillment-payment.scxml", "fulfillment-shipping.scxml"],
  identify: (_s, info) => (info.invokeid ? { id: `${info.parent}/${info.invokeid}`, label: `${info.invokeid} of ${String(info.parent).replace(/^order-/, "")}`, chart: info.invokeid } : undefined),
  inputs: {
    at: "desk",
    skip: (actorId) => actorId.includes("/"), // children take their events from their parent and the services
    only: ["admin.approve", "admin.reject", "admin.hold", "admin.release", "customer.address.changed", "customer.cancel"],
    labels: { "admin.approve": "APPROVE REVIEW", "admin.reject": "REJECT", "admin.hold": "HOLD", "admin.release": "RELEASE", "customer.address.changed": "NEW ADDRESS", "customer.cancel": "CUSTOMER CANCELS" },
    payloads: { "admin.hold": { reason: "stock audit in aisle 12" }, "customer.address.changed": { address: { street: "Oudegracht 12", postcode: "3511 AL", city: "Utrecht", country: "NL" } } },
  },
  sessionOptions: (ctx) => ({ ioprocessors: ctx.state.services, loader: (src) => ctx.track(ctx.load(String(src).replace(/^.*\//, ""))) }),
  async boot(ctx) {
    ctx.state.services = services(ctx);
    ctx.state.orders = 0;
  },
  controls(ctx) {
    const st = ctx.state;
    const out = KINDS.map((k, i) => ({
      id: `place:${i}`, at: "shop", title: "PLACE AN ORDER", console: "place", label: k.label, color: "#3b9a5a",
      press: async () => {
        const n = 1001 + st.orders++;
        const id = `SO-${n}`;
        const s = await ctx.spawn("fulfillment.scxml", { id: `order-${id}`, label: `Order ${id}`, chart: "order" });
        const amount = k.items.reduce((x, it) => x + it.qty * it.price, 0);
        ctx.as("shop", () => s.send("order.placed", { id, customer, items: k.items, amount, currency: "EUR", address }));
      },
    }));
    // the bank: the oldest waiting authorization, approved or declined by the visitor
    st.waiting = (st.waiting || []).filter((w) => w.s && st.payments);
    const w = st.waiting[0];
    const decide = (name, data) => async () => { st.waiting.shift(); st.payments.deliver(w.s, name, data); };
    out.push({ id: `bank:approve:${w ? w.n : 0}`, at: "payments", console: "bank", title: w ? `CARD ${w.data?.orderId ?? ""}` : "NO CARD WAITING", label: "APPROVE", color: "#3b9a5a", enabled: !!w, press: w ? decide("payments.authorize.done", { authCode: `A${w.n}X` }) : () => {} });
    out.push({ id: `bank:decline:${w ? w.n : 0}`, at: "payments", console: "bank", title: w ? `CARD ${w.data?.orderId ?? ""}` : "NO CARD WAITING", label: "DECLINE", color: "#d8432f", enabled: !!w, press: w ? decide("payments.authorize.error", { reason: "card declined" }) : () => {} });
    return out;
  },
  snapshot: (ctx) => ({ waiting: (ctx.state.waiting || []).length, orders: ctx.state.orders }),
};
