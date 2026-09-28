// Bun imports stylesheets as text with `import css from "./x.css" with { type: "text" }`.
declare module "*.css" {
  const text: string;
  export default text;
}
