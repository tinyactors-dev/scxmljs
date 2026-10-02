import { afterEach, describe, expect, test } from "bun:test";
import { CITATIONS } from "../src/post.ts";
import { CHAPTERS } from "../src/tour.ts";
import { boot, busy, entries, kinds, lastAnswer, live, system, tasks, tour, until } from "./support.ts";

afterEach(() => system?.dispose());

describe("pi-durable", () => {
  test("a question becomes a generation, tool calls, and an answer", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "the client to attach");
    system.type("you", "What's in the repo?");
    await until(() => !!lastAnswer(), "an answer");
    expect(kinds()).toEqual(["pi.user", "pi.system", "pi.assistant", "pi.tool-result", "pi.tool-result", "pi.assistant"]);
    expect(busy()).toBe(false);
    expect(tasks().map((t) => [t.kind, t.state.status])).toEqual([
      ["pi.generation", "terminal"],
      ["pi.tool", "terminal"],
      ["pi.tool", "terminal"],
      ["pi.generation", "terminal"],
    ]);
    // the client's view agrees with storage
    await until(
      () => (system.clients.get("you")!.session.datamodel.evaluate("view.entries.length") as number) === entries().length,
      "the view",
    );
  });
});

describe("survives crashes", () => {
  test("job-42: a crash mid tool round, then mid answer", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "the client to attach");
    system.type("you", "Fix the flaky login test", { requestId: "job-42" });
    const slot = (name: string) =>
      (
        system.storage.doc(
          { kind: "pi.live", fork: "initial", initial: () => ({}) as { tools?: { name: string; output?: string; status: string }[] } },
          "c1",
        ).tools ?? []
      ).find((s) => s.name === name);
    await until(() => (slot("bash")?.output ?? "").includes("renders the form"), "bash to print");
    system.type("you", "Then update the changelog.");
    await until(
      () => system.storage.doc({ kind: "pi.inbox", fork: "initial", initial: () => ({ items: [] as unknown[] }) }, "c1").items.length === 1,
      "the follow-up to queue",
    );
    system.kill();
    expect(live()).toBe(true); // the client doesn't know yet
    await until(() => !live(), "the client to notice");
    await system.start();
    await until(() => live(), "the client to reattach");
    // the rerun search, the interrupted bash
    await until(() => entries().filter((e) => e.data.kind === "pi.tool-result").length >= 2, "both results");
    const results = entries()
      .filter((e) => e.data.kind === "pi.tool-result")
      .map((e) => e.data as { name: string; code?: string; text: string });
    expect(results.find((r) => r.name === "bash")?.code).toBe("interrupted");
    expect(results.find((r) => r.name === "bash")?.text).toContain("renders the form");
    expect(results.find((r) => r.name === "search_issues")?.code).toBeUndefined();
    expect(system.machine.runs.filter((r) => r.command.startsWith("bun test")).length).toBe(1);
    // the second crash: while the final answer streams
    await until(() => {
      const g = system.storage.doc(
        { kind: "pi.live", fork: "initial", initial: () => ({}) as { generation?: { message?: string } } },
        "c1",
      ).generation;
      return (g?.message ?? "").startsWith("Fixed the flaky login test. The login token");
    }, "the answer to stream");
    system.kill();
    await system.start();
    await until(() => !!lastAnswer() && !busy(), "the answer");
    const aborted = entries().filter((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "aborted");
    expect(aborted.length).toBe(1);
    // the follow-up was still queued, and ran after the answer
    await until(() => entries().filter((e) => e.data.kind === "pi.user").length === 2 && !busy(), "the follow-up's run");
    // exactly-once: one submission for job-42, retried by the client twice
    const subs = [...system.storage.submissions.values()].filter((s) => s.requestId === "job-42");
    expect(subs.length).toBe(1);
    expect(subs[0]!.status).toBe("done");
    const req = (system.clients.get("you")!.session.datamodel.evaluate("requests") as { requestId: string; duplicate?: boolean }[]).find(
      (r) => r.requestId === "job-42",
    );
    expect(req?.duplicate).toBe(true);
  });
});

