// The app around the component from docs/frameworks.md (Chart.svelte is the documented snippet, verbatim).
import { mount } from "svelte";
import Chart from "./Chart.svelte";
import { PLAYER } from "./chart";

document.getElementById("app")!.append(Object.assign(document.createElement("h1"), { textContent: "Svelte" }));
mount(Chart, { target: document.getElementById("app")!, props: { source: PLAYER } });
