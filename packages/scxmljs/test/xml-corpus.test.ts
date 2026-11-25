/**
 * Differential test of the built-in XML parser (src/xml) against happy-dom's
 * DOMParser: every SCXML file of the repository must parse to the same tree
 * (node types, namespaces, prefixes, local names, attributes as sets, text
 * exactly, comments and processing instructions included) under the document
 * element. Outside it the two differ on purpose: happy-dom drops the comments
 * and processing instructions around the root, which browsers (and the
 * built-in parser) keep as children of the document.
 *
 * Two more happy-dom deviations from the DOM and Namespaces standards are
 * corrected in its tree before comparing (each is spelled out below, so a
 * difference of any other kind still fails):
 * - it splits a text node at each ">" (a browser makes one text node of
 *   character data, so adjacent text nodes are merged here);
 * - under `xmlns=""` it leaves the descendants in the outer default
 *   namespace (W3C tests 557 and 561: `<books xmlns=""><book/>`, whose
 *   `<book>` is in no namespace).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Window } from "happy-dom";
import { DOMParser } from "../src/xml/index.ts";

const repo = join(import.meta.dir, "../../..");
const ROOTS = ["examples", "docs/examples", "site/charts", "conformance"];

function scxmlFiles(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) scxmlFiles(path, out);
    else if (name.endsWith(".scxml")) out.push(path);
  }
  return out;
}

/** The parts of a DOM node both implementations must agree on. */
interface AnyNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<AnyNode>;
  namespaceURI?: string | null;
  prefix?: string | null;
  localName?: string | null;
  attributes?: ArrayLike<{ namespaceURI: string | null; prefix: string | null; localName: string; value: string }>;
}

/** One line per node, indented by depth; attributes sorted, so they compare as sets. */
function canonical(node: AnyNode, depth = 0, out: string[] = []): string[] {
  const pad = "  ".repeat(depth);
  switch (node.nodeType) {
    case 1: {
      const attrs = Array.from(node.attributes ?? [])
        .map((a) => `{${a.namespaceURI ?? ""}}${a.prefix ? `${a.prefix}:` : ""}${a.localName}=${JSON.stringify(a.value)}`)
        .sort();
      out.push(`${pad}element {${node.namespaceURI ?? ""}}${node.prefix ? `${node.prefix}:` : ""}${node.localName} ${attrs.join(" ")}`);
      break;
    }
    case 3:
    case 4:
    case 8:
      out.push(`${pad}${node.nodeType} ${JSON.stringify(node.nodeValue)}`);
      break;
    case 7:
      out.push(`${pad}pi ${node.nodeName} ${JSON.stringify(node.nodeValue)}`);
      break;
    case 9:
      break;
    default:
      return out; // a DocumentType: the built-in parser makes none
  }
  let text: string | null = null;
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType === 3) {
      text = (text ?? "") + c.nodeValue;
      continue;
    }
    if (text !== null) out.push(`${pad}  3 ${JSON.stringify(text)}`);
    text = null;
    canonical(c, depth + 1, out);
  }
  if (text !== null) out.push(`${pad}  3 ${JSON.stringify(text)}`);
  return out;
}

/** happy-dom's namespace for the children of `<books xmlns="">`, corrected. */
const UNDECLARED_DEFAULT: Record<string, [string, string]> = {
  "conformance/ecma/557/test557.scxml": ["element {http://www.w3.org/2005/07/scxml}book ", "element {}book "],
  "conformance/ecma/561/test561.scxml": ["element {http://www.w3.org/2005/07/scxml}book ", "element {}book "],
};

const files = ROOTS.flatMap((r) => scxmlFiles(join(repo, r))).sort();
const happy = new new Window().DOMParser();
const ours = new DOMParser();

describe("the built-in XML parser reads every SCXML file of the repository as happy-dom does", () => {
  test("the corpus is there", () => {
    expect(files.length).toBeGreaterThan(200);
  });
  for (const file of files) {
    test(relative(repo, file), () => {
      const text = readFileSync(file, "utf8");
      const root = (doc: unknown) => (doc as { documentElement: AnyNode }).documentElement;
      const fix = UNDECLARED_DEFAULT[relative(repo, file)];
      const expected = canonical(root(happy.parseFromString(text, "application/xml"))).map((l) => (fix ? l.replace(fix[0], fix[1]) : l));
      const actual = canonical(root(ours.parseFromString(text, "application/xml")));
      expect(expected.some((l) => l.includes("parsererror"))).toBe(false);
      expect(actual.join("\n")).toBe(expected.join("\n"));
    });
  }
});

test("parsing the largest chart of the repository takes well under 50 ms", () => {
  const largest = files.reduce((a, b) => (statSync(b).size > statSync(a).size ? b : a));
  const text = readFileSync(largest, "utf8");
  ours.parseFromString(text, "application/xml"); // warm up
  const start = performance.now();
  for (let i = 0; i < 10; i++) ours.parseFromString(text, "application/xml");
  const each = (performance.now() - start) / 10;
  expect(each).toBeLessThan(50);
});
