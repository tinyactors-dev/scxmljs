/**
 * The explorer demo: the playground's sample systems (examples/playground/src/explorer), each on a
 * PlaybackClock that drives the machines, the fake services and the simulated environment together.
 */
import "@tinyactors/scxmljs/explorer";
import { createSession, PlaybackClock, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
import { sampleById, samples } from "../../examples/playground/src/explorer/samples.ts";

const params = new URLSearchParams(location.search);
const explorer = document.querySelector("scxml-explorer")!;
const picker = document.getElementById("sample") as HTMLSelectElement;
const about = document.getElementById("about")!;
const restart = document.getElementById("restart")!;

picker.value = params.get("sample") ?? samples[0]!.id;

let current: { session: SCXMLSession; stop: () => void; clock: PlaybackClock } | undefined;

async function run(id: string) {
  const sample = sampleById(id);
  if (!sample) return;
  const speed = current?.clock.speed ?? 0.5;
  current?.stop();
  current?.session.dispose();
  current?.clock.dispose();
  about.textContent = sample.description;
  // ?paused=1 starts paused (the site's browser test steps it)
  const clock = new PlaybackClock({ speed, playing: !current && params.get("paused") === "1" ? false : true });
  const processors = sample.ioprocessors(clock);
  const session = await createSession(await sample.source(), { clock, loader: sample.loader, ioprocessors: processors, data: sample.data });
  explorer.attach({ session, processors, clock });
  session.start();
  const stop = sample.drive?.(session, clock) ?? (() => {});
  current = { session, stop, clock };
}

picker.addEventListener("change", () => {
  params.set("sample", picker.value);
  history.replaceState(null, "", `?${params}`);
  void run(picker.value);
});
restart.addEventListener("click", () => void run(picker.value));
void run(picker.value);
