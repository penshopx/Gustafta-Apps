/**
 * Store utama — tombol Beli membuka tujuan checkout yang benar.
 *
 * Kontrak Store utama sengaja variant-first agar order Scalev dan webhook
 * fulfillment terbentuk. paymentUrl dipakai bila produk tidak memiliki variant.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("wouter", async () => {
  const actual = await vi.importActual<typeof import("wouter")>("wouter");
  return {
    ...actual,
    useLocation: () => ["/store", vi.fn()],
    Link: ({ children, href, ...rest }: any) => (
      <a href={href} {...rest}>{children}</a>
    ),
  };
});

vi.mock("@/hooks/use-cart", () => ({
  useCart: () => ({
    addItem: vi.fn(),
    totalItems: 0,
    openCart: vi.fn(),
    items: [],
  }),
}));

vi.mock("@/components/cart-drawer", () => ({
  CartDrawer: () => <div data-testid="mock-cart-drawer" />,
}));

vi.mock("@/lib/meta-pixel", () => ({
  trackLead: vi.fn(),
  trackViewContent: vi.fn(),
  trackInitiateCheckout: vi.fn(),
}));

import Store from "../client/src/pages/store";
import { PAYMENT_BASE_URL } from "../client/src/lib/payment-base";
import { getQueryFn } from "../client/src/lib/queryClient";

const CONTACT = {
  primary: "6281287941900",
  secondary: "6282299417818",
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    productId: 42,
    name: "Produk Uji",
    category: "engineering",
    tagline: "Tagline uji",
    description: "Deskripsi uji",
    productSummary: "Ringkasan uji",
    productFeatures: ["Fitur A"],
    emoji: "🤖",
    color: "#7c3aed",
    price: 150000,
    originalPrice: null,
    agentId: null,
    paymentUrl: null,
    scalevVariantId: null,
    ...overrides,
  };
}

function buildFetch(product: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    if (url.includes("/api/store/catalog/categories")) return Promise.resolve(jsonResponse([]));
    if (url.includes("/api/store/catalog/modules")) return Promise.resolve(jsonResponse([]));
    if (url.includes("/api/store/catalog")) {
      return Promise.resolve(jsonResponse({
        items: [product],
        total: 1,
        page: 1,
        limit: 18,
        pages: 1,
      }));
    }
    if (url.includes("/api/subscriptions/status")) {
      return Promise.resolve(jsonResponse({
        clientKey: "",
        paymentConfigured: false,
        isSandbox: true,
      }));
    }
    if (url.includes("/api/config/contact")) return Promise.resolve(jsonResponse(CONTACT));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
}

function renderStore(product: Record<string, unknown>) {
  global.fetch = buildFetch(product) as typeof fetch;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        gcTime: 0,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <Store />
    </QueryClientProvider>,
  );
}

describe("Store utama — tujuan tombol pembelian", () => {
  let originalFetch: typeof global.fetch;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    originalFetch = global.fetch;
    window.localStorage.clear();
    window.history.replaceState({}, "", "/store");
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("scalevVariantId-only membuka checkout variant dengan qty=1", async () => {
    renderStore(makeProduct({ scalevVariantId: 98765 }));

    fireEvent.click(await screen.findByTestId("button-buy-prod-1"));

    expect(openSpy).toHaveBeenCalledWith(
      `${PAYMENT_BASE_URL}/c/checkout?variant_ids=98765&qty=1`,
      "_blank",
    );
  });

  it("paymentUrl dipakai saat produk tidak memiliki scalevVariantId", async () => {
    renderStore(makeProduct({
      paymentUrl: "https://bayar.dokumenproyek.com/pl/produk-uji?coupon=HEMAT",
    }));

    fireEvent.click(await screen.findByTestId("button-wa-prod-1"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const opened = new URL(String(openSpy.mock.calls[0][0]));
    expect(`${opened.origin}${opened.pathname}`).toBe(
      "https://bayar.dokumenproyek.com/pl/produk-uji",
    );
    expect(opened.searchParams.get("coupon")).toBe("HEMAT");
    expect(opened.searchParams.get("product_ref")).toBe("42");
    expect(openSpy.mock.calls[0][1]).toBe("_blank");
  });

  it("tanpa variant dan paymentUrl membuka fallback inquiry WhatsApp", async () => {
    renderStore(makeProduct());

    fireEvent.click(await screen.findByTestId("button-wa-prod-1"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = String(openSpy.mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/wa\.me\/6282299417818\?text=/);
    expect(decodeURIComponent(url)).toContain("Produk Uji");
    expect(url).not.toContain("/c/checkout");
    expect(openSpy.mock.calls[0][1]).toBe("_blank");
  });
});