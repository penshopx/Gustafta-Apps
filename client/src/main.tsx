import { createRoot } from "react-dom/client";
import App from "./App";
import { PageErrorBoundary } from "./components/page-error-boundary";
import { recordPreloadError } from "./lib/page-load-error";
import "./index.css";

window.addEventListener("vite:preloadError", recordPreloadError);

window.__pwaInstalled = false;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
});

window.addEventListener("appinstalled", () => {
  window.__pwaInstalled = true;
  window.__pwaInstallPrompt = undefined;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(
  <PageErrorBoundary>
    <App />
  </PageErrorBoundary>
);
