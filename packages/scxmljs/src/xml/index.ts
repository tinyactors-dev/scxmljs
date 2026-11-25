/**
 * The library's own XML parser and DOM, for environments without a
 * `DOMParser` (Node, Bun, Deno). See `./parser.ts` and `./dom.ts`.
 */

import type { Document } from "./dom.ts";
import { parseXML } from "./parser.ts";

export {
  Attr,
  CDATASection,
  CharacterData,
  type ChildNode,
  Comment,
  Document,
  Element,
  NamedNodeMap,
  Node,
  NodeArray,
  type ParentNode,
  ProcessingInstruction,
  Text,
  XMLSerializer,
} from "./dom.ts";
export { PARSERERROR_NS } from "./parser.ts";

const XML_TYPES = ["application/xml", "text/xml"];

/** `DOMParser` for XML: `parseFromString(text, "application/xml" | "text/xml")`. */
export class DOMParser {
  /**
   * Parses `source` as XML. A document that isn't well-formed comes back as a
   * document whose root is a `<parsererror>` element, as from a browser.
   * @throws {TypeError} for any other MIME type.
   */
  parseFromString(source: string, type: string): Document {
    if (!XML_TYPES.includes(type))
      throw new TypeError(`DOMParser.parseFromString: unsupported type "${type}" (supported: ${XML_TYPES.join(", ")})`);
    return parseXML(String(source), type);
  }
}
