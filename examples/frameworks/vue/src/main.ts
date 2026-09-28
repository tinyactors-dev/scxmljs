// The app around the component from docs/frameworks.md (Chart.vue is the documented snippet, verbatim).
import { createApp, h } from "vue";
import Chart from "./Chart.vue";
import { PLAYER } from "./chart";

createApp({ render: () => [h("h1", "Vue"), h(Chart, { source: PLAYER })] }).mount("#app");
