/**
 * Scale: a support desk whose dispatcher spawns a ticket machine for each of 60 tickets arriving over
 * ~35 s (about 20 alive at peak). Tickets report back across sessions (#_scxml_), refunds wait for
 * the dispatcher's approval, bugs wait for the customer; every ticket ends in its final state.
 * Charts: ../charts/dispatcher.scxml, ../charts/ticket.scxml (synthetic, written for this test).
 * Run: bun prototypes/office/tracer/drivers/many.ts
 */
import { readFile } from "node:fs/promises";
import { compile, type IOProcessor, parseSCXML, Session, VirtualClock } from "@tinyactors/scxmljs/trusted";
import { Window } from "happy-dom";
import { createTracer, leadingComment } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const chart = (n: string) => readFile(new URL(`../charts/${n}.scxml`, import.meta.url), "utf8");
const [dispatcherSrc, ticketSrc] = await Promise.all([chart("dispatcher"), chart("ticket")]);
const domParser = new (new Window().DOMParser)() as never;
const clock = new VirtualClock();
const tracer = createTracer({
  system: "many",
  scenario: "support-desk-60-tickets",
  clock,
  appCause: "same-tick",
  app: { id: "customers", label: "customers writing in", kind: "user" },
  identify: (_s, info) => {
    const t = info.data.ticket as { id: string; kind: string } | undefined;
    if (t) return { id: t.id, label: `${t.id} (${t.kind})`, role: `${t.kind} ticket`, chart: "ticket", source: "ticket.scxml", purpose: leadingComment(ticketSrc) };
    return { id: "dispatcher", label: "dispatcher", role: "the desk's dispatcher", chart: "dispatcher", source: "dispatcher.scxml", purpose: leadingComment(dispatcherSrc) };
  },
});
tracer.external("pool", { label: "the ticket pool (spawns ticket machines)", kind: "service" });
const ticketModel = await compile(parseSCXML(ticketSrc, domParser));
const dispatcherModel = await compile(parseSCXML(dispatcherSrc, domParser));
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const tickets: Session[] = [];
let dispatcher!: Session;
const pool: IOProcessor = {
  type: "urn:example:pool",
  aliases: ["pool"],
  location: () => "urn:example:pool",
  send(m) {
    const ticket = (m.data as { ticket: unknown }).ticket;
    // after the dispatcher's step: the spawn follows its send to the pool
    clock.defer(() => {
      const s = new Session(ticketModel, { clock, data: { ticket, dispatcher: `#_scxml_${dispatcher.sessionId}` } });
      tracer.observe(s);
      tickets.push(s);
      s.start();
    });
  },
};
dispatcher = new Session(dispatcherModel, { clock, ioprocessors: [pool] });
tracer.observe(dispatcher);
dispatcher.start();
const { wait } = clockDriver(clock, 20);
tracer.caption("The desk opens. Tickets arrive about twice a second; each gets a machine of its own.");
const KINDS = ["question", "question", "bug", "refund", "question", "bug"];
for (let i = 1; i <= 60; i++) {
  const kind = KINDS[Math.floor(rand() * KINDS.length)]!;
  const ticket = { id: `T-${String(i).padStart(3, "0")}`, kind, triageMs: 300 + Math.floor(rand() * 900), workMs: 3000 + Math.floor(rand() * 7000) };
  dispatcher.send("ticket.new", ticket);
  if (i === 30) tracer.caption("Midway: the desk is at its busiest.");
  await wait(250 + Math.floor(rand() * 600));
}
tracer.caption("No more tickets: the desk works through what is open.");
await wait(25_000);
console.log(`tickets: ${tickets.length}, done: ${tickets.filter((t) => t.status === "done").length}, dispatcher:`, dispatcher.snapshot());
const trace = tracer.finish();
for (const s of [dispatcher, ...tickets]) s.dispose();
await writeTrace("many", trace);
process.exit(0);
