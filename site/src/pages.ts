/** Page bodies that aren't rendered from Markdown: landing, demos, playground placeholder, search, 404. */
import { REPO } from "../../scripts/docs/config.ts";
import { esc } from "./layout.ts";
import { EXAMPLES } from "./playground-examples.ts";

export interface Media {
  webp: string;
  png: string;
  webm: string;
}

/** Charts shown in the gallery: file name in /charts/, title, one-line description, and the data label clicks send (`event-data`). */
export const GALLERY: { file: string; title: string; text: string; eventData?: Record<string, unknown> }[] = [
  {
    file: "traffic-light.scxml",
    title: "Traffic light",
    text: "Delayed <send>s drive the cycle; <cancel> on exit, and a counter in the datamodel.",
  },
  {
    file: "microwave.scxml",
    title: "Microwave",
    text: "Two parallel regions, engine and door, coordinated with In(). It only cooks with the door closed.",
  },
  {
    file: "player.scxml",
    title: "Media player",
    text: "A <parallel> transport and sound, and a <history> that remembers whether it was muted.",
  },
  {
    file: "login.scxml",
    title: "Sign in",
    text: "Guards on event data and <assign>: the smallest useful chart. Clicking login sends {user: 'ada'} (set with the event-data attribute).",
    eventData: { login: { user: "ada" } },
  },
];

export function landing(media: Media | undefined): string {
  return `<div class="wrap" data-pagefind-body>
  <section class="hero">
    <div>
      <p class="eyebrow">SCXML 1.0 · ECMAScript data model</p>
      <h1>Statecharts you can <em>run</em>, see and step through</h1>
      <p class="lede">scxmljs is a correctness-first SCXML interpreter that passes every mandatory W3C test, with two custom elements that render running charts in any framework: <code>&lt;scxml-view&gt;</code> draws a whole chart, <code>&lt;scxml-explorer&gt;</code> explores whole systems level by level.</p>
      <div class="install">
        <code id="install-cmd">npm install @tinyactors/scxmljs</code>
        <button class="icon-button copy" type="button" data-copy="#install-cmd">Copy</button>
      </div>
      <div class="actions">
        <a class="button primary" href="/docs/getting-started/">Get started</a>
        <a class="button" href="/demos/">See the demos</a>
        <a class="button" href="${REPO}">GitHub</a>
      </div>
    </div>
    <figure class="card hero-demo">
      <scxml-view id="hero-view" trusted direction="right" fit src="/charts/traffic-light.scxml" aria-label="A live traffic light statechart"></scxml-view>
      <figcaption><span>Live: <code>&lt;scxml-view src="traffic-light.scxml"&gt;</code></span><a href="/demos/gallery/">More charts</a></figcaption>
    </figure>
  </section>
${
  media
    ? `  <figure class="showcase">
    <a class="card frame" href="${media.webm}" aria-label="Watch the explorer tour (WebM video)">
      <img src="${media.webp}" width="1600" height="1000" alt="The explorer stepping through an order-fulfilment system: the tree of states, the focused compound state, the events it accepts, and the system of machines and services." loading="lazy">
    </a>
    <figcaption><code>&lt;scxml-explorer&gt;</code> on a three-machine order system. <a href="${media.webm}">Full-resolution video</a> · <a href="/demos/explorer/">try it</a></figcaption>
  </figure>`
    : ""
}
  <h2 class="section-title">Why scxmljs</h2>
  <div class="features">
    <div class="card feature"><span class="stat">160 / 160</span><h3>Conformant</h3><p>Every mandatory W3C SCXML test passes, in both data models. The algorithm follows the spec's Appendix D procedure by procedure.</p></div>
    <div class="card feature"><span class="stat">Sandboxed</span><h3>Safe for user charts</h3><p>Each session gets its own QuickJS context: no access to the page, other sessions, or the network, and runaway scripts are stopped.</p></div>
    <div class="card feature"><span class="stat">16 KB</span><h3>Or trusted and tiny</h3><p>For your own charts, the trusted entry runs on the page's engine with the same semantics and no WebAssembly download.</p></div>
    <div class="card feature"><span class="stat">▶ ⏸ ⏭</span><h3>Playback built in</h3><p>A <code>PlaybackClock</code> pauses, steps and speeds up whole systems: machines, delayed events and simulated services together.</p></div>
    <div class="card feature"><span class="stat">Any framework</span><h3>Custom elements</h3><p>Plain web components with properties, events, slots and <code>::part()</code>. Tested with React, Vue, Svelte and Angular.</p></div>
    <div class="card feature"><span class="stat">Accessible</span><h3>Keyboard and screen readers</h3><p>Tree navigation, live announcements, WCAG AA contrast in both themes, and zero axe violations in three browser engines.</p></div>
  </div>
  <h2 class="section-title">Two elements, two jobs</h2>
  <div class="two-up">
    <div class="card"><h3>&lt;scxml-view&gt;</h3><p>Drop-in and zero-JavaScript: point it at a chart and it loads, validates, runs and draws the whole thing. Transition labels are buttons that send their event.</p><a href="/docs/view/">Reference</a> · <a href="/demos/gallery/">Gallery</a></div>
    <div class="card"><h3>&lt;scxml-explorer&gt;</h3><p>For systems too big to draw at once: a tree of states, a focus on one level, the events accepted right now, and a system view of machines and services.</p><a href="/docs/explorer/">Reference</a> · <a href="/demos/explorer/">Demo</a></div>
  </div>
</div>`;
}

