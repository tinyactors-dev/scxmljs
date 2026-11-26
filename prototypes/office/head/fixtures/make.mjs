// node head/fixtures/make.mjs : writes head/fixtures/shapes/trace.json, a hand-made system whose charts
// have the shapes the recorded examples lack (flat, wide, deep, parallel in compound in parallel, history
// shallow and deep, finals at every level, invoke, a burst, a kill-and-resume, many / no variables).
import { writeFileSync, mkdirSync } from "node:fs"; import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const S = (id, kind, children = [], transitions = [], extra = {}) => ({ id, kind, children, transitions, ...extra });
const A = (id) => S(id, "atomic"); const F = (id) => S(id, "final");
const T = (event, targets, cond) => ({ ...(event ? { event } : {}), ...(cond ? { cond } : {}), targets: [].concat(targets) });
const at = (n, ...tr) => ({ ...n, transitions: [...n.transitions, ...tr] });
const C = (id, children, tr = [], extra = {}) => S(id, "compound", children, tr, { initial: [children[0].id], ...extra });
const P = (id, children, tr = []) => S(id, "parallel", children, tr);
const root = (child) => ({ root: S("__root__", "compound", [child], [], { initial: [child.id] }) });

const charts = {};
// flat: two states
charts.receipt = root(C("receipt", [at(A("draft"), T("send", "sent")), at(A("sent"), T("amend", "draft"))]));
// wide: 24 siblings in a chain, a cross edge, an error state, a timeout racing a reply
const stages = ["ordered", "confirmed", "picking", "picked", "packing", "packed", "labelled", "weighed", "manifested", "collected", "hub-in", "sorted", "hub-out", "linehaul", "depot-in", "depot-sorted", "loaded", "out-for-delivery", "arriving", "attempted", "delivered", "signed", "rated", "archived"];
const wide = stages.map((s, i) => at(A(s), ...(i < stages.length - 1 ? [T(`step.${i}`, stages[i + 1])] : [])));
wide[2] = at(wide[2], T("error.execution", "exception"));
wide[17] = at(wide[17], T("delivery.timeout", "exception"), T("scan.ok", "arriving"));
wide[19] = at(wide[19], T("retry", "out-for-delivery"));
wide[5] = at(wide[5], T("express", "loaded"));
charts.shipment = root(at(C("shipment", [...wide, at(A("exception"), T("resolve", "confirmed"))]), T("status.ping", [])));
charts.shipment.root.children[0].onentry = [{ type: "send", event: "delivery.timeout", delay: "2d" }];
// deep: six levels
const lvl = (k) => {
  const names = ["account", "profile", "billing", "card", "verification", "check"];
  const id = names[k];
  if (k === 5) return C(id, [at(A("queued"), T("run", "running")), at(A("running"), T("pass", "passed"), T("error.platform", "failed")), F("passed"), F("failed")]);
  const inner = lvl(k + 1);
  return C(id, [at(A(`${id}-idle`), T(`open.${id}`, inner.id)), at(inner, T(`close.${id}`, `${id}-idle`)), at(A(`${id}-locked`), T(`unlock.${id}`, `${id}-idle`))], [T(`lock.${id}`, `${id}-locked`)]);
};
charts.account = root(lvl(0));
// parallel in compound in parallel, with shallow and deep history
const region = (id, a, b) => C(id, [at(A(a), T(`go.${id}`, b)), at(A(b), T(`back.${id}`, a))]);
const payment = C("payment", [
  at(C("pay-active", [S("pay-h", "history", [], [], { type: "shallow" }), at(A("authorising"), T("go.pay", "authorised")), at(A("authorised"), T("back.pay", "authorising"))], [], { initial: ["authorising"] }), T("pause.payment", "on-hold")),
  at(A("on-hold"), T("resume.payment", "pay-h")),
]);
const delivery = C("delivery", [
  at(C("del-active", [S("del-h", "history", [], [], { type: "deep" }), C("booking", [P("slots", [region("carrier", "asking", "booked"), region("window", "choosing", "chosen")])])], [], { initial: ["booking"] }), T("pause.delivery", "delivery-hold")),
  at(A("delivery-hold"), T("resume.delivery", "del-h")),
]);
charts.checkout = root(P("checkout", [payment, delivery]));
// finals at every level; the root reaches final
charts["import-job"] = root(C("import-job", [
  at(C("run", [at(A("reading"), T("read.done", "writing")), at(A("writing"), T("write.done", "written")), F("written")]), T("done.state.run", "wrap"), T("error.execution", "aborted")),
  at(A("wrap"), T("wrapped", "finished")), F("finished"), F("aborted"),
]));
// invoke: an order that invokes a payment
charts.order = root(C("order", [at(A("placed"), T("pay", "paying")), at(S("paying", "atomic", [], [], { invokes: [{ type: "scxml", id: "pay", src: "payment-run.scxml" }] }), T("done.invoke.pay", "paid"), T("error.communication", "placed")), at(A("paid"), T("ship", "shipped")), A("shipped")]));
charts["payment-run"] = root(C("payment-run", [at(A("charging"), T("charged", "settled")), F("settled")]));
// burst: forty updates in one instant
charts["inventory-sync"] = root(C("inventory-sync", ["listening", "counting", "writing", "confirming"].map((s, i, a) => at(A(s), T("item.updated", a[(i + 1) % a.length])))));
// kill and resume: a durable task
charts.task = root(C("task", [at(A("planning"), T("plan.done", "calling-tool")), at(A("calling-tool"), T("tool.done", "summarising")), at(A("summarising"), T("summary.done", "complete")), F("complete")]));
// many variables / none
charts.cart = { ...root(C("cart", [at(A("browsing"), T("add", "browsing"), T("checkout", "checking-out", "items.length > 0")), at(A("checking-out"), T("cancel", "browsing"))])),
  datamodel: ["items", "total", "currency", "coupon", "express", "notes", "updatedAt", "ownerId", "attempts", "warnings", "address", "taxRate"].map((id, i) => ({ id, type: ["array", "number", "string", "null", "boolean", "array", "number", "string", "number", "array", "object", "number"][i], readBy: i < 5 ? ["browsing"] : i === 8 ? ["checking-out"] : [], writtenBy: ["browsing"] })) };
