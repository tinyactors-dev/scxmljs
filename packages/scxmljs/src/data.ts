/**
 * @tinyactors/scxmljs/data — the `<scxml-data>` custom element: shows, edits and composes a value
 * of the ECMAScript data model as an XML Schema type describes it, and the schema reader behind it.
 *
 * ```html
 * <script type="module">import "@tinyactors/scxmljs/data";</script>
 * <scxml-data element="checkout"></scxml-data>
 * ```
 *
 * A chart describes the data its events take with an `<xs:schema>` in XML Schema's namespace: each
 * top-level `<xs:element name>` is the `_event.data` of the event of that name. `<scxml-view>` uses
 * this element to ask for an event's data before it sends it.
 *
 * @packageDocumentation
 */

export { ScxmlData } from "./data/element.ts";
export { type DataStrings, defaultDataStrings } from "./data/strings.ts";
export {
  type CheckWords,
  check,
  type DataProblem,
  type DataType,
  type Facets,
  type Field,
  inferredObject,
  initialValue,
  readSchema,
  readSchemas,
  type Schema,
  XSD_NS,
} from "./data/xsd.ts";
