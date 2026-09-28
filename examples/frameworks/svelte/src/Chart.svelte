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
