import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";

const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** axe-core (WCAG 2.2 A/AA + best practices) over the whole page, shadow roots included */
async function axe(page: Page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() =>
    (window as any).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    }),
  );
  return (result.violations as { id: string; impact: string; nodes: { target: unknown[]; any: { message: string }[] }[] }[]).map(
    (v) => `${v.impact} ${v.id} (${v.nodes.length}× ${JSON.stringify(v.nodes[0]?.target)}: ${v.nodes[0]?.any[0]?.message ?? ""})`,
  );
}

/** fail on uncaught errors and console errors */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("landing: the hero <scxml-view> runs", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  const hero = page.locator("#hero-view");
  // the traffic light starts red and its delayed <send> moves it on: an active state changes
  const active = () => hero.evaluate((el) => ((el as any).session?.configuration ?? []).map((s: { id: string }) => s.id).join(","));
  await expect.poll(active).toContain("red");
  await expect.poll(active, { timeout: 15_000 }).not.toContain("red");
  expect(errors).toEqual([]);
});

test("explorer demo: stepping advances the system", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/explorer/?paused=1");
  const explorer = page.locator("scxml-explorer");
  const step = explorer.locator("[part~=step]");
  await expect(step).toBeEnabled();
  const clock = explorer.locator("[part~=clock]");
  const before = await clock.textContent();
  for (let i = 0; i < 3; i++) await step.click();
  await expect(clock).not.toHaveText(before ?? "");
  expect(errors).toEqual([]);
});

test("llm chat: a turn with parallel tools, a retry, a steer and a stop, all simulated", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/llm-chat/");
  const ada = page.locator("[data-client=ada]");
  const box = ada.locator("textarea");
  await expect(ada.locator(".chat-chip")).toHaveText("live");

  // two tool providers join; one question makes the model call both at once
  for (const kind of ["terminal", "python"]) {
    await page.selectOption("#chat-add", kind);
    await page.click("#chat-add-button");
    await expect(page.locator(`[data-client=${kind}] .chat-chip`)).toHaveText("live");
  }
  await box.fill("How many files are in the workspace? And use python to compute 2**64.");
  await box.press("Enter");
  const card = ada.locator(".msg.tools").last();
  await expect(card).toContainText("2 tool calls, in parallel");
  // a steer while the tools run rides along with their results
  await box.fill("Only the markdown files, please.");
  await box.press("Control+Enter");
  await expect(card).toContainText("18446744073709551616");
  await expect(ada.locator(".msg.user[data-steer]")).toContainText("Only the markdown files");
  await expect(ada.locator(".msg.assistant").last()).toContainText("Noted: [Ada] Only the markdown files, please");

  // the next request is rate limited: the host backs off and retries
  await page.click("summary:text('Simulate a failure')");
  await page.selectOption("#chat-fault", "rate_limit");
  await box.fill("hello again");
  await box.press("Enter");
  await expect(page.locator(".chat-status .chat-chip").first()).toHaveText("waiting to retry");
  await expect(ada.locator(".msg.notice").last()).toContainText("Retrying in 3 s");
  await expect(page.locator(".chat-status .chat-chip").first()).toHaveText("idle", { timeout: 15_000 });

  // Esc stops the answer being written; it is dropped
  await box.fill("one more");
  await box.press("Enter");
  await expect(page.locator(".chat-status .chat-chip").first()).toHaveText("model writing");
  await box.press("Escape");
  await expect(ada.locator(".msg.assistant").last()).toHaveAttribute("data-status", "discarded");
  await expect(ada.locator(".msg.assistant .who").last()).toHaveText("model (dropped: stopped by Ada)");

  // every client saw the same log
  const seen = await page.evaluate(() => {
    const s = (window as any).llmChat();
    return [...s.clients.values()].map((c: any) => c.view.seq === s.log.seq);
  });
  expect(seen).toEqual([true, true, true]);
  expect(errors).toEqual([]);
});

