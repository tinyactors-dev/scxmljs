/** Every page: theme toggle, mobile menus, copy buttons. */
const root = document.documentElement;

document.querySelector(".theme-toggle")?.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* private mode: the choice lasts for this page */
  }
});

function disclosure(button: Element | null, container: Element | null) {
  if (!button || !container) return;
  button.addEventListener("click", () => {
    const open = !container.hasAttribute("data-open");
    container.toggleAttribute("data-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
}
disclosure(document.querySelector(".menu-button"), document.querySelector(".site-header"));
disclosure(document.querySelector(".docs-nav-toggle"), document.querySelector(".docs-nav"));

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  button.addEventListener("click", async () => {
    const text = document.querySelector(button.dataset.copy!)?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select it";
    }
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
}
