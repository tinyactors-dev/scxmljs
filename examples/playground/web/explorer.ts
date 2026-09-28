import "@tinyactors/scxmljs/explorer";
import { createSession, PlaybackClock, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
// The Tinyactors look is an optional stylesheet shipped with the package. It's applied unless
// ?theme=neutral asks for the explorer's neutral default. (Published consumers link
// "@tinyactors/scxmljs/themes/tinyactors.css"; inside the repo the source file is used.)
import tinyactorsTheme from "../../../packages/scxmljs/src/themes/tinyactors.css" with { type: "text" };
import { sampleById, samples } from "../src/explorer/samples.ts";

const params = new URLSearchParams(location.search);
if (params.get("theme") !== "neutral") {
  document.head.append(Object.assign(document.createElement("style"), { textContent: tinyactorsTheme }));
}

const explorer = document.querySelector("scxml-explorer")!;
const picker = document.getElementById("sample") as HTMLSelectElement;
const about = document.getElementById("about")!;
const restart = document.getElementById("restart")!;

picker.replaceChildren(...samples.map((s) => Object.assign(document.createElement("option"), { value: s.id, textContent: s.title })));
picker.value = params.get("sample") ?? samples[0]!.id;

let current: { session: SCXMLSession; stop: () => void; clock: PlaybackClock } | undefined;

async function run(id: string) {
  const sample = sampleById(id);
  if (!sample) return;
  const speed = current?.clock.speed ?? 0.25; // slow enough to follow what the machines do
  current?.stop();
  current?.session.dispose();
  current?.clock.dispose();
  about.textContent = sample.description;
  // everything — the machines, the fake services, the simulated customers — runs on this clock,
  // so pausing, stepping and changing speed affect the whole system at once
  // ?paused=1 starts paused (the browser tests step it deterministically)
  const clock = new PlaybackClock({ speed, playing: !current && params.get("paused") === "1" ? false : true });
  const processors = sample.ioprocessors(clock);
  const session = await createSession(await sample.source(), { clock, loader: sample.loader, ioprocessors: processors, data: sample.data });
  explorer.attach({ session, processors, clock });
  session.start();
  const stop = sample.drive?.(session, clock) ?? (() => {});
  current = { session, stop, clock };
  Object.assign(globalThis, { session, clock });
}

picker.addEventListener("change", () => {
  params.set("sample", picker.value);
  history.replaceState(null, "", `?${params}`);
  void run(picker.value);
});
restart.addEventListener("click", () => void run(picker.value));
void run(picker.value);