const doc = <T>(kind: string, conv = "c1") => system.storage.doc({ kind, fork: "initial", initial: () => ({}) as T }, conv);
const outcome = (t: { state: { status: string; outcome?: { status: string } } }) =>
  t.state.status === "terminal" ? t.state.outcome!.status : t.state.status;

describe("tasks", () => {
  test("checkout: one card declines, failFast aborts the others, which refund", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.bank.latency.set("mc-0009", 500); // declines while the others are in flight
    system.type("you", "Checkout with visa-4242, amex-0005 and mc-0009");
    await until(() => !!lastAnswer() && !busy(), "the answer");
    const pay = tasks().filter((t) => t.kind === "shop.payment");
    expect(pay.map(outcome).sort()).toEqual(["aborted", "aborted", "failed"]);
    expect(outcome(tasks().find((t) => t.kind === "shop.checkout")!)).toBe("failed");
    await until(() => system.bank.log.filter((l) => l.includes("not charged")).length === 2, "the in-flight charges to arrive voided");
    expect([...system.bank.charges.values()].some((c) => c.status === "charged")).toBe(false);
  });

  test("a crash during checkout: the unsafe call is interrupted, its checkout aborted, payments refunded", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.bank.declines.clear();
    system.type("you", "Checkout with visa-4242 and amex-0005");
    await until(() => tasks().filter((t) => t.kind === "shop.payment").length === 2, "payments");
    await until(() => system.bank.charges.size === 2, "the charges to land");
    system.kill();
    await system.start();
    await until(() => !!lastAnswer() && !busy(), "the answer");
    expect(outcome(tasks().find((t) => t.kind === "pi.tool" && t.label === "checkout")!)).toBe("failed");
    expect(outcome(tasks().find((t) => t.kind === "shop.checkout")!)).toBe("aborted");
    expect([...system.bank.charges.values()].map((c) => c.status)).toEqual(["refunded", "refunded"]);
    expect((lastAnswer()!.data as { text: string }).text).toContain("refunded");
  });

  test("background vs foreground: Esc stops the run, not the reminder", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.type("you", "Remind me to stretch");
    await until(() => !!lastAnswer() && !busy(), "the answer");
    const reminder = () => tasks().find((t) => t.kind === "app.reminder")!;
    expect(reminder().background).toBe(true);
    system.type("you", "Why is checkout slow?");
    await until(() => tasks().some((t) => t.label === "bash" && t.state.status === "running"), "bash");
    system.kill();
    await until(() => !live(), "the client to notice");
    await system.start(); // the timer survives the restart
    await until(() => live(), "reattach");
    system.type("you", "Why is checkout slow?");
    await until(
      () =>
        tasks().filter((t) => t.label === "bash" && t.state.status === "running").length === 1 &&
        (tasks().findLast((t) => t.label === "bash")!.state as { checkpoint?: { phase: string } }).checkpoint?.phase === "execute",
      "the second bash to run",
    );
    system.ui("you", "abort");
    await until(() => !busy(), "the abort");
    expect(outcome(tasks().findLast((t) => t.label === "bash")!)).toBe("aborted");
    expect(outcome(tasks().findLast((t) => t.kind === "pi.generation")!)).toBe("aborted");
    expect(reminder().state.status).not.toBe("terminal");
    await until(() => entries().some((e) => e.data.kind === "pi.user" && e.data.text.startsWith("Reminder:")), "the reminder");
    expect(outcome(reminder())).toBe("completed");
  });
});

