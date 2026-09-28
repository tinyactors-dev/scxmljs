# Frameworks

`<scxml-view>` and `<scxml-explorer>` are standard custom elements, so they work in any framework
that renders HTML. Each framework has its own syntax for three things:

- **Registering**: import `@tinyactors/scxmljs/view` or `/explorer` once, in the browser.
- **Properties**: `session`, `clock`, `options` and `strings` take objects, so they must be set as
  properties, not attributes.
- **Events**: `scxml-load`, `scxml-error`, `scxml-send`, `scxml-focus` and `scxml-select` are
  `CustomEvent`s with dashes in their names.

> **Verified:** every snippet on this page is a file of a real app in
> [`examples/frameworks/`](../examples/frameworks/) (React 19.3, Vue 3.5, Svelte 5.57, Angular 22.2).
> CI builds each app with its framework's own toolchain and loads it in a browser, and the docs
> check fails if a snippet and its file ever differ.

## Plain HTML

<!-- doctest: html files=traffic-light.scxml -->
```html
<script type="module">
  import "@tinyactors/scxmljs/view";

  const view = document.querySelector("scxml-view");
  view.addEventListener("scxml-load", (e) => console.log("running", e.detail.session.sessionId));
</script>

<scxml-view src="traffic-light.scxml"></scxml-view>
```

## React 19

React 19 sets properties on custom elements when the element has them, and listens for custom
events with `on` + the exact event name.

<!-- doctest: app file=examples/frameworks/react/src/App.tsx -->
```tsx
import { useEffect, useState } from "react";
import { createSession, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";

export function Chart({ src }: { src: string }) {
  return <scxml-view src={src} trusted onscxml-load={(e) => console.log(e.detail.session)} />;
}

export function Explorer({ source }: { source: string }) {
  const [session, setSession] = useState<SCXMLSession>();
  useEffect(() => {
    let s: SCXMLSession | undefined;
    createSession(source).then((created) => {
      s = created;
      setSession(created);
      created.start();
    });
    return () => s?.dispose();
  }, [source]);
  return <scxml-explorer session={session} />;
}
```

TypeScript needs the elements declared for JSX once:

<!-- doctest: app file=examples/frameworks/react/src/scxml-elements.d.ts -->
```tsx
import type { ScxmlExplorer } from "@tinyactors/scxmljs/explorer";
import type { ScxmlView, ViewLoadDetail } from "@tinyactors/scxmljs/view";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "scxml-view": React.HTMLAttributes<ScxmlView> & {
        src?: string;
        trusted?: boolean;
        "onscxml-load"?: (e: CustomEvent<ViewLoadDetail>) => void;
      };
      "scxml-explorer": React.HTMLAttributes<ScxmlExplorer> & { session?: ScxmlExplorer["session"] };
    }
  }
}
```

With server-side rendering (Next.js, Remix), import the element modules only in the browser (a
client component, or a dynamic `import()` in an effect). Importing them on the server is safe but
does nothing.

## Vue 3

Tell Vue's compiler which tags are custom elements, then use `.prop` for objects and `@` for
events:

<!-- doctest: app file=examples/frameworks/vue/vite.config.ts -->
```ts
// vite.config.ts
import vue from "@vitejs/plugin-vue";

export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag: string) => tag.startsWith("scxml-") } } })],
};
```

<!-- doctest: app file=examples/frameworks/vue/src/Chart.vue -->
```vue
<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from "vue";
import { createSession, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";

const props = defineProps<{ source: string }>();
const session = shallowRef<SCXMLSession>();
createSession(props.source).then((s) => {
  session.value = s;
  s.start();
});
onBeforeUnmount(() => session.value?.dispose());
</script>

<template>
  <scxml-view src="/charts/traffic-light.scxml" trusted @scxml-load="(e) => console.log(e.detail)" />
  <scxml-explorer :session.prop="session" />
</template>
```

Use `shallowRef` for sessions: Vue must not wrap them in a reactive proxy.

## Svelte 5

Svelte sets properties on custom elements when the element has them. Listen for dashed events
with an action or `addEventListener`:

<!-- doctest: app file=examples/frameworks/svelte/src/Chart.svelte -->
```svelte
<script lang="ts">
  import { onDestroy } from "svelte";
  import { createSession, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
  import "@tinyactors/scxmljs/explorer";
  import "@tinyactors/scxmljs/view";

  let { source }: { source: string } = $props();
  let session = $state.raw<SCXMLSession>();
  createSession(source).then((s) => {
    session = s;
    s.start();
  });
  onDestroy(() => session?.dispose());

  function onLoad(node: HTMLElement) {
    const handler = (e: Event) => console.log((e as CustomEvent).detail);
    node.addEventListener("scxml-load", handler);
    return { destroy: () => node.removeEventListener("scxml-load", handler) };
  }
</script>

<scxml-view src="/charts/traffic-light.scxml" trusted use:onLoad></scxml-view>
<scxml-explorer {session}></scxml-explorer>
```

In SvelteKit, import the element modules only in the browser (for example in `onMount`), or turn
off SSR for the page.

## Angular

Allow custom elements in the component, bind objects with `[property]` and events with `(event)`:

<!-- doctest: app file=examples/frameworks/angular/src/app/chart.component.ts -->
```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, type OnDestroy, type OnInit, signal } from "@angular/core";
import { createSession, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";

@Component({
  selector: "app-chart",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <scxml-view src="/charts/traffic-light.scxml" trusted (scxml-load)="loaded($event)"></scxml-view>
    <scxml-explorer [session]="session()"></scxml-explorer>
  `,
})
export class ChartComponent implements OnInit, OnDestroy {
  @Input({ required: true }) source!: string;
  session = signal<SCXMLSession | undefined>(undefined);

  async ngOnInit() {
    const s = await createSession(this.source);
    this.session.set(s);
    s.start();
  }
  ngOnDestroy() {
    this.session()?.dispose();
  }
  loaded(e: Event) {
    console.log((e as CustomEvent).detail);
  }
}
```

## Things to know in every framework

- **Who owns the session.** A session you create is yours to `dispose()`, typically when the
  component unmounts. A session `<scxml-view>` created from `src` is the element's: it's disposed
  when the element leaves the page.
- **Don't make sessions reactive.** Frameworks that wrap objects in proxies (Vue's `ref`, Svelte's
  `$state`, MobX) must hold sessions, clocks and models as raw values.
- **Re-rendering.** Changing `src` or `trusted` makes `<scxml-view>` start a fresh session. Setting
  the same value again does nothing.
