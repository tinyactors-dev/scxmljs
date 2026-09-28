/** Page bodies that aren't rendered from Markdown: landing, demos, playground placeholder, search, 404. */
import { REPO } from "../../scripts/docs/config.ts";
import { esc } from "./layout.ts";

export interface Media {
  webp: string;
  png: string;
  webm: string;
}

/** Charts shown in the gallery: file name in /charts/, title, one-line description. */
export const GALLERY: { file: string; title: string; text: string }[] = [
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
    text: "Guards on event data and <assign>: the smallest useful chart. Send login with data to sign in.",
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
    <a class="card" href="/playground/"><h2>Playground</h2><p>Edit a chart and watch it run. Coming soon.</p></a>
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

export function gallery(): string {
  return `<div class="wrap">
  <h1 class="page-title">Chart gallery</h1>
  <p class="lede">Each chart is a <code>&lt;scxml-view src="…"&gt;</code> with a <code>PlaybackClock</code>. Click a transition label to send its event; play, pause and step with the controls.</p>
  <div class="gallery">
${GALLERY.map(
  (c) => `    <figure class="card">
      <scxml-view trusted fit src="/charts/${c.file}" data-gallery aria-label="${esc(c.title)} statechart"></scxml-view>
      <figcaption><h2>${esc(c.title)}</h2><p>${esc(c.text)} <a href="/charts/${c.file}">Source</a></p></figcaption>
    </figure>`,
).join("\n")}
  </div>
</div>`;
}

export function playground(): string {
  return `<div class="wrap">
  <h1 class="page-title">Playground</h1>
  <p class="lede">Edit a statechart and watch it run, in the sandboxed engine.</p>
  <div class="card notice">
    <h2>Coming soon</h2>
    <p>The live editor is being built. Until then, the <a href="/demos/gallery/">gallery</a> runs example charts, and <a href="/docs/getting-started/">getting started</a> shows how to run your own.</p>
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
