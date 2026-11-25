/**
 * The words `<scxml-data>` shows. Every one can be replaced (`element.strings = {...}`), to
 * translate the element or to say things another way.
 */
import type { CheckWords } from "./xsd.ts";

export interface DataStrings extends CheckWords {
  /** The button that adds an optional field, or an item to a list. */
  add: (name: string) => string;
  /** The button that removes an optional field or an item. */
  remove: (name: string) => string;
  /** The label of item `i` (0-based) of the list `name`. */
  item: (name: string, i: number) => string;
  /** A value that is not set (an optional field left out). */
  unset: string;
  /** The label of the choice between options. */
  choose: string;
  /** The placeholder of a field that takes any JSON value. */
  anyPlaceholder: string;
  /** A list with no items, in view mode. */
  empty: string;
  /** The summary of a value's problems: how many there are. */
  problems: (n: number) => string;
}

/** The words `<scxml-data>` shows by default, in English. */
export const defaultDataStrings: DataStrings = {
  add: (name) => `Add ${name}`,
  remove: (name) => `Remove ${name}`,
  item: (name, i) => `${name} ${i + 1}`,
  unset: "not set",
  choose: "One of",
  anyPlaceholder: "JSON, or text",
  empty: "none",
  problems: (n) => (n === 1 ? "1 problem" : `${n} problems`),
  required: "Required",
  notNumber: "A number",
  notInteger: "A whole number",
  atLeast: (n) => `At least ${n}`,
  atMost: (n) => `At most ${n}`,
  above: (n) => `More than ${n}`,
  below: (n) => `Less than ${n}`,
  oneOf: (values) => `One of ${values.join(", ")}`,
  minLength: (n) => `At least ${n} characters`,
  maxLength: (n) => `At most ${n} characters`,
  pattern: "Doesn't match the expected form",
  minItems: (n) => `At least ${n} items`,
  maxItems: (n) => `At most ${n} items`,
  notDate: "A date in the expected form",
};
