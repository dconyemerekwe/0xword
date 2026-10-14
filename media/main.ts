// Webview entry point, bundled to media/dist/main.js. Phase 2 placeholder:
// the game UI arrives in Phase 3.

const app = document.getElementById("app");
if (app) {
  // Set from the script, so seeing this text proves the bundle loaded and ran.
  app.textContent = "0xWORD is ready. The game is on its way.";
}
