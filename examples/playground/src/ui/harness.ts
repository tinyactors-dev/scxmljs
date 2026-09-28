/**
 * Demo harness for the <scxml-view> page: a fake GitHub repo, the GitHub
 * I/O processor wired to it, and a control panel to poke the chart.
 */
import { SCXML_IOPROCESSOR, type SCXMLSession as Session, type SessionEventMap, type SessionOptions } from "@tinyactors/scxmljs/trusted";
import { FakeGitHub, type FakeIssue } from "../scxml/fake-github.ts";
import { GitHubIOProcessor, issuesWebhook } from "../scxml/github-ioprocessor.ts";

export const REPO = "acme/widgets";

type Attrs = Record<string, string | ((e: Event) => void)>;
export function h(tag: string, attrs: Attrs = {}, ...kids: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else el.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) el.append(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}

export interface Harness {
  gh: FakeGitHub;
  github: GitHubIOProcessor;
  panel: HTMLElement;
  /** Options to construct interpreters with (ioprocessors etc.). */
  options: SessionOptions;
  /** (Re)bind the panel to a running interpreter. */
  bind(s: Session): void;
}

export function createHarness(latencyMs = 600): Harness {
  const gh = new FakeGitHub(latencyMs);
  const github = new GitHubIOProcessor(gh);
  let current: Session | undefined;
  let unbind: (() => void) | undefined;

  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;

  const authors = ["octocat", "dhamidi", "mallory", "eve", "trent"];
  const open = (action: "opened" | "reopened") => {
    const author = $<HTMLInputElement>("[name=author]").value.trim() || "mallory";
    const title = $<HTMLInputElement>("[name=title]").value.trim() || "Something is broken";
    let issue: FakeIssue | undefined;
    if (action === "reopened") {
      issue = [...gh.issues.values()].filter((i) => i.state === "closed").at(-1);
      if (!issue) return note("no closed issue to reopen");
      void gh.reopen(issue.repo, issue.number);
    } else issue = gh.open(REPO, author, title);
    github.receiveWebhook("issues", issuesWebhook(action, REPO, issue.number, issue.author, issue.title));
  };

  const panel = h(
    "div",
    { class: "sx-panel" },
    h("h2", {}, "Simulated GitHub"),
    h(
      "form",
      {
        class: "sx-row",
        onsubmit: (e) => {
          e.preventDefault();
          open("opened");
        },
      },
      h("input", { name: "author", list: "sx-authors", placeholder: "author", value: "mallory", size: "9" }),
      h("datalist", { id: "sx-authors" }, ...authors.map((a) => h("option", { value: a }))),
      h("input", { name: "title", placeholder: "title", value: "Something is broken", size: "14" }),
      h("button", { type: "submit", class: "sx-primary" }, "Open issue"),
    ),
    h(
      "div",
      { class: "sx-row" },
      h("button", { type: "button", onclick: () => open("reopened") }, "Reopen last closed"),
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            gh.failNext("close");
            render();
          },
        },
        "Fail next close",
      ),
    ),
    // declarative sends (session.bind): the form's fields become the event data
    h(
      "form",
      { class: "sx-row", "data-scxml-send": "allowlist.add" },
      h("input", { name: "login", placeholder: "login", size: "9", required: "required" }),
      h("button", { type: "submit" }, "Allow"),
      h("button", { type: "submit", "data-scxml-send": "allowlist.remove" }, "Disallow"),
    ),
    h("h3", {}, "Issues in ", h("code", {}, REPO)),
    h("ul", { class: "sx-issues" }),
    h("h3", {}, "Datamodel"),
    h("pre", { class: "sx-data" }),
    h("h3", {}, "Trace"),
    h("ol", { class: "sx-log", reversed: "reversed" }),
  );

  function note(text: string, kind = "note") {
    const log = $("ol.sx-log");
    log.prepend(h("li", { class: `sx-k-${kind}` }, text));
    while (log.children.length > 60) log.lastElementChild!.remove();
  }

  function render() {
    const list = $("ul.sx-issues");
    list.replaceChildren(
      ...[...gh.issues.values()]
        .reverse()
        .map((i) =>
          h(
            "li",
            { class: `sx-issue sx-${i.state}` },
            h("b", {}, `#${i.number}`),
            ` ${i.title} — @${i.author} `,
            h("span", { class: "sx-state" }, i.state),
            ...i.labels.map((l) => h("span", { class: "sx-label" }, l)),
            i.comments.length ? h("span", { class: "sx-comments" }, `💬 ${i.comments.length}`) : null,
          ),
        ),
    );
    const pending = [...gh.failures].filter(([, n]) => n).map(([v, n]) => `${v}×${n}`);
    if (pending.length) list.prepend(h("li", { class: "sx-k-note" }, `injected failures pending: ${pending.join(", ")}`));
    if (current) $("pre.sx-data").textContent = JSON.stringify(current.snapshot(), null, 2);
  }
  gh.addEventListener("change", render);

  const listeners: { [K in keyof SessionEventMap]?: (e: SessionEventMap[K]) => void } = {
    microstep: (e) => {
      const to = e.transitions.flatMap((t) => t.targets.map((x) => x.id)).join(", ");
      note(`${e.event ? e.event.name : "∅"} → ${to || "(targetless)"}`, "step");
    },
    send: ({ message: m }) => {
      if (m.type !== SCXML_IOPROCESSOR) note(`send ${m.event} ⇒ ${m.target || m.type}`, "send");
    },
    log: (e) => note(`${e.label}: ${e.value ?? ""}`, "log"),
    error: (e) => note(`${e.kind}: ${e.message}`, "error"),
    macrostep: () => render(),
  };
  const each = (fn: <K extends keyof SessionEventMap>(type: K, l: (e: SessionEventMap[K]) => void) => void) => {
    for (const type of Object.keys(listeners) as (keyof SessionEventMap)[]) fn(type, listeners[type] as never);
  };

  return {
    gh,
    github,
    panel,
    options: { ioprocessors: [github], data: { backoffMs: 1500 } },
    bind(s) {
      const prev = current;
      if (prev) each((type, l) => prev.removeEventListener(type, l));
      unbind?.();
      current = s;
      each((type, l) => s.addEventListener(type, l));
      // the allowlist controls are data-scxml-send elements; mark the ones the chart can take now
      unbind = s.bind(panel, { reflectEnabled: true });
      render();
    },
  };
}
