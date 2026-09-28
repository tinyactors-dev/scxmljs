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
