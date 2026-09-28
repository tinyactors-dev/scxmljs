/**
 * Generates the "support-desk" stress chart: a helpdesk system sized to
 * stress an explorer UI (hundreds of states, a 60+ wide routing level, deep
 * escalation nesting, a 10-region <parallel>, 600+ transitions, 120+ event
 * names, 14 invoked child machines talking to 5 I/O processors).
 *
 * Pure construction — no randomness — so the output is identical every time.
 */

// ─────────────────────────────── vocabulary ───────────────────────────────

/** Routing queues: category → sub-queues. Each becomes a state `q-<cat>-<sub>` and an event `route.<cat>.<sub>`. */
export const QUEUES: Record<string, string[]> = {
  billing: ["refunds", "invoices", "chargebacks", "tax", "plans", "coupons", "payment-methods"],
  auth: ["sso", "mfa", "password-reset", "lockout", "api-keys", "permissions"],
  product: ["bugs", "feature-requests", "performance", "integrations", "mobile", "desktop", "web", "api"],
  data: ["export", "import", "deletion", "gdpr", "retention", "backups"],
  enterprise: ["onboarding", "contracts", "renewals", "procurement", "security-review", "sla-credits"],
  shipping: ["tracking", "damaged", "returns", "customs", "address-change"],
  accounts: ["upgrades", "downgrades", "cancellations", "transfers", "merges"],
  security: ["phishing", "vulnerability", "abuse", "compromised-account"],
  legal: ["dmca", "subpoena", "privacy-request"],
  partners: ["resellers", "marketplace", "affiliates"],
  education: ["courses", "certifications", "webinars"],
  hardware: ["devices", "firmware", "warranty", "repairs"],
  general: ["questions", "feedback", "press", "careers"],
};

export const QUEUE_LIST: { category: string; sub: string; state: string; event: string }[] = Object.entries(QUEUES).flatMap(
  ([category, subs]) => subs.map((sub) => ({ category, sub, state: `q-${category}-${sub}`, event: `route.${category}.${sub}` })),
);

/** Agent teams (assignment region). */
export const TEAMS = [
  "billing",
  "auth",
  "product",
  "data",
  "enterprise",
  "shipping",
  "accounts",
  "security",
  "legal",
  "partners",
  "education",
  "hardware",
  "tier2",
  "tier3",
  "vip",
];

/** Canned-response macros (macros region): targetless `macro.<name>` transitions. */
export const MACROS = [
  "greeting",
  "apology",
  "refund-issued",
  "password-reset-link",
  "known-issue",
  "workaround",
  "request-logs",
  "request-screenshot",
  "escalated-to-engineering",
  "vendor-contacted",
  "follow-up",
  "closing-survey",
  "gdpr-confirmation",
  "invoice-resent",
  "plan-changed",
  "outage-notice",
  "maintenance-window",
  "feature-logged",
  "duplicate-merged",
  "spam-closed",
  "handoff-note",
  "vip-priority",
  "legal-hold",
  "thank-you",
];

/** I/O processors used by the chart (type URI + short alias). */
export const PROCESSORS = [
  { alias: "email", type: "urn:example:support:email" },
  { alias: "chat", type: "urn:example:support:chat" },
  { alias: "telephony", type: "urn:example:support:telephony" },
  { alias: "crm", type: "urn:example:support:crm" },
  { alias: "jira", type: "urn:example:support:jira" },
] as const;

/** Invoked child machines: id, processor alias, verb it performs, event it reports to the parent, cooldown (ms). */
export const CHILDREN = [
  { id: "email-intake", alias: "email", verb: "poll", report: "channel.email.message", cool: 4000 },
  { id: "chat-intake", alias: "chat", verb: "poll", report: "channel.chat.message", cool: 3000 },
  { id: "phone-intake", alias: "telephony", verb: "poll", report: "channel.phone.call", cool: 5000 },
  { id: "social-intake", alias: "chat", verb: "listen", report: "channel.social.mention", cool: 7000 },
  { id: "triage-bot", alias: "crm", verb: "classify", report: "triage.suggestion", cool: 4500 },
  { id: "sla-monitor", alias: "crm", verb: "sla-check", report: "sla.tick", cool: 6000 },
  { id: "csat-survey", alias: "email", verb: "survey", report: "csat.response", cool: 8000 },
  { id: "team-billing", alias: "jira", verb: "queue-stats", report: "team.billing.capacity", cool: 9000 },
  { id: "team-auth", alias: "jira", verb: "queue-stats", report: "team.auth.capacity", cool: 9500 },
  { id: "team-product", alias: "jira", verb: "queue-stats", report: "team.product.capacity", cool: 10000 },
  { id: "team-enterprise", alias: "jira", verb: "queue-stats", report: "team.enterprise.capacity", cool: 10500 },
  { id: "escalation-desk", alias: "jira", verb: "sync", report: "escalation.desk.update", cool: 7500 },
  { id: "kb-indexer", alias: "crm", verb: "index", report: "kb.indexed", cool: 12000 },
  { id: "crm-sync", alias: "crm", verb: "sync", report: "crm.synced", cool: 6500 },
];

