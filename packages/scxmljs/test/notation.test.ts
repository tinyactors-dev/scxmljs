/**
 * The event-name primitive (docs/design-principles.md, "Event names: the event chip"): a name is
 * shown as written, split into a quieter namespace and its last part, with its kind as a class.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const window = new Window();
let notation: typeof import("../src/ui/notation.ts");
const saved = Object.getOwnPropertyDescriptor(globalThis, "document");

beforeAll(async () => {
  Object.defineProperty(globalThis, "document", { value: window.document, configurable: true, writable: true });
  notation = await import("../src/ui/notation.ts");
});
afterAll(() => {
  if (saved) Object.defineProperty(globalThis, "document", saved);
  else delete (globalThis as Record<string, unknown>).document;
  window.close();
});

test("event kinds: completions, errors, wildcards", () => {
  const kinds = [
    "done.state.cancelling",
    "done.invoke.payment",
    "email.paymentFailed.done",
    "error.execution",
    "error",
    "email.sent.error",
    "carrier.*",
    "*",
    "order.placed",
    "cancel",
  ].map((n) => notation.eventKind(n));
  expect(kinds).toEqual(["done", "done", "done", "error", "error", "error", "wildcard", "wildcard", "event", "event"]);
});

test("an event name is the name as written: namespace and last part, its kind a class, no glyphs", () => {
  const el = notation.eventName("email.paymentFailed.done");
  expect(el.textContent).toBe("email.paymentFailed.done");
  expect(el.querySelector(".ns")?.textContent).toBe("email.paymentFailed.");
  expect(el.querySelector(".leaf")?.textContent).toBe("done");
  expect(el.classList.contains("kind-done")).toBe(true);
  expect(el.title).toBe("email.paymentFailed.done");
  expect(el.querySelector("svg, .glyph")).toBeNull();
  const plain = notation.eventName("cancel");
  expect(plain.querySelector(".ns")).toBeNull();
  expect(plain.querySelector(".leaf")?.textContent).toBe("cancel");
  expect(notation.eventName("carrier.*").querySelector(".leaf")?.textContent).toBe("*");
});
