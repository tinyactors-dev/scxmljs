// node board/fixtures/make.mjs : writes small hand-made traces (SCHEMA.md shape) for shapes the
// recorded examples may lack, into board/fixtures/<name>/trace.json:
//   checkout     one actor, a chart with parallel regions, a 2.4 s run, no stories
//   job-queue    a dispatcher + 64 short-lived jobs (about 20 alive at once), a process kill
//                (mass death) and a restart that resumes jobs (rebirth), ~4 minutes
//   orders       3 orders that invoke payment children, a 10-minute wait with a reminder, one
//                failed payment retried; NO cause/via links (episodes from time bursts)
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);

const S = (id, kind = "atomic", children = [], extra = {}) => ({ id, kind, children, transitions: [], ...extra });

class Rec {
  constructor(system) { this.system = system; this.events = []; this.n = 0; this.actors = []; this.externals = []; this.charts = {}; this.live = new Map(); }
  ev(o) { o.id = "x" + this.n++; this.events.push(o); return o; }
  chart(name, children, extra = {}) {
    const root = S("__root__", "compound", children);
    const parent = new Map(); const nodes = new Map();
    (function walk(n, p) { nodes.set(n.id, n); if (p) parent.set(n.id, p.id); for (const c of n.children) walk(c, n); })(root, null);
    this.charts[name] = { root, ...extra, _parent: parent, _nodes: nodes };
  }
  ext(id, label, kind) { this.externals.push({ id, label, kind }); }
  anc(chart, leaves) { const p = this.charts[chart]._parent; const out = new Set(); for (const l of leaves) { let x = l; while (x && x !== "__root__") { out.add(x); x = p.get(x); } } return out; }
  config(t, a) { const act = [...this.anc(a.chart, a.leaves)]; this.ev({ t, type: "config", actor: a.id, active: act }); }
  spawn(t, id, chart, leaves, { label, parent, cause } = {}) {
    const a = { id, chart, label: label || id, role: chart, bornAt: t, ...(parent ? { parent } : {}) };
    this.actors.push(a); const st = { ...a, leaves: new Set(leaves) }; this.live.set(id, st);
    const sp = this.ev({ t, type: "spawn", actor: id, ...(cause ? { cause } : {}) });
    this.config(t, st); return sp;
  }
  go(t, id, event, from, to, cause) {
    const a = this.live.get(id); const before = this.anc(a.chart, a.leaves);
    for (const f of [].concat(from)) a.leaves.delete(f);
    for (const x of [].concat(to)) a.leaves.add(x);
    const after = this.anc(a.chart, a.leaves);
    const tr = this.ev({ t, type: "transition", actor: id, event, from: [...before].filter((x) => !after.has(x)).concat([].concat(from).filter((x) => after.has(x))), to: [...after].filter((x) => !before.has(x)).concat([].concat(to).filter((x) => before.has(x))), ...(cause ? { cause } : {}) });
    this.config(t, a); return tr;
  }
  msg(t, from, to, name, cause, via) { return this.ev({ t, type: "message", from, to, name, ...(cause ? { cause } : {}), ...(via ? { via } : {}) }); }
  end(t, id, cause) { const a = this.actors.find((x) => x.id === id); a.diedAt = t; this.live.delete(id); return this.ev({ t, type: "end", actor: id, ...(cause ? { cause } : {}) }); }
  write(name, { strip = false, extra = {} } = {}) {
    // stable sort by t, then renumber ids e0.. and rewrite links
    const evs = this.events.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i).map((x) => x.e);
    const ren = new Map(evs.map((e, i) => [e.id, "e" + i]));
    for (const e of evs) { e.id = ren.get(e.id); if (e.cause) e.cause = ren.get(e.cause); if (e.via) e.via = ren.get(e.via); if (strip) { delete e.cause; delete e.via; } }
    const charts = Object.fromEntries(Object.entries(this.charts).map(([k, v]) => { const { _parent, _nodes, ...rest } = v; return [k, rest]; }));
    const duration = Math.ceil(Math.max(...evs.map((e) => e.t)) + 50);
    const out = { system: name, scenario: "fixture", duration, charts, actors: this.actors, externals: this.externals, events: evs, ...extra };
    fs.mkdirSync(path.join(here, name), { recursive: true });
    fs.writeFileSync(path.join(here, name, "trace.json"), JSON.stringify(out));
    console.log(name, evs.length, "events,", this.actors.length, "actors,", duration, "ms");
  }
}
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// ---------------------------------------------------------------- checkout: one actor, parallel regions
{
  const r = new Rec("checkout");
  r.chart("checkout", [
    S("cart", "atomic"),
    S("processing", "parallel", [
      S("payment", "compound", [S("authorizing"), S("declined"), S("retrying"), S("authorized")]),
      S("shipping", "compound", [S("waiting-for-payment"), S("packing"), S("labelled"), S("handed-over")]),
      S("receipt", "compound", [S("drafting"), S("sent")]),
    ]),
    S("complete", "final"),
  ], { purpose: "One checkout: payment, shipping and the receipt run side by side." });
  r.ext("customer", "the customer", "user"); r.ext("payments", "payment provider", "service"); r.ext("carrier", "the carrier", "service"); r.ext("mailer", "mail service", "service");
  r.spawn(0, "checkout-41", "checkout", ["cart"], { label: "Checkout #41" });
  const m0 = r.msg(200, "customer", "checkout-41", "checkout.submit");
  const t0 = r.go(200, "checkout-41", "checkout.submit", "cart", ["authorizing", "waiting-for-payment", "drafting"], m0.id);
  const a1 = r.msg(200, "checkout-41", "payments", "payment.authorize", m0.id, t0.id);
  const d1 = r.msg(650, "payments", "checkout-41", "payment.declined", a1.id);
  const t1 = r.go(650, "checkout-41", "payment.declined", "authorizing", "declined", d1.id);
  const t2 = r.go(900, "checkout-41", "retry", "declined", "retrying", t1.id);
  const a2 = r.msg(900, "checkout-41", "payments", "payment.authorize", t1.id, t2.id);
  const ok = r.msg(1300, "payments", "checkout-41", "payment.authorized", a2.id);
  const t3 = r.go(1300, "checkout-41", "payment.authorized", "retrying", "authorized", ok.id);
  const t4 = r.go(1300, "checkout-41", "payment.authorized", "waiting-for-payment", "packing", ok.id);
  const lb = r.msg(1300, "checkout-41", "carrier", "label.request", ok.id, t4.id);
  const lr = r.msg(1700, "carrier", "checkout-41", "label.ready", lb.id);
  const t5 = r.go(1700, "checkout-41", "label.ready", "packing", "labelled", lr.id);
  const pk = r.msg(2100, "carrier", "checkout-41", "parcel.picked-up", lb.id);
  const t6 = r.go(2100, "checkout-41", "parcel.picked-up", "labelled", "handed-over", pk.id);
  const ml = r.msg(2100, "checkout-41", "mailer", "receipt.send", pk.id, t6.id);
  const ms = r.msg(2250, "mailer", "checkout-41", "receipt.sent", ml.id);
  const t7 = r.go(2250, "checkout-41", "receipt.sent", "drafting", "sent", ms.id);
  const t8 = r.go(2250, "checkout-41", "done.state.processing", ["authorized", "handed-over", "sent"], "complete", t7.id);
  r.msg(2250, "checkout-41", "customer", "order.confirmed", ms.id, t8.id);
  r.end(2300, "checkout-41", t8.id);
  r.write("checkout");
}