// ─────────────────────────────── XML helpers ───────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Attrs = Record<string, string | number | undefined>;
const attrs = (a: Attrs) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");

/** `<tag attrs>children</tag>` or self-closing. Children are joined with newlines. */
export function el(tag: string, a: Attrs = {}, ...children: (string | false | null | undefined)[]): string {
  const body = children.filter(Boolean).join("\n");
  return body ? `<${tag}${attrs(a)}>\n${body}\n</${tag}>` : `<${tag}${attrs(a)}/>`;
}

/** A transition, optionally with executable content. */
export function tr(event: string | undefined, target?: string, cond?: string, ...content: string[]): string {
  return el("transition", { event, target, cond }, ...content);
}

export const assign = (location: string, expr: string) => el("assign", { location, expr });
export const onentry = (...content: string[]) => el("onentry", {}, ...content);

// ─────────────────────────────── child machines ───────────────────────────────

/** A small but real child machine: ask a processor, report to the parent, cool down, repeat. */
function childMachine(c: (typeof CHILDREN)[number]): string {
  const machine = el("param", { name: "machine", expr: `'${c.id}'` });
  const scxml = el(
    "scxml",
    { version: "1.0", datamodel: "ecmascript", name: c.id, initial: "starting" },
    el("datamodel", {}, el("data", { id: "cycles", expr: "0" }), el("data", { id: "failures", expr: "0" })),
    el("state", { id: "starting" }, tr(undefined, "working")),
    el(
      "state",
      { id: "working" },
      onentry(el("send", { type: c.alias, event: c.verb }, machine)),
      tr(`${c.alias}.${c.verb}.done`, "reporting", undefined, assign("cycles", "cycles + 1")),
      tr(`${c.alias}.${c.verb}.error`, "failed", undefined, assign("failures", "failures + 1")),
      tr("pause", "paused"),
    ),
    el(
      "state",
      { id: "reporting" },
      onentry(el("send", { target: "#_parent", event: c.report }, machine, el("param", { name: "cycles", expr: "cycles" }))),
      tr(undefined, "cooling"),
    ),
    el(
      "state",
      { id: "cooling" },
      onentry(el("send", { event: "tick", delay: `${c.cool}ms` })),
      tr("tick", "working"),
      tr("pause", "paused"),
    ),
    el("state", { id: "failed" }, onentry(el("send", { event: "retry", delay: "5s" })), tr("retry", "working")),
    el("state", { id: "paused" }, tr("resume", "working")),
  );
  return el("invoke", { id: c.id }, el("content", {}, scxml));
}

// ─────────────────────────────── regions ───────────────────────────────

