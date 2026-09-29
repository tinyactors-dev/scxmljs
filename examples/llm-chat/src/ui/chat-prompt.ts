/**
 * <chat-prompt>: the message editor, with this client's queue flying out on top of it.
 *
 * It holds no conversation state: the page sets `queue`, `busy`, `canSteer`, `canStop`,
 * `disabled` and `status` from the client's chart, and the element reports what the person does:
 *
 *   prompt-submit        { text }   ⏎ or the send button (the chart sends it now, or queues it)
 *   prompt-steer         { text }   ⌘/Ctrl+⏎ or the steer button
 *   prompt-stop                     Esc, or the stop button (shown while a turn runs and the editor is empty)
 *   prompt-queue-edit    { id }     the pencil on a queued message (or ↑ in an empty editor: the last one)
 *   prompt-queue-remove  { id }     the bin on a queued message
 *
 * `appendText(text)` adds text to the editor after what is there (typed input is never replaced).
 * Styling comes from the page's design tokens (custom properties inherit into the shadow root).
 *
 * The textarea is a light-DOM child (slotted into the shadow root), so page tools, browser
 * automation and extensions that don't pierce shadow roots can still type into it. Its styles
 * live in one document-level stylesheet (EDITOR_STYLE), scoped to `chat-prompt > textarea.cp-editor`.
 */
import { ArrowUp, CornerDownRight, createElement, Pencil, Square, Trash2 } from "lucide";

export interface QueuedMessage {
  id: string;
  text: string;
}

const icon = (node: Parameters<typeof createElement>[0]) => {
  const svg = createElement(node, { width: 16, height: 16, "stroke-width": 2 });
  svg.setAttribute("aria-hidden", "true");
  return svg;
};

const STYLE = `
:host {
  display: block;
  position: relative;
  min-width: 0;
  --cp-surface: var(--surface-1, #fff);
  --cp-raised: var(--surface-2, #f4f4f4);
  --cp-border: var(--border-2, #ccc);
  --cp-fg: var(--fg-1, #111);
  --cp-muted: var(--fg-2, #555);
  --cp-accent: var(--accent, #2b6);
  --cp-on-accent: var(--fg-on-accent, #fff);
  --cp-radius: 12px;
  font: var(--type-body-sm, 14px/1.5 system-ui, sans-serif);
  color: var(--cp-fg);
}
.box {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  padding: 10px 10px 8px 14px;
  background: var(--cp-surface);
  border: 1px solid var(--cp-border);
  border-radius: var(--cp-radius);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.box:focus-within {
  border-color: var(--border-strong, var(--cp-muted));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cp-accent) 18%, transparent);
}
::slotted(textarea) {
  display: block;
}
.bar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
/* whole shortcuts only: the element drops the ones that don't fit (no ellipsis) */
.hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--fg-3, var(--cp-muted));
  white-space: nowrap;
  overflow: hidden;
}
button {
  display: inline-grid;
  place-items: center;
  border: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
  background: transparent;
}
button:focus-visible {
  outline: 2px solid var(--focus-ring, var(--cp-accent));
  outline-offset: 2px;
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
.steer {
  height: 30px;
  padding: 0 10px;
  gap: 4px;
  grid-auto-flow: column;
  border-radius: 999px;
  font-size: 12px;
  color: var(--cp-muted);
  border: 1px solid var(--cp-border);
}
.steer:not(:disabled):hover {
  color: var(--cp-fg);
  border-color: var(--cp-muted);
}
.primary {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: var(--cp-on-accent);
  background: var(--cp-accent);
}
.primary[data-mode="stop"] {
  color: var(--cp-surface);
  background: var(--cp-fg);
}
.primary[data-mode="stop"] svg {
  fill: currentColor;
  width: 12px;
  height: 12px;
}
.status {
  margin: 6px 2px 0;
  font-size: 12px;
  color: var(--cp-muted);
}
.status:empty {
  display: none;
}

/* ── the queue, flying out above the editor ── */
/* attached to the top of the editor, in the flow: it never covers the conversation above */
.queue {
  position: relative;
  margin: 0 12px -1px;
  padding: 6px;
  background: var(--cp-raised);
  border: 1px solid var(--cp-border);
  border-bottom: 0;
  border-radius: var(--cp-radius) var(--cp-radius) 0 0;
  box-shadow: 0 -6px 18px rgb(0 0 0 / 0.07);
  transform-origin: bottom center;
  animation: fly 160ms ease-out;
}
.queue[hidden] {
  display: none;
}
@keyframes fly {
  from {
    opacity: 0;
    transform: translateY(8px) scaleY(0.96);
  }
}
@media (prefers-reduced-motion: reduce) {
  .queue {
    animation: none;
  }
}
.queue-head {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 6px 6px;
  font: var(--type-label, 600 11px/1 ui-monospace, monospace);
  color: var(--cp-muted);
}
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 2px;
  max-height: 9.5em;
  overflow-y: auto;
}
li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 8px;
}
li:hover,
li:focus-within {
  background: color-mix(in srgb, var(--cp-fg) 6%, transparent);
}
li .n {
  flex: none;
  min-width: 1.4em;
  font: var(--type-label, 600 11px/1.6 ui-monospace, monospace);
  color: var(--cp-muted);
}
li .text {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
li .actions {
  flex: none;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 100ms ease;
}
li:hover .actions,
li:focus-within .actions {
  opacity: 1;
}
@media (hover: none) {
  li .actions {
    opacity: 1;
  }
}
li .actions button {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  color: var(--cp-muted);
}
li .actions button:hover {
  color: var(--cp-fg);
  background: color-mix(in srgb, var(--cp-fg) 8%, transparent);
}
li .actions button.remove:hover {
  color: var(--state-error, #c33);
}

/* phones and touch screens: 44px targets, and the hint (keyboard shortcuts) out of the way */
@media (max-width: 999px), (pointer: coarse) {
  .primary {
    width: 44px;
    height: 44px;
  }
  .steer {
    height: 44px;
    padding: 0 14px;
  }
  li {
    align-items: center;
  }
  li .actions button {
    width: 44px;
    height: 44px;
  }
}
@media (pointer: coarse) {
  .hint {
    visibility: hidden;
  }
}
`;

