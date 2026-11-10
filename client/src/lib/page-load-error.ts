// Vite also reports CSS preload failures, whose message varies by version.
// Remember the original payload without suppressing its rejection: React.lazy
// must reject so an error boundary can render the recovery UI.
const preloadErrors = new WeakSet<object>();

export function recordPreloadError(event: Event) {
  const payload = (event as Event & { payload?: unknown }).payload;
  if (payload !== null && (typeof payload === "object" || typeof payload === "function")) {
    preloadErrors.add(payload);
  }
}

export function isPageLoadError(error: unknown): boolean {
  if (error !== null && (typeof error === "object" || typeof error === "function")) {
    if (preloadErrors.has(error)) return true;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Loading chunk .+ failed|Unable to preload CSS/i.test(message);
}
