/**
 * Timers and deferred work. Sessions never touch setTimeout/queueMicrotask
 * directly, so tests (and the conformance runner) can use a VirtualClock:
 * deterministic, and delayed events fire without real waiting.
 */
/**
 * Where a session gets its time: timers for delayed `<send>`s and deferred
 * work for external events. Pass one as `SessionOptions.clock`.
 */
export interface Clock {
  /** The current time in ms (real or virtual). */
  now(): number;
  /** Run `fn` after `ms` milliseconds of this clock's time; returns a handle for `clearTimeout`. */
  setTimeout(fn: () => void, ms: number): unknown;
  /** Cancel a timer from `setTimeout`. Unknown or already-fired handles are ignored. */
  clearTimeout(handle: unknown): void;
  /** Run `fn` soon, after the current task (a microtask on the real clock). */
  defer(fn: () => void): void;
}

/** The default clock: `Date.now`, the global `setTimeout` and microtasks. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  defer: (fn) => queueMicrotask(fn),
};

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** Earlier time first; equal times in the order they were scheduled. */
const before = (a: Timer, b: Timer) => a.at < b.at || (a.at === b.at && a.id < b.id);

/**
 * Deterministic time for tests and playback. Timers live in a binary heap
 * (O(log n) to schedule and fire) and cancelling is O(1), so a clock with
 * hundreds of thousands of pending timers stays fast.
 */
export class VirtualClock implements Clock {
  private time = 0;
  private seq = 0;
  /** timers that are still scheduled, by id */
  private live = new Map<number, Timer>();
  /** min-heap of timers; cancelled ones are skipped lazily */
  private heap: Timer[] = [];
  private deferred: ((() => void) | undefined)[] = [];
  private head = 0;

  now() {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number) {
    const timer = { id: ++this.seq, at: this.time + Math.max(0, ms), fn };
    this.live.set(timer.id, timer);
    this.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown) {
    this.live.delete(handle as number);
    // keep the heap from filling up with cancelled timers
    if (this.heap.length > 64 && this.heap.length > 4 * this.live.size) this.rebuild();
  }

  defer(fn: () => void) {
    this.deferred.push(fn);
  }

  /** True when nothing is scheduled: no deferred work and no pending timers. */
  get idle() {
    return this.ready === 0 && this.live.size === 0;
  }

  /**
   * Runs deferred work, then fires timers in time order, advancing virtual
   * time, until nothing is pending or the next timer is later than `until`
   * (absolute virtual ms). Returns the number of tasks run.
   */
  run(until = Infinity, maxTasks = 1_000_000): number {
    let n = 0;
    for (;;) {
      for (let d = this.takeDeferred(); d; d = this.takeDeferred()) {
        if (++n > maxTasks) throw new Error("VirtualClock: task limit exceeded");
        d();
      }
      const next = this.peek();
      if (!next || next.at > until) break;
      this.fire(next);
      if (++n > maxTasks) throw new Error("VirtualClock: task limit exceeded");
      next.fn();
    }
    if (until !== Infinity && this.time < until) this.time = until;
    return n;
  }

  /** Advance by `ms`, running everything due. */
  advance(ms: number) {
    return this.run(this.time + ms);
  }

  /**
   * Run exactly one task: the oldest deferred one, else the earliest timer
   * (advancing virtual time to it). Returns false when nothing is pending.
   */
  runNext(): boolean {
    const d = this.takeDeferred();
    if (d) {
      d();
      return true;
    }
    const next = this.peek();
    if (!next) return false;
    this.fire(next);
    next.fn();
    return true;
  }

  /** Virtual time of the next timer, if any. */
  get nextTimerAt(): number | undefined {
    return this.peek()?.at;
  }

  /** Number of pending tasks (deferred work + timers). */
  get pending(): number {
    return this.ready + this.live.size;
  }

  /** Deferred work waiting to run now (e.g. queued external events). */
  get ready(): number {
    return this.deferred.length - this.head;
  }

  private takeDeferred(): (() => void) | undefined {
    if (this.head >= this.deferred.length) return undefined;
    const fn = this.deferred[this.head];
    this.deferred[this.head++] = undefined;
    if (this.head === this.deferred.length) {
      this.deferred = [];
      this.head = 0;
    } else if (this.head > 1024 && this.head * 2 > this.deferred.length) {
      this.deferred = this.deferred.slice(this.head);
      this.head = 0;
    }
    return fn;
  }

  /** Remove `timer` (the heap's top) and move time to it. */
  private fire(timer: Timer) {
    this.pop();
    this.live.delete(timer.id);
    this.time = Math.max(this.time, timer.at);
  }

