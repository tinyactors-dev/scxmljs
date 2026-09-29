# llm-chat (working draft)

A multi-client LLM conversation, run by statecharts, entirely in one browser tab: streaming,
parallel tool calls from several providers, per-client message queues (visible, editable), steering, stop, retries, clients
joining, leaving and going offline. It runs on a simulated model and simulated tools by default,
on one shared clock, so you can pause, step and slow down the whole system. Paste an Anthropic
API key to talk to Claude; it never leaves the tab except to go to api.anthropic.com.

The page is /demos/llm-chat/ on the website (`site/client/llm-chat.ts`); `mise run site:build && mise run site:serve`, then http://localhost:4400/demos/llm-chat/.

| Path | |
|---|---|
| `charts/host.scxml` | the host's controller: roster, model, conversation, inbox |
| `charts/client.scxml` | every client: joining, sync, composer, its own queue (outbox), tool work, simulated/real tools, network link |
| `charts/workspace.scxml`, `charts/package.scxml` | the shared WebAssembly workspace, and one machine per package download |
| `charts/scenarios/*.scxml` | scripted walkthroughs; they drive the page through the `stage` processor |
| `PROTOCOL.md` | every processor and invoker: the messages it accepts and what it answers |
| `src/protocol.ts` | the same, as types |
| `src/bus.ts`, `src/log.ts` | the bus (host ⇄ clients) and the chat log (the only writer of the history) |
| `src/llm.ts` | the `llm` and `key-check` invokers |
| `src/sim-model.ts`, `src/claude-model.ts` | the two model sources |
| `src/tools/` | the tool runtime; simulated tools; real tools in WebAssembly (`wasm.ts`: one shared Wasmer workspace with bash, Python and psql, plus PGlite; `packages.ts`: what each tool downloads) |
| `src/catalog.ts` | the kinds of client the page can add |
| `src/view.ts` | what a panel renders, folded from the log |
| `src/ui/chat-prompt.ts` | `<chat-prompt>`: the editor, with the client's own queue flying out on top (edit, delete) |
| `src/system.ts` | wires one system together; the page and the tests both use it |

```sh
bun test examples/llm-chat
```

Real tools: switch Terminal, Python or Postgres to Real in its panel. First downloads, once per browser: the Wasmer runtime 4.9 MB, then Terminal ≈ 15 MB, Python ≈ 62 MB more (≈ 76 MB if it goes first: it brings bash and coreutils), Postgres ≈ 78 MB. Terminal, Python and psql share one `/workspace`: what one writes, the others read.
`SITE_TEST_REAL_TOOLS=1 mise run site:test` runs them in the browser test too.

Next: Claude mode by hand.
