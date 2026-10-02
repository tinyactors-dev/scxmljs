// Bun bundles charts as text: `import chart from "./x.scxml" with { type: "text" }`.
declare module "*.scxml" {
  const text: string;
  export default text;
}
