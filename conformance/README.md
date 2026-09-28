# SCXML conformance tests (W3C IRP)

The W3C SCXML Implementation Report Plan tests, converted to the ECMAScript datamodel.

The converted suite is **vendored**: `ecma/` and `manifest.json` are committed, so running it needs no
network. Licence: see [`LICENSE-W3C`](LICENSE-W3C). The W3C dual-licenses the suite under the W3C Test Suite
License and the W3C 3-clause BSD License; it is redistributed here under the BSD terms.

```sh
mise run conformance              # sandboxed data model
mise run conformance:trusted      # trusted data model
mise run conformance:fetch        # regenerate ecma/ and manifest.json (network + bunx xslt3)
```

To regenerate, the fetch script downloads `manifest.xml`, `confEcma.xsl` and every test and dependency file from
<https://www.w3.org/Voice/2013/scxml-irp/> into `.cache/`. It uses 8 parallel requests and retries
failed requests. Later runs use the cache and do not use the network. `--refresh` downloads everything again.
Each `.txml` is converted to `.scxml` in `ecma/<assertId>/`. Other dependency files (`.txt`) are
copied as they are. The script then writes `manifest.json`. Only `.cache/` is git-ignored.

**Why not xsltproc:** `confEcma.xsl` is XSLT 2.0 (`xsl:analyze-string`, `regex-group()`).
libxslt runs it in forwards-compatible mode and does not report an error. It outputs empty attributes
instead: 97 `cond=""` in the first run. So the script uses SaxonJS through `bunx xslt3@2.7.0`. Bun caches
this package, and it does not change `package.json`. The stylesheet is compiled once to
`.cache/confEcma.sef.json`.

## How a test works

- Each test is one SCXML document with `datamodel="ecmascript"`. It **passes** when the session reaches
  the top-level `<final id="pass">` and **fails** when it reaches `<final id="fail">`. Both finals also
  `<log label="Outcome" expr="'pass'|'fail'"/>` in their `onentry`.
- Most tests schedule `<send event="timeout" delay="…"/>`. A `*` or `timeout` transition then goes
  to `fail`, so a test that hangs will fail after this delay. A runner still needs its own time limit:
  more than 30s for the HTTP tests, and 5s is enough for most others.
- A document refers to a sub-document or data file with a relative `file:` URI, for example
  `src="file:test239sub1.scxml"`. Resolve it relative to the directory of the document. That file
  is in the same directory.

`manifest.json` entries:

```ts
{ id, assert, specnum, specid, conformance: "mandatory"|"optional", manual: boolean,
  file: "ecma/<assert>/testNNN.scxml", deps: ["ecma/<assert>/..."], description }
```

`id` is the same as `assert` in all entries but one: assert 403 has three start documents, which get
the ids `403a`, `403b` and `403c`.

## Counts

202 tests from 200 assertions: **168 mandatory, 34 optional, 9 manual**. All 206 `.scxml` files
are well-formed (`xmllint --noout`). No `conf:` elements or attributes remain. Only the `xmlns:conf`
declarations and the text `<conf:script>` in a comment in test302 are left, and neither has an effect.

## Manual tests (9)

These tests need a person to check the log or behaviour that a runner cannot observe. Skip them in automated runs.

| id  | reason |
|-----|--------|
| 178 | Check the log: the duplicate param/namelist keys are in `_event.raw` |
| 230 | Check the log: the child's event and the forwarded event are the same |
| 250 | Check the child's log: the onexit handlers ran when the invoke was cancelled |
| 301 | `<script src="D:\foo">` cannot be loaded, so the document must be rejected |
| 307 | Late binding: compare the logged values |
| 313 | Invalid expression: the processor can reject it at load time or raise an error at runtime |
| 314 | Same as 313 |
| 415 | The processor must halt in the initial final state and not process `event1` |
| 513 | BasicHTTP: send a POST with wget and check for a 200 response (`test513.txt` has the instructions) |

## Categories

**Basic HTTP Event I/O Processor** (all optional, C.2): 201, 509, 510, 518, 519, 520, 522,
531, 532, 534, 567, 577 (+ 513 manual). These tests use `type="http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor"`
and `_ioprocessors['basichttp']['location']`. Most of them have a 30s timeout.

**`<invoke>` with an external document** (mandatory): 216 (`srcexpr` evaluates to
`'file:test216sub1.scxml'`), 226, 239, 242 (`src="file:testNNNsub1.scxml"`), 276
(`type="scxml"` with `src`). 36 tests in total use `<invoke>`. The other 31 tests use inline `<content>`.

**`<data src>` / `<script src>`**: 446, 557, 558 (optional) and 552 (mandatory) load `file:testNNN.txt`.
446 and 552 expect the loaded value to be JSON, 558 expects a plain string, and 557 expects an XML document.
301 (manual) must reject an unloadable `<script src>`.

**XML DOM values in the datamodel** (optional): 557 (an inline `<data>` with XML children, and `data src` of an
XML file) and 561 (`<send><content>` with XML becomes `_event.data`). Both call
`getElementsByTagName(...)[n].getAttribute(...)`, so these values must be DOM `Document`s.

**Timing and delays**: 78 documents use `<send delay|delayexpr>`. In most of them the delay is only a
timeout that fails the test. The longest are 30s (509, 510, 518, 519, 520, 522, 534), 20s (347),
and 5s (191, 192, 215, 216, 220, 350, 351, 352, 354). These tests **wait for a delayed event
before they pass**, so each takes at least this long: 175 (0.5s), 185, 186, 187, 252, 409, 423, 553,
554, 579 (1s), 207, 208, 210, 237 (1.5s), 236, 422 (2s). 175 also uses `delayexpr="Var1"`. 208 and
210 test `<cancel>` of a delayed send.

## Optional tests (34)

| category | ids |
|----------|-----|
| ECMAScript datamodel details (B.2) | 278, 444, 445, 448, 449, 451, 452, 453, 456, 457, 459, 460, 569 |
| `<data>` src/inline content parsing (B.2) | 446 (JSON file), 557 (XML → DOM), 558 (text file) |
| `_event.data` content parsing (B.2) | 560 (key-value), 561 (XML → DOM), 562 (string), 578 (JSON) |
| SCXML Event I/O processor (C.1) | 193 (a send with no target goes to the external queue of the sending session) |
| Basic HTTP Event I/O Processor (C.2) | 201, 509, 510, 513 (manual), 518, 519, 520, 522, 531, 532, 534, 567, 577 |