describe("hooks", () => {
  test("the approval is a memo: after a crash it isn't asked again", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.type("you", "Deploy v1.5.1");
    await until(() => (system.harness?.approvals.size ?? 0) === 1, "the question");
    const id = [...system.harness!.approvals.keys()][0]!;
    system.harness!.approve(id, true);
    await until(
      () =>
        tasks().some(
          (t) =>
            t.label === "deploy" &&
            t.state.status !== "terminal" &&
            (t.state as { checkpoint?: { phase: string } }).checkpoint?.phase === "execute",
        ),
      "the intent",
    );
    expect(system.storage.tasks.get(id)!.memos).toEqual({ "approval:deploy": true });
    system.kill();
    await system.start();
    await until(() => !!lastAnswer() && !busy(), "the answer");
    // deploy is not safe to rerun: interrupted, and nobody was asked twice
    expect((entries().find((e) => e.data.kind === "pi.tool-result")!.data as { code?: string }).code).toBe("interrupted");
  });
});

describe("many conversations", () => {
  test("a thread forks the channel at the answer, without deploy, and both run at once", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.type("you", "@agent why did the deploy fail?");
    await until(() => !!lastAnswer() && !busy(), "the answer");
    const at = lastAnswer()!.id;
    const thread = system.harness!.fork("c1", at, { title: "thread", agent: { tools: { remove: ["deploy"] }, model: "sim-luna" } });
    expect(entries(thread).map((e) => e.id)).toEqual(entries("c1").map((e) => e.id)); // by reference
    system.harness!.submit(thread, { text: "@agent can we roll it back?" });
    system.harness!.submit("c1", { text: "@agent who is on call today?" });
    await until(() => busy(thread) && busy("c1"), "both busy");
    await until(() => !busy(thread) && !busy("c1"), "both done");
    expect((lastAnswer(thread)!.data as { text: string }).text).toContain("deploy isn't one of my tools");
    expect((lastAnswer("c1")!.data as { text: string }).text).toContain("on call");
    expect(entries("c1").some((e) => e.conversationId === thread)).toBe(false);
  });
});

describe("multiplayer", () => {
  test("a late client gets the view, steers, and the steer joins the run after the tool round", async () => {
    await boot();
    await system.addClient("you", "Ada");
    await until(() => live(), "attach");
    system.type("you", "Why is checkout slow?");
    await until(() => tasks().some((t) => t.label === "bash" && t.state.status === "running"), "bash");
    await system.addClient("bo", "Bo");
    await until(() => live("bo"), "bo to attach");
    system.type("bo", "Check the staging logs first", { whenBusy: "steer" });
    await until(() => doc<{ items: unknown[] }>("pi.inbox").items?.length === 1, "the steer to queue");
    system.type("bo", "And summarise", { whenBusy: "reject" });
    await until(() => !!lastAnswer() && !busy(), "the answer");
    expect((lastAnswer()!.data as { text: string }).text).toContain("Staging");
    const users = entries().filter((e) => e.data.kind === "pi.user");
    expect(users.length).toBe(2);
    const runs = tasks().filter((t) => t.kind === "pi.generation").length;
    expect(runs).toBe(3);
    const rejected = (system.clients.get("bo")!.session.datamodel.evaluate("requests") as { status: string }[]).filter(
      (r) => r.status === "rejected",
    );
    expect(rejected.length).toBe(1);
    await until(
      () => (system.clients.get("bo")!.session.datamodel.evaluate("view.entries.length") as number) === entries().length,
      "bo's view",
    );
  });
});