/** Ticket lifecycle: idle → routing (64 queues) → active (triage / working / escalation, 7 levels deep) → resolved → closed. */
function ticketsRegion(): string {
  const created = assign("ticketCount", "ticketCount + 1");
  // each queue is a small machine of its own: waiting / snoozed / in review
  const queues = QUEUE_LIST.map((q) =>
    el(
      "state",
      { id: q.state, initial: `${q.state}-waiting` },
      el(
        "state",
        { id: `${q.state}-waiting` },
        tr("ticket.snooze", `${q.state}-snoozed`, undefined, assign("lastEvent", "'snoozed'")),
        tr("ticket.review", `${q.state}-review`),
      ),
      el("state", { id: `${q.state}-snoozed` }, tr("ticket.unsnooze", `${q.state}-waiting`), tr("sla.warning", `${q.state}-waiting`)),
      el("state", { id: `${q.state}-review` }, tr("review.approved", `${q.state}-waiting`), tr("review.rejected", "classifying")),
      tr("ticket.accept", "triage"),
      tr("ticket.requeue", "classifying"),
      tr("ticket.escalate", "tier1"),
      tr("ticket.merge", undefined, "ticketCount > 1", assign("lastEvent", "'merged'")),
      tr("ticket.spam", "closed"),
    ),
  );
  const routing = el(
    "state",
    { id: "routing", initial: "classifying" },
    el(
      "state",
      { id: "classifying" },
      ...QUEUE_LIST.map((q) => tr(q.event, q.state, undefined, assign("currentQueue", `'${q.category}.${q.sub}'`))),
      tr("ticket.spam", "closed"),
      tr("ticket.duplicate", "closed"),
    ),
    ...queues,
  );
  const vendorFix = el(
    "state",
    { id: "vendor-fix", initial: "patch-review" },
    el("state", { id: "patch-review" }, tr("vendor.patch.approved", "patch-deploy"), tr("vendor.patch.rejected", "vendor-ack")),
    el("state", { id: "patch-deploy" }, tr("vendor.patch.deployed", "resolved"), tr("vendor.patch.failed", "patch-review")),
  );
  const awaitingVendor = el(
    "state",
    { id: "awaiting-vendor", initial: "vendor-ack" },
    el("state", { id: "vendor-ack" }, tr("vendor.ack", "vendor-fix"), tr("vendor.unresponsive", "engineering")),
    vendorFix,
    tr("vendor.withdrawn", "engineering"),
  );
  const escalation = el(
    "state",
    { id: "escalation", initial: "tier1" },
    el("state", { id: "tier1" }, tr("escalation.promote", "tier2"), tr("escalation.demote", "working")),
    el("state", { id: "tier2" }, tr("escalation.promote", "tier3"), tr("escalation.demote", "tier1")),
    el(
      "state",
      { id: "tier3", initial: "engineering" },
      el("state", { id: "engineering" }, tr("vendor.involve", "awaiting-vendor"), tr("engineering.fix", "resolved")),
      awaitingVendor,
      tr("escalation.demote", "tier2"),
    ),
    tr("ticket.deescalate", "working"),
  );
  const working = el(
    "state",
    { id: "working", initial: "investigating" },
    el(
      "state",
      { id: "investigating" },
      tr("agent.request-info", "awaiting-customer"),
      tr("agent.consult", "awaiting-internal"),
      tr("agent.propose-fix", "resolved"),
    ),
    el("state", { id: "awaiting-customer" }, tr("customer.reply", "investigating"), tr("customer.silent", "resolved")),
    el("state", { id: "awaiting-internal" }, tr("internal.answer", "investigating"), tr("internal.reassign", "triage")),
  );
  const active = el(
    "state",
    { id: "active", initial: "triage" },
    el("state", { id: "triage" }, tr("triage.done", "working"), tr("triage.reroute", "classifying")),
    working,
    escalation,
    tr("ticket.escalate", "escalation"),
    tr("ticket.resolve", "resolved"),
    tr("customer.cancel", "closed"),
  );
  return el(
    "state",
    { id: "tickets", initial: "idle" },
    el("state", { id: "idle" }, tr("ticket.created", "routing", undefined, created)),
    routing,
    active,
    el(
      "state",
      { id: "resolved" },
      onentry(el("send", { type: "email", event: "resolution" }, el("param", { name: "queue", expr: "currentQueue" }))),
      tr("customer.reopen", "triage"),
      tr("ticket.close", "closed"),
      tr("csat.request", undefined, undefined, el("send", { type: "email", event: "survey" })),
    ),
    el("state", { id: "closed" }, tr("ticket.created", "routing", undefined, created), tr("ticket.archive", "idle")),
  );
}

function simpleRegion(id: string, initial: string, states: [string, ...string[]][]): string {
  // each entry: [stateId, ...transition XML]
  return el("state", { id, initial }, ...states.map(([sid, ...ts]) => el("state", { id: sid }, ...ts)));
}

function slaRegion() {
  return simpleRegion("sla", "sla-within", [
    ["sla-within", tr("sla.warning", "sla-warning"), tr("sla.pause", "sla-paused")],
    ["sla-warning", tr("sla.breach", "sla-breached"), tr("sla.reset", "sla-within"), tr("sla.pause", "sla-paused")],
    ["sla-breached", tr("sla.reset", "sla-within"), tr("sla.tick", undefined, undefined, assign("breaches", "breaches + 1"))],
    ["sla-paused", tr("sla.resume", "sla-within")],
  ]);
}

