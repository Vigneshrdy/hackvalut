// Applies the saved theme before first paint to avoid a flash.
// Kept in its own file because the CSP (script-src 'self') blocks inline scripts,
// which silently reverted a saved dark theme on every reload.
if (localStorage.getItem("hackvault:theme") === "dark" ||
    (!localStorage.getItem("hackvault:theme") && matchMedia("(prefers-color-scheme: dark)").matches)) {
  document.documentElement.classList.add("dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#10161f");
}