export function demosIndex(): string {
  return `<div class="wrap">
  <h1 class="page-title">Demos</h1>
  <p class="lede">Everything here runs in your browser on the published library: no server, no build step.</p>
  <div class="demo-cards">
    <a class="card" href="/demos/explorer/"><h2>Explorer</h2><p>Three systems — an order pipeline with invoked payment and shipping machines, a 333-state support desk, and a GitHub gatekeeper — with playback controls.</p></a>
    <a class="card" href="/demos/gallery/"><h2>Chart gallery</h2><p>Classic statecharts drawn by <code>&lt;scxml-view&gt;</code>: parallel regions, history, delayed events, guards. Click a transition to send its event.</p></a>
    <a class="card" href="/demos/llm-chat/"><h2>LLM chat</h2><p>A group chat with a language model, run by statecharts: streaming, parallel tool calls from several clients, queueing, steering and stopping. Simulated by default; bring your own API key for Claude.</p></a>
    <a class="card" href="/playground/"><h2>Playground</h2><p>Edit a chart and watch it re-run as you type, in the sandboxed engine: diagnostics in the editor, playback controls, share links.</p></a>
  </div>
</div>`;
}

export function explorerDemo(samples: { id: string; title: string }[]): string {
  return `<div class="wrap explorer-demo">
  <h1 class="page-title">Explorer</h1>
  <p class="lede">A running system at three levels: the <em>system</em> of machines and services, one <em>machine</em> as a tree plus a focus on one compound state, and a <em>state</em>'s details. The focus follows the action until you navigate; Space pauses, <kbd>.</kbd> steps.</p>
  <div class="demo-bar">
    <label>Sample <select id="sample">${samples.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join("")}</select></label>
    <button id="restart" type="button">Restart</button>
    <span class="about" id="about"></span>
  </div>
  <scxml-explorer>
    <div slot="state:completed" class="slotted">✓ <strong>Order complete</strong> — custom slotted UI</div>
    <div slot="state:closed" class="slotted">slotted: closed issues are archived nightly</div>
  </scxml-explorer>
  <p>Built with <a href="/docs/explorer/"><code>&lt;scxml-explorer&gt;</code></a> and a <a href="/docs/playback/"><code>PlaybackClock</code></a>. The simulated services are custom <a href="/docs/io-processors/">I/O processors</a>; the source is in <a href="${REPO}/tree/main/examples/playground/src/explorer">examples/playground</a>.</p>
</div>`;
}