function sentimentRegion() {
  return simpleRegion("sentiment", "neutral", [
    ["neutral", tr("sentiment.positive", "positive"), tr("sentiment.negative", "frustrated")],
    ["positive", tr("sentiment.negative", "neutral"), tr("sentiment.praise", undefined, undefined, assign("lastEvent", "'praise'"))],
    ["frustrated", tr("sentiment.negative", "angry"), tr("sentiment.calm", "neutral")],
    ["angry", tr("sentiment.calm", "frustrated"), tr("sentiment.threat", "angry", "breaches > 0")],
  ]);
}

function assignmentRegion() {
  const teams = TEAMS.map((t, i) =>
    el(
      "state",
      { id: `team-${t}` },
      tr("agent.release", "unassigned"),
      tr("agent.handoff", `team-${TEAMS[(i + 1) % TEAMS.length]}`),
      tr("agent.overloaded", undefined, "channelMessages > 5", assign("currentTeam", `'${t} (overloaded)'`)),
    ),
  );
  return el(
    "state",
    { id: "assignment", initial: "unassigned" },
    el("state", { id: "unassigned" }, tr("agent.claim", "team-tier2")),
    el("state", { id: "assigned", initial: `team-${TEAMS[0]}` }, ...teams),
    // type="internal": the region's own descendants are the targets. An external transition's domain is
    // the nearest *compound* ancestor — the <parallel> doesn't count — so it would exit the whole floor.
    ...TEAMS.map((t) =>
      el("transition", { event: `agent.assign.${t}`, target: `team-${t}`, type: "internal" }, assign("currentTeam", `'${t}'`)),
    ),
  );
}

function notificationsRegion() {
  return simpleRegion("notifications", "quiet", [
    ["quiet", tr("notify.queue", "sending"), tr("notify.digest", "digest")],
    [
      "sending",
      onentry(el("send", { type: "email", event: "send" }, el("param", { name: "team", expr: "currentTeam" }))),
      tr("email.send.done", "quiet"),
      tr("email.send.error", "quiet"),
    ],
    ["digest", tr("notify.flush", "quiet")],
  ]);
}

function auditRegion() {
  return simpleRegion("audit", "recording", [
    ["recording", tr("audit.export", "exporting")],
    [
      "exporting",
      onentry(el("send", { type: "crm", event: "export" })),
      tr("crm.export.done", "recording"),
      tr("crm.export.error", "recording"),
    ],
  ]);
}

function billingRegion() {
  return simpleRegion("billing-hold", "billing-clear", [
    ["billing-clear", tr("billing.hold", "billing-held")],
    ["billing-held", tr("billing.release", "billing-clear"), tr("billing.dispute", "billing-disputed")],
    ["billing-disputed", tr("billing.resolve", "billing-clear")],
  ]);
}

function knowledgeRegion() {
  return simpleRegion("knowledge", "kb-idle", [
    ["kb-idle", tr("kb.suggest", "kb-suggesting")],
    [
      "kb-suggesting",
      onentry(el("send", { type: "crm", event: "search" }, el("param", { name: "queue", expr: "currentQueue" }))),
      tr("crm.search.done", "kb-suggested"),
      tr("crm.search.error", "kb-idle"),
    ],
    ["kb-suggested", tr("kb.apply", "kb-applied"), tr("kb.dismiss", "kb-idle")],
    ["kb-applied", tr("kb.feedback", "kb-idle")],
  ]);
}

function staffingRegion() {
  return simpleRegion("staffing", "staffing-normal", [
    ["staffing-normal", tr("staffing.surge", "staffing-surge")],
    ["staffing-surge", tr("staffing.overflow", "staffing-overflow"), tr("staffing.normal", "staffing-normal")],
    [
      "staffing-overflow",
      tr("staffing.normal", "staffing-normal"),
      tr("staffing.page", undefined, "channelMessages > 10", el("send", { type: "telephony", event: "page-oncall" })),
    ],
  ]);
}

function macrosRegion() {
  return simpleRegion("macros", "macros-ready", [
    ["macros-ready", ...MACROS.map((m) => tr(`macro.${m}`, undefined, undefined, assign("lastMacro", `'${m}'`)))],
  ]);
}

// ─────────────────────────────── the chart ───────────────────────────────