test("llm chat: the queue flies out above the editor; edit appends, delete removes, the rest drains", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/llm-chat/");
  const ada = page.locator("[data-client=ada]");
  const editor = ada.locator("chat-prompt textarea");
  await expect(ada.locator(".chat-chip")).toHaveText("live");
  await page.evaluate(() => ((window as any).llmChat().clock.speed = 0.5)); // time to click
  for (const text of ["one", "two", "three", "four"]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  const queued = ada.locator("chat-prompt li");
  await expect(queued).toHaveCount(3);
  await expect(queued.locator(".text")).toHaveText(["two", "three", "four"]);
  // the icons show on hover
  const actions = queued.nth(0).locator(".actions");
  const edit = actions.locator(".edit");
  await expect(actions).toHaveCSS("opacity", "0");
  await queued.nth(0).hover();
  await expect(actions).toHaveCSS("opacity", "1");
  // edit: out of the queue, appended to what is typed
  await editor.fill("draft");
  await edit.click();
  await expect(editor).toHaveValue("draft\n\ntwo");
  // delete: gone
  await queued.nth(1).hover();
  await queued.nth(1).locator(".remove").click();
  await expect(queued.locator(".text")).toHaveText(["three"]);
  // "three" goes out once the first turn has settled; then the queue is empty
  await expect(queued).toHaveCount(0, { timeout: 20_000 });
  await expect(ada.locator(".msg.user")).toHaveText([/one/, /three/]);
  await expect(page.locator(".chat-status .chat-chip").first()).toHaveText("idle", { timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).llmChat().host.datamodel.evaluate("turn"))).toBe(2);
  expect(errors).toEqual([]);
});

test("llm chat: the chart picker shows each client, including ones added later, by name", async ({ page }) => {
  await page.goto("/demos/llm-chat/");
  await expect(page.locator("[data-client=ada]")).toBeVisible();
  await page.evaluate(() => (window as any).llmChat().addClient("postgres"));
  await expect(page.locator("#chat-session option[value=postgres]")).toHaveCount(1);
  const crumb = () =>
    page.locator("scxml-explorer").evaluate((e) => (e.shadowRoot!.querySelector("nav")?.textContent ?? "").replace(/\s+/g, " "));
  for (const [value, name] of [
    ["postgres", "Postgres"],
    ["ada", "Ada"],
  ]) {
    await page.selectOption("#chat-session", value!);
    await expect.poll(crumb).toContain(`llm-chat-client · ${name}`);
  }
});

