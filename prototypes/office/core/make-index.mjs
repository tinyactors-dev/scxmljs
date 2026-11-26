// node core/make-index.mjs : writes data/index.json from the data/<system>/ directories that have a
// trace.json (office: true when there is an office.json), keeping titles already set.
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
const dir = new URL("../data/", import.meta.url); const file = new URL("index.json", dir);
const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const titles = new Map((old.systems || []).map((s) => [s.id, s.title]));
const order = ["llm-chat", "llm-chat-dynamic", "pi-durable", "fulfillment", "github-issues"];
const ids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/trace.json`, dir))).map((d) => d.name)
  .sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || (a < b ? -1 : 1));
const systems = ids.map((id) => ({ id, title: titles.get(id) || id, ...(existsSync(new URL(`${id}/office.json`, dir)) ? { office: true } : {}) }));
writeFileSync(file, JSON.stringify({ default: old.default || "llm-chat", systems }, null, 2) + "\n");
console.log(systems.map((s) => s.id + (s.office ? "*" : "")).join(" "));