/** The light-DOM textarea's styles: specific enough to beat page rules such as `.chat-demo textarea`. */
const EDITOR_STYLE = `
chat-prompt > textarea.cp-editor {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 1.5em;
  max-height: 12em;
  margin: 0;
  resize: none;
  border: 0;
  border-radius: 0;
  outline: 0;
  box-shadow: none;
  padding: 2px 0;
  background: transparent;
  color: var(--fg-1, #111);
  font: var(--type-body-sm, 14px/1.5 system-ui, sans-serif);
  line-height: 1.5;
  field-sizing: content;
}
chat-prompt > textarea.cp-editor::placeholder {
  color: var(--fg-3, var(--fg-2, #555));
}
chat-prompt > textarea.cp-editor:disabled {
  cursor: not-allowed;
}
@media (max-width: 999px), (pointer: coarse) {
  chat-prompt > textarea.cp-editor {
    font-size: 16px; /* no zoom-on-focus on iOS */
  }
}
`;

function installEditorStyle(): void {
  if (document.querySelector("style[data-chat-prompt]")) return;
  const style = document.createElement("style");
  style.dataset.chatPrompt = "";
  style.textContent = EDITOR_STYLE;
  document.head.append(style);
}

/** Keyboard hints, most useful first; the element shows as many whole ones as fit. */
type Hint = string;

export class ChatPrompt extends HTMLElement {
  static readonly observedAttributes = ["placeholder", "label"];

  readonly #root: ShadowRoot;
  readonly #area: HTMLTextAreaElement;
  readonly #primary: HTMLButtonElement;
  readonly #steer: HTMLButtonElement;
  readonly #hint: HTMLElement;
  readonly #status: HTMLElement;
  readonly #queueEl: HTMLElement;
  readonly #count: HTMLElement;
  readonly #list: HTMLOListElement;
  readonly #items = new Map<string, HTMLLIElement>();

  #queue: QueuedMessage[] = [];
  #busy = false;
  #canSteer = false;
  #canStop = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;

    this.#queueEl = el("section", { class: "queue", hidden: "", "aria-label": "Queued messages" });
    this.#count = el("span");
    this.#list = el("ol") as HTMLOListElement;
    this.#queueEl.append(
      el("div", { class: "queue-head" }, el("span", {}, "Queued · sent one by one, when the model is done"), this.#count),
      this.#list,
    );

