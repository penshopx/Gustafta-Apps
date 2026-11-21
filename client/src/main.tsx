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
  if (import.meta.env.DEV) {
    // The production worker caches transformed JavaScript, including Vite's
    // optimized React modules. Never let an old worker serve mixed dependency
    // versions to the HMR client during local development.
    const cleanup = Promise.all([
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      ),
      "caches" in window ? window.caches.delete("gustafta-v3") : Promise.resolve(false),
    ]).catch(() => undefined);

    if (navigator.serviceWorker.controller) {
      const cleanupKey = "gustafta-dev-worker-cleared";
      try {
        if (window.sessionStorage.getItem(cleanupKey)) {
          window.sessionStorage.removeItem(cleanupKey);
        } else {
          window.sessionStorage.setItem(cleanupKey, "1");
          void cleanup.finally(() => window.location.reload());
        }
      } catch {
        // Storage can be unavailable in restricted browser contexts; cleanup
        // still runs, and the next manual reload will use the network.
      }
    }
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <PageErrorBoundary>
    <App />
  </PageErrorBoundary>
);