test("llm chat: the scenarios run to the end", async ({ page }) => {
  const errors = watchErrors(page);
  for (const scenario of ["provider-leaves", "three-in-a-row", "queue-and-steer"]) {
    await page.goto(`/demos/llm-chat/?scenario=${scenario}`);
    await expect
      .poll(() => page.evaluate(() => (window as any).llmChat()?.director?.status), { timeout: 20_000, message: scenario })
      .toBe("done");
  }
  // queue-and-steer: Bo's refused steer went back into his editor; his queued message got its own turn
  await expect(page.locator("[data-client=bo] chat-prompt textarea")).toHaveValue("Only the markdown files, please.");
  await expect(page.locator("[data-client=bo] .msg.user").last()).toContainText("Afterwards, also count the lines of the README.");
  await page.click("#chat-reset");
  await expect(page.locator("[data-client]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("llm chat: the page is cross-origin isolated, and the simulation downloads nothing from Wasmer", async ({ page }) => {
  const errors = watchErrors(page);
  const wasmer: string[] = [];
  page.on("request", (r) => /wasmer/.test(r.url()) && wasmer.push(r.url()));
  await page.goto("/demos/llm-chat/");
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.selectOption("#chat-add", "terminal");
  await page.click("#chat-add-button");
  const terminal = page.locator("[data-client=terminal]");
  await expect(terminal.locator("input[value=simulated]")).toBeChecked();
  await expect(terminal.locator("input[value=real]")).not.toBeChecked();
  await page.locator("[data-client=ada] chat-prompt textarea").fill("list the files in the workspace");
  await page.locator("[data-client=ada] chat-prompt textarea").press("Enter");
  await expect(page.locator("[data-client=ada] .msg.tools").last()).toContainText("report.py", { timeout: 15_000 });
  expect(wasmer).toEqual([]);
  expect(errors).toEqual([]);
});

// Real tools download ≈ 155 MB from registry.wasmer.io / cdn.wasmer.io on a cold cache, so this
// only runs when asked: SITE_TEST_REAL_TOOLS=1 mise run site:test
test("llm chat @real-tools: Terminal, Python and Postgres run for real (WebAssembly)", async ({ page, request }) => {
  test.skip(!process.env.SITE_TEST_REAL_TOOLS, "set SITE_TEST_REAL_TOOLS=1 (downloads ≈ 155 MB)");
  const reachable = await request
    .post("https://registry.wasmer.io/graphql", { data: { query: "{ __typename }" }, failOnStatusCode: false })
    .then(
      (r) => r.status() < 500,
      () => false,
    );
  test.skip(!reachable, "registry.wasmer.io is unreachable");
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await page.goto("/demos/llm-chat/");
  await page.waitForFunction(() => (window as any).llmChat?.()?.clients.size === 1);
  // switch through the runtime (not the panel's markup): Terminal first, so Python finds bash and coreutils installed
  for (const [kind, tool] of [
    ["terminal", "shell"],
    ["python", "python"],
    ["postgres", "sql"],
  ] as const) {
    await page.evaluate(async (k) => {
      const s = (window as any).llmChat();
      await s.addClient(k);
      s.clients.get(k).runtime.setMode("real");
    }, kind);
    await expect
      .poll(() => page.evaluate(([k, t]) => (window as any).llmChat().clients.get(k).runtime.realState(t).status, [kind, tool]), {
        timeout: 240_000,
        message: `${kind} loads`,
      })
      .toBe("ready");
  }
  // one entry per package, all ready; Python's bash and coreutils came from the Terminal's install
  const packages = await page.evaluate(() => {
    const s = (window as any).llmChat();
    const list = (k: string, t: string) =>
      s.clients
        .get(k)
        .runtime.realState(t)
        .packages.map((p: any) => `${p.label}:${p.phase}${p.shared ? ":shared" : ""}`);
    return { shell: list("terminal", "shell"), python: list("python", "python"), sql: list("postgres", "sql") };
  });
  expect(packages.shell).toEqual(["Wasmer runtime:ready", "bash:ready", "coreutils:ready"]);
  expect(packages.python).toEqual(["Wasmer runtime:ready:shared", "bash:ready:shared", "coreutils:ready:shared", "Python 3.13:ready"]);
  expect(packages.sql).toEqual(["Wasmer runtime:ready:shared", "PostgreSQL (PGlite):ready", "psql:ready"]);

  // one filesystem: bash writes, Python reads and writes, psql copies out, bash reads it back
  const call = (kind: string, tool: string, input: Record<string, unknown>) =>
    page.evaluate(([k, t, i]) => (window as any).llmChat().clients.get(k).runtime.invoke(t, i), [kind, tool, input] as const);
  await call("terminal", "shell", { command: "echo written-by-bash > shared.txt" });
  expect(
    await call("python", "python", { code: "print(open('shared.txt').read().strip()); open('py.txt','w').write('written-by-python\\n')" }),
  ).toBe("written-by-bash");
  expect(await call("terminal", "shell", { command: "cat py.txt" })).toBe("written-by-python");
  await call("postgres", "sql", { query: "\\copy (SELECT status FROM orders ORDER BY id) TO '/workspace/statuses.txt'" });
  expect(await call("terminal", "shell", { command: "cat statuses.txt" })).toBe("shipped\npending\nshipped\ncancelled");
  // the Terminal can run the other tools' programs too, on the same files
  expect(await call("terminal", "shell", { command: "python -c 'print(40 + 2)'" })).toBe("42");

  // and the conversation: three real tools in parallel
  const editor = page.locator("[data-client=ada] chat-prompt textarea");
  await editor.fill(
    "How many files are in the workspace? And use python to compute 2**64. And count the orders by status in the database.",
  );
  await editor.press("Enter");
  const card = page.locator("[data-client=ada] .msg.tools").last();
  await expect(card).toContainText("3 tool calls, in parallel", { timeout: 30_000 });
  await expect(card).toContainText("18446744073709551616", { timeout: 60_000 }); // real CPython
  await expect(card).toContainText("shared.txt"); // real ls, in the shared workspace
  await expect(card).toContainText("(3 rows)"); // real psql
  expect(errors).toEqual([]);
});

test("gallery: every chart renders with playback controls", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/gallery/");
  const views = page.locator("scxml-view[data-gallery]");
  await expect(views).toHaveCount(4);
  for (const v of await views.all()) await expect(v.locator("[part~=step]")).toBeVisible();
  expect(errors).toEqual([]);
});

test("search returns results", async ({ page }) => {
  await page.goto("/search/?q=clock");
  await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
});

test("docs: a guide renders with sidebar, TOC and highlighted code", async ({ page }) => {
  await page.goto("/docs/playback/");
  await expect(page.locator("h1")).toContainText("Playback");
  await expect(page.locator(".docs-nav [aria-current=page]")).toBeVisible();
  await expect(page.locator(".toc a").first()).toBeVisible();
  await expect(page.locator(".prose pre.shiki").first()).toBeVisible();
});

// ── playground ──────────────────────────────────────────────────────────
type PlaygroundHandle = { getText(): string; setText(t: string): void; session?: { configuration: { id: string }[] } };
const pg = (page: Page) => ({
  states: () =>
    page.evaluate(() => ((window as any).__playground as PlaygroundHandle).session?.configuration.map((s) => s.id).join(",") ?? ""),
  edit: (fn: (text: string) => string) =>
    page.evaluate((src) => {
      const p = (window as any).__playground as PlaygroundHandle;
      p.setText(new Function("t", `return (${src})(t)`)(p.getText()));
    }, fn.toString()),
});

test("playground: runs an example, re-runs edits, shows problems", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/playground/?example=traffic-light");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await expect(page.locator("#pg-editor .cm-editor")).toBeVisible(); // CodeMirror replaced the textarea
  const { states, edit } = pg(page);
  await expect.poll(states).toContain("red");
  // an edit re-runs the chart: start in yellow instead
  await edit((t) => t.replace('initial="red"', 'initial="yellow"'));
  await expect.poll(states).toContain("yellow");
  // a parse error: a diagnostic in the list and the editor, the last good run stays up
  await edit((t) => t.replace('<state id="green">', '<state id="green"'));
  await expect(page.locator("#pg-status")).toHaveText("Not well-formed XML");
  const problem = page.locator("#pg-problems button[data-severity=error]");
  await expect(problem).toHaveCount(1);
  await expect(page.locator("#pg-editor .cm-lintRange-error")).toHaveCount(1);
  await problem.click();
  await expect(page.locator("#pg-editor .cm-content")).toBeFocused();
  // a validation problem (unknown target) is reported too
  await edit((t) => t.replace('<state id="green"', '<state id="green">').replace('target="green"', 'target="nowhere"'));
  await expect(page.locator("#pg-status")).toContainText("Invalid");
  await expect(page.locator("#pg-problems")).toContainText("nowhere");
  expect(errors).toEqual([]);
});

