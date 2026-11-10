import React, { lazy, Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PageErrorBoundary } from "../client/src/components/page-error-boundary";
import { isPageLoadError, recordPreloadError } from "../client/src/lib/page-load-error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("page load recovery", () => {
  it.each([
    "Failed to fetch dynamically imported module: /assets/old.js",
    "error loading dynamically imported module: /assets/old.js",
    "Importing a module script failed.",
    "Loading chunk 12 failed.",
    "Unable to preload CSS for /assets/old.css",
  ])("recognizes module loading failure: %s", message => {
    expect(isPageLoadError(new TypeError(message))).toBe(true);
  });

  it("recognizes Vite payloads without swallowing the lazy rejection", () => {
    const error = new Error("browser-specific preload failure");
    const event = new Event("vite:preloadError", { cancelable: true });
    Object.assign(event, { payload: error });
    recordPreloadError(event);
    expect(isPageLoadError(error)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(isPageLoadError(new Error("ordinary render bug"))).toBe(false);
    recordPreloadError(new Event("vite:preloadError"));
    expect(isPageLoadError(undefined)).toBe(false);
  });

  it("shows a rejected lazy route, waits offline, and reloads only once on click", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    render(<PageErrorBoundary><Suspense fallback="Loading"><Broken /></Suspense></PageErrorBoundary>);
    expect(await screen.findByText("Halaman belum berhasil dimuat")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Muat ulang halaman" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(reload).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    fireEvent(window, new Event("online"));
    expect(button).toBeEnabled();
    expect(reload).not.toHaveBeenCalled();
    // A stale online state must not permit a reload after connection loss.
    online.mockReturnValue(false);
    fireEvent.click(button);
    expect(reload).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it("hides technical details for unrelated render errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = (): React.ReactNode => { throw new Error("private diagnostic stack"); };
    const view = render(<PageErrorBoundary key="/broken"><Broken /></PageErrorBoundary>);
    expect(screen.getByText("Halaman mengalami kendala")).toBeInTheDocument();
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
    view.rerender(<PageErrorBoundary key="/other"><p>Other route</p></PageErrorBoundary>);
    expect(screen.getByText("Other route")).toBeInTheDocument();
    expect(screen.queryByTestId("page-recovery")).not.toBeInTheDocument();
  });
});