export function llmChatDemo(): string {
  const speeds = [
    ["0.25", "¼×"],
    ["0.5", "½×"],
    ["1", "1×"],
    ["2", "2×"],
    ["4", "4×"],
  ];
  return `<div class="chat-demo" data-view="chat">
  <h1 class="page-title">LLM chat</h1>
  <p class="lede">A group chat with a language model where statecharts make every decision: who may type, when a message waits, where a steer goes, which client runs which tool. It all runs in this tab, simulated, on one clock you can slow down, pause and step.</p>
  <div class="chat-toolbar">
    <div class="chat-playback" role="group" aria-label="Playback">
      <button id="chat-play" type="button" class="chat-play" aria-label="Pause"></button>
      <fieldset class="chat-speed">
        <legend class="visually-hidden">Speed</legend>
        ${speeds.map(([v, label]) => `<label><input type="radio" name="chat-speed" value="${v}"><span>${label}</span></label>`).join("")}
      </fieldset>
      <label class="chat-speed-compact"><span class="visually-hidden">Speed</span><select id="chat-speed-select">${speeds.map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}</select></label>
      <button id="chat-step" type="button" class="chat-step" aria-label="Step"><span class="chat-step-label">Step</span></button>
      <span class="chat-time" id="chat-time" aria-label="Simulated time">0.0 s</span>
    </div>
    <div class="chat-views" role="group" aria-label="Show">
      <button type="button" data-view="chat" aria-pressed="true">Chat</button>
      <button type="button" data-view="inside" aria-pressed="false">Inside</button>
    </div>
    <div class="chat-dl" id="chat-dl" hidden>
      <button type="button" class="chat-dl-toggle" id="chat-dl-toggle" aria-expanded="false" aria-controls="chat-dl-list">
        <span class="chat-dl-text" id="chat-dl-text"></span>
        <progress class="chat-dl-bar" id="chat-dl-bar" max="100" aria-label="All downloads"></progress>
      </button>
      <ul class="chat-dl-list" id="chat-dl-list" hidden></ul>
    </div>
  </div>
  <p class="chat-caption" id="chat-caption" aria-live="polite"></p>
  <div class="chat-panes">
    <section class="chat-pane" id="chat-pane-chat" aria-labelledby="chat-pane-chat-title">
      <h2 class="visually-hidden" id="chat-pane-chat-title">Chat</h2>
      <details class="chat-setup" id="chat-setup">
        <summary>Scenario · add a client · reset</summary>
        <div class="chat-setup-body">
          <div class="chat-field">
            <label class="chat-field-label" for="chat-scenario">Scenario</label>
            <div class="chat-combo">
              <select id="chat-scenario"><option value="">Free play</option></select>
              <button id="chat-run" type="button" class="chat-primary">Run</button>
            </div>
          </div>
          <div class="chat-field">
            <label class="chat-field-label" for="chat-add">Add a client</label>
            <div class="chat-combo">
              <select id="chat-add"></select>
              <button id="chat-add-button" type="button">Add</button>
            </div>
          </div>
          <button id="chat-reset" type="button" class="chat-quiet">Reset</button>
        </div>
      </details>
      <div class="chat-switcher" id="chat-switcher" role="group" aria-label="Clients"></div>
      <div class="chat-clients" id="chat-clients"></div>
    </section>
    <section class="chat-pane chat-inspect" id="chat-pane-inside" aria-labelledby="chat-inspect-title">
      <h2 id="chat-inspect-title">Inside</h2>
      <div class="chat-inside-grid">
        <section class="chat-host card" aria-labelledby="chat-host-title">
          <h3 id="chat-host-title">Host</h3>
          <div id="chat-host-body"></div>
        </section>
        <div class="chat-inside-main">
          <div class="chat-field chat-chart-picker">
            <label class="chat-field-label" for="chat-session">Chart</label>
            <select id="chat-session"></select>
            <span class="chat-small">One machine at a time; the playback controls drive the whole system.</span>
          </div>
          <scxml-explorer></scxml-explorer>
          <div class="chat-timeline-head">
            <h3>Timeline</h3>
            <label><input type="checkbox" id="chat-batches"> show log batches</label>
          </div>
          <ol class="chat-timeline" id="chat-timeline" aria-label="Messages between the host and the clients"></ol>
        </div>
      </div>
    </section>
  </div>
  <p>The charts, protocols and simulated model and tools are in <a href="${REPO}/tree/main/examples/llm-chat">examples/llm-chat</a>. Built with <a href="/docs/explorer/"><code>&lt;scxml-explorer&gt;</code></a>, a <a href="/docs/playback/"><code>PlaybackClock</code></a>, <a href="/docs/io-processors/">custom I/O processors</a> and <a href="/docs/invokers/">invokers</a>.</p>
</div>`;
}

