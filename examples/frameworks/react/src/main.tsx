// The app around the components from docs/frameworks.md (App.tsx is the documented snippet, verbatim).
import { createRoot } from "react-dom/client";
import { Chart, Explorer } from "./App";
import { PLAYER } from "./chart";

createRoot(document.getElementById("root")!).render(
  <>
    <h1>React</h1>
    <Chart src="/charts/traffic-light.scxml" />
    <Explorer source={PLAYER} />
  </>,
);