// ---------------------------------------------------------------- job-queue: a swarm, a kill, a restart
{
  const r = new Rec("job-queue");
  r.chart("dispatcher", [S("idle"), S("dispatching"), S("draining"), S("stopped", "final")], { purpose: "Hands export jobs to workers." });
  r.chart("job", [S("queued"), S("running"), S("uploading"), S("retrying"), S("failed", "final"), S("done", "final")], { purpose: "One export job." });
  r.ext("client", "API clients", "user"); r.ext("storage", "object storage", "service"); r.ext("timers", "timers", "timer");
  let disp = "dispatcher"; r.spawn(0, disp, "dispatcher", ["idle"], { label: "Dispatcher" });
  let n = 0; const alive = new Map(); // id -> {phase, next}
  const SECOND = 1000; const KILL = 118 * SECOND, RESTART = 124 * SECOND, END = 230 * SECOND;
  const plan = []; // each job: submit time, run, upload, outcome
  let t = 500;
  while (t < 200 * SECOND) { plan.push({ at: Math.round(t) }); t += (t < 100 * SECOND ? 1900 : 2600) + rnd() * 2400; }
  const jobsIn = [];
  for (const p of plan) {
    if (p.at > KILL && p.at < RESTART + 500) continue;
    const id = `job-${++n}`; const sub = r.msg(p.at, "client", disp, "job.submit");
    const td = r.go(p.at, disp, "job.submit", "idle", "dispatching", sub.id);
    const sp = r.spawn(p.at + 5, id, "job", ["queued"], { label: `Job ${n}`, cause: td.id });
    r.go(p.at + 10, disp, "job.assigned", "dispatching", "idle", td.id);
    const run = p.at + 300 + rnd() * 2000; const up = run + 9000 + rnd() * 30000; const fin = up + 3000 + rnd() * 18000;
    const fails = rnd() < 0.16;
    jobsIn.push({ id, sub, sp, run, up, fin, fails });
  }
  // walk each job, cut at the kill
  const killed = [];
  for (const j of jobsIn) {
    const tr = r.go(j.run, j.id, "start", "queued", "running", j.sp.id);
    if (j.up >= KILL && j.run < KILL) { killed.push(j); continue; }
    if (j.run >= KILL) { killed.push(j); continue; }
    const tu = r.go(j.up, j.id, "rendered", "running", "uploading", tr.id);
    const put = r.msg(j.up, j.id, "storage", "object.put", tr.id, tu.id);
    if (j.fin >= KILL) { killed.push(j); continue; }
    if (j.fails) {
      const er = r.msg(j.fin, "storage", j.id, "error.put", put.id);
      const tf = r.go(j.fin, j.id, "error.put", "uploading", "failed", er.id);
      r.msg(j.fin, j.id, disp === "dispatcher" ? "dispatcher" : disp, "job.failed", er.id, tf.id);
      r.end(j.fin + 5, j.id, tf.id);
    } else {
      const okm = r.msg(j.fin, "storage", j.id, "object.stored", put.id);
      const tf = r.go(j.fin, j.id, "object.stored", "uploading", "done", okm.id);
      r.msg(j.fin, j.id, "dispatcher", "job.done", okm.id, tf.id);
      r.end(j.fin + 5, j.id, tf.id);
    }
  }
  // the kill: every live actor ends at once
  const victims = [...r.live.keys()];
  for (const id of victims) r.end(KILL, id);
  // restart: a new dispatcher, and the jobs that were in flight resume as new actors
  disp = "dispatcher-2"; const sp2 = r.spawn(RESTART, disp, "dispatcher", ["draining"], { label: "Dispatcher" });
  let k = 0;
  for (const j of killed) {
    if (j.sub.t > KILL) continue;
    const id = `job-${j.id.slice(4)}-r`; const s = r.spawn(RESTART + 2, id, "job", ["queued"], { label: `Job ${j.id.slice(4)}`, cause: sp2.id }); k++;
    const run = RESTART + 400 + rnd() * 1500; const tr = r.go(run, id, "start", "queued", "running", s.id);
    const up = run + 6000 + rnd() * 15000; const tu = r.go(up, id, "rendered", "running", "uploading", tr.id);
    const put = r.msg(up, id, "storage", "object.put", tr.id, tu.id);
    const fin = up + 2000 + rnd() * 9000; const okm = r.msg(fin, "storage", id, "object.stored", put.id);
    const tf = r.go(fin, id, "object.stored", "uploading", "done", okm.id);
    r.msg(fin, id, disp, "job.done", okm.id, tf.id); r.end(fin + 5, id, tf.id);
  }
  r.go(RESTART + 30000, disp, "drained", "draining", "idle");
  // new submissions after the restart
  for (let tt = RESTART + 32000; tt < END - 40000; tt += 3500 + rnd() * 4000) {
    const id = `job-${++n}`; const sub = r.msg(Math.round(tt), "client", disp, "job.submit");
    const td = r.go(Math.round(tt), disp, "job.submit", "idle", "dispatching", sub.id);
    const s = r.spawn(Math.round(tt) + 5, id, "job", ["queued"], { label: `Job ${n}`, cause: td.id });
    r.go(Math.round(tt) + 10, disp, "job.assigned", "dispatching", "idle", td.id);
    const run = tt + 500 + rnd() * 1500; const tr = r.go(run, id, "start", "queued", "running", s.id);
    const up = run + 5000 + rnd() * 9000; const tu = r.go(up, id, "rendered", "running", "uploading", tr.id);
    const put = r.msg(up, id, "storage", "object.put", tr.id, tu.id);
    const fin = up + 2000 + rnd() * 8000; const okm = r.msg(fin, "storage", id, "object.stored", put.id);
    const tf = r.go(fin, id, "object.stored", "uploading", "done", okm.id);
    r.msg(fin, id, disp, "job.done", okm.id, tf.id); r.end(fin + 5, id, tf.id);
  }
  r.write("job-queue");
}