test("playground: sending events, and the fake services of the gatekeeper", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/playground/?example=login");
  const { states } = pg(page);
  await expect.poll(states).toContain("signed-out");
  await page.locator("#pg-suggestions button", { hasText: "login as ada" }).click();
  await expect.poll(states).toContain("signed-in");
  await page.fill("#pg-send-name", "logout");
  await page.click("#pg-send button[type=submit]");
  await expect.poll(states).toContain("signed-out");

  await page.selectOption("#pg-example", "gatekeeper");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await page.locator("#pg-suggestions button", { hasText: "issue by mallory" }).click();
  await expect(page.locator("#pg-log")).toContainText("closed: #1", { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("playground: a runaway script is stopped", async ({ page }) => {
  await page.goto("/playground/?example=blank");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await pg(page).edit((t) => t.replace('<assign location="count" expr="count + 1"/>', "<script>while (true) {}</script>"));
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await page.locator("#pg-suggestions button", { hasText: "go" }).click();
  await expect(page.locator("#pg-notice")).toContainText("was stopped");
  await expect(page.locator("#pg-log")).toContainText("interrupted");
});

test("playground: share links round-trip; broken ones fall back to an example", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/playground/?example=microwave");
  await expect(page.locator("#pg-status")).toHaveText("Running");
  await pg(page).edit((t) => t.replace('name="microwave"', 'name="shared-oven"'));
  await page.click("#pg-share");
  await expect(page).toHaveURL(/#example=microwave&chart=[\w-]+$/);
  const url = page.url();
  await page.evaluate(() => localStorage.clear());
  await page.goto("about:blank");
  await page.goto(url);
  await expect(page.locator("#pg-notice")).toContainText("shared link");
  expect(await page.evaluate(() => ((window as any).__playground as PlaygroundHandle).getText())).toContain("shared-oven");

  await page.goto("about:blank");
  await page.goto("/playground/#example=login&chart=AAAA");
  await expect(page.locator("#pg-notice")).toContainText("couldn't be opened");
  await expect(page.locator("#pg-example")).toHaveValue("login");
  await expect(page.locator("#pg-status")).toHaveText("Running");
});

test.describe("playground at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("Edit / Diagram / Explorer tabs", async ({ page }) => {
    await page.goto("/playground/");
    await expect(page.locator("#pg-view")).toBeVisible();
    await expect(page.locator("#pg-editor")).toBeHidden();
    await page.click("[data-pg-tab=edit]");
    await expect(page.locator("#pg-editor")).toBeVisible();
    await expect(page.locator("#pg-view")).toBeHidden();
    await page.click("[data-pg-tab=explore]");
    await expect(page.locator("#pg-explorer")).toBeVisible();
  });
});

