// Loaded first, as a classic script, by every fixture page: records CSP violations and
// element events for the tests to read back.
window.__violations = [];
window.__events = [];
document.addEventListener("securitypolicyviolation", (e) => {
  window.__violations.push(`${e.effectiveDirective} ${e.blockedURI || ""}`.trim());
});
// ?dir=rtl: right-to-left pages (checked by the browser tests)
if (new URLSearchParams(location.search).get("dir") === "rtl") document.documentElement.dir = "rtl";