// ---------------------------------------------------------------- orders: invoked children, a long wait, no causality
{
  const r = new Rec("orders");
  r.chart("order", [S("placed"), S("paying", "atomic", [], { invokes: [{ type: "scxml", id: "payment", src: "payment.scxml" }] }), S("payment-failed"), S("awaiting-shipment"), S("reminded"), S("shipped"), S("closed", "final")], { purpose: "An order from placement to delivery.", source: "order.scxml" });
  r.chart("payment", [S("authorizing"), S("capturing"), S("declined", "final"), S("captured", "final")], { purpose: "Charges the card for one order.", source: "payment.scxml" });
  r.ext("shop", "the shop front", "user"); r.ext("bank", "the bank", "service"); r.ext("warehouse", "the warehouse", "service"); r.ext("timers", "timers", "timer");
  const MIN = 60000;
  const orders = [{ id: "order-1001", at: 1000, fail: false, ship: 7.5 * MIN }, { id: "order-1002", at: 4000, fail: true, ship: 9.2 * MIN }, { id: "order-1003", at: 3.1 * MIN, fail: false, ship: 11.4 * MIN }];
  for (const o of orders) {
    r.spawn(o.at, o.id, "order", ["placed"], { label: `Order ${o.id.slice(6)}` });
    r.msg(o.at, "shop", o.id, "order.place");
    let t = o.at + 120; let attempt = 0;
    for (;;) {
      attempt++;
      r.go(t, o.id, "pay", attempt === 1 ? "placed" : "payment-failed", "paying");
      const pid = `${o.id}.payment-${attempt}`;
      r.spawn(t + 2, pid, "payment", ["authorizing"], { label: "Payment", parent: o.id });
      r.msg(t + 2, pid, "bank", "card.authorize");
      const declined = o.fail && attempt === 1;
      r.msg(t + 600, "bank", pid, declined ? "card.declined" : "card.authorized");
      if (declined) {
        r.go(t + 600, pid, "card.declined", "authorizing", "declined"); r.end(t + 610, pid);
        r.msg(t + 610, pid, o.id, "done.invoke.payment");
        r.go(t + 610, o.id, "error.payment", "paying", "payment-failed");
        t += 25000; continue;
      }
      r.go(t + 600, pid, "card.authorized", "authorizing", "capturing");
      r.msg(t + 600, pid, "bank", "card.capture"); r.msg(t + 1500, "bank", pid, "card.captured");
      r.go(t + 1500, pid, "card.captured", "capturing", "captured"); r.end(t + 1510, pid);
      r.msg(t + 1510, pid, o.id, "done.invoke.payment");
      r.go(t + 1510, o.id, "done.invoke.payment", "paying", "awaiting-shipment");
      r.msg(t + 1510, o.id, "warehouse", "shipment.request");
      t += 1510; break;
    }
    const rem = t + 5 * MIN;
    if (rem < o.ship) { r.msg(rem, "timers", o.id, "reminder"); r.go(rem, o.id, "reminder", "awaiting-shipment", "reminded"); r.msg(rem, o.id, "warehouse", "shipment.nudge"); }
    r.msg(o.ship, "warehouse", o.id, "shipment.dispatched");
    r.go(o.ship, o.id, "shipment.dispatched", rem < o.ship ? "reminded" : "awaiting-shipment", "shipped");
    r.msg(o.ship, o.id, "shop", "order.shipped");
    r.go(o.ship + 400, o.id, "close", "shipped", "closed"); r.end(o.ship + 420, o.id);
  }
  r.write("orders", { strip: true });
}