test("pi durable: a crash mid-run; the new process continues every task from its checkpoint", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/pi-durable/?chapter=&speed=4&autoplay=1");
  const you = page.locator("[data-client=you]");
  await expect(you.locator("header .pd-pill")).toHaveText("live");
  await you.locator("textarea").fill("Fix the flaky login test");
  await you.getByRole("button", { name: "Send" }).click();
  // bash is running (its intent stored): kill the process
  await expect(you.locator(".pd-slot", { hasText: "bash" })).toContainText("running", { timeout: 20_000 });
  await expect(you.locator(".pd-slot pre").last()).toContainText("bun test", { timeout: 20_000 });
  await page.click("#pd-kill");
  await expect(page.locator("#pd-process-status")).toContainText("no process");
  await expect(page.locator(".pd-dead")).toBeVisible();
  await expect(you.locator("header .pd-pill")).toHaveText("offline");
  await page.click("#pd-start");
  await expect(page.locator("#pd-process-status")).toContainText("process 2");
  // bash isn't safe to rerun: the model is told; search_issues is, and runs again
  await expect(you.locator(".pd-tool-result", { hasText: "interrupted" })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window as any).piDurable().storage.submissions.size)).toBe(1);
  expect(errors).toEqual([]);
});

test("pi durable: every chapter's ¶ opens the post's passage", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demos/pi-durable/?chapter=crashes");
  const cite = page.locator(".pd-chapter-head .pd-cite-btn");
  await cite.click();
  const pop = page.locator("#cite-crashes");
  await expect(pop).toBeVisible();
  await expect(pop.locator("a.pd-quote")).toHaveCount(3);
  const href = await pop.locator("a.pd-quote").first().getAttribute("href");
  expect(href).toMatch(/^https:\/\/earendil\.com\/posts\/pi-durable\/#:~:text=/);
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  // the Try… menu is hidden until opened, and picking an item fills the message box
  const tryList = page.locator("[id^=try-]").first();
  await expect(tryList).toBeHidden();
  await page.locator("[popovertarget^=try-]").first().click();
  await expect(tryList).toBeVisible();
  await tryList.getByRole("menuitem", { name: "Deploy v1.5.1" }).click();
  await expect(tryList).toBeHidden();
  await expect(page.locator("[data-client] textarea").first()).toHaveValue("Deploy v1.5.1");
  // a chapter opens paused, and pauses at every caption until Next
  await page.goto("/demos/pi-durable/?chapter=harness&speed=4");
  const notes = () => page.evaluate(() => (window as any).piDurable()?.notes.length ?? 0);
  await expect(page.locator("#pd-next")).toHaveText("Start");
  await expect.poll(notes).toBe(1);
  await page.click("#pd-next");
  await expect(page.locator("#pd-next")).toHaveText("Next", { timeout: 30_000 });
  await expect.poll(notes).toBe(2);
  // the tour points at a chart: the inspector is a mode of its own
  for (let i = 0; i < 2 && (await page.locator("#pd-chart-hint").isHidden()); i++) {
    await page.click("#pd-next");
    await expect(page.locator("#pd-next")).toBeVisible({ timeout: 30_000 });
  }
  await page.click("#pd-chart-hint");
  await expect(page.locator("#pd-inspector")).toBeVisible();
  await expect(page.locator("#pd-main")).toBeHidden();
  await page.click("#pd-back");
  await expect(page.locator("#pd-main")).toBeVisible();
  expect(errors).toEqual([]);
});

