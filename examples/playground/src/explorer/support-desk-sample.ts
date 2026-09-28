/**
 * Sample: "support-desk" — a generated helpdesk system sized to stress the
 * explorer (see support-desk-generator.ts for the shape).
 */
import type { Clock, SCXMLSession } from "@tinyactors/scxmljs/trusted";
import { FakeService } from "./fake-services.ts";
import type { Sample } from "./sample.ts";
import { MACROS, PROCESSORS, QUEUE_LIST, supportDeskChart, TEAMS } from "./support-desk-generator.ts";

/** Latency per processor (ms): chat is snappy, the CRM and Jira are slow. */
const LATENCY: Record<string, number> = { email: 900, chat: 300, telephony: 600, crm: 1400, jira: 2000 };

/**
 * One ticket's journey, as a list of external events. `{q}` / `{t}` / `{m}`
 * are replaced by a rotating queue, team and macro so every run of the loop
 * exercises different states.
 */
const JOURNEY: string[] = [
  "ticket.created",
  "sentiment.negative",
  "route.{q}",
  "ticket.accept",
  "agent.assign.{t}",
  "notify.queue",
  "triage.done",
  "macro.{m}",
  "agent.request-info",
  "sla.warning",
  "customer.reply",
  "kb.suggest",
  "agent.consult",
  "internal.answer",
  "ticket.escalate",
  "escalation.promote",
  "escalation.promote",
  "vendor.involve",
  "sla.breach",
  "vendor.ack",
  "vendor.patch.approved",
  "billing.hold",
  "vendor.patch.deployed",
  "sentiment.calm",
  "kb.apply",
  "sla.reset",
  "billing.release",
  "macro.{m}",
  "staffing.surge",
  "ticket.close",
  "agent.release",
  "staffing.normal",
  "kb.feedback",
  "audit.export",
  "metrics.snapshot",
];

export const supportDeskSample: Sample = {
  id: "support-desk",
  title: "Support desk (stress test)",
  description: "A generated helpdesk: 14 invoked machines, 5 services, a 10-region parallel floor, 64 routing queues and 600+ transitions.",
  source: async () => supportDeskChart(),
  loader: (src) => {
    throw new Error(`support-desk has no external files (asked for "${src}")`);
  },
  ioprocessors(clock: Clock) {
    return PROCESSORS.map((p) => new FakeService({ type: p.type, alias: p.alias, clock, latencyMs: LATENCY[p.alias] }));
  },
  drive(session: SCXMLSession, clock: Clock) {
    let step = 0;
    let timer: unknown;
    const next = () => {
      const loop = Math.floor(step / JOURNEY.length);
      const q = QUEUE_LIST[(loop * 7) % QUEUE_LIST.length]!;
      const event = JOURNEY[step % JOURNEY.length]!.replace("{q}", `${q.category}.${q.sub}`)
        .replace("{t}", TEAMS[(loop * 3) % TEAMS.length]!)
        .replace("{m}", MACROS[(step * 5) % MACROS.length]!);
      session.send(event);
      // every third loop: a maintenance window in the middle of a ticket (history brings the floor back)
      if (loop % 3 === 2 && step % JOURNEY.length === 12) {
        session.send("system.maintenance.start");
        clock.setTimeout(() => session.send("system.maintenance.end"), 2500);
      }
      step++;
      timer = clock.setTimeout(next, step % 2 ? 1200 : 1700);
    };
    timer = clock.setTimeout(next, 1000);
    return () => clock.clearTimeout(timer);
  },
};