charts.session = root(C("session", [at(A("connected"), T("drop", "reconnecting")), at(A("reconnecting"), T("reconnected", "connected"), T("give-up", "closed")), F("closed")]));

// ---------- the run ----------
let n = 0; const events = []; const actors = [];
const E = (e) => events.push({ id: "", ...e });
const idx = (ch) => { const m = new Map(); const w = (x, p) => { m.set(x.id, p); for (const c of x.children) w(c, x); }; w(charts[ch].root, null); return m; };
const node = (ch, id) => { let r = null; const w = (x) => { if (x.id === id) r = x; for (const c of x.children) w(c); }; w(charts[ch].root); return r; };
function full(ch, leaves) { const par = idx(ch); const s = new Set(); for (const l of leaves) for (let x = node(ch, l); x && x.id !== "__root__"; x = par.get(x.id)) s.add(x.id); return s; }
function actor(id, chart, steps, extra = {}) {
  actors.push({ id, chart, label: id, role: chart, bornAt: steps[0][0], ...extra });
  let curr = new Set();
  for (const st of steps) {
    const [t, ev, leaves, opt = {}] = st;
    if (ev === "@spawn") { E({ t, type: "spawn", actor: id }); const next = full(chart, leaves); E({ t, type: "transition", actor: id, event: "", from: [], to: [...next] }); E({ t, type: "config", actor: id, active: [...next] }); curr = next; continue; }
    if (ev === "@end") { E({ t, type: "end", actor: id }); curr = new Set(); continue; }
    if (ev === "@config") { const next = full(chart, leaves); E({ t, type: "config", actor: id, active: [...next] }); curr = next; continue; }
    const next = leaves ? full(chart, leaves) : curr;
    if (ev) E({ t, type: "message", from: opt.from || "driver", to: id, name: ev });
    const re = new Set(opt.reenter || []);
    const from = [...curr].filter((x) => !next.has(x) || re.has(x)), to = [...next].filter((x) => !curr.has(x) || re.has(x));
    E({ t, type: "transition", actor: id, event: ev || "", from, to });
    E({ t, type: "config", actor: id, active: [...next] });
    if (opt.values) E({ t, type: "snapshot", actor: id, values: opt.values });
    curr = next;
  }
}
actor("receipt", "receipt", [[0, "@spawn", ["draft"]], [1500, "send", ["sent"]], [4000, "amend", ["draft"]], [6500, "send", ["sent"]]]);
const wsteps = [[0, "@spawn", ["ordered"]]]; for (let i = 0; i < 17; i++) wsteps.push([600 + i * 500, `step.${i}`, [stages[i + 1]]]);
wsteps.push([9300, "delivery.timeout", ["exception"]], [10000, "resolve", ["confirmed"]], [10400, "status.ping", null]);
actor("shipment", "shipment", wsteps);
actor("account", "account", [[0, "@spawn", ["account-idle"]], [800, "open.account", ["profile-idle"]], [1600, "open.profile", ["billing-idle"]], [2400, "open.billing", ["card-idle"]], [3200, "open.card", ["verification-idle"]], [4000, "open.verification", ["queued"]], [4800, "run", ["running"]], [5600, "pass", ["passed"]], [7000, "lock.card", ["card-locked"]], [8500, "unlock.card", ["card-idle"]]]);
actor("checkout", "checkout", [[0, "@spawn", ["authorising", "asking", "choosing"]], [1000, "go.pay", ["authorised", "asking", "choosing"]], [2000, "go.carrier", ["authorised", "booked", "choosing"]], [3000, "pause.payment", ["on-hold", "booked", "choosing"]], [3500, "pause.delivery", ["on-hold", "delivery-hold"]], [5000, "resume.payment", ["authorised", "delivery-hold"]], [6000, "resume.delivery", ["authorised", "booked", "choosing"]], [7000, "go.window", ["authorised", "booked", "chosen"]]]);
actor("import-job", "import-job", [[200, "@spawn", ["reading"]], [1500, "read.done", ["writing"]], [2800, "write.done", ["written"]], [2800, "", ["wrap"]], [4000, "wrapped", ["finished"]], [4000, "@end"]]);
actor("order", "order", [[0, "@spawn", ["placed"]], [1000, "pay", ["paying"]], [5000, "done.invoke.pay", ["paid"], { from: "order.pay" }], [7000, "ship", ["shipped"]]]);
actor("order.pay", "payment-run", [[1000, "@spawn", ["charging"]], [4000, "charged", ["settled"]], [5000, "@end"]], { parent: "order" });
const bsteps = [[0, "@spawn", ["listening"]]]; const ring = ["listening", "counting", "writing", "confirming"];
for (let i = 1; i <= 40; i++) bsteps.push([3000, "item.updated", [ring[i % 4]]]);
bsteps.push([8000, "item.updated", ["counting"]]);
actor("inventory-sync", "inventory-sync", bsteps);
actor("task", "task", [[0, "@spawn", ["planning"]], [1500, "plan.done", ["calling-tool"]], [4000, "@end"], [6000, "@spawn", ["calling-tool"]], [7500, "tool.done", ["summarising"]], [9000, "summary.done", ["complete"]]]);
actor("cart", "cart", [[0, "@spawn", ["browsing"], {}], [0, "", null, { values: { items: [], total: 0, currency: "EUR", coupon: null, express: false, notes: [], updatedAt: 0, ownerId: "u1", attempts: 0, warnings: [], address: {}, taxRate: 0.2 } }],
  [1000, "add", ["browsing"], { reenter: ["browsing"], values: { items: ["mug"], total: 12, currency: "EUR", coupon: null, express: false, notes: [], updatedAt: 1, ownerId: "u1", attempts: 0, warnings: [], address: {}, taxRate: 0.2 } }],
  [2500, "add", ["browsing"], { reenter: ["browsing"], values: { items: ["mug", "tea"], total: 20, currency: "EUR", coupon: "TEN", express: true, notes: ["gift"], updatedAt: 2, ownerId: "u1", attempts: 0, warnings: [], address: { city: "Tartu" }, taxRate: 0.2 } }],
  [4000, "checkout", ["checking-out"], { values: { items: ["mug", "tea"], total: 18, currency: "EUR", coupon: "TEN", express: true, notes: ["gift"], updatedAt: 3, ownerId: "u1", attempts: 1, warnings: [], address: { city: "Tartu" }, taxRate: 0.2 } }],
  [6000, "cancel", ["browsing"]]]);
actor("session", "session", [[0, "@spawn", ["connected"]], [2000, "drop", ["reconnecting"]], [3000, "reconnected", ["connected"]], [5000, "drop", ["reconnecting"]], [7000, "give-up", ["closed"]], [7000, "@end"]]);
// cleanup: the self-message steps with no event and null leaves are snapshots only
const out = events.filter((e) => !(e.type === "transition" && !e.from.length && !e.to.length && !e.event));
out.sort((a, b) => a.t - b.t); out.forEach((e, i) => (e.id = `e${i + 1}`));
for (const a of actors) { const ends = out.filter((e) => e.type === "end" && e.actor === a.id); const spawns = out.filter((e) => e.type === "spawn" && e.actor === a.id); if (ends.length && ends.length >= spawns.length) a.diedAt = ends[ends.length - 1].t; }
const trace = { system: "shapes", scenario: "head fixtures", duration: 11000, charts, actors, externals: [{ id: "driver", label: "test driver", kind: "user" }], events: out };
mkdirSync(path.join(here, "shapes"), { recursive: true });
writeFileSync(path.join(here, "shapes", "trace.json"), JSON.stringify(trace, null, 1));
console.log("wrote", out.length, "events,", Object.keys(charts).length, "charts,", actors.length, "actors");
