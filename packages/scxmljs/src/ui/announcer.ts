/**
 * A polite live region's pacing, shared by the scxmljs elements: urgent
 * messages (sent events, steps while paused or stepping) go out at once; while
 * a clock is running, messages are throttled to one per `interval` (ms of real
 * time — this paces a screen reader, not the simulation), the latest winning.
 */
export interface AnnouncerOptions {
  /** Minimum real-time distance between non-urgent messages (ms). */
  interval: () => number;
  /** True while the simulation is paused: messages go out at once. */
  paused: () => boolean;
}

export class Announcer {
  #last = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #pending = "";

  constructor(
    readonly region: HTMLElement,
    private opts: AnnouncerOptions,
  ) {}

  say(text: string, urgent = false) {
    const now = Date.now(); // real time on purpose: see above
    const wait = this.#last + this.opts.interval() - now;
    clearTimeout(this.#timer);
    if (urgent || this.opts.paused() || wait <= 0) {
      this.#last = now;
      this.#pending = "";
      // repeat identical messages: alternate a trailing no-break space so the change registers
      this.region.textContent = this.region.textContent === text ? `${text} ` : text;
      return;
    }
    this.#pending = text;
    this.#timer = setTimeout(() => this.say(this.#pending, true), wait);
  }

  dispose() {
    clearTimeout(this.#timer);
  }
}

/** The live region element itself (visually hidden). */
export const SR_ONLY_CSS =
  ".sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }";
