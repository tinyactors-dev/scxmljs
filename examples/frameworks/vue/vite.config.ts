// vite.config.ts
import vue from "@vitejs/plugin-vue";

export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag: string) => tag.startsWith("scxml-") } } })],
};
