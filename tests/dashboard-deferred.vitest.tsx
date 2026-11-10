import React, { lazy, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DeferredDashboardContent } from "../client/src/components/dashboard/deferred-content";

afterEach(cleanup);

describe("dashboard features load on first use", () => {
  it("does not import closed content, shows loading, then retains drafts after closing", async () => {
    let finish!: (module: { default: typeof Draft }) => void;
    function Draft() {
      const [draft, setDraft] = useState("");
      return <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />;
    }
    const loader = vi.fn(() => new Promise<{ default: typeof Draft }>(resolve => { finish = resolve; }));
    const Feature = lazy(loader);
    const { rerender } = render(<DeferredDashboardContent active={false}><Feature /></DeferredDashboardContent>);
    expect(loader).not.toHaveBeenCalled();
    rerender(<DeferredDashboardContent active><Feature /></DeferredDashboardContent>);
    expect(screen.getByRole("status")).toHaveTextContent("Memuat fitur dashboard");
    finish({ default: Draft });
    const input = await screen.findByRole("textbox", { name: "Draft" });
    fireEvent.change(input, { target: { value: "draft tetap ada" } });
    rerender(<DeferredDashboardContent active={false}><Feature /></DeferredDashboardContent>);
    rerender(<DeferredDashboardContent active><Feature /></DeferredDashboardContent>);
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("draft tetap ada");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("resets retained chat state on agent change, without loading an unopened chat", async () => {
    function Chat() {
      const [draft, setDraft] = useState("");
      return <input aria-label="Pesan" value={draft} onChange={e => setDraft(e.target.value)} />;
    }
    const { rerender } = render(<DeferredDashboardContent key="agent-a" active><Chat /></DeferredDashboardContent>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "untuk A" } });
    rerender(<DeferredDashboardContent key="agent-b" active={false}><Chat /></DeferredDashboardContent>);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    rerender(<DeferredDashboardContent key="agent-b" active><Chat /></DeferredDashboardContent>);
    expect(await screen.findByRole("textbox")).toHaveValue("");
  });
});