describe("compaction and malleable", () => {
  test("background compaction keeps the conversation going; older messages stay in storage", async () => {
    await boot({ settings: { compaction: { contextWindow: 900, reserveTokens: 150, backgroundTokens: 300, keepRecentTokens: 150 } } });
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    for (const q of [
      "Tell me about durability",
      "And about tasks?",
      "What about storage?",
      "And forks?",
      "And clients?",
      "And extensions?",
    ]) {
      system.type("you", q);
      await until(() => !busy(), q);
    }
    await until(() => entries().some((e) => e.data.kind === "pi.compaction"), "a summary");
    const c = tasks().find((t) => t.kind === "pi.compaction")!;
    expect(c.background).toBe(true);
    expect(entries().length).toBeGreaterThan(12);
    const view = system.harness!.view("c1");
    expect(view.entries.some((e) => !e.active)).toBe(true);
  });

  test("a running deploy finishes on ops@1; the next one uses ops@2", async () => {
    await boot({ settings: { extensions: ["coding", "ops"] } });
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.type("you", "Deploy v1.6.0");
    await until(() => tasks().some((t) => t.label === "deploy" && t.state.status === "running"), "deploy");
    await until(() => (doc<{ tools?: { output?: string }[] }>("pi.live").tools?.[0]?.output ?? "").includes("building"), "the build");
    system.install("ops@2");
    await until(() => !!lastAnswer() && !busy(), "the first deploy");
    expect((lastAnswer()!.data as { text: string }).text).toContain("ops@1");
    system.type("you", "Deploy v1.6.1");
    await until(
      () => entries().filter((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop").length === 2 && !busy(),
      "the second",
    );
    expect((lastAnswer()!.data as { text: string }).text).toContain("ops@2");
  });
});

describe("documents and sections", () => {
  test("todos commit with the transcript; a fork starts with the todos as of its fork entry", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.type("you", "Add to my list: buy milk and call Bo");
    await until(() => !!lastAnswer() && !busy(), "the first answer");
    const at = lastAnswer()!.id;
    system.type("you", "Add to my list: water the plants");
    await until(
      () => entries().filter((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop").length === 2 && !busy(),
      "the second",
    );
    expect(doc<{ items: string[] }>("app.todos").items).toEqual(["buy milk", "call Bo", "water the plants"]);
    const fork = system.harness!.fork("c1", at, { title: "earlier" });
    expect(doc<{ items: string[] }>("app.todos", fork).items).toEqual(["buy milk", "call Bo"]);
    expect(doc<{ items: unknown[] }>("pi.inbox", fork).items).toEqual([]); // initial
  });

  test("a changed section is recorded where it changed", async () => {
    await boot();
    await system.addClient("you", "You");
    await until(() => live(), "attach");
    system.type("you", "Add a house rule to AGENTS.md");
    await until(() => !!lastAnswer() && !busy(), "the answer");
    const systems = entries().filter((e) => e.data.kind === "pi.system");
    expect(systems.length).toBe(2);
    const second = systems[1]!.data as { sections: Record<string, string> };
    expect(Object.keys(second.sections)).toEqual(["agents_md"]);
    expect(second.sections.agents_md).toContain("Always run the tests");
  });
});

describe("the tour", () => {
  for (const chapter of CHAPTERS)
    test(`chapter: ${chapter.title}`, async () => {
      await boot({
        ...(chapter.settings ? { settings: chapter.settings } : {}),
        ...(chapter.rootAgent ? { rootAgent: chapter.rootAgent } : {}),
      });
      const director = await system.runScenario(await tour(chapter.file));
      const errors: string[] = [];
      director.addEventListener("macrostep", () => {
        const e = director.datamodel.evaluate("_event") as { name?: string; data?: unknown } | undefined;
        if (e?.name?.startsWith("error.")) errors.push(`${e.name} ${JSON.stringify(e.data)}`);
      });
      try {
        await until(() => director.activeStateIds().length === 0, `${chapter.id} to finish`, 240_000);
      } finally {
        if (director.activeStateIds().length) console.log(chapter.id, "stuck in", director.activeStateIds(), errors);
      }
      for (const n of system.notes) if (n.cite) expect(CITATIONS[n.cite]).toBeDefined();
      expect(system.notes.length).toBeGreaterThan(1);
      await until(() => [...system.storage.conversations.keys()].every((c) => !busy(c)), "everything to settle", 60_000);
    });
});