let cached: string | undefined;

/** The generated support-desk chart (cached). */
export function supportDeskChart(): string {
  if (cached) return cached;
  const data = [
    ["ticketCount", "0"],
    ["currentQueue", "null"],
    ["currentTeam", "null"],
    ["breaches", "0"],
    ["lastMacro", "null"],
    ["lastEvent", "null"],
    ["channelMessages", "0"],
    ["suggestions", "0"],
    ["csatScores", "[]"],
    ["teamCapacity", "{}"],
  ].map(([id, expr]) => el("data", { id, expr }));

  const count = (loc: string) => assign(loc, `${loc} + 1`);
  const globals = [
    tr("channel.*", undefined, undefined, count("channelMessages")),
    tr("triage.suggestion", undefined, undefined, count("suggestions")),
    tr(
      "team.*",
      undefined,
      undefined,
      assign("teamCapacity", "Object.assign({}, teamCapacity, { [_event.name.split('.')[1]]: _event.data.cycles })"),
    ),
    tr("kb.indexed", undefined, undefined, assign("lastEvent", "'kb.indexed'")),
    tr("crm.synced", undefined, undefined, assign("lastEvent", "'crm.synced'")),
    tr(
      "csat.response",
      undefined,
      undefined,
      el("script", {}, "csatScores.push((_event.data.cycles % 5) + 1); if (csatScores.length > 20) csatScores.shift();"),
    ),
    tr("sla.tick", undefined, undefined, assign("lastEvent", "'sla.tick'")),
    tr("escalation.desk.update", undefined, undefined, assign("lastEvent", "'escalation.desk.update'")),
    tr(
      "metrics.snapshot",
      undefined,
      undefined,
      el("log", { label: "metrics", expr: "JSON.stringify({ tickets: ticketCount, breaches: breaches })" }),
    ),
    tr("audit.note", undefined, undefined, assign("lastEvent", "'audit.note'")),
    tr("admin.announce", undefined, undefined, el("send", { type: "email", event: "announce" })),
    tr("admin.broadcast", undefined, undefined, el("send", { type: "chat", event: "broadcast" })),
    tr("integration.webhook", undefined, undefined, assign("lastEvent", "'integration.webhook'")),
    tr("integration.error", undefined, "lastEvent !== null", assign("lastEvent", "'integration.error'")),
    tr("system.heartbeat", undefined),
    tr("customer.message", undefined, undefined, count("channelMessages")),
    tr("agent.note", undefined, undefined, assign("lastEvent", "'agent.note'")),
    tr("ticket.comment", undefined, undefined, assign("lastEvent", "'ticket.comment'")),
    tr("ticket.tag", undefined, undefined, assign("lastEvent", "'ticket.tag'")),
    tr("ticket.watch", undefined, undefined, assign("lastEvent", "'ticket.watch'")),
    tr("email.*", undefined, undefined, assign("lastEvent", "_event.name")),
    tr("chat.*", undefined, undefined, assign("lastEvent", "_event.name")),
    tr("telephony.*", undefined, undefined, assign("lastEvent", "_event.name")),
    tr("system.maintenance.start", "maintenance"),
    tr("admin.reset", "operating"),
  ];

  const floor = el(
    "parallel",
    { id: "floor" },
    ticketsRegion(),
    slaRegion(),
    sentimentRegion(),
    assignmentRegion(),
    notificationsRegion(),
    auditRegion(),
    billingRegion(),
    knowledgeRegion(),
    staffingRegion(),
    macrosRegion(),
  );

  const desk = el(
    "state",
    { id: "desk", initial: "operating" },
    ...CHILDREN.map(childMachine),
    ...globals,
    el(
      "state",
      { id: "operating", initial: "floor" },
      el("history", { id: "operating-history", type: "deep" }, tr(undefined, "floor")),
      floor,
    ),
    el(
      "state",
      { id: "maintenance" },
      onentry(el("send", { type: "email", event: "maintenance-notice" })),
      tr("system.maintenance.end", "operating-history"),
    ),
  );

  cached =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- generated by src/explorer/support-desk-generator.ts — do not edit -->\n` +
    el(
      "scxml",
      { xmlns: "http://www.w3.org/2005/07/scxml", version: "1.0", datamodel: "ecmascript", name: "support-desk", initial: "desk" },
      el("datamodel", {}, ...data),
      desk,
    );
  return cached;
}
