# Event data and `<scxml-data>`

Many events carry data: an `add` names a product and a quantity, a `pay` a card or a voucher. A
chart can say what that data is, with an XML Schema inside it, and `<scxml-view>` then asks for it
with a form when someone clicks the event's label. The form is `<scxml-data>`, an element you can
use on its own to show, edit and compose any value a schema describes.

## Describe an event's data

Put an `<xs:schema>` in the chart, in XML Schema's namespace. Each top-level `<xs:element name>`
describes the `_event.data` of the event with that name. The interpreter ignores elements of other
namespaces, so the schema changes nothing about how the chart runs.

<!-- doctest: scxml -->
```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:xs="http://www.w3.org/2001/XMLSchema"
       version="1.0" datamodel="ecmascript" initial="cart">
  <xs:schema>
    <xs:element name="add">
      <xs:annotation><xs:documentation>Put a product in the cart.</xs:documentation></xs:annotation>
      <xs:complexType>
        <xs:sequence>
          <xs:element name="sku">
            <xs:simpleType><xs:restriction base="xs:string">
              <xs:enumeration value="notebook"/><xs:enumeration value="pen"/>
            </xs:restriction></xs:simpleType>
          </xs:element>
          <xs:element name="quantity" type="xs:positiveInteger" default="1"/>
          <xs:element name="gift" type="xs:boolean" minOccurs="0"/>
        </xs:sequence>
      </xs:complexType>
    </xs:element>
  </xs:schema>
  <datamodel><data id="items" expr="[]"/></datamodel>
  <state id="cart">
    <transition event="add"><script>items.push(_event.data)</script></transition>
  </state>
</scxml>
```

A click on `add` now opens a form with a select for `sku`, a number box for `quantity` (1 at least)
and an optional `gift`. The label shows `add …`: a click asks for the event's data (a label whose data the page gives
with `event-data` doesn't, since its click sends at once). Send (or Enter) sends the
event with the form's value; Cancel (or Escape) sends nothing. A value the schema refuses isn't
sent: its problems show at their fields.

`docs/examples/checkout.scxml` is a whole checkout: products, an address with a country and a
delivery date, and a payment that is a card or a voucher.

### Without a schema

A chart with no schema for an event still gets a form when it reads the event's data: each name it
reads as `_event.data.name` (or `_event.data["name"]`) where it handles the event becomes a field.
Such a field takes any JSON value, or text when what's typed isn't JSON (`12.5` is a number, `pen`
the text "pen"), and is left out when left empty.

### When the form shows

The `event-forms` attribute of `<scxml-view>` decides:

| Value | A click on an event that takes data |
|---|---|
| `auto` (the default) | opens the form, unless `event-data` gives data for that event: then it sends that, as before |
| `always` | opens the form, filled in from `event-data` when it gives some |
| `off` | sends at once, with `event-data`'s data or none |

A page can still change the data in an `scxml-send` listener, after the form.

## What the schema can say

In the ECMAScript data model a value is JSON, and the schema maps onto it:

| XML Schema | The value | The form |
|---|---|---|
| `xs:string`, `xs:token`, … | a string | a text box (a `maxLength` facet limits it) |
| `xs:decimal`, `xs:double`, `xs:integer`, `xs:positiveInteger`, … | a number | a number box, with the type's and the facets' bounds |
| `xs:boolean` | `true` or `false` | a checkbox |
| `xs:date`, `xs:dateTime`, `xs:time` | its text (`2026-12-01`) | the browser's date box |
| `xs:enumeration` facets | one of the values | a select |
| `xs:pattern` | a string matching it (whole) | a text box, checked |
| `xs:list` | an array | a text box of values separated by spaces |
| `xs:complexType` with `xs:sequence` or `xs:all`, and `xs:attribute`s | an object: a field per child element and attribute | a group of fields |
| `minOccurs="0"`, `use="optional"` | the field may be left out | a button that adds it, and one that removes it |
| `maxOccurs` more than 1, or `unbounded` | an array | a list that grows to the bound |
| `xs:choice` | an object with one of the options' fields | a select of the options, then the chosen one's fields |
| `default`, `fixed` | the first value (`fixed` can't be changed) | filled in |
| `xs:annotation/xs:documentation` | | shown under the field, or under the form's title |

A named type (`type="Address"`, a top-level `xs:complexType` or `xs:simpleType`) can be used by
several elements, and can refer to itself: a tree is composed to any depth. `ref="other"` uses
another top-level element. What the reader doesn't know (`xs:any`, `xs:union`, imports, substitution
groups) takes any JSON value. The schema has no target namespace to declare: names are matched by
their local part.

## `<scxml-data>` on its own

<!-- doctest: html -->
```html
<scxml-data id="ship" element="ship"></scxml-data>
<script type="module">
  import "@tinyactors/scxmljs/data";

  const form = document.querySelector("#ship");
  form.schema = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
    <xs:element name="ship">
      <xs:complexType><xs:sequence>
        <xs:element name="city" type="xs:string"/>
        <xs:element name="deliverOn" type="xs:date" minOccurs="0"/>
      </xs:sequence></xs:complexType>
    </xs:element>
  </xs:schema>`;
  form.addEventListener("input", () => console.log(form.value, form.valid));
</script>
```

| | |
|---|---|
| `schema` | the schema: XML text, a document or element holding `<xs:schema>`s (a chart), or `readSchemas(...)`'s result |
| `element` (attribute) | the top-level element whose value this is |
| `field` | what the value may be, given directly instead of `schema` and `element` |
| `value` (also an attribute, as JSON) | the value; before one is set, the schema's first value |
| `readonly` (attribute), `readOnly` | show the value, don't edit it |
| `valid`, `problems` | whether the value is what the schema says, and each problem with its path (`["items", 2, "price"]`) and message |
| `reportValidity()` | show every problem (not only those of fields already left), focus the first, return `valid` |
| `strings` | the words it shows (`defaultDataStrings`), to translate it |
| `input`, `change` events | the value changed; an edit was committed |

It uses the shared theme's `--scxml-*` properties ([theming](theming.md)) and its `form` part.

The schema reader is exported too, for forms of your own:

<!-- doctest: check -->
```ts
import { check, defaultDataStrings, initialValue, readSchemas } from "@tinyactors/scxmljs/data";

const schema = readSchemas(new DOMParser().parseFromString("<scxml/>", "application/xml"));
const add = schema.elements.get("add");
if (add) console.log(initialValue(add), check(add, { sku: "pen" }, defaultDataStrings));
```
