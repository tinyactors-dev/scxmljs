/**
 * The playground's example charts: shared by the page markup (build time) and the client.
 * Every file lives in /charts/ on the site (copied from examples/playground/charts, docs/examples
 * and site/charts by scripts/site/build.ts).
 */

/** An event the example suggests sending (shown as a button under the event form). */
export interface SuggestedEvent {
  name: string;
  data?: unknown;
  /** Button text, when the name alone isn't clear. */
  label?: string;
}

export interface PlaygroundExample {
  id: string;
  title: string;
  /** File in /charts/; empty for the blank chart (its source is inline). */
  file: string;
  /** One line: what the example demonstrates. */
  text: string;
  /**
   * Harmless fake services the example opts into (the chart can't reach the network):
   * "github" = an in-memory GitHub, "fulfillment" = fake risk/CRM/warehouse/payments/carrier/email.
   */
  services?: "github" | "fulfillment";
  /** Starting playback speed (default 1): the multi-machine examples start at ¼ so you can follow them. */
  speed?: number;
  events: SuggestedEvent[];
}

/** The starting point for "Blank chart" and for shared links without an example. */
export const BLANK_CHART = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" name="my-chart" initial="idle">
  <datamodel>
    <data id="count" expr="0"/>
  </datamodel>
  <state id="idle">
    <transition event="go" target="busy">
      <assign location="count" expr="count + 1"/>
    </transition>
  </state>
  <state id="busy">
    <onentry><send id="timer" event="done" delay="1s"/></onentry>
    <onexit><cancel sendid="timer"/></onexit>
    <transition event="done" target="idle">
      <log label="finished run" expr="count"/>
    </transition>
  </state>
</scxml>
`;

export const EXAMPLES: PlaygroundExample[] = [
  {
    id: "traffic-light",
    title: "Traffic light",
    file: "traffic-light.scxml",
    text: "Delayed <send>s drive the cycle and <cancel> cleans up on exit.",
    events: [{ name: "power.off" }],
  },
  {
    id: "microwave",
    title: "Microwave",
    file: "microwave.scxml",
    text: "Two parallel regions, engine and door, coordinated with In().",
    events: [{ name: "turn.on" }, { name: "door.open" }, { name: "door.close" }, { name: "turn.off" }],
  },
  {
    id: "player",
    title: "Media player",
    file: "player.scxml",
    text: "A <parallel> transport and sound, and a <history> that remembers muting.",
    events: [
      { name: "play" },
      { name: "mute" },
      { name: "pause" },
      { name: "volume", data: { value: 7 }, label: "volume 7" },
      { name: "stop" },
    ],
  },
  {
    id: "login",
    title: "Sign in",
    file: "login.scxml",
    text: "A guard on event data, and <assign> into the datamodel.",
    events: [
      { name: "login", data: { user: "ada" }, label: "login as ada" },
      { name: "login", data: {}, label: "login without a user" },
      { name: "logout" },
    ],
  },
  {
    id: "downloads",
    title: "Downloads (invoke)",
    file: "downloads.scxml",
    text: "An invoked child machine reports progress to #_parent and ends with done.invoke.",
    events: [{ name: "start" }, { name: "cancel" }],
  },
  {
    id: "gatekeeper",
    title: "GitHub gatekeeper",
    file: "github-issues.scxml",
    text: "Talks to an I/O processor (an in-memory fake GitHub): closes issues from people not on the allowlist.",
    services: "github",
    speed: 0.25,
    events: [
      {
        name: "issues.opened",
        data: { repo: "acme/widgets", number: 1, title: "Crash on startup", author: "mallory" },
        label: "issue by mallory",
      },
      {
        name: "issues.opened",
        data: { repo: "acme/widgets", number: 2, title: "Typo in README", author: "octocat" },
        label: "issue by octocat",
      },
      { name: "allowlist.add", data: { login: "mallory" }, label: "allow mallory" },
    ],
  },
  {
    id: "fulfillment",
    title: "Order fulfilment",
    file: "fulfillment.scxml",
    text: "A 59-state order machine that invokes payment and shipping machines and talks to six fake services.",
    services: "fulfillment",
    speed: 0.25,
    events: [
      {
        name: "order.placed",
        label: "place an order",
        data: {
          id: "SO-10482",
          customer: { id: "cus_3317", name: "Jana de Vries", email: "jana@example.org" },
          items: [
            { sku: "LMP-DESK-OAK", name: "Desk lamp, oak", qty: 1, price: 189.0 },
            { sku: "CHR-ERG-GRY", name: "Ergonomic chair, grey", qty: 1, price: 431.0 },
          ],
          amount: 620.0,
          currency: "EUR",
          address: { street: "Prinsengracht 263", postcode: "1016 GV", city: "Amsterdam", country: "NL" },
        },
      },
      { name: "admin.hold", data: { reason: "stock audit" }, label: "hold" },
      { name: "admin.release", label: "release" },
      { name: "customer.cancel", label: "cancel" },
    ],
  },
  {
    id: "blank",
    title: "Blank chart",
    file: "",
    text: "A small starting point: two states, a delayed event and a counter.",
    events: [{ name: "go" }],
  },
];

/** Files a playground session may load through `src` (invoke/data/script): the example charts, nothing else. */
export const LOADABLE_FILES = new Set([
  ...EXAMPLES.map((e) => e.file).filter(Boolean),
  "fulfillment-payment.scxml",
  "fulfillment-shipping.scxml",
]);

export function exampleById(id: string | null | undefined): PlaygroundExample | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
