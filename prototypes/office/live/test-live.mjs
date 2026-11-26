// node prototypes/office/live/test-live.mjs [system...] [--shots] [--keep]
// Live mode in a real browser (Playwright, software GL). For each system it
//   1. loads ?live=<system>&still=1 and checks there are no page errors;
//   2. asserts stillness: two screenshots 3 s apart are pixel-identical;
//   3. runs the system's script: walks the visitor up to each control (the page's autopilot steers the real
//      first-person walker), presses it at its screen position (a real mouse click at the point the page
//      reports), advances the clock, and checks window.live.snapshot();
//   4. checks the room comes to rest again after each press, and resets.
// With --shots it writes close-ups of every control to live/out/ (not published) to look at.
import { createRequire } from "node:module";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../.."); // prototypes/
const outDir = path.join(here, "out");
const args = process.argv.slice(2);
const SHOTS = args.includes("--shots");
const only = args.filter((a) => !a.startsWith("--"));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".scxml": "application/xml" };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split("?")[0])); if (!f.startsWith(root) || !existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); r.end(readFileSync(f)); });
await new Promise((r) => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}/office/index.html`;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
mkdirSync(outDir, { recursive: true });

let failures = 0;
const ok = (cond, what) => { if (cond) console.log(`  ok   ${what}`); else { failures++; console.log(`  FAIL ${what}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What each system's script does: steps of {press: label-regex, at?, expect(snapshot)} or {advance: true, expect} */
const SCRIPTS = {
  microwave: [
    { check: (s) => s.actors.microwave?.states.includes("off") && s.actors.microwave.states.includes("closed"), what: "boots off, door closed" },
    { inert: /TURN OFF/, what: "TURN OFF is inert while off" },
    { press: /^TURN ON$/, expect: (s) => s.actors.microwave.states.includes("cooking"), what: "TURN ON: it cooks" },
    { check: (s) => s.pendingTimers > 0, what: "the cooking tick is pending on the clock" },
    { advance: true, expect: (s) => s.actors.microwave.values.timer === 1, what: "the clock advances one tick: timer = 1" },
    { press: /^OPEN DOOR$/, expect: (s) => s.actors.microwave.states.includes("open") && s.actors.microwave.states.includes("idle"), what: "OPEN DOOR: cooking pauses" },
    { check: (s) => s.pendingTimers === 0, what: "an open door leaves no timer" },
    { press: /^CLOSE DOOR$/, expect: (s) => s.actors.microwave.states.includes("cooking"), what: "CLOSE DOOR: cooking again" },
    { advance: 4, expect: (s) => s.actors.microwave.states.includes("off") && s.actors.microwave.values.timer >= 5, what: "five ticks later it switches itself off" },
    { past: true, what: "the board touched in the past: the room shows that moment, the inputs go inert, ADVANCE TIME returns to now" },
    { reset: true, expect: (s) => s.actors.microwave.states.includes("off") && s.actors.microwave.values.timer === 0 && s.events < 40, what: "START OVER" },
  ],
  checkout: [
    { check: (s) => s.actors.checkout?.states.includes("cart"), what: "boots in the cart" },
    { inert: /^CHECKOUT$/, what: "CHECKOUT is inert with an empty cart (its cond is judged)" },
    { press: /ADD NOTEBOOK/, expect: (s) => s.actors.checkout.values.cart?.length === 1, what: "ADD NOTEBOOK" },
    { press: /^CHECKOUT$/, expect: (s) => s.actors.checkout.states.includes("shipping"), what: "CHECKOUT: shipping" },
    { press: /^SHIP/, expect: (s) => s.actors.checkout.states.includes("payment"), what: "SHIP: payment" },
    { press: /PAY BY CARD/, expect: (s) => !s.actors.checkout, what: "PAY: placed (the final state ends the session: the shopper leaves)" },
    { press: /NEW SHOPPER/, expect: (s) => Object.values(s.actors).some((x) => x.states.includes("cart")), what: "NEW SHOPPER: a new checkout session" },
    { reset: true, expect: (s) => s.actors.checkout?.states.includes("cart"), what: "START OVER" },
  ],
  fulfillment: [
    { press: /DESK LAMP ORDER/, expect: (s) => Object.keys(s.actors).some((a) => a.startsWith("order-")), what: "the shop places an order: an order machine arrives" },
    { advanceUntil: (s) => Object.keys(s.actors).some((a) => /payment/.test(a)), max: 12, what: "the clock runs the services until the payment child is invoked" },
    { advanceUntil: (s) => s.state?.waiting > 0, max: 6, what: "the bank waits for the visitor" },
    { shot: "bank-waiting", of: /^APPROVE$/ },
    { press: /^APPROVE$/, expect: (s) => true, what: "APPROVE the payment at the bank" },
    { advanceUntil: (s) => Object.keys(s.actors).some((a) => /shipment/.test(a)) || Object.values(s.actors).some((x) => x.states.includes("fulfilment")), max: 30, what: "paid: the order goes on to fulfilment" },
    { press: /SMALL ORDER/, expect: (s) => Object.keys(s.actors).filter((a) => /^order-[^/]*$/.test(a)).length >= 2, what: "a second order" },
    { advanceUntil: (s) => s.state?.waiting > 0, max: 16, what: "its payment waits at the bank" },
    { press: /^DECLINE$/, expect: () => true, what: "DECLINE it" },
    { shot: "order-desk", of: /CUSTOMER CANCELS/ },
    { shot: "room" },
    { press: /CUSTOMER CANCELS/, expect: (s) => Object.values(s.actors).some((x) => x.states.includes("cancelling")) || Object.keys(s.actors).filter((a) => /^order-[^/]*$/.test(a)).length < 2, what: "the customer cancels an order" },
    { reset: true, expect: (s) => !Object.keys(s.actors).length, what: "START OVER: no orders" },
  ],
  "pi-durable": [
    { check: (s) => s.actors.harness && s.actors.you?.states.includes("live"), what: "boots: process 1's harness, Ada attached" },
    { press: /WHAT'S IN THE REPO\?/, expect: (s) => s.pendingTimers > 0 && s.state.tasks.length === 0, what: "Ada asks: the question waits on the wire (a pending timer), no task yet" },
    { press: /LET IT WORK/, expect: (s) => s.state.tasks.every((t) => /terminal|reminder/.test(t)), what: "LET IT WORK: the generation and its tools run to the end" },
    { press: /REMIND ME/, expect: (s) => true, what: "Ada asks for a reminder" },
    { press: /LET IT WORK/, expect: (s) => s.state.tasks.some((t) => t.startsWith("app.reminder")), what: "a reminder task is waiting on its timer" },
    { press: /WHY SLOW\?/, expect: (s) => s.state.tasks.some((t) => !/terminal/.test(t)), what: "another question: tasks running" },
    { shot: "room" },
    { press: /KILL PROCESS/, expect: (s) => s.state.alive === false && !s.actors.harness, what: "KILL PROCESS: every actor of the process is gone" },
    { press: /START PROCESS/, expect: (s) => s.state.alive === true && !!s.actors["harness~2"] && Object.keys(s.actors).some((a) => /~2$/.test(a) && a !== "harness~2"), what: "START PROCESS: a second harness, the unfinished tasks reborn (~2) from their checkpoints" },
    { reset: true, expect: (s) => s.actors.harness && s.state.tasks.length === 0, what: "START OVER" },
  ],
  "llm-chat": [
    { check: (s) => s.actors.host && s.actors.ada?.states.includes("live"), what: "boots: the host, the workspace and Ada, live" },
    { inert: /^ANSWER$/, what: "the model's ANSWER lever is inert with nothing asked" },
    { press: /^HELLO$/, expect: (s) => s.actors.host.states.includes("requesting"), what: "Ada says hello: the host asks the model, which waits" },
    { check: (s) => s.pendingTimers > 0, what: "the model's answer is pending on the clock" },
    { shot: "model-waiting", of: /^ANSWER$/ },
    { press: /^ANSWER$/, expect: (s) => s.actors.host.states.includes("idle"), what: "ANSWER: the model writes its answer, the host is idle again" },
    { press: /TERMINAL JOINS/, expect: (s) => s.actors.terminal?.states.includes("live"), what: "a terminal joins as a tool provider" },
    { press: /^FILES\?$/, expect: (s) => s.actors.host.states.includes("requesting"), what: "Ada asks about the files" },
    { press: /^ANSWER$/, expect: (s) => s.actors.host.states.includes("tools") || s.actors.host.states.includes("idle"), what: "the model calls the shell tool" },
    { shot: "room" },
    { press: /RUN THE TOOLS/, expect: (s) => !s.actors.host.states.includes("tools"), what: "RUN THE TOOLS: the terminal answers" },
    { press: /^ANSWER$/, expect: (s) => s.actors.host.states.includes("idle"), what: "the model writes the result" },
    { press: /^LEAVE$/, pick: (cs) => cs.find((c) => c.at === "terminal" && /LEAVE/.test(c.label)), expect: (s) => !s.actors.terminal, what: "the terminal leaves" },
    { reset: true, expect: (s) => s.actors.ada && !s.actors.terminal, what: "START OVER" },
  ],
};

/** Stand the visitor `dist` m in front of a control, facing it (for close-up shots only: a press walks there). */
async function lookAt(page, c, dist) {
  await page.evaluate(([w, f, dist]) => { const a = window.api, p = a.fp.player; p.place({ x: w[0] + f[0] * dist + f[2] * 0.25, z: w[2] + f[2] * dist - f[0] * 0.25 }); p.face({ x: w[0], y: w[1], z: w[2] }); a.tick(0.05); }, [c.world, c.facing, dist]);
}
/** Walk the visitor up to a control the way a visitor would (the page's autopilot drives the real walker round the
 *  furniture), facing it; the test steps the world faster than it renders. */
async function walkTo(page, c) {
  const ok = await page.evaluate((id) => window.api.fp.approachTo({ control: id }), c.id);
  if (!ok) throw new Error(`cannot walk to ${c.label}`);
  for (let i = 0; i < 400; i++) { if (!(await page.evaluate(() => { window.api.tick(0.2); return window.api.fp.busy(); }))) break; }
  const r = await page.evaluate(() => window.api.fp.last());
  if (!r.ok) throw new Error(`did not reach ${c.label}`);
}
/** Back to where a visitor comes in (H without its fade). */
const atDoor = (page) => page.evaluate(() => { const a = window.api; a.fp.spawn("test"); a.tick(0.05); });
async function screen(page) { return page.evaluate(() => window.live.screen()); }
async function settle(page, max = 60000) {
  const t0 = Date.now();
  await page.waitForFunction(() => !window.live.busy, null, { timeout: max });
  // let the room play the chain out (accelerate: the test does not watch)
  while (Date.now() - t0 < max) { const r = await page.evaluate(() => { const l = window.live; return { rest: l.atRest() }; }); if (r.rest) break; await page.evaluate(() => window.api.tick(1.5)); }
}
async function clickControl(page, re, { expectEnabled = true, pick } = {}) {
  const all = await screen(page);
  const cs = pick ? [pick(all)].filter(Boolean) : all.filter((c) => re.test(c.label));
  if (!cs.length) throw new Error(`no control ${re}: ${(await screen(page)).map((c) => c.label).join(", ")}`);
  const c = cs.find((x) => x.enabled) || cs[0];
  // walk up to it so the click is a real one, within reach, at a real point
  await walkTo(page, c);
  const c2 = (await screen(page)).find((x) => x.id === c.id);
  if (expectEnabled && !c2.enabled) throw new Error(`control ${c.label} is inert`);
  await page.mouse.click(c2.x, c2.y);
  return c2;
}

for (const system of only.length ? only : Object.keys(SCRIPTS)) {
  console.log(`\n${system}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}?live=${system}&still=1&nolock=1`); // no pointer lock: the clicks land where the test points
  try { await page.waitForFunction(() => window.ready === true && window.live, null, { timeout: 60000 }); }
  catch { failures++; console.log(`  FAIL does not load: ${errors.join(" | ") || "(no error)"}`); await page.close(); continue; }
  await sleep(500);
  ok(!errors.length, `loads without errors ${errors.slice(0, 3).join(" | ")}`);
  // stillness where the visitor comes in
  await atDoor(page);
  await sleep(600);
  const a1 = await page.screenshot(); await sleep(3000); const a2 = await page.screenshot();
  ok(a1.equals(a2), "still: two screenshots 3 s apart are identical");
  if (!a1.equals(a2)) { writeFileSync(path.join(outDir, `${system}-still-a.png`), a1); writeFileSync(path.join(outDir, `${system}-still-b.png`), a2); }
  if (SHOTS) {
    writeFileSync(path.join(outDir, `${system}-home.png`), a1);
    const cs = await screen(page);
    const seen = new Set();
    for (const c of cs) {
      const key = c.at + (c.kind === "lever" ? c.id : ""); if (seen.has(key)) continue; seen.add(key);
      // 2 m in front of it, at eye height
      await lookAt(page, c, 2.0);
      await sleep(250);
      await page.screenshot({ path: path.join(outDir, `${system}-control-${c.id.replace(/[^a-z0-9]+/gi, "_")}.png`) });
    }
  }
  for (const st of SCRIPTS[system] || []) {
    try {
      if (st.shot) {
        if (!SHOTS) continue;
        if (st.of) { const c = (await screen(page)).find((x) => st.of.test(x.label)); if (c) await lookAt(page, c, 2.0); }
        else await atDoor(page);
        await sleep(300); await page.screenshot({ path: path.join(outDir, `${system}-${st.shot}.png`) }); continue;
      }
      if (st.past) {
        await page.evaluate(() => { window.live.viewPast(1.0); window.api.tick(0.6); });
        await sleep(500);
        const s1 = await page.evaluate(() => window.live.snapshot());
        const inputs = (await screen(page)).filter((c) => c.id.startsWith("in:"));
        ok(s1.viewingPast && inputs.every((c) => !c.enabled), "  looking back: every input is inert");
        await clickControl(page, /ADVANCE TIME/); await sleep(300);
        const s2 = await page.evaluate(() => window.live.snapshot());
        ok(!s2.viewingPast && s2.atRest, st.what); continue;
      }
      if (st.check) { ok(st.check(await page.evaluate(() => window.live.snapshot())), st.what); continue; }
      if (st.inert) { const c = (await screen(page)).find((x) => st.inert.test(x.label)); ok(c && !c.enabled, st.what); if (c) { await walkTo(page, c); const before = await page.evaluate(() => window.live.snapshot().events); const c2 = (await screen(page)).find((x) => x.id === c.id); await page.mouse.click(c2.x, c2.y); await sleep(300); ok((await page.evaluate(() => window.live.snapshot().events)) === before, "  pressing it does nothing"); } continue; }
      if (st.press) { await clickControl(page, st.press, { pick: st.pick }); }
      else if (st.advance) { for (let i = 0; i < (st.advance === true ? 1 : st.advance); i++) { await clickControl(page, /ADVANCE TIME/); await settle(page); } }
      else if (st.advanceUntil) { let s; for (let i = 0; i < st.max; i++) { s = await page.evaluate(() => window.live.snapshot()); if (st.advanceUntil(s)) break; await clickControl(page, /ADVANCE TIME/); await settle(page); } s = await page.evaluate(() => window.live.snapshot()); ok(st.advanceUntil(s), st.what); continue; }
      else if (st.reset) { await clickControl(page, /START OVER/); await page.waitForFunction(() => !window.live.busy, null, { timeout: 60000 }); await sleep(300); }
      await settle(page);
      const s = await page.evaluate(() => window.live.snapshot());
      ok(st.expect(s), `${st.what}  [${Object.entries(s.actors).map(([a, x]) => `${a}: ${x.states.filter((q) => !q.startsWith("__")).join(" ")}`).join(" · ")}]`);
      ok(s.atRest, "  comes to rest");
    } catch (err) { failures++; console.log(`  FAIL ${st.what}: ${err.message}`); }
  }
  // still again after all that
  await atDoor(page);
  await sleep(600);
  const b1 = await page.screenshot(); await sleep(3000); const b2 = await page.screenshot();
  ok(b1.equals(b2), "still again at the end");
  ok(!errors.length, `no page errors ${errors.slice(0, 3).join(" | ")}`);
  await page.close();
}
await browser.close(); srv.close();
console.log(failures ? `\n${failures} failures` : "\nall passed");
process.exit(failures ? 1 : 0);