const PAGES = [
  "/",
  "/docs/",
  "/docs/view/",
  "/demos/",
  "/demos/explorer/",
  "/demos/gallery/",
  "/demos/llm-chat/",
  "/demos/pi-durable/",
  "/playground/",
  "/search/?q=clock",
  "/404.html",
];

test.describe("llm chat at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("one activity and one client at a time; the speed control drives the clock", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/demos/llm-chat/");
    await expect(page.locator("[data-client=ada] .chat-chip")).toHaveText("live");
    // half speed by default, and the toolbar (one row on a phone: a compact speed select) changes it
    expect(await page.evaluate(() => (window as any).llmChat().clock.speed)).toBe(0.5);
    await expect(page.locator("#chat-speed-select")).toHaveValue("0.5");
    await page.selectOption("#chat-speed-select", "2");
    expect(await page.evaluate(() => (window as any).llmChat().clock.speed)).toBe(2);
    // one row (44px controls plus breathing room), not two
    expect((await page.locator(".chat-toolbar").boundingBox())!.height).toBeLessThan(80);
    // one set of playback controls: the explorer's own bar is hidden
    expect(
      await page.locator("scxml-explorer").evaluate((e) => getComputedStyle(e.shadowRoot!.querySelector("[part~=playback]")!).display),
    ).toBe("none");
    await page.click("#chat-play");
    await expect(page.locator("#chat-play")).toHaveAttribute("aria-label", "Play");
    await page.click("#chat-play");
    // chat first; Inside shows the host and the explorer instead
    await expect(page.locator("#chat-pane-chat")).toBeVisible();
    await expect(page.locator("#chat-pane-inside")).toBeHidden();
    await page.click(".chat-views button[data-view=inside]");
    await expect(page.locator("scxml-explorer")).toBeVisible();
    await expect(page.locator("#chat-pane-chat")).toBeHidden();
    await page.click(".chat-views button[data-view=chat]");
    // adding a client shows it; the switcher goes back to Ada
    await page.click("#chat-setup > summary");
    await page.selectOption("#chat-add", "terminal");
    await page.click("#chat-add-button");
    await expect(page.locator("[data-client=terminal]")).toBeVisible();
    await expect(page.locator("[data-client=ada]")).toBeHidden();
    await page.click("[data-client-tab=ada]");
    await expect(page.locator("[data-client=ada]")).toBeVisible();
    // big enough to tap
    for (const sel of ["#chat-play", "#chat-step", "#chat-speed-select", "[data-client-tab=ada]", ".chat-views button"]) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box!.height, sel).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });

  test("the editor's keyboard hint shows whole shortcuts only", async ({ page }) => {
    await page.goto("/demos/llm-chat/");
    const editor = page.locator("[data-client=ada] chat-prompt textarea");
    for (const text of ["one", "two", "three"]) {
      await editor.fill(text);
      await editor.press("Enter");
    }
    const hint = page.locator("[data-client=ada] chat-prompt").locator(".hint");
    await expect(hint).toContainText("⏎ queue");
    expect(await hint.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await hint.textContent()).not.toContain("…");
  });
});

