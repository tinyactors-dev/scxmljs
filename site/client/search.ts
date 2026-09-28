/** Search page: Pagefind's UI over the build-time index (/pagefind/), prefilled from ?q=. */
declare const PagefindUI: new (options: Record<string, unknown>) => { triggerSearch(term: string): void };

const ui = new PagefindUI({ element: "#search", showSubResults: true, showImages: false, resetStyles: false, autofocus: true });
// Pagefind's input has only a placeholder: give it a real accessible name
document.querySelector("#search input")?.setAttribute("aria-label", "Search the documentation");
const q = new URLSearchParams(location.search).get("q");
if (q) ui.triggerSearch(q);
