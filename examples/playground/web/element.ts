import type { ViewErrorDetail, ViewLoadDetail } from "@tinyactors/scxmljs/view";
import "@tinyactors/scxmljs/view";
import { createHarness } from "../src/ui/harness.ts";

const view = document.querySelector("scxml-view")!;
const harness = createHarness();
document.getElementById("panel-slot")!.append(harness.panel);

view.options = harness.options;
view.addEventListener("scxml-load", (e) => {
  harness.bind((e as CustomEvent<ViewLoadDetail>).detail.session);
  status.textContent = "running";
});
view.addEventListener("scxml-error", (e) => {
  status.textContent = (e as CustomEvent<ViewErrorDetail>).detail.message;
});

// live editing: re-parse and restart on (debounced) input
const source = document.getElementById("source") as HTMLTextAreaElement;
const status = document.getElementById("status")!;
fetch("/charts/github-issues.scxml").then(async (r) => {
  source.value = await r.text();
});
let timer: ReturnType<typeof setTimeout>;
source.addEventListener("input", () => {
  clearTimeout(timer);
  status.textContent = "…";
  timer = setTimeout(() => {
    view.source = source.value;
  }, 400);
});