  /** The earliest live timer, dropping cancelled ones from the top. */
  private peek(): Timer | undefined {
    while (this.heap.length && !this.live.has(this.heap[0]!.id)) this.pop();
    return this.heap[0];
  }

  private push(t: Timer) {
    const h = this.heap;
    h.push(t);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private pop() {
    const h = this.heap;
    const last = h.pop();
    if (!last || !h.length) return;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && before(h[l]!, h[m]!)) m = l;
      if (r < h.length && before(h[r]!, h[m]!)) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }

  private rebuild() {
    const timers = [...this.live.values()];
    this.heap = [];
    for (const t of timers) this.push(t);
  }
}

/**
 * A VirtualClock that real time drives forward — at an adjustable speed —
 * and that can be paused and stepped. For visualisations: everything that
 * takes its time from this clock (sessions, delayed sends, fake services,
 * simulated environments) slows down, stops and single-steps together.
 *
 *   const clock = new PlaybackClock({ speed: 0.5 });
 *   const session = await createSession(src, { clock });
 *   clock.pause(); clock.step(); clock.play();
 */
export class PlaybackClock extends VirtualClock {
  #speed: number;
  #playing = false;
  #last = 0;
  #handle: unknown;
  #listeners = new Set<() => void>();

  /** `speed` defaults to 1; `playing` (default true) starts driving the clock right away. */
  constructor(opts: { speed?: number; playing?: boolean } = {}) {
    super();
    this.#speed = opts.speed ?? 1;
    if (opts.playing ?? true) this.play();
  }

  /** Whether real time is currently driving the clock. */
  get playing() {
    return this.#playing;
  }

  /** Virtual ms per real ms (1 = real time, 0.5 = half speed). */
  get speed() {
    return this.#speed;
  }

  /** Change the speed; negative values are treated as 0. */
  set speed(v: number) {
    this.#speed = Math.max(0, v);
    this.#notify();
  }

  /** Let real time drive the clock (at `speed`). */
  play() {
    if (this.#playing) return;
    this.#playing = true;
    this.#last = realNow();
    this.#schedule();
    this.#notify();
  }

  /** Stop time: nothing runs until `play()` or `step()`. */
  pause() {
    if (!this.#playing) return;
    this.#playing = false;
    cancelFrame(this.#handle);
    this.#notify();
  }

  /** Play if paused, pause if playing. */
  toggle() {
    if (this.#playing) this.pause();
    else this.play();
  }

  /**
   * Run tasks one at a time — jumping virtual time to the next timer when
   * nothing is ready — until `until()` holds after a task, or nothing is
   * pending. Pauses first. Returns the number of tasks run.
   */
  step(until: () => boolean = () => true, maxTasks = 10_000): number {
    this.pause();
    let n = 0;
    while (n < maxTasks && this.runNext()) {
      n++;
      if (until()) break;
    }
    this.#notify();
    return n;
  }

  // queued work changes what a UI shows (pending count, whether Step can do anything): tell subscribers
  /** Like `VirtualClock.setTimeout`, and notifies subscribers that work is queued. */
  override setTimeout(fn: () => void, ms: number) {
    const id = super.setTimeout(fn, ms);
    this.#notifySoon();
    return id;
  }

  /** Like `VirtualClock.defer`, and notifies subscribers that work is queued. */
  override defer(fn: () => void) {
    super.defer(fn);
    this.#notifySoon();
  }

  #notifyQueued = false;
  #notifySoon() {
    if (this.#notifyQueued || !this.#listeners.size) return;
    this.#notifyQueued = true;
    queueMicrotask(() => {
      this.#notifyQueued = false;
      this.#notify();
    });
  }

  /** Called after every tick, play/pause, speed change and step, and when work is queued. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Pause and drop every subscriber. */
  dispose() {
    this.pause();
    this.#listeners.clear();
  }

  #tick = () => {
    if (!this.#playing) return;
    const now = realNow();
    const dt = Math.min(now - this.#last, 250) * this.#speed; // cap: a background tab shouldn't fast-forward minutes
    this.#last = now;
    this.run(this.now() + dt);
    this.#notify();
    this.#schedule();
  };

  #schedule() {
    this.#handle = requestFrame(this.#tick);
  }

  #notify() {
    for (const fn of this.#listeners) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }
}

const realNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const requestFrame = (fn: () => void): unknown =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16);
const cancelFrame = (h: unknown) => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(h as number);
  clearTimeout(h as ReturnType<typeof setTimeout>);
};
