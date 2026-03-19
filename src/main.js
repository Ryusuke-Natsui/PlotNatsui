import { renderPlot } from "./plot.js";
import { bindUi, renderAll } from "./ui.js";

let deferredPrompt = null;

function setupPwaInstall() {
  const installBtn = document.getElementById("installBtn");

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (installBtn) installBtn.hidden = false;
  });

  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
}

async function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  bindUi();
  renderAll();
  await renderPlot();
  setupPwaInstall();
  await setupServiceWorker();
});