test("llm chat: downloads are announced up front and shown live, per package and for the page (fake downloads)", async ({ page }) => {
  const errors = watchErrors(page);
  const wasmer: string[] = [];
  page.on("request", (r) => /wasmer/.test(r.url()) && wasmer.push(r.url()));
  await page.goto("/demos/llm-chat/?fake-downloads=fast,cached,fail");
  for (const kind of ["terminal", "python"]) {
    await page.selectOption("#chat-add", kind);
    await page.click("#chat-add-button");
  }
  const terminal = page.locator("[data-client=terminal]");
  const python = page.locator("[data-client=python]");
  // the cost, before anything happens
  await expect(terminal.locator(".chat-mode-option:has(input[value=real])")).toContainText(
    /Downloads about \d+(\.\d)? MB once, then cached/,
  );
  await expect(page.locator("#chat-dl")).toBeHidden();
  // switching to Real: the page-level indicator and one row per package, live
  await terminal.locator("input[value=real]").check();
  await expect(page.locator("#chat-dl")).toBeVisible();
  await expect(page.locator("#chat-dl-text")).toContainText("Downloading");
  // the Wasmer runtime first, then bash and coreutils: one package.scxml machine each
  await expect(terminal.locator(".chat-dl-rows li")).toHaveCount(3);
  await expect(terminal.locator(".chat-dl-rows li").first()).toContainText("Wasmer runtime");
  await expect(terminal.locator(".chat-dl-rows li progress").first()).toHaveAttribute("aria-label", /download/);
  expect(await axe(page)).toEqual([]);
  // tapping the indicator lists who is downloading
  await page.click("#chat-dl-toggle");
  await expect(page.locator("#chat-dl-list")).toContainText("Terminal");
  // done: cached coreutils, the indicator goes away
  await expect(terminal.locator(".chat-dl-total")).toHaveText("Ready.", { timeout: 15_000 });
  await expect(terminal.locator(".chat-dl-rows")).toContainText("from this browser's cache");
  await expect(page.locator("#chat-dl")).toBeHidden();
  // a second Terminal: what the first already has is not counted again, and shows as shared
  await page.selectOption("#chat-add", "terminal");
  await page.click("#chat-add-button");
  const terminal2 = page.locator("[data-client=terminal-2]");
  await expect(terminal2.locator(".chat-mode-option:has(input[value=real])")).toContainText("already here");
  await terminal2.locator("input[value=real]").check();
  await expect(terminal2.locator(".chat-dl-rows")).toContainText("shared with Terminal");
  // Python fails, visibly, with a retry
  await python.locator("input[value=real]").check();
  await expect(page.locator("#chat-dl-text")).toContainText("Download failed: Python", { timeout: 15_000 });
  await expect(python.locator(".chat-dl-rows")).toContainText("failed: network error (fake)");
  await expect(python.getByRole("button", { name: "Try again" })).toBeVisible();
  // the fake fails once: trying again goes through the same package machine, and works
  await python.getByRole("button", { name: "Try again" }).click();
  await expect(python.locator(".chat-dl-total")).toHaveText("Ready.", { timeout: 15_000 });
  await expect(page.locator("#chat-dl")).toBeHidden();
  await python.locator("input[value=simulated]").check();
  expect(wasmer).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe("390px wide: no horizontal overflow", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of PAGES)
    test(path, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});

// every page in the sitemap (the TypeDoc reference aside), plus the unindexed search and 404 pages
const SITEMAP = [
  ...readFileSync(new URL("../../_site/sitemap.xml", import.meta.url), "utf8").matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g),
]
  .map((m) => m[1]!)
  .filter((p) => !p.startsWith("/api/"));
const AUDITED = [...new Set([...SITEMAP, "/search/?q=clock", "/404.html"])];

for (const scheme of ["light", "dark"] as const)
  test.describe(`accessibility (axe-core), ${scheme}`, () => {
    for (const path of AUDITED)
      test(path, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await axe(page)).toEqual([]);
      });
  });
