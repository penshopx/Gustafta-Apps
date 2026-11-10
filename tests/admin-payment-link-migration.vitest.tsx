import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
import { apiRequest } from "@/lib/queryClient";
import { AdminPaymentLinkMigration } from "@/components/admin-payment-link-migration";

const request = vi.mocked(apiRequest);
const phrase = "MIGRASI TAUTAN PEMBAYARAN";
const plan = {
  oldOrigin: "https://old.example",
  targetOrigin: "https://new.example",
  count: 2,
  ignored: 7,
  fingerprint: "a".repeat(64),
  changes: [
    { table: "agents", id: 42, from: "https://old.example/p/a?x=1#detail", to: "https://new.example/p/a?x=1#detail" },
    { table: "store_products", id: 8, from: "https://old.example/p/b", to: "https://new.example/p/b" },
  ],
};

function mount(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <AdminPaymentLinkMigration enabled={enabled} />
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

async function preview() {
  fireEvent.change(screen.getByTestId("payment-link-old-origin"), { target: { value: `${plan.oldOrigin}/` } });
  fireEvent.click(screen.getByTestId("payment-link-preview"));
  await screen.findByTestId("payment-link-preview-results");
}

function approve() {
  fireEvent.change(screen.getByTestId("payment-link-confirmation"), { target: { value: phrase } });
  fireEvent.click(screen.getByTestId("payment-link-apply"));
}

beforeEach(() => request.mockReset());
afterEach(cleanup);

describe("admin checkout-domain migration", () => {
  it("renders nothing and makes no requests without effective admin permission", () => {
    const { container } = mount(false);
    expect(container).toBeEmptyDOMElement();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["http://old.example", "https://old.example/path", "https://old.example?x=1", "https://user:pass@old.example"])(
    "rejects invalid origin %s before requesting a preview", (value) => {
      mount();
      fireEvent.change(screen.getByTestId("payment-link-old-origin"), { target: { value } });
      expect(screen.getByTestId("payment-link-preview")).toBeDisabled();
      expect(screen.getByTestId("payment-link-origin-error")).toBeVisible();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("lists every exact source and destination and skipped count; applies only exact typed approval", async () => {
    request.mockResolvedValueOnce(plan).mockResolvedValueOnce({ updated: { store_products: 1, agents: 1 }, targetOrigin: plan.targetOrigin });
    const { invalidate } = mount();
    await preview();
    for (const change of plan.changes) {
      expect(screen.getByText(change.from)).toBeVisible();
      expect(screen.getByText(change.to)).toBeVisible();
    }
    expect(screen.getByTestId("payment-link-change-count")).toHaveTextContent("2");
    expect(screen.getByTestId("payment-link-ignored-count")).toHaveTextContent("7");
    expect(screen.getByTestId("payment-link-apply")).toBeDisabled();
    fireEvent.change(screen.getByTestId("payment-link-confirmation"), { target: { value: phrase.toLowerCase() } });
    expect(screen.getByTestId("payment-link-apply")).toBeDisabled();
    approve();
    await screen.findByTestId("payment-link-success");
    expect(screen.getByTestId("payment-link-success")).toHaveTextContent("2 tautan");
    expect(request).toHaveBeenNthCalledWith(2, "POST", "/api/admin/payment-links/apply", {
      oldOrigin: plan.oldOrigin, fingerprint: plan.fingerprint, confirmation: phrase,
    });
    expect(screen.queryByTestId("payment-link-preview-results")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/store/admin/products"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/store/catalog"] });
  });

  it("discards review and approval when the old origin changes", async () => {
    request.mockResolvedValueOnce(plan).mockResolvedValueOnce(plan);
    mount();
    await preview();
    fireEvent.change(screen.getByTestId("payment-link-confirmation"), { target: { value: phrase } });
    fireEvent.change(screen.getByTestId("payment-link-old-origin"), { target: { value: plan.oldOrigin } });
    expect(screen.queryByTestId("payment-link-preview-results")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("payment-link-preview"));
    await screen.findByTestId("payment-link-preview-results");
    expect(screen.getByTestId("payment-link-confirmation")).toHaveValue("");
    expect(screen.getByTestId("payment-link-apply")).toBeDisabled();
  });

  it("discards approval when requesting another preview", async () => {
    request.mockResolvedValue(plan);
    mount();
    await preview();
    fireEvent.change(screen.getByTestId("payment-link-confirmation"), { target: { value: phrase } });
    fireEvent.click(screen.getByTestId("payment-link-preview"));
    await screen.findByTestId("payment-link-preview-results");
    expect(screen.getByTestId("payment-link-confirmation")).toHaveValue("");
    expect(screen.getByTestId("payment-link-apply")).toBeDisabled();
  });

  it.each(["409: {\"error\":\"changed\"}", "500: {\"error\":\"Migration failed\"}", "Network error"])(
    "requires fresh review after an apply failure (%s)", async (message) => {
      request.mockResolvedValueOnce(plan).mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(plan);
      mount();
      await preview();
      approve();
      await screen.findByTestId("payment-link-error");
      expect(screen.getByTestId("payment-link-error")).toHaveTextContent(/pratinjau baru/i);
      expect(screen.queryByTestId("payment-link-preview-results")).not.toBeInTheDocument();
      expect(request).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByTestId("payment-link-preview"));
      await screen.findByTestId("payment-link-preview-results");
      expect(screen.getByTestId("payment-link-confirmation")).toHaveValue("");
      expect(screen.getByTestId("payment-link-apply")).toBeDisabled();
    },
  );

  it("offers no apply for zero matching links", async () => {
    request.mockResolvedValueOnce({ ...plan, changes: [], count: 0 });
    mount();
    await preview();
    expect(screen.getByTestId("payment-link-empty")).toBeVisible();
    expect(screen.queryByTestId("payment-link-confirmation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-link-apply")).not.toBeInTheDocument();
  });

  it("locks inputs during pending preview and apply to prevent stale approval", async () => {
    let resolvePreview!: (value: unknown) => void;
    let resolveApply!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve; }));
    mount();
    fireEvent.change(screen.getByTestId("payment-link-old-origin"), { target: { value: plan.oldOrigin } });
    fireEvent.click(screen.getByTestId("payment-link-preview"));
    expect(screen.getByTestId("payment-link-old-origin")).toBeDisabled();
    expect(screen.getByTestId("payment-link-preview")).toBeDisabled();
    resolvePreview(plan);
    await screen.findByTestId("payment-link-preview-results");
    request.mockImplementationOnce(() => new Promise(resolve => { resolveApply = resolve; }));
    approve();
    expect(screen.getByTestId("payment-link-old-origin")).toBeDisabled();
    expect(screen.getByTestId("payment-link-confirmation")).toBeDisabled();
    expect(screen.getByTestId("payment-link-apply")).toBeDisabled();
    resolveApply({ updated: { store_products: 1, agents: 1 } });
    await waitFor(() => expect(screen.getByTestId("payment-link-preview")).toBeEnabled());
  });
});