    this.#area = el("textarea", { rows: "1", class: "cp-editor", slot: "editor" }) as HTMLTextAreaElement;
    this.#steer = el(
      "button",
      { type: "button", class: "steer", title: "Steer: sent now, reaches the model at its next step (⌘/Ctrl+⏎)" },
      icon(CornerDownRight),
      "Steer",
    ) as HTMLButtonElement;
    this.#primary = el("button", { type: "button", class: "primary" }) as HTMLButtonElement;
    this.#hint = el("span", { class: "hint" });
    this.#status = el("p", { class: "status", role: "status" });
    const box = el(
      "div",
      { class: "box" },
      el("slot", { name: "editor" }),
      el("div", { class: "bar" }, this.#hint, this.#steer, this.#primary),
    );
    // the editor is focused by clicking anywhere in the box, as before
    box.addEventListener("pointerdown", (e) => {
      if (e.target === box) {
        e.preventDefault();
        this.#area.focus();
      }
    });
    this.#root.append(style, this.#queueEl, box, this.#status);

    this.#area.addEventListener("input", () => this.#sync());
    this.#area.addEventListener("keydown", (e) => this.#key(e));
    this.#primary.addEventListener("click", () => (this.#primary.dataset.mode === "stop" ? this.#emit("prompt-stop") : this.#send(false)));
    this.#steer.addEventListener("click", () => this.#send(true));
    new ResizeObserver(() => this.#fitHint()).observe(this.#hint);
    this.#sync();
  }

  attributeChangedCallback(): void {
    this.#area.placeholder = this.getAttribute("placeholder") ?? "";
    this.#area.setAttribute("aria-label", this.getAttribute("label") ?? "Message");
  }

  connectedCallback(): void {
    installEditorStyle();
    if (this.#area.parentNode !== this) this.append(this.#area);
    this.attributeChangedCallback();
  }

  /** The editor itself (a light-DOM child). */
  get editor(): HTMLTextAreaElement {
    return this.#area;
  }

  override focus(options?: FocusOptions): void {
    this.#area.focus(options);
  }

  /** What is typed right now. */
  get value(): string {
    return this.#area.value;
  }
  set value(v: string) {
    this.#area.value = v;
    this.#sync();
  }

  /** This client's queued messages, oldest first. */
  get queue(): QueuedMessage[] {
    return this.#queue;
  }
  set queue(q: QueuedMessage[]) {
    if (sameQueue(q, this.#queue)) return;
    this.#queue = q.map((m) => ({ ...m }));
    this.#renderQueue();
  }

  /** A turn is running: sending queues, and the primary button can stop. */
  get busy(): boolean {
    return this.#busy;
  }
  set busy(b: boolean) {
    this.#busy = b;
    this.#sync();
  }

  get canSteer(): boolean {
    return this.#canSteer;
  }
  set canSteer(b: boolean) {
    this.#canSteer = b;
    this.#sync();
  }

  get canStop(): boolean {
    return this.#canStop;
  }
  set canStop(b: boolean) {
    this.#canStop = b;
    this.#sync();
  }

  get disabled(): boolean {
    return this.#area.disabled;
  }
  set disabled(b: boolean) {
    this.#area.disabled = b;
    this.#sync();
  }

  /** A line under the editor (a refusal, what is waiting). */
  set status(text: string) {
    if (this.#status.textContent !== text) this.#status.textContent = text;
  }

  /** Add text after what is typed (a blank line between), and put the caret at the end. */
  appendText(text: string): void {
    const current = this.#area.value.replace(/\s+$/, "");
    this.#area.value = current ? `${current}\n\n${text}` : text;
    this.#sync();
    this.#area.focus();
    this.#area.setSelectionRange(this.#area.value.length, this.#area.value.length);
  }

  // ── internals ──────────────────────────────────────────────────────────

  #key(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.#send(e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape" && this.#busy && this.#canStop) {
      e.preventDefault();
      this.#emit("prompt-stop");
    } else if (e.key === "ArrowUp" && !this.#area.value && this.#queue.length) {
      e.preventDefault();
      this.#emit("prompt-queue-edit", { id: this.#queue.at(-1)!.id });
    }
  }

  #send(steer: boolean): void {
    const text = this.#area.value.trim();
    if (!text || this.#area.disabled || (steer && !this.#canSteer)) return;
    this.#area.value = "";
    this.#sync();
    this.#emit(steer ? "prompt-steer" : "prompt-submit", { text });
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** Buttons and hint follow the text, the roles and whether a turn runs. */
  #sync(): void {
    const empty = !this.#area.value.trim();
    const stop = this.#busy && this.#canStop && empty;
    const mode = stop ? "stop" : "send";
    if (this.#primary.dataset.mode !== mode) {
      this.#primary.dataset.mode = mode;
      this.#primary.replaceChildren(icon(stop ? Square : ArrowUp));
    }
    const label = stop ? "Stop the turn (Esc)" : this.#busy ? "Queue the message: it goes out when the model is done (⏎)" : "Send (⏎)";
    this.#primary.setAttribute("aria-label", label);
    this.#primary.title = label;
    this.#primary.disabled = !stop && (empty || this.#area.disabled);
    this.#steer.hidden = !this.#canSteer;
    this.#steer.disabled = empty || this.#area.disabled;
    const hints: Hint[] = this.#area.disabled
      ? []
      : this.#busy
        ? [
            "⏎ queue",
            ...(this.#canStop ? ["Esc stop"] : []),
            ...(this.#canSteer ? ["⌘⏎ steer"] : []),
            ...(this.#queue.length ? ["↑ edit last"] : []),
          ]
        : ["⏎ send", "⇧⏎ new line"];
    this.#hints = hints;
    this.#fitHint();
  }

  #hints: Hint[] = [];

  /** As many whole hints as fit, never one cut in half. */
  #fitHint(): void {
    const hint = this.#hint;
    for (let n = this.#hints.length; n >= 0; n--) {
      const text = this.#hints.slice(0, n).join(" · ");
      if (hint.textContent !== text) hint.textContent = text;
      if (n === 0 || hint.scrollWidth <= hint.clientWidth) return;
    }
  }

  /** Keyed, so hover and focus survive updates. */
  #renderQueue(): void {
    const ids = new Set(this.#queue.map((m) => m.id));
    for (const [id, li] of this.#items)
      if (!ids.has(id)) {
        li.remove();
        this.#items.delete(id);
      }
    this.#queue.forEach((m, i) => {
      let li = this.#items.get(m.id);
      if (!li) {
        li = this.#item(m);
        this.#items.set(m.id, li);
      }
      li.querySelector(".n")!.textContent = `${i + 1}`;
      if (this.#list.children[i] !== li) this.#list.insertBefore(li, this.#list.children[i] ?? null);
    });
    this.#queueEl.hidden = this.#queue.length === 0;
    this.#count.textContent = String(this.#queue.length);
    this.#sync();
  }

  #item(m: QueuedMessage): HTMLLIElement {
    const short = m.text.length > 40 ? `${m.text.slice(0, 40)}…` : m.text;
    const edit = el(
      "button",
      { type: "button", class: "edit", "aria-label": `Edit queued message: ${short}`, title: "Edit (back into the editor)" },
      icon(Pencil),
    );
    const remove = el(
      "button",
      { type: "button", class: "remove", "aria-label": `Delete queued message: ${short}`, title: "Delete" },
      icon(Trash2),
    );
    edit.addEventListener("click", () => this.#emit("prompt-queue-edit", { id: m.id }));
    remove.addEventListener("click", () => this.#emit("prompt-queue-remove", { id: m.id }));
    return el(
      "li",
      { "data-id": m.id },
      el("span", { class: "n" }),
      el("span", { class: "text" }, m.text),
      el("span", { class: "actions" }, edit, remove),
    ) as HTMLLIElement;
  }
}

function sameQueue(a: QueuedMessage[], b: QueuedMessage[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]?.id && m.text === b[i]?.text);
}

function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children);
  return e;
}

if (!customElements.get("chat-prompt")) customElements.define("chat-prompt", ChatPrompt);

declare global {
  interface HTMLElementTagNameMap {
    "chat-prompt": ChatPrompt;
  }
}
