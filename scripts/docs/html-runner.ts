/**
 * Renders the HTML samples from the docs in happy-dom with both custom
 * elements registered (doctest.ts runs this in its own process). Every
 * <scxml-view> must fire scxml-load (not scxml-error) and every
 * <scxml-explorer> must upgrade. `src` URLs are served from the files the
 * sample declared (files=…), matched by file name.
 *
 *   bun scripts/docs/html-runner.ts <jobs.json>
 */
import { Window } from "happy-dom";

interface Job {
  where: string;
  html: string;
  files: Record<string, string>;
}
const jobs: Job[] = await Bun.file(process.argv[2]!).json();

const window = new Window({ url: "http://localhost/docs/" });
let served: Record<string, string> = {};
const w = window as unknown as Record<string, unknown>;
for (const k of [
  "window",
  "document",
  "HTMLElement",
  "customElements",
  "CSSStyleSheet",
  "DOMParser",
  "XMLSerializer",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "CustomEvent",
  "KeyboardEvent",
  "ResizeObserver",
  "fetch",
]) {
  let v: unknown = k === "window" ? window : w[k];
  if (k === "fetch")
    v = async (url: string | URL) => {
      const name = String(url).split("/").pop()!;
      const text = served[name];
      return text == null ? new Response("not found", { status: 404 }) : new Response(text);
    };
  else if (typeof v === "function" && /^[a-z]/.test(k)) v = (v as (...a: unknown[]) => unknown).bind(window);
  if (v !== undefined) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
}
const { ScxmlView } = await import("../../packages/scxmljs/src/view.ts");
const { ScxmlExplorer } = await import("../../packages/scxmljs/src/explorer.ts");

const failures: string[] = [];
for (const job of jobs) {
  served = job.files;
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const outcomes: Promise<string | undefined>[] = [];
  // listen before the elements connect: they start loading when they're inserted
  const listen = (el: Element) =>
    new Promise<string | undefined>((resolve) => {
      const t = setTimeout(() => resolve("no scxml-load within 10 s"), 10_000);
      el.addEventListener("scxml-load", () => (clearTimeout(t), resolve(undefined)), { once: true });
      el.addEventListener("scxml-error", (e) => (clearTimeout(t), resolve(`scxml-error: ${(e as CustomEvent).detail?.message}`)), {
        once: true,
      });
    });
  const template = doc.createElement("template");
  template.innerHTML = job.html;
  for (const el of template.content.querySelectorAll("scxml-view")) {
    // autostart="false" or a session set by script: nothing loads in happy-dom without a script
    if (el.getAttribute("src") || el.querySelector('script[type="application/scxml+xml"]')) outcomes.push(listen(el));
  }
  host.append(template.content);
  for (const el of host.querySelectorAll("scxml-view"))
    if (!(el instanceof ScxmlView)) failures.push(`${job.where}: <scxml-view> didn't upgrade`);
  for (const el of host.querySelectorAll("scxml-explorer"))
    if (!(el instanceof ScxmlExplorer)) failures.push(`${job.where}: <scxml-explorer> didn't upgrade`);
  for (const r of await Promise.all(outcomes)) if (r) failures.push(`${job.where}: ${r}`);
  for (const el of host.querySelectorAll("scxml-view")) (el as unknown as InstanceType<typeof ScxmlView>).session?.dispose();
  host.remove();
  console.log(`rendered ${job.where}`);
}
await window.happyDOM.abort();
window.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
process.exit(0);
