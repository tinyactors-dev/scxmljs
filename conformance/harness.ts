/**
 * Runs one W3C conformance test (shared by run.ts and conformance.test.ts).
 * A test passes when its session reaches the top-level <final id="pass">.
 * Time is virtual: delayed events fire instantly, timeouts cost nothing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { createSession, SCXMLValidationError, VirtualClock } from "../packages/scxmljs/src/index.ts";
import * as trustedEntry from "../packages/scxmljs/src/trusted.ts";

export interface Entry {
  id: string;
  conformance: "mandatory" | "optional";
  manual: boolean;
  file: string;
  description: string;
}

export type Outcome = "pass" | "fail" | "timeout" | "error";

const here = import.meta.dir;
export const manifest: Entry[] = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const window = new Window();
const domParser = new window.DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

export async function runTest(entry: Entry, trusted: boolean): Promise<{ outcome: Outcome; detail: string; logs: string[] }> {
  const create = trusted ? trustedEntry.createSession : createSession;
  const path = join(here, entry.file);
  const dir = dirname(path);
  const clock = new VirtualClock();
  const logs: string[] = [];
  const loader = (src: string) => readFileSync(join(dir, src.replace(/^file:/, "")), "utf8");
  let outcome: Outcome | undefined;
  try {
    const session = await create(readFileSync(path, "utf8"), { clock, loader, domParser, scriptTimeoutMs: 1000 });
    session.addEventListener("microstep", (e) => {
      for (const s of e.entered)
        if (s.parent?.kind === "scxml" && s.kind === "final" && (s.id === "pass" || s.id === "fail")) outcome ??= s.id;
    });
    session.addEventListener("log", (e) => logs.push(`log ${e.label}: ${JSON.stringify(e.value)}`));
    session.addEventListener("error", (e) => logs.push(`${e.kind}: ${e.message}`));
    session.start();
    // run virtual time forward; stop at the outcome or after 60 virtual seconds
    for (let i = 0; i < 1000 && !outcome && !clock.idle; i++) {
      clock.run(clock.now() + 60_000);
      await Promise.resolve();
      if (clock.now() >= 60_000) break;
    }
    session.dispose();
    return { outcome: outcome ?? "timeout", detail: outcome ? "" : `ended in [${session.activeStateIds().join(", ")}]`, logs };
  } catch (e) {
    const msg = e instanceof SCXMLValidationError ? e.message : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { outcome: "error", detail: msg, logs };
  }
}
