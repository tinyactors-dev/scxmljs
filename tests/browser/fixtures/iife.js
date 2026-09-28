// Classic script: uses the globals the IIFE bundles define (window.scxml, <scxml-explorer>).
(async () => {
  const text = await (await fetch("/charts/traffic-light.scxml")).text();
  const session = await window.scxml.createSession(text);
  document.getElementById("explorer").attach({ session });
  session.start();
  window.__session = session;
})()
  .catch((e) => window.__events.push(`iife:error:${e.message}`))
  .finally(() => {
    window.__ready = true;
  });