export function gallery(): string {
  return `<div class="wrap">
  <h1 class="page-title">Chart gallery</h1>
  <p class="lede">Each chart is a <code>&lt;scxml-view src="…"&gt;</code> with a <code>PlaybackClock</code>. Click a transition label to send its event; play, pause and step with the controls.</p>
  <div class="gallery">
${GALLERY.map(
  (c) => `    <figure class="card">
      <scxml-view trusted fit src="/charts/${c.file}"${c.eventData ? ` event-data="${esc(JSON.stringify(c.eventData))}"` : ""} data-gallery aria-label="${esc(c.title)} statechart"></scxml-view>
      <figcaption><h2>${esc(c.title)}</h2><p>${esc(c.text)} <a href="/charts/${c.file}">Source</a> · <a href="/playground/?example=${c.file.replace(/\.scxml$/, "")}">Open in playground</a></p></figcaption>
    </figure>`,
).join("\n")}
  </div>
</div>`;
}

export function playground(): string {
  const first = EXAMPLES[0]!;
  return `<div class="playground" id="playground" data-tab="view">
  <div class="pg-intro" data-pagefind-body>
    <h1 class="page-title">Playground</h1>
    <p class="lede">Pick an example, edit its SCXML, and it re-runs as you type. Charts run in the <a href="/docs/sandboxed-vs-trusted/">sandboxed engine</a>: they can't touch this page or the network, and runaway scripts are stopped. Click a transition to send its event, or use the form below the diagram. New to SCXML? Start with <a href="/docs/getting-started/">getting started</a>.</p>
  </div>
  <div class="pg-bar">
    <label class="pg-picker">Example <select id="pg-example">${EXAMPLES.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join("")}</select></label>
    <span class="pg-about" id="pg-about">${esc(first.text)}</span>
    <span class="pg-actions">
      <button class="button" id="pg-reset" type="button">Reset</button>
      <button class="button" id="pg-download" type="button">Download</button>
      <button class="button primary" id="pg-share" type="button">Share link</button>
    </span>
  </div>
  <p class="pg-status" id="pg-status" role="status" aria-live="polite">Loading…</p>
  <div class="pg-notice notice" id="pg-notice" hidden></div>
  <div class="pg-tabs" role="tablist" aria-label="Playground panels">
    <button type="button" role="tab" data-pg-tab="edit" aria-selected="false" aria-controls="pg-panel-edit">Edit</button>
    <button type="button" role="tab" data-pg-tab="view" aria-selected="true" aria-controls="pg-panel-run">Diagram</button>
    <button type="button" role="tab" data-pg-tab="explore" aria-selected="false" aria-controls="pg-panel-run">Explorer</button>
  </div>
  <div class="pg-grid">
    <section class="pg-edit" id="pg-panel-edit" aria-label="Editor">
      <div class="pg-editor card" id="pg-editor"><p class="pg-loading">Loading the editor…</p></div>
      <details class="pg-problems-box" open>
        <summary>Problems: <span id="pg-problem-count">none</span></summary>
        <ul class="pg-problems" id="pg-problems"></ul>
      </details>
    </section>
    <section class="pg-run" id="pg-panel-run" aria-label="Running chart">
      <div class="pg-stage card">
        <scxml-view class="pg-view" id="pg-view" direction="auto" fit aria-label="The chart, running"></scxml-view>
        <scxml-explorer class="pg-explorer" id="pg-explorer" aria-label="The chart in the explorer"></scxml-explorer>
      </div>
      <form class="pg-send" id="pg-send" aria-label="Send an event">
        <label>Event <input id="pg-send-name" name="event" required placeholder="e.g. go" autocomplete="off" spellcheck="false"></label>
        <label>Data <input id="pg-send-data" name="data" placeholder='JSON, e.g. {"user": "ada"}' autocomplete="off" spellcheck="false"></label>
        <button class="button" type="submit">Send</button>
        <div class="pg-suggestions" id="pg-suggestions" aria-label="Suggested events"></div>
      </form>
      <div class="pg-log-box">
        <div class="pg-log-head"><h2>Log</h2><button class="button" id="pg-log-clear" type="button">Clear</button></div>
        <ol class="pg-log" id="pg-log" aria-label="Log: <log> output, errors and steps"></ol>
      </div>
    </section>
  </div>
</div>`;
}

export function search(): string {
  return `<div class="search-page">
  <h1 class="page-title">Search</h1>
  <div id="search"></div>
</div>`;
}

export function notFound(): string {
  return `<div class="wrap">
  <h1 class="page-title">Not found</h1>
  <p class="lede">There's no page at this address. Try the <a href="/docs/">documentation</a>, the <a href="/demos/">demos</a> or <a href="/search/">search</a>.</p>
</div>`;
}
