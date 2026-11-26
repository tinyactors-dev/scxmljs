// live/catalog.js: the systems live mode can run (?live=<id>), for the directory by the door.
// Tiny on purpose: the replay pages import it without loading the engine.
export const LIVE_SYSTEMS = [
  { id: "microwave", title: "Microwave · live" },
  { id: "checkout", title: "Checkout · live" },
  { id: "fulfillment", title: "Orders · live" },
  { id: "llm-chat", title: "LLM chat · live" },
  { id: "pi-durable", title: "Pi durable · live" },
];
